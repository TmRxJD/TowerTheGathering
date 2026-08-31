/**
 * Stateful CLI for playing/evaluating a match by hand. State is serialized to a scratch file between
 * invocations, so you can drive one game across many shell calls:
 *
 *   pnpm ttg new 5           # start vs boss 5 (starter deck, with that boss's handicap)
 *   pnpm ttg show            # print board, hand, and numbered legal actions
 *   pnpm ttg do 3            # apply legal action #3 (plays stay on your turn)
 *   pnpm ttg do 0            # #0 is always End Turn → resolves combat, the SearchAI boss responds
 *
 * The opponent is the SearchAI (the real in-game boss AI), so this is an honest feel test.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  BOSS_DECKS,
  STARTER_DECK,
  bossHandicap,
  createEngine,
  createEngineFromState,
  getCard,
  type Action,
  type Engine,
  type EngineState,
  type GameEvent,
  type Lane,
} from '../engine'
import { SearchAI } from '../ai'

const LANES: readonly Lane[] = ['LEFT', 'CENTER', 'RIGHT']
const STATE_DIR = '.scratch'
const STATE_FILE = `${STATE_DIR}/ttg-cli.json`

interface Saved {
  boss: number
  engine: EngineState
}

function save(boss: number, engine: Engine): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify({ boss, engine: engine.serialize() } satisfies Saved))
}

function load(): { boss: number; engine: Engine } {
  if (!existsSync(STATE_FILE)) {
    console.error('No game in progress. Run: pnpm ttg new <boss>')
    process.exit(1)
  }
  const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Saved
  return { boss: raw.boss, engine: createEngineFromState(raw.engine) }
}

function bossName(i: number): string {
  return BOSS_DECKS[i - 1]?.name ?? `Boss ${i}`
}

function unitStr(u: { cardId: string; atk: number; hp: number; keywords: readonly string[]; isFront: boolean; tapped: boolean; frozen: boolean }): string {
  const kw = u.keywords.length ? ` [${u.keywords.map(k => (k === 'firstStrike' ? 'FS' : k[0]!.toUpperCase())).join('')}]` : ''
  const status = `${u.frozen ? ' ❄' : ''}${u.tapped ? ' 💤' : ''}`
  return `${u.isFront ? '▶' : ' '}${getCard(u.cardId).name} ${u.atk}/${u.hp}${kw}${status}`
}

function render(boss: number, engine: Engine): void {
  const s = engine.snapshot('HUMAN')
  const ai = s.players.AI
  const me = s.players.HUMAN
  const line = '─'.repeat(60)
  console.log(line)
  console.log(`Boss ${boss}: ${bossName(boss)}  ·  Turn ${s.turn}  ·  ${engine.isOver() ? 'OVER' : s.activeSide + ' to act'}`)
  console.log(`ENEMY  ♥ ${ai.life}/${ai.maxLife}   mana ${ai.manaPool}/${ai.manaMax}   deck ${ai.deckCount}   hand ${ai.handCount}   modules: ${ai.modules.map(m => getCard(m.cardId).name).join(', ') || '—'}`)
  console.log(line)
  for (const lane of LANES) {
    const aiU = s.lanes[lane].AI.map(unitStr).join('   ') || '·'
    const meU = s.lanes[lane].HUMAN.map(unitStr).join('   ') || '·'
    console.log(`${lane.padEnd(6)} AI : ${aiU}`)
    console.log(`${' '.repeat(6)} YOU: ${meU}`)
  }
  console.log(line)
  console.log(`YOU    ♥ ${me.life}/${me.maxLife}   mana ${me.manaPool}/${me.manaMax}   deck ${me.deckCount}   modules: ${me.modules.map(m => getCard(m.cardId).name).join(', ') || '—'}`)
  const hand = (me.hand ?? []).map(c => {
    const d = getCard(c.cardId)
    const stats = d.type === 'UNIT' ? ` ${d.atk}/${d.hp}` : ''
    return `${d.name}(${d.cost}${stats})`
  })
  console.log(`HAND: ${hand.join('  ') || '—'}`)
  const res = engine.result()
  if (res) console.log(`\n*** ${res.winner === 'HUMAN' ? 'YOU WIN' : 'YOU LOSE'} — you ${res.humanLifeRemaining} HP, foe ${res.aiLifeRemaining} HP, ${res.turns} turns ***`)
}

function describe(a: Action, engine: Engine): string {
  if (a.kind === 'endTurn') return 'End Turn (resolve combat)'
  const s = engine.snapshot('HUMAN')
  const ref = (s.players.HUMAN.hand ?? []).find(c => c.uid === a.uid)
  const name = ref ? getCard(ref.cardId).name : `#${a.uid}`
  const cost = ref ? getCard(ref.cardId).cost : '?'
  if (a.kind === 'playUnit') return `Play ${name} (${cost}) → ${a.lane}`
  if (a.kind === 'playModule') return `Play ${name} (${cost}, module)`
  let tgt = ''
  if (a.target && a.target.kind === 'unit') {
    const uid = a.target.uid
    for (const lane of LANES) for (const side of ['HUMAN', 'AI'] as const) {
      const u = s.lanes[lane][side].find(x => x.uid === uid)
      if (u) tgt = ` @ ${side} ${getCard(u.cardId).name} ${u.atk}/${u.hp} (${lane})`
    }
  }
  return `Cast ${name} (${cost})${tgt}`
}

/** Dedupe legal actions to a compact numbered menu (unit plays list each lane; targets each unit). */
function menu(engine: Engine): Action[] {
  const legal = engine.legalActions('HUMAN')
  // endTurn first as #0, then plays.
  const end = legal.filter(a => a.kind === 'endTurn')
  const plays = legal.filter(a => a.kind !== 'endTurn')
  return [...end, ...plays]
}

