/**
 * Meta-progression "speedrun" — the honest economy signal. A single player starts fresh (empty
 * collection, 0 shards, the starter deck) and climbs the tiers the way the game intends: play a
 * boss, and on a win earn shards, take a reward card (trim the weakest), then SPEND the bank on card
 * upgrades before the next boss (cheapest deck-card upgrade first — a sensible "keep the whole deck
 * levelling" strategy). It stops when a tier can't be cleared within the retry budget.
 *
 * The point is not match balance (harness:ladder covers that) but the economy: does shard income
 * keep pace with escalating upgrade costs as the tiers climb? The per-tier table shows earned/spent/
 * bank and how far the deck actually levels; the summary prices the whole collection.
 *
 *   pnpm progression                 # heuristic player, fast
 *   TTG_PLAYER=search pnpm progression
 *   TTG_RETRY=30 TTG_MAXTIER=24 pnpm progression
 */

import {
  ALL_CARD_IDS,
  BOSS_DECKS,
  CARD_MAX_LEVEL,
  MASTERY_MAX_LEVEL,
  MAX_TIER,
  STARTER_DECK,
  cardLevelValue,
  cardMaxCost,
  cardValue,
  clampTier,
  createRng,
  levelUpCost,
  masteryUpCost,
  rewardCandidates,
  shardReward,
  tierAiDepth,
  tierBossHandicap,
  tierClearReward,
  tierPlayerLifePenalty,
  weakestIndex,
  type CardLevels,
} from '../engine'
import { playMatch, type AiKind } from './match'

const PLAYER_AI: AiKind = process.env.TTG_PLAYER === 'search' ? 'search' : 'heuristic'
const BOSS_AI: AiKind = process.env.TTG_BOSS === 'search' ? 'search' : 'heuristic'
const RETRY_CAP = Number(process.env.TTG_RETRY ?? 25)
const MAXTIER = clampTier(Number(process.env.TTG_MAXTIER ?? MAX_TIER))
const SEED = process.env.TTG_SEED ?? 'progression'

/** Boss card levels for a tier — mirrors the game's aiCardLevels(): levels rise every 3 tiers, and
 *  masteries come online at tier 13 and climb. */
function bossLevels(tier: number): CardLevels {
  const level = Math.min(CARD_MAX_LEVEL, 1 + Math.floor((tier - 1) / 3))
  const mastery = tier >= 13 ? Math.min(MASTERY_MAX_LEVEL, tier - 12) : 0
  const out: CardLevels = {}
  for (const id of ALL_CARD_IDS) out[id] = { level, mastery }
  return out
}

const uniq = (deck: string[]): string[] => [...new Set(deck)]

/**
 * Score a card's next upgrade by the impact it buys per shard — a strategic buyer, not a cheapest-
 * first one. Impact = how much this card matters to THIS deck (copies × its power) × the fractional
 * power the upgrade adds; divided by cost. So the player pours shards into the cards it actually
 * leans on, favours upgrades that meaningfully move a card, and only chases the pricey masteries on
 * its best cards once their levels are done.
 */
function scoreUpgrade(
  coll: CardLevels,
  deck: string[],
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

/** Spend the bank on the best value-per-shard deck upgrade available, repeatedly. */
function spend(coll: CardLevels, deck: string[], bank: number): { bank: number; bought: number } {
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

function pickReward(deck: string[], rng: { next(): number }): string | null {
  const offered = rewardCandidates(deck, () => rng.next())
  if (offered.length === 0) return null
  return offered.sort((a, b) => cardValue(b) - cardValue(a))[0]!
}

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const pad = (s: string | number, n: number): string => String(s).padStart(n)

function run(): void {
  const coll: CardLevels = {}
  let deck = [...STARTER_DECK]
  let bank = 0
  let totalEarned = 0
  let totalMatches = 0
  let totalUpgrades = 0
  const rng = createRng(`${SEED}-meta`)

  console.log(`Progression speedrun — player=${PLAYER_AI} boss=${BOSS_AI} retryCap=${RETRY_CAP} tiers=1..${MAXTIER}`)
  console.log(`One card fully maxed = ${cardMaxCost()} shards · whole ${ALL_CARD_IDS.length}-card collection = ${cardMaxCost() * ALL_CARD_IDS.length} shards\n`)
  console.log('tier  clr  matches  earned   bank    ups  deckLvl  deckMaxed  tierPayout')

  for (let tier = 1; tier <= MAXTIER; tier++) {
    const bl = bossLevels(tier)
    let earned = 0
    let matches = 0
    let ups = 0
    let stuck: number | null = null

    for (const boss of BOSS_DECKS) {
      let win = false
      let attempts = 0
      while (!win && attempts < RETRY_CAP) {
        const hc = tierBossHandicap(tier, boss.index)
        const out = playMatch({
          humanDeck: deck,
          aiDeck: boss.cards,
          seed: `${SEED}-t${tier}-b${boss.index}-a${attempts}`,
          humanArchetype: 'balanced',
          aiArchetype: boss.archetype,
          aiBonusLife: hc.bonusLife,
          aiBonusStartMana: hc.bonusStartMana,
          humanBonusLife: -tierPlayerLifePenalty(tier),
          aiDepth: tierAiDepth(tier),
          humanAi: PLAYER_AI,
          aiAi: BOSS_AI,
          humanCardLevels: coll,
          aiCardLevels: bl,
        })
        attempts++
        matches++
        totalMatches++
        win = out.result?.winner === 'HUMAN'
      }
      if (!win) {
        stuck = boss.index
        break
      }
      const r = shardReward(tier, boss.index)
      bank += r
      earned += r
      totalEarned += r
      const rew = pickReward(deck, rng)
      if (rew) {
        deck.push(rew)
        deck.splice(weakestIndex(deck), 1)
      }
      const s = spend(coll, deck, bank)
      bank = s.bank
      ups += s.bought
      totalUpgrades += s.bought
    }

    const deckLvls = uniq(deck).map(id => (coll[id] ?? { level: 1 }).level)
    const maxed = uniq(deck).filter(id => {
      const e = coll[id] ?? { level: 1, mastery: 0 }
      return e.level >= CARD_MAX_LEVEL && e.mastery >= MASTERY_MAX_LEVEL
    }).length
    console.log(
      `${pad(tier, 4)}  ${stuck ? ' ✗ ' : ' ✓ '}  ${pad(matches, 7)}  ${pad(earned, 6)}  ${pad(bank, 6)}  ${pad(ups, 5)}  ${pad(avg(deckLvls).toFixed(1), 7)}  ${pad(maxed + '/' + uniq(deck).length, 9)}  ${pad(tierClearReward(tier), 10)}`,
    )
    if (stuck) {
      console.log(`\nSTUCK at Tier ${tier}, boss ${stuck} — lost ${RETRY_CAP} straight even after upgrading.`)
      break
    }
  }

  console.log(`\nTotals: ${totalMatches} matches · ${totalEarned} shards earned · ${totalUpgrades} upgrades bought · ${bank} banked`)
  const deckMaxed = uniq(deck).filter(id => {
    const e = coll[id] ?? { level: 1, mastery: 0 }
    return e.level >= CARD_MAX_LEVEL && e.mastery >= MASTERY_MAX_LEVEL
  }).length
  console.log(`Deck: ${uniq(deck).length} unique cards, ${deckMaxed} fully maxed, avg level ${avg(uniq(deck).map(id => (coll[id] ?? { level: 1 }).level)).toFixed(2)}`)
}

run()
