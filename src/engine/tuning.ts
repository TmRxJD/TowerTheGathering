/**
 * Every playtest-deferred number, in one place. The harness sweeps these; nothing else should
 * hard-code a balance constant. See docs/GAME_DESIGN.md.
 */

import type { Rarity } from './types'

/**
 * Base combat unit for the engine's OWN non-card constants (fatigue, walls, tokens, enemy-skill
 * magnitudes) — kept on the same ×10 footing as a card's level-1 value so they interoperate. Card
 * values themselves are NOT scaled here: they carry their real L1 `base` and grow by the geometric law
 * in card-progression.ts (see §6a). Mana / hand / draws / durations / ratios are unscaled.
 */
export const COMBAT_SCALE = 10

export const TUNING = {
  START_LIFE: 20 * COMBAT_SCALE,
  START_MANA_MAX: 1,
  MANA_CAP: 10,
  HAND_LIMIT: 7,
  OPENING_HAND: 3,
  DECK_SIZE: 20, // the size decks are AUTHORED at (starter + every boss)
  MAX_DECK: 26, // the player's deck may grow to this via rewards (tested balanced; 20 felt limiting)
  BACKLINE_SLOTS: 5,
  LANE_STACK_CAP: 4,

  CRIT_CHANCE: 0.3,
  CRIT_MULTIPLIER: 2,
  LAND_MINE_SPAWN_CHANCE: 0.5,

  HEALTH_MODULE_BONUS: 5 * COMBAT_SCALE,
  REGEN_PER_TURN: 1 * COMBAT_SCALE,
  EXTRA_DEFENSE_REDUCTION: 1 * COMBAT_SCALE,
  SECOND_WIND_HEAL: 5 * COMBAT_SCALE,
  DEATH_RAY_MAIN: 6 * COMBAT_SCALE,
  DEATH_RAY_SPLASH: 2 * COMBAT_SCALE,
  DEMON_MODE_ATK: 5 * COMBAT_SCALE,
  SUPER_TOWER_ATK: 3 * COMBAT_SCALE,
  SUPER_TOWER_EVERY: 3,
  ORBS_SPEED_ATK: 2 * COMBAT_SCALE,
  RECOVERY_OVERHEAL: 2 * COMBAT_SCALE,
  PACKAGE_CHANCE_HP: 2 * COMBAT_SCALE,
  ULTIMATE_CRIT_MULTIPLIER: 3,
} as const

/** Max copies of a card allowed in a 20-card deck, by rarity. */
export const COPY_LIMITS: Readonly<Record<Rarity, number>> = {
  common: 3,
  rare: 2,
  epic: 1,
}
