/**
 * Persistence (localStorage). The game keeps FOUR saves: three player slots you switch between, plus
 * a dedicated Autoplay slot the AI progresses on its own (it is never touched by manual play, and
 * manual play never touches it). Each save holds progression + an in-progress run + lifetime stats.
 *
 * Every access is try/catch-guarded: storage can be unavailable (private windows, blocked site data)
 * and must never crash the game — we fall back to fresh saves. The v2 single-save is migrated into
 * slot 0 on first load.
 */

import { ALL_CARD_IDS, CARD_MAX_LEVEL, STARTER_DECK, clampLevel, clampMastery, clampTier, getCard, maxDeckForTier, type CardLevels } from '../engine'

const KEY = 'ttg.saves.v3'
const LEGACY_KEY = 'ttg.save.v2'
export const PLAYER_SLOTS = 3

/** Lifetime stats for a save, surfaced on the menu/slot picker. */
export interface RunMeta {
  timeMs: number // total time spent in battles
  moves: number // total cards played + turns ended
  matches: number // battles played
  wins: number // battles won
  fastestWinTurns: number | null // fewest turns in a won battle
  fastestTierMs: number | null // fastest full-tier (10-boss) clear
}

export interface SaveState {
  /** Highest tier whose 10-boss ladder has been fully cleared (0 = none). Unlocks tier+1. */
  highestTierCleared: number
  /** The in-progress run to resume, or null. */
  run: { tier: number; bossIndex: number; deck: string[] } | null
  /** Card collection: level (1-7) + mastery level (0-9) per card. Missing = level 1, no mastery. */
  collection: CardLevels
  /** Currency earned from wins, spent to level cards + unlock masteries. */
  shards: number
  /** Lifetime stats. */
  meta: RunMeta
}

/** All four saves plus which player slot is active. */
export interface SavesFile {
  activeSlot: number // 0..PLAYER_SLOTS-1
  slots: SaveState[] // player saves
  ai: SaveState // the Autoplay slot
}

const VALID_IDS = new Set(ALL_CARD_IDS)

export function freshMeta(): RunMeta {
  return { timeMs: 0, moves: 0, matches: 0, wins: 0, fastestWinTurns: null, fastestTierMs: null }
}

export function freshSave(): SaveState {
  return { highestTierCleared: 0, run: null, collection: {}, shards: 0, meta: freshMeta() }
}

function freshFile(): SavesFile {
  return { activeSlot: 0, slots: Array.from({ length: PLAYER_SLOTS }, freshSave), ai: freshSave() }
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt
}

function copiesLegal(deck: string[]): boolean {
  const counts = new Map<string, number>()
  for (const id of deck) counts.set(id, (counts.get(id) ?? 0) + 1)
  for (const [id, n] of counts) {
    const limit = { common: 3, rare: 2, epic: 1 }[getCard(id).rarity]
    if (n > limit) return false
  }
  return true
}

function cleanCollection(raw: unknown): CardLevels {
  const out: CardLevels = {}
  if (raw && typeof raw === 'object') {
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!VALID_IDS.has(id) || !v || typeof v !== 'object') continue
      const e = v as { level?: unknown; mastery?: unknown }
      const level = clampLevel(Number(e.level) || 1)
      const rawMastery = e.mastery === true ? 1 : clampMastery(Number(e.mastery) || 0)
      const mastery = level >= CARD_MAX_LEVEL ? rawMastery : 0
      if (level > 1 || mastery > 0) out[id] = { level, mastery }
    }
  }
  return out
}

function cleanMeta(raw: unknown): RunMeta {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Partial<RunMeta>
  const posOrNull = (v: unknown): number | null => {
    const n = Math.floor(Number(v))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return {
    timeMs: clampInt(m.timeMs, 0, 1e12, 0),
    moves: clampInt(m.moves, 0, 1e9, 0),
    matches: clampInt(m.matches, 0, 1e9, 0),
    wins: clampInt(m.wins, 0, 1e9, 0),
    fastestWinTurns: posOrNull(m.fastestWinTurns),
    fastestTierMs: posOrNull(m.fastestTierMs),
  }
}

function cleanSave(raw: unknown): SaveState {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<SaveState>
  let run: SaveState['run'] = null
  if (s.run && Array.isArray(s.run.deck)) {
    const deck = s.run.deck.filter(id => typeof id === 'string' && VALID_IDS.has(id))
    const tier = clampTier(s.run.tier ?? 1)
    // Deck may be anywhere from the starter size up to this tier's cap (it grows +1 per tier climbed).
    if (deck.length >= STARTER_DECK.length && deck.length <= maxDeckForTier(tier) && copiesLegal(deck)) {
      run = { tier, bossIndex: clampInt(s.run.bossIndex, 1, 10, 1), deck }
    }
  }
  return {
    highestTierCleared: clampInt(s.highestTierCleared, 0, 24, 0),
    run,
    collection: cleanCollection(s.collection),
    shards: clampInt(s.shards, 0, 1e12, 0),
    meta: cleanMeta(s.meta),
  }
}

export function loadSaves(): SavesFile {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SavesFile>
      const slots = Array.from({ length: PLAYER_SLOTS }, (_, i) => cleanSave(parsed.slots?.[i]))
      return { activeSlot: clampInt(parsed.activeSlot, 0, PLAYER_SLOTS - 1, 0), slots, ai: cleanSave(parsed.ai) }
    }
    // Migrate the old single save into slot 0.
    const legacy = globalThis.localStorage?.getItem(LEGACY_KEY)
    const file = freshFile()
    if (legacy) file.slots[0] = cleanSave(JSON.parse(legacy))
    return file
  } catch {
    return freshFile()
  }
}

export function writeSaves(file: SavesFile): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(file))
  } catch {
    /* storage unavailable — progress just won't persist this session */
  }
}
