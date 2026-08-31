/**
 * Decks — the starter and the 10 ladder boss decks. Every deck is exactly TUNING.DECK_SIZE (20)
 * cards and respects COPY_LIMITS; `validateDeck` enforces both and is unit-tested, so a mis-built
 * deck here fails loudly rather than silently dealing an illegal hand.
 *
 * Each boss also carries an `archetype`, which the heuristic AI reads to weight its play
 * (see src/ai). The archetype is the deck's identity, not just flavour.
 */

import { getCard } from './cards'
import { COPY_LIMITS, TUNING } from './tuning'

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

/** The player's default 20-card deck: a rounded, teachable balanced list. */
export const STARTER_DECK: readonly string[] = deck([
  ['fortress', 3],
  ['extra-orbs', 2],
  ['berserker', 1],
  ['land-mine-stun', 2],
  ['damage', 2],
  ['health-regen', 1],
  ['range', 1],
  ['coins', 1],
  ['plasma-cannon', 2],
  ['death-ray', 1],
  ['cash', 2],
  ['recovery-package', 1],
  ['nuke', 1],
])

export const BOSS_DECKS: readonly BossDeck[] = [
  {
    index: 1,
    name: 'Recruit Sentinel',
    archetype: 'balanced',
    cards: deck([
      ['fortress', 3],
      ['extra-orbs', 2],
      ['berserker', 1],
      ['damage', 3],
      ['health', 2],
      ['range', 1],
      ['cash', 2],
      ['plasma-cannon', 2],
      ['recovery-package', 1],
      ['coins', 2],
      ['intro-sprint', 1],
    ]),
  },
  {
    index: 2,
    name: 'Aggro Vanguard',
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
    name: 'Bastion Warden',
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
    name: 'Orbital Barrage',
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
    name: 'Coin Magnate',
    archetype: 'ramp',
    cards: deck([
      ['coins', 3],
      ['critical-coin', 2],
      ['cash', 3],
      ['enemy-balance', 3],
      ['wave-accelerator', 1],
      ['fortress', 2],
      ['extra-orbs', 2],
      ['death-ray', 1],
      ['plasma-cannon', 2],
      ['intro-sprint', 1],
    ]),
  },
  {
    index: 6,
    name: 'Frost Saboteur',
    archetype: 'turtle',
    cards: deck([
      ['slow-aura', 2],
      ['energy-net', 1],
      ['land-mine-stun', 2],
      ['fortress', 3],
      ['health-regen', 2],
      ['extra-defense', 2],
      ['plasma-cannon', 2],
      ['berserker', 1],
      ['coins', 2],
      ['recovery-package', 1],
      ['wave-skip', 2],
    ]),
  },
  {
    index: 7,
    name: 'Nuke Controller',
    archetype: 'nuke-control',
    cards: deck([
      ['fortress', 3],
      ['land-mine-stun', 2],
      ['slow-aura', 2],
      ['health-regen', 2],
      ['extra-defense', 2],
      ['wave-skip', 2],
      ['plasma-cannon', 2],
      ['death-ray', 1],
      ['nuke', 1],
      ['coins', 2],
      ['cash', 1],
    ]),
  },
  {
    index: 8,
    name: 'Berserk Legion',
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
    name: 'Ascendant Ramp',
    archetype: 'ramp',
    cards: deck([
      ['coins', 3],
      ['critical-coin', 2],
      ['cash', 2],
      ['wave-accelerator', 1],
      ['enemy-balance', 2],
      ['fortress', 2],
      ['extra-orbs', 2],
      ['death-ray', 1],
      ['demon-mode', 1],
      ['nuke', 1],
      ['plasma-cannon', 2],
      ['super-tower', 1],
    ]),
  },
  {
    index: 10,
    name: 'The Apex Nexus',
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
]

export interface DeckValidation {
  readonly ok: boolean
  readonly errors: readonly string[]
}

/** Enforce deck size and per-rarity copy limits. Unit-tested against every built-in deck. */
export function validateDeck(cards: readonly string[]): DeckValidation {
  const errors: string[] = []
  if (cards.length !== TUNING.DECK_SIZE) {
    errors.push(`deck has ${cards.length} cards, expected ${TUNING.DECK_SIZE}`)
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
