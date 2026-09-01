/**
 * Expansion coverage: the 9 Ultimate Weapons + 20 unique-effect Modules, plus 9-level masteries.
 *
 * Two guards, both aimed at this codebase's signature bug (a control that changes nothing):
 *  1. A self-play smoke test whose two decks together contain every new card, run to completion by
 *     the AI — once at base level, once with every card at max level + max mastery. This exercises
 *     each new code path (start-of-turn, on-play, on-kill, on-draw, combat, cost) without crashing.
 *  2. Deterministic asserts that flip a specific new effect and prove the output moves.
 */

import { describe, expect, it } from 'vitest'
import { createEngine, createEngineFromState } from './engine'
import { validateDeck } from './decks'
import { ALL_CARD_IDS } from './cards'
import { CARD_MAX_LEVEL, MASTERY_MAX_LEVEL } from './card-progression'
import { HeuristicAI } from '../ai/heuristic'
import { TUNING } from './tuning'
import type { CardLevels, Engine, Lane, Side } from './types'

// Two legal 20-card decks whose union contains all 29 new cards (5 rares + 24 epics).
const DECK_A = [
  'fortress', 'fortress', 'fortress',
  'chain-lightning', 'smart-missiles', 'inner-land-mines', 'golden-tower', 'spotlight', // 5 rares
  'death-wave', 'chrono-field', 'poison-swamp', 'black-hole',
  'astral-deliverance', 'being-annihilator', 'death-penalty', 'havoc-bringer', 'shrink-ray',
  'anti-cube-portal', 'negative-mass-projector', 'sharp-fortitude',
]
const DECK_B = [
  'fortress', 'fortress', 'fortress',
  'extra-orbs', 'extra-orbs', 'land-mine-stun', 'land-mine-stun', 'berserker',
  'wormhole-redirector', 'space-displacer', 'black-hole-digestor', 'galaxy-compressor',
  'project-funding', 'pulsar-harvester', 'singularity-harness', 'dimension-core',
  'harmony-conductor', 'magnetic-hook', 'multiverse-nexus', 'om-chip',
]

function allMaxed(): CardLevels {
  const out: CardLevels = {}
  for (const id of ALL_CARD_IDS) out[id] = { level: CARD_MAX_LEVEL, mastery: MASTERY_MAX_LEVEL }
  return out
}

function playOut(humanDeck: string[], aiDeck: string[], levels?: Partial<Record<Side, CardLevels>>): Engine {
  const { engine } = createEngine({
    humanDeck,
    aiDeck,
    seed: 'smoke',
    shuffle: true,
    ...(levels ? { cardLevels: levels } : {}),
  })
  const ai = { HUMAN: new HeuristicAI(engine, 'HUMAN'), AI: new HeuristicAI(engine, 'AI') }
  let guard = 0
  while (!engine.isOver() && guard++ < 500) {
    ai[engine.snapshot().activeSide].takeTurn()
  }
  return engine
}

const pass = (e: Engine) => e.apply({ kind: 'endTurn' })
function hand(e: Engine, side: Side) {
  return e.snapshot(side).players[side].hand ?? []
}
function uidOf(e: Engine, side: Side, cardId: string): number {
  const ref = hand(e, side).find(c => c.cardId === cardId)
  if (!ref) throw new Error(`${cardId} not in ${side} hand`)
  return ref.uid
}
function stack(e: Engine, lane: Lane, side: Side) {
  return e.snapshot().lanes[lane][side]
}
function build(humanTail: string[], aiTail: string[]): Engine {
  const mk = (tail: string[]) => {
    const pad = Array.from({ length: TUNING.DECK_SIZE - tail.length }, () => 'cash')
    return [...pad, ...[...tail].reverse()]
  }
  return createEngine({ humanDeck: mk(humanTail), aiDeck: mk(aiTail), seed: 'exp', shuffle: false, firstPlayer: 'HUMAN' }).engine
}
/** Advance until HUMAN is active with at least `mana` available. */
function toHumanMana(e: Engine, mana: number) {
  for (let g = 0; g < 60; g++) {
    const s = e.snapshot()
    if (s.activeSide === 'HUMAN' && s.players.HUMAN.manaPool >= mana) return
    pass(e)
  }
  throw new Error('never reached mana')
}

describe('expansion decks', () => {
  it('both smoke decks are legal and cover all 29 new cards', () => {
    expect(validateDeck(DECK_A).ok).toBe(true)
    expect(validateDeck(DECK_B).ok).toBe(true)
    const union = new Set([...DECK_A, ...DECK_B])
    for (const id of [
      'chain-lightning', 'smart-missiles', 'death-wave', 'chrono-field', 'inner-land-mines',
      'golden-tower', 'poison-swamp', 'black-hole', 'spotlight',
      'astral-deliverance', 'being-annihilator', 'death-penalty', 'havoc-bringer', 'shrink-ray',
      'anti-cube-portal', 'negative-mass-projector', 'sharp-fortitude', 'wormhole-redirector', 'space-displacer',
      'black-hole-digestor', 'galaxy-compressor', 'project-funding', 'pulsar-harvester', 'singularity-harness',
      'dimension-core', 'harmony-conductor', 'magnetic-hook', 'multiverse-nexus', 'om-chip',
    ]) {
      expect(union.has(id)).toBe(true)
    }
  })
})

