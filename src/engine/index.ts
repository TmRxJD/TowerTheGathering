/**
 * Public barrel for the engine. Import from here, never deeper — the UI, AI, harness, and host
 * all depend on this surface and nothing internal.
 */

export * from './types'
export { CARD_CATALOG, ALL_CARD_IDS, getCard, MINE_TOKEN } from './cards'
export { TUNING, COPY_LIMITS } from './tuning'
export {
  STARTER_DECK,
  BOSS_DECKS,
  validateDeck,
  bossHandicap,
  type Archetype,
  type BossDeck,
  type DeckValidation,
} from './decks'
export { createRng, type Rng } from './rng'
export { createEngine, createEngineFromState } from './engine'
export { cardValue, rewardCandidates, weakestIndex } from './deckbuild'
export { levelUpCost, masteryUpCost, shardReward, tierShardBonus, cardMaxCost, tierClearReward } from './economy'
export { spendShards, takeRewardAndTrim } from './upgrade-ai'
export {
  CARD_PROG,
  CARD_DISPLAY,
  CARD_MAX_LEVEL,
  MASTERY_MAX_LEVEL,
  cardEffectLabel,
  cardLevelValue,
  cardMasterySpecial,
  cardUnitStat,
  clampLevel,
  clampMastery,
  formatCardValue,
  type CardProg,
  type CardDisplay,
  type MasterySpecial,
} from './card-progression'
export {
  LADDER_TIERS,
  MAX_TIER,
  BATTLE_CONDITION_TIER,
  clampTier,
  maxDeckForTier,
  tierName,
  tierAiDepth,
  tierBossHandicap,
  tierPlayerLifePenalty,
  type LadderTier,
} from './tiers'
