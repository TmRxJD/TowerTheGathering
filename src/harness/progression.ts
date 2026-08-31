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
  cardMaxCost,
  clampTier,
  createRng,
  shardReward,
  spendShards,
  takeRewardAndTrim,
  tierAiDepth,
  tierBossHandicap,
  tierClearReward,
  tierPlayerLifePenalty,
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
      takeRewardAndTrim(deck, () => rng.next())
      const s = spendShards(coll, deck, bank)
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
