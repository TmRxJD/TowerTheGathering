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

/** Cost in shards to raise a card from `level` to `level + 1` (valid for level 1..6). */
export function levelUpCost(level: number): number {
  return level * level * 6 // 6 · 24 · 54 · 96 · 150 · 216  → 546 to max a card's 7 levels
}

/** Cost in shards to raise a card's mastery from `mastery` to `mastery + 1` (valid for mastery 0..8). */
export function masteryUpCost(mastery: number): number {
  return 60 * (mastery + 1) // 60 · 120 … 540  → 2700 for a full 0→9
}

/**
 * Shards awarded for beating boss `boss` (1..10) at `tier`. A per-tier base bonus that grows with
 * tier² dwarfs the small per-boss bump, so a tier-N run is worth far more than any lower tier — the
 * incentive is always to climb, never to farm a cleared tier.
 */
export function tierShardBonus(tier: number): number {
  return tier * tier * 2 // per-boss base: T1 = 2, T5 = 50, T10 = 200, T24 = 1152
}

/**
 * The per-boss bump also scales with tier, so *both* terms grow as you climb — a higher tier is
 * always worth far more than any lower one, and replaying a cleared low tier for "easy" shards is
 * never worth it. Tier 1 is unchanged (75/ladder); tier 24 pays ~12.8k/ladder (~170× tier 1).
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
  for (let b = 1; b <= 10; b++) c += shardReward(tier, b)
  return c
}
