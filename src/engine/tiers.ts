/**
 * Ladder tiers (roguelike "ascension"), matching The Tower's 24-tier structure. The same 10 bosses
 * are replayed at escalating difficulty, so the curve rises gradually across many runs. Progression
 * is GATED: you must full-clear a tier's 10-boss ladder to unlock the next (enforced by the game via
 * the saved `highestTierCleared`).
 *
 * Difficulty levers, tuned via `TTG_TIER=<n> pnpm harness:ladder`:
 *  - AI depth      — Tier 1 uses the 1-ply search (competent but beatable, for learning); Tier 2+
 *                    use the 2-ply anti-cheese search.
 *  - Boss handicap — bonus life that climbs each tier (flat to all bosses, extra to the back half, a
 *                    growing capstone on the final boss) plus start-mana at the highest tiers.
 *  - Battle conditions — from Tier 14 up (as in The Tower) the PLAYER is also nerfed: escalating
 *    lost starting life. Higher tiers are meant to be brutal; most players won't reach the top.
 */

import { COMBAT_SCALE } from './tuning'

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

/** Search depth by tier: a beatable 1-ply intro, 2-ply anti-cheese through the mid tiers, and a
 *  3-ply searcher from Tier 14 (battle conditions) up — it reads two of your turns ahead, so it holds
 *  removal, avoids overcommitting, and sets up lethal far better. (3-ply ≈ 31ms/turn, imperceptible.) */
export function tierAiDepth(level: number): number {
  const t = clampTier(level)
  // Depth is the dominant difficulty lever vs a human: a searching boss out-plays you regardless of
  // HP. So keep bosses SIMPLE (1-ply) through the easy onboarding tiers, step up to the anti-cheese
  // 2-ply for the mid game, and only bring the 2-turn-lookahead 3-ply out for the top tiers.
  return t <= 6 ? 1 : t <= 11 ? 2 : 3
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
  const climb = Math.round((t - 6) * 3.2 + Math.max(0, t - 14) * 4.0) // steeper: compensates buffed player cards
  const bossRamp = Math.round((i - 1) * (0.4 + t * 0.12)) // within-tier ramp; later rungs a touch harder
  // The 11th "Boss" rung is the real Tower Boss enemy: its identity is a chunk of extra HP (kept
  // beatable — scales gently with tier), not an offense spike.
  const finalBoss = i >= FINAL_BOSS_RUNG ? Math.round(baseLifeRaw(t) * 0.8) + Math.round(t * 0.6) : 0
  const bonusStartMana = t >= 23 ? 1 : 0 // a tiny opening tempo edge only at the very top (mana, unscaled)
  return { bonusLife: (climb + bossRamp + finalBoss) * COMBAT_SCALE, bonusStartMana }
}

/** Battle-condition player nerf: starting life lost, from Tier 14 up, accelerating past Tier 20 —
 *  but tempered so the very top isn't a one-hit coin-flip (the boss's huge HP carries the wall). */
export function tierPlayerLifePenalty(level: number): number {
  // Removed for the TCG direction — a shrinking life bar is exactly the "punishing" feel we don't
  // want. Difficulty comes from the boss's gentle handicap + maxed cards, not from gimping the player.
  void level
  return 0
}
