/**
 * Every playtest-deferred number, in one place. The harness sweeps these; nothing else should
 * hard-code a balance constant. See docs/GAME_DESIGN.md.
 */

import type { Rarity } from './types'

export const TUNING = {
  START_LIFE: 20,
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

  HEALTH_MODULE_BONUS: 5,
  REGEN_PER_TURN: 1,
  EXTRA_DEFENSE_REDUCTION: 1,
  SECOND_WIND_HEAL: 5,
  DEATH_RAY_MAIN: 6,
  DEATH_RAY_SPLASH: 2,
  DEMON_MODE_ATK: 5,
  SUPER_TOWER_ATK: 3,
  SUPER_TOWER_EVERY: 3,
  ORBS_SPEED_ATK: 2,
  RECOVERY_OVERHEAL: 2,
  PACKAGE_CHANCE_HP: 2,
  ULTIMATE_CRIT_MULTIPLIER: 3,
} as const

/** Max copies of a card allowed in a 20-card deck, by rarity. */
export const COPY_LIMITS: Readonly<Record<Rarity, number>> = {
  common: 3,
  rare: 2,
  epic: 1,
}
