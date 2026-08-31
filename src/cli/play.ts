/**
 * Headless text playthrough. `pnpm play [bossIndex] [seed]` runs the starter deck vs a boss with the
 * heuristic AI on both sides and prints a compact turn log — a quick sanity check that a real game
 * unfolds sensibly without opening a browser.
 */

import { BOSS_DECKS, STARTER_DECK, createEngine, type Side } from '../engine'
import { HeuristicAI } from '../ai'

const bossIndex = Math.min(Math.max(1, Number(process.argv[2] ?? 1)), BOSS_DECKS.length)
const seed = process.argv[3] ?? 'cli'
const boss = BOSS_DECKS[bossIndex - 1]!

const { engine } = createEngine({ humanDeck: STARTER_DECK, aiDeck: boss.cards, seed: `${seed}-b${bossIndex}` })
const ai: Record<Side, HeuristicAI> = {
  HUMAN: new HeuristicAI(engine, 'HUMAN', 'balanced'),
  AI: new HeuristicAI(engine, 'AI', boss.archetype),
}

console.log(`Starter (balanced) vs Boss ${bossIndex}: ${boss.name} (${boss.archetype})\n`)

let guard = 0
let lastTurn = 0
while (!engine.isOver() && guard < 300) {
  guard++
  const snap = engine.snapshot()
  const active = snap.activeSide
  if (snap.turn !== lastTurn) {
    lastTurn = snap.turn
    const h = snap.players.HUMAN
    const a = snap.players.AI
    const board = (['LEFT', 'CENTER', 'RIGHT'] as const)
      .map(l => `${snap.lanes[l].HUMAN.length}v${snap.lanes[l].AI.length}`)
      .join(' ')
    console.log(
      `T${String(snap.turn).padStart(3)} ${active.padEnd(5)} | You ${h.life}hp/${h.manaMax}m  Foe ${a.life}hp/${a.manaMax}m | lanes ${board}`,
    )
  }
  ai[active].takeTurn()
}

const res = engine.result()
if (res) {
  console.log(`\n${res.winner === 'HUMAN' ? 'YOU WIN' : 'AI WINS'} on turn ${res.turns} — you ${res.humanLifeRemaining} HP, foe ${res.aiLifeRemaining} HP`)
} else {
  console.log('\nTimed out (no winner within the turn cap).')
}
