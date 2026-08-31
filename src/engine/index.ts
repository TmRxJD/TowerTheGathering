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
export { createEngine } from './engine'
