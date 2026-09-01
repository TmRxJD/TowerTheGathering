/**
 * Between-boss deckbuilding helpers, shared by the game UI, the CLI, and the ladder harness so the
 * three never drift: how a reward is offered, how a card's power is judged, and which card a
 * reasonable player trims. Randomness is injected (`rand: () => number` in [0,1)) so callers pick
 * their own source — Math.random in the browser, a seeded RNG in the harness/CLI.
 */

import { ALL_CARD_IDS, COPY_LIMITS, getCard } from './index'
import { COMBAT_SCALE } from './tuning'

/** Rough power value of a card, used to pick the best reward and trim the weakest card. Unit stats are
 *  on the ×COMBAT_SCALE combat scale, so divide them back down to keep the ranking comparable to the
 *  flat per-card values below (which are heuristic weights, not combat numbers). */
export function cardValue(id: string): number {
  const d = getCard(id)
  if (d.type === 'UNIT') return ((d.atk ?? 0) * 1.3 + (d.hp ?? 0) * 0.9) / COMBAT_SCALE + d.cost
  if (id === 'nuke' || id === 'death-ray') return 9
  if (id === 'bot-bot' || id === 'flame-bot' || id === 'guardian-ally') return 8 // premium bots/chips
  if (id === 'plasma-cannon' || id === 'energy-net' || id === 'demon-mode') return 7
  if (id === 'thunder-bot' || id === 'amplify-bot' || id === 'guardian-summon' || id === 'guardian-fetch') return 6.5
  if (id === 'super-tower' || id === 'ultimate-crit' || id === 'recovery-package') return 6
  if (id === 'guardian-attack' || id === 'guardian-bounty' || id === 'guardian-scout') return 5.5
  if (id === 'damage' || id === 'attack-speed' || id === 'critical-chance') return 5
  if (id === 'health-regen' || id === 'health') return 4.5
  // Pure economy (farm shards, no combat value) — the AI, which plays to WIN, rates these low.
  if (id === 'coins' || id === 'golden-bot' || id === 'golden-tower' || id === 'critical-coin') return 2
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
