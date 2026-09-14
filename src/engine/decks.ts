/**
 * Decks — the starter and the 10 ladder boss decks. Every deck is exactly TUNING.DECK_SIZE (20)
 * cards and respects COPY_LIMITS; `validateDeck` enforces both and is unit-tested, so a mis-built
 * deck here fails loudly rather than silently dealing an illegal hand.
 *
 * Each boss also carries an `archetype`, which the heuristic AI reads to weight its play
 * (see src/ai). The archetype is the deck's identity, not just flavour.
 */

import { getCard } from './cards'
import { COPY_LIMITS, COMBAT_SCALE, TUNING } from './tuning'
import type { EnemySkill } from './types'

export type Archetype = 'balanced' | 'turtle' | 'aggro' | 'ramp' | 'nuke-control' | 'orbs-burst'

export interface BossDeck {
  readonly index: number // 1..10
  readonly name: string
  readonly archetype: Archetype
  readonly cards: readonly string[]
}

/** Expand a compact [cardId, count] list into a flat deck array. */
function deck(entries: ReadonlyArray<readonly [string, number]>): string[] {
  const out: string[] = []
  for (const [id, n] of entries) for (let i = 0; i < n; i++) out.push(id)
  return out
}

/** The player's default FULL 20-card deck (a full deck from Tier 1 — see maxDeckForTier). A rounded,
 *  capable list: walls to survive, First-Strike attackers, army buffs, freeze/removal, an econ engine,
 *  and a Nuke finisher — everything a real deck needs, so your power is complete from the start and the
 *  ladder's difficulty comes from the enemies scaling up, not from your deck filling out. */
export const STARTER_DECK: readonly string[] = deck([
  ['fortress', 3], // walls
  ['land-mine-stun', 2], // trap/defender
  ['extra-orbs', 2], // First-Strike attackers
  ['berserker', 1],
  ['damage', 2], // army buffs
  ['attack-speed', 1],
  ['health-regen', 1], // sustain
  ['coins', 1], // economy
  ['cash', 1],
  ['plasma-cannon', 2], // removal
  ['energy-net', 1],
  ['death-ray', 1],
  ['nuke', 1], // finisher
  ['recovery-package', 1],
])

export const BOSS_DECKS: readonly BossDeck[] = [
  {
    index: 1,
    name: 'Basic',
    archetype: 'balanced',
    cards: deck([
      ['fortress', 3],
      ['extra-orbs', 1],
      ['land-mine-stun', 2],
      ['damage', 2],
      ['health', 2],
      ['health-regen', 2],
      ['range', 1],
      ['cash', 3],
      ['coins', 2],
      ['plasma-cannon', 1],
      ['intro-sprint', 1],
    ]),
  },
  {
    index: 2,
    name: 'Fast',
    archetype: 'aggro',
    cards: deck([
      ['extra-orbs', 2],
      ['berserker', 1],
      ['fortress', 1],
      ['damage', 3],
      ['attack-speed', 3],
      ['critical-chance', 3],
      ['orbs-speed', 2],
      ['cash', 3],
      ['ultimate-crit', 1],
      ['range', 1],
    ]),
  },
  {
    index: 3,
    name: 'Tank',
    archetype: 'turtle',
    cards: deck([
      ['fortress', 3],
      ['land-mine-stun', 2],
      ['berserker', 1],
      ['health', 3],
      ['health-regen', 3],
      ['extra-defense', 3],
      ['slow-aura', 2],
      ['recovery-package', 1],
      ['energy-shield', 1],
      ['coins', 1],
    ]),
  },
  {
    index: 4,
    name: 'Ranged',
    archetype: 'orbs-burst',
    cards: deck([
      ['extra-orbs', 2],
      ['fortress', 2],
      ['orbs-speed', 2],
      ['range', 3],
      ['damage', 3],
      ['attack-speed', 2],
      ['cash', 3],
      ['plasma-cannon', 2],
      ['ultimate-crit', 1],
    ]),
  },
  {
    index: 5,
    name: 'Vampire',
    archetype: 'balanced',
    cards: deck([
      ['fortress', 3],
      ['extra-orbs', 2],
      ['berserker', 1],
      ['damage', 2],
      ['health-regen', 2],
      ['coins', 2],
      ['critical-coin', 1],
      ['plasma-cannon', 2],
      ['death-ray', 1],
      ['recovery-package', 1],
      ['demon-mode', 1],
      ['cash', 2],
    ]),
  },
  {
    index: 6,
    name: 'Protector',
    archetype: 'turtle',
    cards: deck([
      ['fortress', 3],
      ['land-mine-stun', 2],
      ['extra-orbs', 2],
      ['berserker', 1],
      ['slow-aura', 2],
      ['health-regen', 2],
      ['extra-defense', 2],
      ['plasma-cannon', 2],
      ['energy-net', 1],
      ['recovery-package', 1],
      ['coins', 2],
    ]),
  },
  {
    index: 7,
    name: 'Saboteur',
    archetype: 'nuke-control',
    cards: deck([
      ['fortress', 3],
      ['land-mine-stun', 2],
      ['extra-orbs', 2],
      ['slow-aura', 1],
      ['health-regen', 2],
      ['extra-defense', 2],
      ['wave-skip', 1],
      ['plasma-cannon', 2],
      ['energy-net', 1],
      ['death-ray', 1],
      ['nuke', 1],
      ['coins', 2],
    ]),
  },
  {
    index: 8,
    name: 'Scatter',
    archetype: 'aggro',
    cards: deck([
      ['berserker', 1],
      ['extra-orbs', 2],
      ['fortress', 2],
      ['damage', 3],
      ['attack-speed', 3],
      ['critical-chance', 3],
      ['demon-mode', 1],
      ['recovery-package', 1],
      ['cash', 3],
      ['range', 1],
    ]),
  },
  {
    index: 9,
    name: 'Overcharge',
    archetype: 'balanced',
    cards: deck([
      ['coins', 2],
      ['critical-coin', 1],
      ['cash', 2],
      ['wave-accelerator', 1],
      ['fortress', 2],
      ['extra-orbs', 2],
      ['berserker', 1],
      ['health-regen', 2],
      ['death-ray', 1],
      ['demon-mode', 1],
      ['nuke', 1],
      ['plasma-cannon', 2],
      ['super-tower', 1],
      ['damage', 1],
    ]),
  },
  {
    index: 10,
    name: 'Commander',
    archetype: 'balanced',
    cards: deck([
      ['fortress', 3],
      ['extra-orbs', 2],
      ['berserker', 1],
      ['super-tower', 1],
      ['damage', 2],
      ['health-regen', 2],
      ['plasma-cannon', 2],
      ['death-ray', 1],
      ['energy-net', 1],
      ['demon-mode', 1],
      ['nuke', 1],
      ['second-wind', 1],
      ['coins', 2],
    ]),
  },
  {
    index: 11,
    name: 'Boss',
    archetype: 'balanced',
    cards: deck([
      ['fortress', 3],
      ['extra-orbs', 2],
      ['berserker', 1],
      ['super-tower', 1],
      ['damage', 2],
      ['health-regen', 2],
      ['plasma-cannon', 2],
      ['death-ray', 1],
      ['energy-net', 1],
      ['demon-mode', 1],
      ['nuke', 1],
      ['second-wind', 1],
      ['coins', 1],
      ['cash', 1],
    ]),
  },
]