describe('expansion self-play (no crashes, games terminate)', () => {
  it('base level: A vs B and B vs A both finish with a winner', () => {
    const g1 = playOut(DECK_A, DECK_B)
    expect(g1.isOver()).toBe(true)
    expect(g1.result()?.winner).toBeDefined()
    const g2 = playOut(DECK_B, DECK_A)
    expect(g2.isOver()).toBe(true)
    expect(g2.result()?.winner).toBeDefined()
  })

  it('every card at max level + max mastery still terminates cleanly', () => {
    const maxed = allMaxed()
    const g = playOut(DECK_A, DECK_B, { HUMAN: maxed, AI: maxed })
    expect(g.isOver()).toBe(true)
    expect(g.result()?.winner).toBeDefined()
  })
})

describe('expansion effects (flip the control, output moves)', () => {
  it('Inner Land Mines damages an enemy unit as it enters', () => {
    const e = build(['inner-land-mines'], ['fortress']) // fortress 0/8
    toHumanMana(e, 3)
    e.apply({ kind: 'playModule', uid: uidOf(e, 'HUMAN', 'inner-land-mines') })
    pass(e) // → AI
    // AI plays fortress; entering it should take 2 mine damage.
    for (let g = 0; g < 6 && e.snapshot().activeSide === 'AI' && e.snapshot().players.AI.manaPool < 2; g++) pass(e)
    e.apply({ kind: 'playUnit', uid: uidOf(e, 'AI', 'fortress'), lane: 'LEFT' })
    expect(stack(e, 'LEFT', 'AI')[0]?.hp).toBe(6) // 8 − 2
  })

  it('Spotlight (module) boosts your Ultimate Weapon cards', () => {
    // Control: Smart Missiles alone deals 2 to the front enemy.
    const c = build(['smart-missiles'], ['fortress'])
    for (let g = 0; g < 6 && !(c.snapshot().activeSide === 'AI' && c.snapshot().players.AI.manaPool >= 2); g++) pass(c)
    c.apply({ kind: 'playUnit', uid: uidOf(c, 'AI', 'fortress'), lane: 'LEFT' })
    toHumanMana(c, 3)
    c.apply({ kind: 'playUltimate', uid: uidOf(c, 'HUMAN', 'smart-missiles') })
    expect(stack(c, 'LEFT', 'AI')[0]?.hp).toBe(6) // 8 − 2

    // With Spotlight in play (+1 to every UW), Smart Missiles deals 3.
    const e = build(['spotlight', 'smart-missiles'], ['fortress'])
    for (let g = 0; g < 6 && !(e.snapshot().activeSide === 'AI' && e.snapshot().players.AI.manaPool >= 2); g++) pass(e)
    e.apply({ kind: 'playUnit', uid: uidOf(e, 'AI', 'fortress'), lane: 'LEFT' })
    toHumanMana(e, 6)
    e.apply({ kind: 'playModule', uid: uidOf(e, 'HUMAN', 'spotlight') })
    e.apply({ kind: 'playUltimate', uid: uidOf(e, 'HUMAN', 'smart-missiles') })
    expect(stack(e, 'LEFT', 'AI')[0]?.hp).toBe(5) // 8 − (2 + 1 Spotlight)
  })

  it('Multiverse Nexus makes the next Ultimate free (weapons fire together)', () => {
    const e = build(['multiverse-nexus', 'smart-missiles', 'smart-missiles'], [])
    toHumanMana(e, 7) // 4 (module) + 3 (first missile) + 0 (second, free)
    e.apply({ kind: 'playModule', uid: uidOf(e, 'HUMAN', 'multiverse-nexus') })
    e.apply({ kind: 'playUltimate', uid: uidOf(e, 'HUMAN', 'smart-missiles') }) // paid → opens window
    const manaAfterFirst = e.snapshot(('HUMAN' as Side)).players.HUMAN.manaPool
    e.apply({ kind: 'playUltimate', uid: uidOf(e, 'HUMAN', 'smart-missiles') }) // free
    expect(e.snapshot('HUMAN').players.HUMAN.manaPool).toBe(manaAfterFirst) // no mana spent on the 2nd
    expect(hand(e, 'HUMAN').some(c => c.cardId === 'smart-missiles')).toBe(false) // both played
  })

  it('serialize/restore preserves the new per-unit flags (Spotlight vuln, Death Penalty mark)', () => {
    const e = build([], ['fortress'])
    for (let g = 0; g < 6 && !(e.snapshot().activeSide === 'AI' && e.snapshot().players.AI.manaPool >= 2); g++) pass(e)
    e.apply({ kind: 'playUnit', uid: uidOf(e, 'AI', 'fortress'), lane: 'CENTER' })
    const state = e.serialize()
    // Plant the new flags on the snapshot, rebuild, and confirm they round-trip.
    state.lanes.CENTER.AI[0]!.vulnerable = 3
    state.lanes.CENTER.AI[0]!.marked = true
    const restored = createEngineFromState(state).serialize()
    expect(restored.lanes.CENTER.AI[0]!.vulnerable).toBe(3)
    expect(restored.lanes.CENTER.AI[0]!.marked).toBe(true)
  })
})
