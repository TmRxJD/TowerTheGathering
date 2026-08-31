/**
 * Balance harness. `pnpm harness` plays the starter deck against each of the 10 ladder bosses over
 * many seeds and prints win rate, average turns, and any timeouts. It is the tool that settles
 * balance — hand-playing does not scale, and a timeout or a 0%/100% matchup is a design bug, not a
 * rounding error.
 */

import { BOSS_DECKS, STARTER_DECK, bossHandicap, validateDeck } from '../engine'
import { playMatch } from './match'

const GAMES_PER_BOSS = Number(process.env.TTG_GAMES ?? 200)

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`
}

function main(): void {
  // Fail loudly if any built-in deck is illegal — a mis-built deck must never reach a match.
  const bad: string[] = []
  for (const d of [STARTER_DECK, ...BOSS_DECKS.map(b => b.cards)]) {
    const v = validateDeck(d, d === STARTER_DECK ? STARTER_DECK.length : undefined)
    if (!v.ok) bad.push(v.errors.join('; '))
  }
  if (bad.length > 0) {
    console.error('Illegal decks:\n' + bad.join('\n'))
    process.exit(1)
  }

  console.log(`Starter vs each boss — ${GAMES_PER_BOSS} games each\n`)
  console.log('Boss                         Arch          Win%    AvgTurns  Timeouts')
  console.log('─'.repeat(74))

  let totalWins = 0
  let totalGames = 0
  for (const boss of BOSS_DECKS) {
    let wins = 0
    let turnSum = 0
    let timeouts = 0
    for (let i = 0; i < GAMES_PER_BOSS; i++) {
      const hc = bossHandicap(boss.index)
      const out = playMatch({
        humanDeck: STARTER_DECK,
        aiDeck: boss.cards,
        seed: `boss${boss.index}-${i}`,
        humanArchetype: 'balanced',
        aiArchetype: boss.archetype,
        aiBonusLife: hc.bonusLife,
        aiBonusStartMana: hc.bonusStartMana,
      })
      if (out.timedOut) timeouts++
      else if (out.result!.winner === 'HUMAN') wins++
      turnSum += out.turns
    }
    totalWins += wins
    totalGames += GAMES_PER_BOSS
    const name = `${boss.index}. ${boss.name}`.padEnd(28)
    console.log(
      `${name} ${boss.archetype.padEnd(13)} ${pct(wins, GAMES_PER_BOSS).padStart(6)}  ` +
        `${(turnSum / GAMES_PER_BOSS).toFixed(1).padStart(8)}  ${String(timeouts).padStart(8)}`,
    )
  }
  console.log('─'.repeat(74))
  console.log(`Overall starter win rate: ${pct(totalWins, totalGames)}`)
}

main()
