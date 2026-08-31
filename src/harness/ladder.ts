/**
 * Ladder-run simulation for balance. Unlike run.ts (starter deck vs each boss in isolation), this
 * plays a whole climb the way a real player does: start from the starter, and after each boss win
 * take a reward card and trim the weakest, so the deck strengthens as the ladder gets harder. This
 * is the honest difficulty signal — the isolated table understates late bosses because it never
 * lets the player's deck grow.
 *
 * A reasonable player is modelled: the reward pick and the trim both use a simple card-value
 * heuristic. Meta-randomness (which 3 cards are offered) flows through the seeded RNG so runs are
 * reproducible.
 */

import {
  BOSS_DECKS,
  STARTER_DECK,
  clampTier,
  createRng,
  rewardCandidates,
  cardValue,
  tierAiDepth,
  tierBossHandicap,
  tierName,
  tierPlayerLifePenalty,
  weakestIndex,
} from '../engine'
import { playMatch } from './match'

const RUNS = Number(process.env.TTG_RUNS ?? 400)
const PLAYER_AI = (process.env.TTG_PLAYER === 'heuristic' ? 'heuristic' : 'search') as 'heuristic' | 'search'
const TIER = clampTier(Number(process.env.TTG_TIER ?? 2))

/** Offer 3 legal candidates and take the highest-value one — the modelled player's reward pick. */
function pickReward(deck: string[], rng: { next(): number }): string | null {
  const offered = rewardCandidates(deck, () => rng.next())
  if (offered.length === 0) return null
  return offered.sort((a, b) => cardValue(b) - cardValue(a))[0]!
}

interface LadderResult {
  reached: number // highest boss faced
  cleared: number // highest boss beaten (0 = beat none)
}

function playLadder(seed: string): LadderResult {
  const rng = createRng(`${seed}-meta`)
  const deck = [...STARTER_DECK]
  let cleared = 0
  for (const boss of BOSS_DECKS) {
    const hc = tierBossHandicap(TIER, boss.index)
    const out = playMatch({
      humanDeck: deck,
      aiDeck: boss.cards,
      seed: `${seed}-b${boss.index}`,
      humanArchetype: 'balanced',
      aiArchetype: boss.archetype,
      aiBonusLife: hc.bonusLife,
      aiBonusStartMana: hc.bonusStartMana,
      humanBonusLife: -tierPlayerLifePenalty(TIER),
      aiDepth: tierAiDepth(TIER),
      humanAi: PLAYER_AI,
      aiAi: 'search',
    })
    const won = !out.timedOut && out.result!.winner === 'HUMAN'
    if (!won) return { reached: boss.index, cleared }
    cleared = boss.index
    const reward = pickReward(deck, rng)
    if (reward) {
      deck.push(reward)
      deck.splice(weakestIndex(deck), 1)
    }
  }
  return { reached: BOSS_DECKS.length, cleared: BOSS_DECKS.length }
}

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`
}

function main(): void {
  const reachedAt = new Array(BOSS_DECKS.length + 1).fill(0) // reached[i] = runs that FACED boss i
  const clearedAt = new Array(BOSS_DECKS.length + 1).fill(0) // cleared[i] = runs that BEAT boss i
  let fullClears = 0
  for (let i = 0; i < RUNS; i++) {
    const r = playLadder(`run${i}`)
    for (let b = 1; b <= r.reached; b++) reachedAt[b]++
    for (let b = 1; b <= r.cleared; b++) clearedAt[b]++
    if (r.cleared === BOSS_DECKS.length) fullClears++
  }

  console.log(
    `Ladder runs (deck grows each win) — ${RUNS} runs · Tier ${TIER} (${tierName(TIER)}) · player=${PLAYER_AI} vs boss=search(d${tierAiDepth(TIER)})\n`,
  )
  console.log('Boss                    Arch          Faced   Won@Boss   Clear%(of those who faced)')
  console.log('─'.repeat(84))
  for (const boss of BOSS_DECKS) {
    const faced = reachedAt[boss.index]
    const won = clearedAt[boss.index]
    const name = `${boss.index}. ${boss.name}`.padEnd(23)
    console.log(
      `${name} ${boss.archetype.padEnd(13)} ${String(faced).padStart(5)}   ${String(won).padStart(6)}     ${pct(won, faced)}`,
    )
  }
  console.log('─'.repeat(84))
  console.log(`Full ladder clears: ${fullClears}/${RUNS} (${pct(fullClears, RUNS)})`)
}

main()
