/**
 * Between-boss deckbuilding helpers, shared by the game UI, the CLI, and the ladder harness so the
 * three never drift: how a reward is offered, how a card's power is judged, and which card a
 * reasonable player trims. Randomness is injected (`rand: () => number` in [0,1)) so callers pick
 * their own source — Math.random in the browser, a seeded RNG in the harness/CLI.
 */

import { ALL_CARD_IDS, COPY_LIMITS, getCard } from './index'

/** Rough power value of a card, used to pick the best reward and trim the weakest card. */
export function cardValue(id: string): number {
  const d = getCard(id)
  if (d.type === 'UNIT') return (d.atk ?? 0) * 1.3 + (d.hp ?? 0) * 0.9 + d.cost
  if (id === 'nuke' || id === 'death-ray') return 9
  if (id === 'plasma-cannon' || id === 'energy-net' || id === 'demon-mode') return 7
  if (id === 'super-tower' || id === 'ultimate-crit' || id === 'recovery-package') return 6
  if (id === 'damage' || id === 'attack-speed' || id === 'critical-chance') return 5
  if (id === 'health-regen' || id === 'coins' || id === 'critical-coin' || id === 'health') return 4.5
  if (id === 'enemy-balance') return 1 // self-harm; a decent player avoids it
  return 3
}

function counts(deck: readonly string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const id of deck) m.set(id, (m.get(id) ?? 0) + 1)
  return m
}

/** Offer up to `n` distinct legal candidates (respecting copy limits), weighted toward commons. */
export function rewardCandidates(deck: readonly string[], rand: () => number, n = 3): string[] {
  const have = counts(deck)
  const pool = ALL_CARD_IDS.filter(id => (have.get(id) ?? 0) < COPY_LIMITS[getCard(id).rarity])
  const weight = (id: string): number => {
    const r = getCard(id).rarity
    return r === 'common' ? 3 : r === 'rare' ? 2 : 1
  }
  const bag = [...pool]
  const picks: string[] = []
  while (picks.length < n && bag.length > 0) {
    const total = bag.reduce((s, id) => s + weight(id), 0)
    let roll = rand() * total
    let idx = 0
    for (; idx < bag.length; idx++) {
      roll -= weight(bag[idx]!)
      if (roll <= 0) break
    }
    picks.push(bag.splice(Math.min(idx, bag.length - 1), 1)[0]!)
  }
  return picks
}

/** Index of the lowest-value card — what a reasonable player trims to get back to deck size. */
export function weakestIndex(deck: readonly string[]): number {
  let worst = 0
  for (let i = 1; i < deck.length; i++) if (cardValue(deck[i]!) < cardValue(deck[worst]!)) worst = i
  return worst
}
