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

export const MAX_TIER = 24
/** From this tier up, the player takes on "battle conditions" (nerfs), as in The Tower. */
export const BATTLE_CONDITION_TIER = 14

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

export function tierName(level: number): string {
  return `Tier ${clampTier(level)}`
}

/** 1-ply for the intro tier, 2-ply (anti-cheese) from Tier 2 up. */
export function tierAiDepth(level: number): number {
  return clampTier(level) <= 1 ? 1 : 2
}

/** Boss life/mana edge for (tier, boss index). Tier 1 is a fair fight; it climbs gradually. */
export function tierBossHandicap(level: number, index: number): { bonusLife: number; bonusStartMana: number } {
  const t = clampTier(level)
  const flat = Math.round(Math.max(0, t - 2) * 1.5) // all bosses, from Tier 3 up
  const backHalf = index >= 8 ? Math.max(0, t - 2) : 0 // bosses 8-10 get extra
  const capstone = index === 10 ? Math.max(0, t - 1) * 2 : 0 // final boss grows fastest
  const bonusStartMana = t >= 20 ? 2 : t >= 14 ? 1 : 0 // a tempo edge only at the very top
  return { bonusLife: flat + backHalf + capstone, bonusStartMana }
}

/** Battle-condition player nerf: starting life lost, from Tier 14 up (0 below it). */
export function tierPlayerLifePenalty(level: number): number {
  return Math.max(0, clampTier(level) - (BATTLE_CONDITION_TIER - 1)) // T14 -1 … T24 -11
}
