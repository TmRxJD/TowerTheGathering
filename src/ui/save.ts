/**
 * Ladder persistence (localStorage). Stores the highest tier cleared (for gated progression — you
 * can play tiers 1..highestTierCleared+1) and the in-progress run (tier + boss + built deck) so it
 * survives reloads. Every access is try/catch-guarded: storage can be unavailable (private windows,
 * blocked site data) and must never crash the game — we fall back to a fresh save.
 */

import { ALL_CARD_IDS, TUNING, clampTier, getCard } from '../engine'

const KEY = 'ttg.save.v2'

export interface SaveState {
  /** Highest tier whose 10-boss ladder has been fully cleared (0 = none). Unlocks tier+1. */
  highestTierCleared: number
  /** The in-progress run to resume, or null. */
  run: { tier: number; bossIndex: number; deck: string[] } | null
}

const VALID_IDS = new Set(ALL_CARD_IDS)

function fresh(): SaveState {
  return { highestTierCleared: 0, run: null }
}

export function loadSave(): SaveState {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return fresh()
    const parsed = JSON.parse(raw) as Partial<SaveState>
    const highestTierCleared = clampInt(parsed.highestTierCleared, 0, 24, 0)
    let run: SaveState['run'] = null
    if (parsed.run && Array.isArray(parsed.run.deck)) {
      const deck = parsed.run.deck.filter(id => typeof id === 'string' && VALID_IDS.has(id))
      if (deck.length === TUNING.DECK_SIZE && copiesLegal(deck)) {
        run = { tier: clampTier(parsed.run.tier ?? 1), bossIndex: clampInt(parsed.run.bossIndex, 1, 10, 1), deck }
      }
    }
    return { highestTierCleared, run }
  } catch {
    return fresh()
  }
}

export function writeSave(state: SaveState): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(state))
  } catch {
    /* storage unavailable — the run just won't persist this session */
  }
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
