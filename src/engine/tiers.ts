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
export function tierBaseLife(level: number): number {
  const t = clampTier(level)
  return 12 + t * 6 // T1 +18 (≈38 HP), T10 +72, T24 +156 — roughly linear growth in battle length
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
  const i = index // 1..10 — position within the tier's ladder
  // Tuned against a search-vs-search sim so that even OPTIMAL play is walled only near the very top
  // (a normal player feels it far sooner). Too steep and the optimal Autoplay demo can't reach T24.
  //
  // Within-tier ramp: boss 1 is the softest of the tier and boss 10 the hardest, and that gap widens
  // with the tier — so climbing the ladder always FEELS like it's getting harder, regardless of which
  // archetype sits at each rung.
  const bossRamp = Math.round((i - 1) * (0.8 + t * 0.28)) // widening within-tier ramp
  const tierFloor = Math.round(Math.max(0, t - 2) * 1.8) // a rising floor across tiers (all bosses)
  const hard = Math.round(Math.max(0, t - 13) * 2.6) // the mid-late squeeze, from Tier 14
  const brutal = Math.max(0, t - 20) * 8 // Tiers 21-24 spike hard
  const nightmare = t >= MAX_TIER ? 90 : 0 // Tier 24 only: a flat wall on every boss (gift-from-god tier)
  const capstone = i >= FINAL_BOSS_RUNG ? Math.round(Math.max(0, t - 2) * 2.6) : 0 // final boss grows fastest
  // The 11th boss is THE Boss (the real Tower boss enemy): a big pile of extra HP on top of all else.
  // Scales with the tier's HP pool so it's a beatable wall on a fresh T1 deck and a monstrous slog up
  // top (where your climbed-up deck can actually chew through it).
  const finalBoss = i >= FINAL_BOSS_RUNG ? Math.round(tierBaseLife(t) * 0.7) : 0
  const bonusStartMana = t >= 23 ? 1 : 0 // a small tempo edge only at the very top
  return { bonusLife: tierFloor + bossRamp + hard + brutal + nightmare + capstone + finalBoss, bonusStartMana }
}

/** Battle-condition player nerf: starting life lost, from Tier 14 up, accelerating past Tier 20 —
 *  but tempered so the very top isn't a one-hit coin-flip (the boss's huge HP carries the wall). */
export function tierPlayerLifePenalty(level: number): number {
  const t = clampTier(level)
  // Scaled against the larger tier HP pool so "battle conditions" stay a real bite at the top: the
  // boss is a long tanky slog, but you fight it on a shorter life bar the higher you climb.
  return Math.max(0, t - (BATTLE_CONDITION_TIER - 1)) * 5 // T14 -5 … T24 -55
}