/** A boss's innate enemy skill, by its (canonical Tower enemy) name. Basic has none; the 11th "Boss"
 *  rung is the real Boss enemy — its threat is a huge HP pile (see tierBossHandicap), not a passive. */
export function bossSkill(name: string): EnemySkill {
  switch (name) {
    case 'Fast': return 'fast'
    case 'Tank': return 'tank'
    case 'Ranged': return 'ranged'
    case 'Vampire': return 'vampire'
    case 'Protector': return 'protector'
    case 'Saboteur': return 'saboteur'
    case 'Scatter': return 'scatter'
    case 'Overcharge': return 'overcharge'
    case 'Commander': return 'commander'
    case 'Boss': return 'boss'
    default: return 'none' // Basic
  }
}

/** Player-facing description of each enemy's signature ability — the single source of truth shared by
 *  the in-game enemy tooltip, the Help screen, and the docs. Each entry is one plain sentence naming the
 *  threat and how to plan against it. Kept in step with the EnemySkill effects in engine.ts. */
export const ENEMY_SKILL_INFO: Readonly<Record<EnemySkill, string>> = {
  none: 'No special ability — a straight fight.',
  fast: 'First Strike — its units strike first in every combat, dealing their damage before yours lands.',
  tank: 'Armored — its units enter with a big chunk of bonus HP, so they take extra hits to clear.',
  ranged: 'Reach — its units attack from the back row and can hit an adjacent lane when their own is clear.',
  vampire: 'Lifedrain — each of its turns it drains HP from your Tower into its own, and shuts off your Health Regen.',
  protector: 'Damage Reduction — its units shrug off part of every hit (at least 1 still lands).',
  saboteur: 'Sabotage — each of its turns it taps your strongest unit, so that unit skips its next attack.',
  scatter: 'Split — when one of its units dies, a small token spawns in its place to keep the lane contested.',
  overcharge: 'Overcharge — every 3rd of its turns it fires a charged ray for burst damage straight to your Tower.',
  commander: 'Rally — all of its units get bonus ATK, so its whole board hits harder.',
  boss: 'Boss — no passive, but a massive wall of extra HP. Bring sustained damage to grind it down.',
}

/**
 * Ladder handicap for a boss. Both sides run the same AI and card pool, so difficulty comes from
 * the boss's deck AND an escalating edge: later bosses start with more life, and the top tier with a
 * tempo lead. Tuned via the harness (pnpm harness) to a rising win curve.
 */
export function bossHandicap(index: number): { bonusLife: number; bonusStartMana: number } {
  // The depth-2 search bosses provide the difficulty by out-playing you, so no early padding at all
  // (bosses 1–5 are a fair fight). The back half gets a light, escalating life edge purely to make
  // the finale feel like a capstone. Tuned via `pnpm harness:ladder`.
  return {
    bonusLife: index === 10 ? 4 * COMBAT_SCALE : 0, // a light capstone edge on the final boss only
    bonusStartMana: 0,
  }
}

export interface DeckValidation {
  readonly ok: boolean
  readonly errors: readonly string[]
}

/** Enforce deck size and per-rarity copy limits. Unit-tested against every built-in deck. Boss decks
 *  are authored at DECK_SIZE (20); the player's starter is smaller and grows per tier, so its expected
 *  size is passed explicitly. */
export function validateDeck(cards: readonly string[], expectedSize: number = TUNING.DECK_SIZE): DeckValidation {
  const errors: string[] = []
  if (cards.length !== expectedSize) {
    errors.push(`deck has ${cards.length} cards, expected ${expectedSize}`)
  }
  const counts = new Map<string, number>()
  for (const id of cards) counts.set(id, (counts.get(id) ?? 0) + 1)
  for (const [id, n] of counts) {
    let def
    try {
      def = getCard(id)
    } catch {
      errors.push(`unknown card: ${id}`)
      continue
    }
    const limit = COPY_LIMITS[def.rarity]
    if (n > limit) errors.push(`${id}: ${n} copies exceeds ${def.rarity} limit ${limit}`)
  }
  return { ok: errors.length === 0, errors }
}
