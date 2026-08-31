/**
 * Ladder persistence. Stored in localStorage under one key so a run survives reloads and — once
 * embedded — page navigations on the host site (the game is served same-origin from the host's
 * public/, so its localStorage is private to the game and persists). Every access is wrapped in
 * try/catch: storage can be unavailable (private windows, blocked site data) and must never crash
 * the game — we just fall back to a fresh save.
 */

import { ALL_CARD_IDS, TUNING, getCard } from '../engine'

const KEY = 'ttg.save.v1'

export interface SaveState {
  /** Highest boss index the player has ever cleared (0 = none). */
  highestCleared: number
  /** The in-progress run to resume, or null if there is none. */
  run: { bossIndex: number; deck: string[] } | null
}

const VALID_IDS = new Set(ALL_CARD_IDS)

function fresh(): SaveState {
  return { highestCleared: 0, run: null }
}

export function loadSave(): SaveState {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return fresh()
    const parsed = JSON.parse(raw) as Partial<SaveState>
    const highestCleared = clampInt(parsed.highestCleared, 0, 10, 0)
    let run: SaveState['run'] = null
    if (parsed.run && Array.isArray(parsed.run.deck)) {
      const deck = parsed.run.deck.filter(id => typeof id === 'string' && VALID_IDS.has(id))
      // Only trust a run whose deck is the right size and whose copies are legal.
      if (deck.length === TUNING.DECK_SIZE && copiesLegal(deck)) {
        run = { bossIndex: clampInt(parsed.run.bossIndex, 1, 10, 1), deck }
      }
    }
    return { highestCleared, run }
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
