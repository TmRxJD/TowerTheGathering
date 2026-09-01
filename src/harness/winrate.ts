/**
 * Win-rate harness — the measurement tool the difficulty spec (docs/GAME_STATE.md §11) needs.
 *
 * The progression sim is DETERMINISTIC (one seeded climb), so it can't report a win rate. This runs
 * MANY seeded matches per (tier, boss) and reports the actual % — measured against a HEURISTIC player
 * (the human proxy: a real player is far closer to the heuristic than to the depth-N search) facing a
 * full-strength boss (search at its tier depth, real handicap + HP pool + enemy skill).
 *
 * A representative player deck+collection is built by climbing tier-by-tier with the same strategic
 * buyer the progression sim uses; the climb ADVANCES deterministically (shards granted per boss) so the
 * state still builds even when the sampled win rate is low — measurement is decoupled from clearing.
 *
 *   pnpm winrate                       # heuristic player vs search boss, 12 samples/boss
 *   TTG_N=24 pnpm winrate              # more samples (steadier %, slower)
 *   TTG_MAXTIER=12 pnpm winrate        # only the first 12 tiers (fast)
 *   TTG_PLAYER=search pnpm winrate     # measure the optimal player instead (clearability check)
 */

import {
  ALL_CARD_IDS,
  BOSS_DECKS,
  bossSkill,
  CARD_MAX_LEVEL,
  clampTier,
  createRng,
  maxDeckForTier,
  shardReward,
  spendShards,
  STARTER_DECK,
  takeRewardAndTrim,
  tierAiDepth,
  tierBaseLife,
  tierBossHandicap,
  tierPlayerLifePenalty,
  type CardLevels,
} from '../engine'
import { playMatch, type AiKind } from './match'

// Default yardstick: a depth-2 SEARCH player — "an engaged human who thinks a little ahead". The
// HeuristicAI proved too weak/erratic to be a human proxy (it lost ~35% of even trivially-favoured
// games). TTG_PLAYER=heuristic measures the weak-play floor instead.
const PLAYER_AI: AiKind = process.env.TTG_PLAYER === 'heuristic' ? 'heuristic' : 'search'
const BOSS_AI: AiKind = process.env.TTG_BOSS === 'heuristic' ? 'heuristic' : 'search'
const N = Number(process.env.TTG_N ?? 12)
const MAXTIER = clampTier(Number(process.env.TTG_MAXTIER ?? 24))
const SEED = process.env.TTG_SEED ?? 'winrate'

function bossLevels(tier: number): CardLevels {
  const level = Math.min(CARD_MAX_LEVEL, 1 + Math.floor((tier - 1) / 3))
  const mastery = tier >= 13 ? Math.min(6, tier - 12) : 0
  const out: CardLevels = {}
  for (const id of ALL_CARD_IDS) out[id] = { level, mastery }
  return out
}

const pad = (s: string | number, n: number): string => String(s).padStart(n)

/** Target curve from the TCG difficulty spec, for at-a-glance comparison. */
function target(tier: number): string {
  if (tier <= 5) return '90-100'
  if (tier <= 12) return '75-90'
  if (tier <= 18) return '60-75'
  if (tier <= 23) return '45-60'
  return '35-50'
}
function targetTurns(tier: number): string {
  if (tier <= 5) return '6-10'
  if (tier <= 12) return '8-12'
  if (tier <= 18) return '10-14'
  if (tier <= 23) return '12-16'
  return '14-18'
}

function run(): void {
  const coll: CardLevels = {}
  let deck = [...STARTER_DECK]
  let bank = 0
  const rng = createRng(`${SEED}-build`)

  console.log(`Win-rate harness — player=${PLAYER_AI} boss=${BOSS_AI} samples=${N}/boss tiers=1..${MAXTIER}`)
  console.log('Player state built by a strategic climb; win rate sampled over N seeds per boss.\n')
  console.log('tier   winRate  (target)   bossWR   turns  (target)   deckLvl deckMst  size')

  for (let tier = 1; tier <= MAXTIER; tier++) {
    const bl = bossLevels(tier)
    let totalWins = 0
    let totalGames = 0
    let turnSum = 0
    let bossWins = 0 // the final rung-11 Boss specifically
    let bossGames = 0

    for (const boss of BOSS_DECKS) {
      const hc = tierBossHandicap(tier, boss.index)
      for (let s = 0; s < N; s++) {
        const out = playMatch({
          humanDeck: deck,
          aiDeck: boss.cards,
          seed: `${SEED}-t${tier}-b${boss.index}-s${s}`,
          humanArchetype: 'balanced',
          aiArchetype: boss.archetype,
          aiBonusLife: tierBaseLife(tier) + hc.bonusLife,
          aiBonusStartMana: hc.bonusStartMana,
          humanBonusLife: tierBaseLife(tier) - tierPlayerLifePenalty(tier),
          aiDepth: tierAiDepth(tier),
          humanAi: PLAYER_AI,
          aiAi: BOSS_AI,
          humanCardLevels: coll,
          aiCardLevels: bl,
          aiSkill: bossSkill(boss.name),
        })
        const win = out.result?.winner === 'HUMAN'
        totalGames++
        turnSum += out.turns
        if (win) totalWins++
        if (boss.index === BOSS_DECKS.length) {
          bossGames++
          if (win) bossWins++
        }
      }
      // Advance the representative state deterministically (build a plausible deck/collection).
      bank += shardReward(tier, boss.index)
      takeRewardAndTrim(deck, () => rng.next(), maxDeckForTier(tier))
      bank = spendShards(coll, deck, bank).bank
    }

    const ids = [...new Set(deck)]
    const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
    const wr = Math.round((totalWins / totalGames) * 100)
    const bwr = Math.round((bossWins / Math.max(1, bossGames)) * 100)
    const turns = (turnSum / totalGames).toFixed(1)
    const deckLvl = avg(ids.map(id => (coll[id] ?? { level: 1 }).level)).toFixed(1)
    const deckMst = avg(ids.map(id => (coll[id] ?? { mastery: 0 }).mastery)).toFixed(1)
    console.log(
      `${pad(tier, 4)}   ${pad(wr + '%', 6)}  ${pad('(' + target(tier) + ')', 9)}   ${pad(bwr + '%', 6)}  ${pad(turns, 5)}  ${pad('(' + targetTurns(tier) + ')', 9)}   ${pad(deckLvl, 6)}  ${pad(deckMst, 6)}  ${pad(deck.length, 4)}`,
    )
  }
  console.log('\nwinRate = avg across all 11 bosses · bossWR = the rung-11 final Boss only · turns = avg per match')
}

run()
