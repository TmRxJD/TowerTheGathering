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
  ALL_CARD_IDS,
  BOSS_DECKS,
  COPY_LIMITS,
  STARTER_DECK,
  bossHandicap,
  createRng,
  getCard,
  type Rng,
} from '../engine'
import { playMatch } from './match'

const RUNS = Number(process.env.TTG_RUNS ?? 400)
const PLAYER_AI = (process.env.TTG_PLAYER === 'heuristic' ? 'heuristic' : 'search') as 'heuristic' | 'search'

/** Rough power value of a card for the modelled player's reward/trim choices. */
function cardValue(id: string): number {
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

/** Offer 3 legal candidates (weighted toward commons) and take the highest-value one. */
function pickReward(deck: string[], rng: Rng): string | null {
  const have = counts(deck)
  const pool = ALL_CARD_IDS.filter(id => (have.get(id) ?? 0) < COPY_LIMITS[getCard(id).rarity])
  const weight = (id: string): number => {
    const r = getCard(id).rarity
    return r === 'common' ? 3 : r === 'rare' ? 2 : 1
  }
  const bag = [...pool]
  const offered: string[] = []
  while (offered.length < 3 && bag.length > 0) {
    const total = bag.reduce((s, id) => s + weight(id), 0)
    let roll = rng.next() * total
    let idx = 0
    for (; idx < bag.length; idx++) {
      roll -= weight(bag[idx]!)
      if (roll <= 0) break
    }
    offered.push(bag.splice(Math.min(idx, bag.length - 1), 1)[0]!)
  }
  if (offered.length === 0) return null
  return offered.sort((a, b) => cardValue(b) - cardValue(a))[0]!
}

/** Remove the lowest-value card so the deck returns to size. */
function trimWeakest(deck: string[]): void {
  let worst = 0
  for (let i = 1; i < deck.length; i++) if (cardValue(deck[i]!) < cardValue(deck[worst]!)) worst = i
  deck.splice(worst, 1)
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
    const hc = bossHandicap(boss.index)
    const out = playMatch({
      humanDeck: deck,
      aiDeck: boss.cards,
      seed: `${seed}-b${boss.index}`,
      humanArchetype: 'balanced',
      aiArchetype: boss.archetype,
      aiBonusLife: hc.bonusLife,
      aiBonusStartMana: hc.bonusStartMana,
      humanAi: PLAYER_AI,
      aiAi: 'search',
    })
    const won = !out.timedOut && out.result!.winner === 'HUMAN'
    if (!won) return { reached: boss.index, cleared }
    cleared = boss.index
    const reward = pickReward(deck, rng)
    if (reward) {
      deck.push(reward)
      trimWeakest(deck)
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

  console.log(`Ladder runs (deck grows each win) — ${RUNS} runs · player=${PLAYER_AI} vs boss=search\n`)
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
