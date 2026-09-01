/**
 * Ladder tiers (roguelike "ascension"), matching The Tower's 24-tier structure. The same 10 bosses
 * are replayed at escalating difficulty, so the curve rises gradually across many runs. Progression
 * is GATED: you must full-clear a tier's 10-boss ladder to unlock the next (enforced by the game via
 * the saved `highestTierCleared`).
 *
 * Difficulty levers, tuned via `pnpm winrate` against the fun curve in docs/GAME_STATE.md §3:
 *  - AI depth (`tierAiDepth`)   — 1-ply intro (T1-5), 2-ply (T6-8), 3-ply from T9. The dominant lever.
 *  - Boss handicap (`tierBossHandicap`) — bonus life that climbs each tier + an opening mana edge from
 *                    the mid tiers, and an HP capstone on the final Boss rung.
 *  - Enemy card power (`bossCardLevels`) — levels rise every 3 tiers; a small mastery from T9, the full
 *                    mastery ramp from T13, so the top out-cards you rather than just out-lifes you.
 *  The old per-tier PLAYER life nerf ("battle conditions") is removed — difficulty is all on the boss.
 */

import { COMBAT_SCALE, TUNING } from './tuning'
import { ALL_CARD_IDS } from './cards'
import { CARD_MAX_LEVEL, MASTERY_MAX_LEVEL } from './card-progression'
import type { CardLevels } from './types'

export const MAX_TIER = 24
/** From this tier up, the player takes on "battle conditions" (nerfs), as in The Tower. */
export const BATTLE_CONDITION_TIER = 14
/** The last rung of every tier is the Boss (rung 11) — a huge-HP capstone. = BOSS_DECKS.length. */
export const FINAL_BOSS_RUNG = 11

export interface LadderTier {
  readonly level: number
  readonly name: string
}

export const LADDER_TIERS: readonly LadderTier[] = Array.from({ length: MAX_TIER }, (_, i) => ({
  level: i + 1,
  name: `Tier ${i + 1}`,
}))

export function clampTier(level: number): number {
  return Math.max(1, Math.min(MAX_TIER, Math.floor(level) || 1))
}

/** The player's deck-size cap for a tier: 10 at Tier 1, +1 for every tier climbed, so a full climb
 *  reaches 33 by Tier 24 (34 once Tier 24 itself is cleared). The deck grows toward this cap via the
 *  post-win reward cards — bigger decks mean more variety AND resist fatigue in the long top-tier
 *  slogs, so climbing is rewarded and grinding a low tier for easy shards is not. */
export function maxDeckForTier(level: number): number {
  return 9 + clampTier(level)
}

export function tierName(level: number): string {
  return `Tier ${clampTier(level)}`
}

/** Extra Nexus life BOTH sides receive at a tier, so battles last longer and lengthen as you climb —
 *  the fun is in developing your board, and a 20-HP sprint ends before the build gets going. By the
 *  top tiers this is a long slog where your climbed-up deck size (fatigue resistance) and card levels
 *  decide it. The boss stacks its difficulty edge (tierBossHandicap) ON TOP of this shared pool. */
/** Unscaled shared-life pool (small units); tierBaseLife applies the ×COMBAT_SCALE. */
function baseLifeRaw(t: number): number {
  return Math.round((t - 1) * 0.8) + Math.round(Math.max(0, t - 16) * 1.3) // T1 +0, T12 +9, T24 +28
}

export function tierBaseLife(level: number): number {
  const t = clampTier(level)
  // TCG pacing: battles stay SHORT (a fast mini-game). Small, gently-rising shared pool on top of the
  // ×10-scaled START_LIFE. (The boss stacks its edge — tierBossHandicap — over this.)
  return baseLifeRaw(t) * COMBAT_SCALE
}

/** Search depth by tier: a beatable 1-ply intro (T1-5), 2-ply anti-cheese (T6-8), and a 3-ply searcher
 *  from Tier 9 up — it reads two of your turns ahead, so it holds removal, avoids overcommitting, and
 *  sets up lethal far better. (3-ply ≈ 31ms/turn, imperceptible.) */
export function tierAiDepth(level: number): number {
  const t = clampTier(level)
  // Depth is the dominant difficulty lever vs a human: a searching boss out-plays you regardless of
  // HP. Keep bosses SIMPLE (1-ply) through the easy onboarding tiers, then 3-ply takes over from T9
  // (where an engaged player's built-up deck would otherwise coast) to hold the mid-and-late pressure.
  return t <= 5 ? 1 : t <= 8 ? 2 : 3
}

