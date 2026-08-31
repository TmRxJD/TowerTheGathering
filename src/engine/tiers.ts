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

/** Search depth by tier: a beatable 1-ply intro, 2-ply anti-cheese through the mid tiers, and a
 *  3-ply searcher from Tier 14 (battle conditions) up — it reads two of your turns ahead, so it holds
 *  removal, avoids overcommitting, and sets up lethal far better. (3-ply ≈ 31ms/turn, imperceptible.) */
export function tierAiDepth(level: number): number {
  const t = clampTier(level)
  return t <= 1 ? 1 : t < 14 ? 2 : 3
}

/**
 * Boss life/mana edge for (tier, boss index). The curve is deliberately shaped: Tier 1 is a fair
 * fight and the early tiers stay easy; a steady ramp climbs through the mid tiers; from Tier 14 the
 * "battle conditions" bite; Tiers 21+ turn vicious and Tier 24 is a near-impossible wall that only an
 * optimally-played, fully-levelled deck can crack.
 */
export function tierBossHandicap(level: number, index: number): { bonusLife: number; bonusStartMana: number } {
  const t = clampTier(level)
  // Tuned against a search-vs-search sim so that even OPTIMAL play is walled only near the very top
  // (a normal player feels it far sooner). Too steep and the optimal Autoplay demo can't reach T24.
  const base = Math.round(Math.max(0, t - 1) * 1.2) // a clear step every tier from Tier 2
  const hard = Math.round(Math.max(0, t - 13) * 1.5) // the mid-late squeeze, from Tier 14
  const brutal = Math.max(0, t - 20) * 2 // Tiers 21-24 spike
  const backHalf = index >= 8 ? Math.max(0, t - 7) : 0 // bosses 8-10 get extra, from Tier 8
  const capstone = index === 10 ? Math.round(Math.max(0, t - 2) * 1.1) : 0 // the tier boss grows fastest
  const bonusStartMana = t >= 23 ? 1 : 0 // a small tempo edge only at the very top
  return { bonusLife: base + hard + brutal + backHalf + capstone, bonusStartMana }
}

/** Battle-condition player nerf: starting life lost, from Tier 14 up, accelerating past Tier 20 —
 *  but tempered so the very top isn't a one-hit coin-flip (the boss's huge HP carries the wall). */
export function tierPlayerLifePenalty(level: number): number {
  const t = clampTier(level)
  return Math.max(0, t - (BATTLE_CONDITION_TIER - 1)) // T14 -1 … T24 -11
}