function summarizeEvents(events: GameEvent[]): void {
  const notable: string[] = []
  for (const ev of events) {
    if (ev.type === 'nexusDamage' && ev.amount > 0) notable.push(`${ev.side} Nexus -${ev.amount} (→${ev.life})`)
    else if (ev.type === 'unitDied') notable.push(`${ev.side} unit destroyed`)
    else if (ev.type === 'ultimateCast') notable.push(`${ev.side} cast ${getCard(ev.cardId).name}`)
    else if (ev.type === 'secretTriggered') notable.push(`${ev.side} Second Wind!`)
  }
  if (notable.length) console.log('» ' + notable.join(' · '))
}

function main(): void {
  const [cmd, arg1, arg2] = process.argv.slice(2)
  if (cmd === 'new') {
    const boss = Math.min(Math.max(1, Number(arg1 ?? 1)), BOSS_DECKS.length)
    const hc = bossHandicap(boss)
    const { engine } = createEngine({
      humanDeck: STARTER_DECK,
      aiDeck: BOSS_DECKS[boss - 1]!.cards,
      seed: arg2 ?? `cli-${boss}`,
      bonusLife: { AI: hc.bonusLife },
      bonusStartMana: { AI: hc.bonusStartMana },
    })
    save(boss, engine)
    render(boss, engine)
    printMenu(engine)
    return
  }
  const { boss, engine } = load()
  if (cmd === 'show') {
    render(boss, engine)
    printMenu(engine)
    return
  }
  if (cmd === 'do') {
    const idx = Number(arg1)
    const options = menu(engine)
    const action = options[idx]
    if (!action) {
      console.error(`Bad action index ${arg1}. Run: pnpm ttg show`)
      process.exit(1)
    }
    const events = engine.apply(action)
    summarizeEvents(events)
    if (action.kind === 'endTurn' && !engine.isOver()) {
      const boss2 = BOSS_DECKS[boss - 1]!
      const ai = new SearchAI(engine, 'AI', boss2.archetype)
      let guard = 0
      while (!engine.isOver() && engine.snapshot().activeSide === 'AI' && guard++ < 4) {
        summarizeEvents(ai.takeTurn())
      }
    }
    save(boss, engine)
    render(boss, engine)
    if (!engine.isOver()) printMenu(engine)
    return
  }
  console.log('Usage: pnpm ttg new <boss> | show | do <n>')
}

function printMenu(engine: Engine): void {
  if (engine.isOver() || engine.snapshot().activeSide !== 'HUMAN') return
  console.log('\nActions:')
  const options = menu(engine)
  options.forEach((a, i) => console.log(`  ${i}. ${describe(a, engine)}`))
}

main()