/**
 * Boss life/mana edge for (tier, boss index). The curve is deliberately shaped: Tier 1 is a fair
 * fight and the early tiers stay easy; a steady ramp climbs through the mid tiers; from Tier 14 the
 * "battle conditions" bite; Tiers 21+ turn vicious and Tier 24 is a near-impossible wall that only an
 * optimally-played, fully-levelled deck can crack.
 */
export function tierBossHandicap(level: number, index: number): { bonusLife: number; bonusStartMana: number } {
  const t = clampTier(level)
  const i = index // 1..11 — position within the tier's ladder (11 = the final Boss)
  // TCG difficulty spec (docs/GAME_STATE.md): a SMOOTH, gentle rise — no nightmare walls, no offense
  // spikes. `climb` is the main knob (harder each tier); `bossRamp` makes later rungs of a tier a bit
  // tougher than earlier ones. Tuned against the win-rate harness to a fun 95%→40% curve, NOT a
  // punishing one. (Replaced the old brutal/nightmare/capstone spikes wholesale.)
  // Across-tier difficulty: starts NEGATIVE so early bosses are genuinely weaker than you (an easy
  // onboarding win), crosses ~T6, and accelerates in the last third for a fair-but-real top-tier fight.
  const climb = Math.round((t - 6) * 5.0 + Math.max(0, t - 12) * 6.0) // steeper: restores late-game pressure
  const bossRamp = Math.round((i - 1) * (0.4 + t * 0.12)) // within-tier ramp; later rungs a touch harder
  // The 11th "Boss" rung is the real Tower Boss enemy: its identity is a chunk of extra HP (kept
  // beatable — scales gently with tier), not an offense spike.
  const finalBoss = i >= FINAL_BOSS_RUNG ? Math.round(baseLifeRaw(t) * 0.8) + Math.round(t * 0.6) : 0
  // Opening tempo edge: a mana lead lets the boss out-develop you — from the mid tiers (where your deck
  // otherwise outpaces it), more at the very top.
  const bonusStartMana = t >= 22 ? 2 : t >= 9 ? 1 : 0
  const raw = (climb + bossRamp + finalBoss) * COMBAT_SCALE
  // Floor so the enemy always starts with real HP — the steep early `climb` is negative enough at T1 to
  // drive total life below zero (an instant, unplayable auto-win). Keep at least 20% of START_LIFE.
  const minBonus = Math.round(TUNING.START_LIFE * 0.2) - TUNING.START_LIFE - tierBaseLife(t)
  return { bonusLife: Math.max(minBonus, raw), bonusStartMana }
}

/** Battle-condition player nerf: starting life lost, from Tier 14 up, accelerating past Tier 20 —
 *  but tempered so the very top isn't a one-hit coin-flip (the boss's huge HP carries the wall). */
export function tierPlayerLifePenalty(level: number): number {
  // Removed for the TCG direction — a shrinking life bar is exactly the "punishing" feel we don't
  // want. Difficulty comes from the boss's gentle handicap + maxed cards, not from gimping the player.
  void level
  return 0
}

/** The card level every enemy card runs at a tier — rises one step every 3 tiers, maxed by ~T19. */
export function bossCardLevel(level: number): number {
  return Math.min(CARD_MAX_LEVEL, 1 + Math.floor((clampTier(level) - 1) / 3))
}

/** The mastery every enemy card runs at a tier. A small mastery comes online at T9 (the band where an
 *  engaged player's built-up deck otherwise outpaces the enemy), then the real ramp from T13 to maxed. */
export function bossCardMastery(level: number): number {
  const t = clampTier(level)
  return t >= 13 ? Math.min(MASTERY_MAX_LEVEL, t - 12) : t >= 9 ? 1 : 0
}

/** The full enemy card-level map for a tier — the single source shared by the game and the harnesses
 *  (previously duplicated in three places, which could silently drift). */
export function bossCardLevels(level: number): CardLevels {
  const lvl = bossCardLevel(level)
  const mastery = bossCardMastery(level)
  const out: CardLevels = {}
  for (const id of ALL_CARD_IDS) out[id] = { level: lvl, mastery }
  return out
}
