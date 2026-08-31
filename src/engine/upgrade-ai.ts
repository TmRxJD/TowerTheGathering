/**
 * The upgrade strategy shared by the progression simulator and the in-game Autoplay: given a shard
 * bank and the deck the AI is running, decide which cards to level. It is deliberately strategic, not
 * cheapest-first — it scores each available upgrade by the impact it buys per shard and spends on the
 * best one repeatedly. So it pours shards into the cards it actually leans on (weighted by copies and
 * card power), prefers upgrades that meaningfully move a card, and only chases the pricey masteries on
 * its best cards once their levels are done.
 */

import { cardValue, weakestIndex, rewardCandidates } from './deckbuild'
import { cardLevelValue, CARD_MAX_LEVEL, MASTERY_MAX_LEVEL } from './card-progression'
import { levelUpCost, masteryUpCost } from './economy'
import { TUNING } from './tuning'
import type { CardLevels } from './types'

const uniq = (deck: readonly string[]): string[] => [...new Set(deck)]

/** The value-per-shard of a card's next available upgrade (level, then mastery), or null if maxed. */
function scoreUpgrade(
  coll: CardLevels,
  deck: readonly string[],
  id: string,
): { kind: 'level' | 'mastery'; cost: number; score: number } | null {
  const e = coll[id] ?? { level: 1, mastery: 0 }
  const copies = deck.filter(c => c === id).length
  const importance = copies * Math.max(1, cardValue(id))
  let kind: 'level' | 'mastery'
  let cost: number
  let before: number
  let after: number
  if (e.level < CARD_MAX_LEVEL) {
    kind = 'level'
    cost = levelUpCost(e.level)
    before = cardLevelValue(id, e.level, e.mastery)
    after = cardLevelValue(id, e.level + 1, e.mastery)
  } else if (e.mastery < MASTERY_MAX_LEVEL) {
    kind = 'mastery'
    cost = masteryUpCost(e.mastery)
    before = cardLevelValue(id, CARD_MAX_LEVEL, e.mastery)
    after = cardLevelValue(id, CARD_MAX_LEVEL, e.mastery + 1)
  } else {
    return null
  }
  const gain = Math.max(0.02, (after - before) / Math.max(1, Math.abs(before))) // fractional improvement
  return { kind, cost, score: (importance * gain) / cost }
}

/** Spend the bank on the best value-per-shard deck upgrade available, repeatedly. Mutates `coll`. */
export function spendShards(coll: CardLevels, deck: readonly string[], bank: number): { bank: number; bought: number } {
  let bought = 0
  for (;;) {
    let best: { id: string; kind: 'level' | 'mastery'; cost: number; score: number } | null = null
    for (const id of uniq(deck)) {
      const up = scoreUpgrade(coll, deck, id)
      if (up && up.cost <= bank && (best === null || up.score > best.score)) best = { id, ...up }
    }
    if (!best) break
    bank -= best.cost
    const e = coll[best.id] ?? { level: 1, mastery: 0 }
    coll[best.id] = best.kind === 'level' ? { level: e.level + 1, mastery: e.mastery } : { level: e.level, mastery: e.mastery + 1 }
    bought++
  }
  return { bank, bought }
}

/** Take a reward card into the deck; grow toward the cap, trimming the weakest only once over it. */
export function takeRewardAndTrim(deck: string[], rand: () => number): void {
  const offered = rewardCandidates(deck, rand)
  if (offered.length === 0) return
  const pick = offered.sort((a, b) => cardValue(b) - cardValue(a))[0]!
  deck.push(pick)
  if (deck.length > TUNING.MAX_DECK) deck.splice(weakestIndex(deck), 1)
}
