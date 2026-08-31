/**
 * Stateful CLI for playing/evaluating the game by hand. State is serialized to a scratch file
 * between invocations, so you can drive a whole run across many shell calls. Two modes:
 *
 *   pnpm ttg run             # start a full LADDER run (boss 1, starter deck) — deck GROWS each win
 *   pnpm ttg new 5           # start a single match vs boss 5 (starter deck, that boss's handicap)
 *   pnpm ttg show            # print board, hand, and numbered legal actions
 *   pnpm ttg do 3            # apply legal action #3 (plays stay on your turn; #0 is End Turn)
 *   pnpm ttg reward 2        # after a run win: take reward card #2 (auto-trims weakest), next boss
 *   pnpm ttg reward skip     # take no reward, advance
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
  rewardCandidates,
  weakestIndex,
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

type Mode = 'single' | 'run'
interface Saved {
  mode: Mode
  boss: number
  deck: string[]
  engine: EngineState
  pendingReward?: string[]
}
interface GameCtx {
  mode: Mode
  boss: number
  deck: string[]
  engine: Engine
  pendingReward?: string[]
}

function save(ctx: GameCtx): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
  const saved: Saved = { mode: ctx.mode, boss: ctx.boss, deck: ctx.deck, engine: ctx.engine.serialize() }
  if (ctx.pendingReward) saved.pendingReward = ctx.pendingReward
  writeFileSync(STATE_FILE, JSON.stringify(saved))
}

function load(): GameCtx {
  if (!existsSync(STATE_FILE)) {
    console.error('No game in progress. Run: pnpm ttg run   (or: pnpm ttg new <boss>)')
    process.exit(1)
  }
  const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Saved
  return {
    mode: raw.mode,
    boss: raw.boss,
    deck: raw.deck,
    engine: createEngineFromState(raw.engine),
    ...(raw.pendingReward ? { pendingReward: raw.pendingReward } : {}),
  }
}

function startMatch(boss: number, deck: string[], seed: string): Engine {
  const hc = bossHandicap(boss)
  const { engine } = createEngine({
    humanDeck: deck,
    aiDeck: BOSS_DECKS[boss - 1]!.cards,
    seed,
    bonusLife: { AI: hc.bonusLife },
    bonusStartMana: { AI: hc.bonusStartMana },
  })
  return engine
}

function bossName(i: number): string {
  return BOSS_DECKS[i - 1]?.name ?? `Boss ${i}`
}

function unitStr(u: {
  cardId: string
  atk: number
  hp: number
  keywords: readonly string[]
  isFront: boolean
  tapped: boolean
  frozen: boolean
}): string {
  const kw = u.keywords.length
    ? ` [${u.keywords.map(k => (k === 'firstStrike' ? 'FS' : k[0]!.toUpperCase())).join('')}]`
    : ''
  const status = `${u.frozen ? ' ❄' : ''}${u.tapped ? ' 💤' : ''}`
  return `${u.isFront ? '▶' : ' '}${getCard(u.cardId).name} ${u.atk}/${u.hp}${kw}${status}`
}

function render(ctx: GameCtx): void {
  const { engine, boss } = ctx
  const s = engine.snapshot('HUMAN')
  const ai = s.players.AI
  const me = s.players.HUMAN
  const line = '─'.repeat(62)
  console.log(line)
  console.log(
    `Boss ${boss}/10: ${bossName(boss)}  ·  Turn ${s.turn}  ·  ${engine.isOver() ? 'OVER' : s.activeSide + ' to act'}${ctx.mode === 'run' ? '  · [RUN]' : ''}`,
  )
  console.log(
    `ENEMY  ♥ ${ai.life}/${ai.maxLife}   mana ${ai.manaPool}/${ai.manaMax}   deck ${ai.deckCount}   hand ${ai.handCount}   modules: ${ai.modules.map(m => getCard(m.cardId).name).join(', ') || '—'}`,
  )
  console.log(line)
  for (const lane of LANES) {
    console.log(`${lane.padEnd(6)} AI : ${s.lanes[lane].AI.map(unitStr).join('   ') || '·'}`)
    console.log(`${' '.repeat(6)} YOU: ${s.lanes[lane].HUMAN.map(unitStr).join('   ') || '·'}`)
  }
  console.log(line)
  console.log(
    `YOU    ♥ ${me.life}/${me.maxLife}   mana ${me.manaPool}/${me.manaMax}   deck ${me.deckCount}   modules: ${me.modules.map(m => getCard(m.cardId).name).join(', ') || '—'}`,
  )
  const hand = (me.hand ?? []).map(c => {
    const d = getCard(c.cardId)
    return `${d.name}(${d.cost}${d.type === 'UNIT' ? ` ${d.atk}/${d.hp}` : ''})`
  })
  console.log(`HAND: ${hand.join('  ') || '—'}`)
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

function menu(engine: Engine): Action[] {
  const legal = engine.legalActions('HUMAN')
  return [...legal.filter(a => a.kind === 'endTurn'), ...legal.filter(a => a.kind !== 'endTurn')]
}

function printMenu(engine: Engine): void {
  if (engine.isOver() || engine.snapshot().activeSide !== 'HUMAN') return
  console.log('\nActions:')
  menu(engine).forEach((a, i) => console.log(`  ${i}. ${describe(a, engine)}`))
}

function summarize(events: GameEvent[]): void {
  const notable: string[] = []
  for (const ev of events) {
    if (ev.type === 'nexusDamage' && ev.amount > 0) notable.push(`${ev.side} Nexus -${ev.amount} (→${ev.life})`)
    else if (ev.type === 'unitDied') notable.push(`${ev.side} unit destroyed`)
    else if (ev.type === 'ultimateCast') notable.push(`${ev.side} cast ${getCard(ev.cardId).name}`)
    else if (ev.type === 'secretTriggered') notable.push(`${ev.side} Second Wind!`)
  }
  if (notable.length) console.log('» ' + notable.join(' · '))
}

function offerRewardOrFinish(ctx: GameCtx): void {
  const res = ctx.engine.result()!
  if (res.winner !== 'HUMAN') {
    console.log(`\n*** DEFEATED at Boss ${ctx.boss} (${bossName(ctx.boss)}) — foe ${res.aiLifeRemaining} HP, ${res.turns} turns ***`)
    if (ctx.mode === 'run') console.log('Run over. Start again: pnpm ttg run')
    save(ctx)
    return
  }
  if (ctx.mode !== 'run' || ctx.boss >= BOSS_DECKS.length) {
    const cleared = ctx.mode === 'run' && ctx.boss >= BOSS_DECKS.length
    console.log(`\n*** ${cleared ? 'LADDER CLEARED!' : 'YOU WIN'} — Boss ${ctx.boss} (${bossName(ctx.boss)}), you ${res.humanLifeRemaining} HP, ${res.turns} turns ***`)
    save(ctx)
    return
  }
  // Won a run boss (non-final): offer a reward.
  ctx.pendingReward = rewardCandidates(ctx.deck, Math.random)
  console.log(`\n*** Beat Boss ${ctx.boss} (${bossName(ctx.boss)})! Choose a reward for your deck: ***`)
  printReward(ctx)
  save(ctx)
}

function printReward(ctx: GameCtx): void {
  const cands = ctx.pendingReward ?? []
  cands.forEach((id, i) => {
    const d = getCard(id)
    const have = ctx.deck.filter(x => x === id).length
    console.log(`  reward ${i}: ${d.name} (${d.cost}${d.type === 'UNIT' ? ` ${d.atk}/${d.hp}` : ''}, ${d.rarity})${have ? ` — have ${have}` : ''}`)
  })
  console.log('  reward skip: take nothing')
}

function main(): void {
  const [cmd, arg1, arg2] = process.argv.slice(2)

  if (cmd === 'run') {
    const deck = [...STARTER_DECK]
    const ctx: GameCtx = { mode: 'run', boss: 1, deck, engine: startMatch(1, deck, arg1 ?? 'run') }
    save(ctx)
    render(ctx)
    printMenu(ctx.engine)
    return
  }
  if (cmd === 'new') {
    const boss = Math.min(Math.max(1, Number(arg1 ?? 1)), BOSS_DECKS.length)
    const deck = [...STARTER_DECK]
    const ctx: GameCtx = { mode: 'single', boss, deck, engine: startMatch(boss, deck, arg2 ?? `cli-${boss}`) }
    save(ctx)
    render(ctx)
    printMenu(ctx.engine)
    return
  }

  const ctx = load()

  if (cmd === 'show') {
    render(ctx)
    if (ctx.pendingReward) {
      console.log('\nWon — pick a reward:')
      printReward(ctx)
    } else printMenu(ctx.engine)
    return
  }

  if (cmd === 'reward') {
    if (!ctx.pendingReward) {
      console.error('No reward pending.')
      process.exit(1)
    }
    if (arg1 !== 'skip') {
      const pick = ctx.pendingReward[Number(arg1)]
      if (!pick) {
        console.error(`Bad reward index ${arg1}.`)
        process.exit(1)
      }
      ctx.deck.push(pick)
      const [trimmed] = ctx.deck.splice(weakestIndex(ctx.deck), 1)
      console.log(`Added ${getCard(pick).name}; trimmed ${getCard(trimmed!).name}. Deck ${ctx.deck.length}.`)
    }
    ctx.boss += 1
    ctx.engine = startMatch(ctx.boss, ctx.deck, `run-b${ctx.boss}`)
    delete ctx.pendingReward
    save(ctx)
    render(ctx)
    printMenu(ctx.engine)
    return
  }

  if (cmd === 'do') {
    if (ctx.pendingReward) {
      console.error('Pick a reward first: pnpm ttg reward <n|skip>')
      process.exit(1)
    }
    const options = menu(ctx.engine)
    const action = options[Number(arg1)]
    if (!action) {
      console.error(`Bad action index ${arg1}. Run: pnpm ttg show`)
      process.exit(1)
    }
    summarize(ctx.engine.apply(action))
    if (action.kind === 'endTurn' && !ctx.engine.isOver()) {
      const ai = new SearchAI(ctx.engine, 'AI', BOSS_DECKS[ctx.boss - 1]!.archetype)
      let guard = 0
      while (!ctx.engine.isOver() && ctx.engine.snapshot().activeSide === 'AI' && guard++ < 4) {
        summarize(ai.takeTurn())
      }
    }
    if (ctx.engine.isOver()) {
      render(ctx)
      offerRewardOrFinish(ctx)
      return
    }
    save(ctx)
    render(ctx)
    printMenu(ctx.engine)
    return
  }

  console.log('Usage: pnpm ttg run | new <boss> | show | do <n> | reward <n|skip>')
}

main()
