/**
 * Meta-economy: shard income and card-upgrade costs. Kept pure (no DOM) so the game UI and the
 * progression simulator (src/harness/progression.ts) share one source of truth — the sim's verdict
 * on "how well do costs scale into late tiers" only means something if it prices upgrades exactly as
 * the game does.
 *
 * Income is weighted hard toward higher tiers so climbing the ladder — not grinding tier 1 — is the
 * way to earn. Upgrade costs escalate so maxing the whole collection is a long-term (weeks) grind.
 */

import { CARD_MAX_LEVEL, MASTERY_MAX_LEVEL } from './card-progression'

/** Cost in shards to raise a card from `level` to `level + 1` (valid for level 1..6). Levels are the
 *  mid-game investment: affordable while you climb, a card's 7 levels total 546. */
export function levelUpCost(level: number): number {
  return level * level * 6 // 6 · 24 · 54 · 96 · 150 · 216  → 546 to max a card's 7 levels
}

/**
 * Cost to raise a card's mastery from `mastery` to `mastery + 1` (valid for mastery 0..8). Masteries
 * are the LONG endgame: a sharp quadratic curve so you can't seriously start maxing them until the
 * high tiers pay out. 30 · 120 · 270 · 480 · 750 · 1080 · 1470 · 1920 · 2430  → 8550 for a full 0→9,
 * ~3× a card's levels and steeply back-loaded.
 */
export function masteryUpCost(mastery: number): number {
  return 30 * (mastery + 1) * (mastery + 1)
}

/**
 * Shards awarded for beating boss `boss` (1..10) at `tier`. A per-tier base bonus that grows with
 * tier² dwarfs the small per-boss bump, so a tier-N run is worth far more than any lower tier — the
 * incentive is always to climb, never to farm a cleared tier.
 */
export function tierShardBonus(tier: number): number {
  // LINEAR in tier (was tier²). The quadratic curve back-loaded income so hard that the player's bank
  // surged in the mid tiers, letting the buyer dump it into masteries all at once — a discrete power
  // spike (the T9-12 win-rate bump). Linear income still rewards climbing (T10 pays 10× T1) but rises
  // smoothly, so the player's power — and the win curve — climbs without a lump.
  return tier * 10 // per-boss base: T1 = 10, T5 = 50, T10 = 100, T20 = 200, T24 = 240
}

/**
 * Income is intentionally lean so shards are hard-won: both terms scale with tier, so a higher tier
 * is always worth far more (never farm a cleared low tier), but the totals stay small against the
 * costs. A full ladder pays ≈ 65 at T1, ≈ 5100 at T20, ≈ 7080 at T24 — a whole 24-tier climb earns
 * only ~65k, so maxing levels is a mid-game goal and maxing masteries is a long post-T20 grind.
 */
export function shardReward(tier: number, boss: number): number {
  return tierShardBonus(tier) + boss * tier
}

/** Total shards to take one card from level 1 / mastery 0 to level 7 / mastery 9. */
export function cardMaxCost(): number {
  let c = 0
  for (let l = 1; l < CARD_MAX_LEVEL; l++) c += levelUpCost(l)
  for (let m = 0; m < MASTERY_MAX_LEVEL; m++) c += masteryUpCost(m)
  return c
}

/** Total shards a full 10-boss ladder clear at `tier` pays out. */
export function tierClearReward(tier: number): number {
  let c = 0
  for (let b = 1; b <= 11; b++) c += shardReward(tier, b) // 10 bosses + the final Boss
  return c
}
