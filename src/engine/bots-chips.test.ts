/**
 * Bots (5) + Guardian chips (6) coverage. Same two guards as expansion.test.ts, aimed at the
 * signature bug (a control that changes nothing):
 *  1. Every catalog card has progression + display + is playable; the 11 new cards exist; a self-play
 *     deck containing all of them runs to completion at base AND max level without crashing.
 *  2. Deterministic asserts that flip each new effect and prove the output moves.
 */

import { describe, expect, it } from 'vitest'
import { createEngine } from './engine'
import { ALL_CARD_IDS, getCard } from './cards'
import { CARD_PROG, CARD_DISPLAY, CARD_MAX_LEVEL, MASTERY_MAX_LEVEL } from './card-progression'
import { HeuristicAI } from '../ai/heuristic'
import { TUNING, COMBAT_SCALE } from './tuning'
import type { CardLevels, Engine, Lane, Side } from './types'

const BOTS = ['flame-bot', 'thunder-bot', 'golden-bot', 'amplify-bot', 'bot-bot'] as const
const CHIPS = ['guardian-ally', 'guardian-attack', 'guardian-bounty', 'guardian-fetch', 'guardian-summon', 'guardian-scout'] as const
const NEW_CARDS = [...BOTS, ...CHIPS]

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
  return createEngine({ humanDeck: mk(humanTail), aiDeck: mk(aiTail), seed: 'bc', shuffle: false, firstPlayer: 'HUMAN' }).engine
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
/** Let the AI drop a unit of `cardId` into `lane` (waits for its mana). */
function aiPlays(e: Engine, cardId: string, lane: Lane) {
  for (let g = 0; g < 12; g++) {
    const s = e.snapshot()
    if (s.activeSide === 'AI' && s.players.AI.manaPool >= getCard(cardId).cost) {
      e.apply({ kind: 'playUnit', uid: uidOf(e, 'AI', cardId), lane })
      return
    }
    pass(e)
  }
  throw new Error(`AI never played ${cardId}`)
}

describe('bots + chips coverage', () => {
  it('every catalog card has progression, display, and the 11 new cards exist', () => {
    for (const id of ALL_CARD_IDS) {
      expect(CARD_PROG[id], `${id} missing CARD_PROG`).toBeDefined()
      expect(CARD_DISPLAY[id], `${id} missing CARD_DISPLAY`).toBeDefined()
      expect(CARD_PROG[id]!.levels.length).toBe(CARD_MAX_LEVEL)
    }
    for (const id of NEW_CARDS) expect(ALL_CARD_IDS.includes(id), `${id} not in catalog`).toBe(true)
  })

  it('a deck containing all 11 new cards self-plays to a winner at base AND max level', () => {
    // 11 new + 9 legal commons = a 20-card deck (copy limits: common 3).
    const deck = [...NEW_CARDS, 'fortress', 'fortress', 'fortress', 'damage', 'damage', 'damage', 'cash', 'cash', 'cash']
    const foe = ['fortress', 'fortress', 'fortress', 'extra-orbs', 'extra-orbs', 'berserker', 'damage', 'damage', 'damage', 'cash', 'cash', 'cash', 'health', 'health', 'range', 'range', 'coins', 'coins', 'attack-speed', 'critical-chance']
    expect(deck.length).toBe(TUNING.DECK_SIZE)
    const maxed: CardLevels = {}
    for (const id of ALL_CARD_IDS) maxed[id] = { level: CARD_MAX_LEVEL, mastery: MASTERY_MAX_LEVEL }
    for (const levels of [undefined, { HUMAN: maxed, AI: maxed }] as const) {
      const { engine } = createEngine({ humanDeck: deck, aiDeck: foe, seed: 'bc-smoke', shuffle: true, ...(levels ? { cardLevels: levels } : {}) })
      const ai = { HUMAN: new HeuristicAI(engine, 'HUMAN'), AI: new HeuristicAI(engine, 'AI') }
      let guard = 0
      while (!engine.isOver() && guard++ < 600) ai[engine.snapshot().activeSide].takeTurn()
      expect(engine.isOver()).toBe(true)
      expect(engine.result()?.winner).toBeDefined()
    }
  })
})

describe('bot/chip effects (flip the control, output moves)', () => {
  it('Amplify Bot raises your units’ ATK by %; Bot Bot doubles that and adds its own', () => {
    const base = 3 * COMBAT_SCALE // extra-orbs base ATK (30)
    // Control: extra-orbs alone is its base ATK.
    const c = build(['extra-orbs'], [])
    toHumanMana(c, 4)
    c.apply({ kind: 'playUnit', uid: uidOf(c, 'HUMAN', 'extra-orbs'), lane: 'LEFT' })
    expect(stack(c, 'LEFT', 'HUMAN')[0]?.atk).toBe(base)
    // Amplify Bot L1 = +10% of the unit's own ATK.
    const a = build(['amplify-bot', 'extra-orbs'], [])
    toHumanMana(a, 7)
    a.apply({ kind: 'playModule', uid: uidOf(a, 'HUMAN', 'amplify-bot') })
    a.apply({ kind: 'playUnit', uid: uidOf(a, 'HUMAN', 'extra-orbs'), lane: 'LEFT' })
    expect(stack(a, 'LEFT', 'HUMAN')[0]?.atk).toBe(base + Math.round(base * 0.1))
    // Bot Bot doubles Amplify (×2) and adds its own 15%: +(10%×2 + 15%) = +35%.
    const b = build(['bot-bot', 'amplify-bot', 'extra-orbs'], [])
    toHumanMana(b, 10)
    b.apply({ kind: 'playModule', uid: uidOf(b, 'HUMAN', 'bot-bot') })
    b.apply({ kind: 'playModule', uid: uidOf(b, 'HUMAN', 'amplify-bot') })
    b.apply({ kind: 'playUnit', uid: uidOf(b, 'HUMAN', 'extra-orbs'), lane: 'LEFT' })
    expect(stack(b, 'LEFT', 'HUMAN')[0]?.atk).toBe(base + Math.round(base * (0.1 * 2 + 0.15)))
  })

  it('Scout Chip saps every enemy unit’s ATK', () => {
    const e = build(['guardian-scout'], ['extra-orbs'])
    aiPlays(e, 'extra-orbs', 'LEFT')
    expect(stack(e, 'LEFT', 'AI')[0]?.atk).toBe(3 * COMBAT_SCALE)
    toHumanMana(e, 2)
    e.apply({ kind: 'playModule', uid: uidOf(e, 'HUMAN', 'guardian-scout') })
    const orbAtk = 3 * COMBAT_SCALE
    expect(stack(e, 'LEFT', 'AI')[0]?.atk).toBe(orbAtk - Math.round(orbAtk * 0.1)) // −10% of ATK at L1
  })

  it('Flame Bot weakens an enemy unit’s ATK immediately (−1)', () => {
    const e = build(['flame-bot'], ['extra-orbs']) // extra-orbs 3 ATK / 1 HP
    aiPlays(e, 'extra-orbs', 'LEFT')
    toHumanMana(e, 3)
    e.apply({ kind: 'playModule', uid: uidOf(e, 'HUMAN', 'flame-bot') })
    expect(stack(e, 'LEFT', 'AI')[0]?.atk).toBe(2 * COMBAT_SCALE) // 3 − 1 (read in unitAtk)
  })

  it('Flame Bot burns enemy units at start of your turn', () => {
    const e = build(['flame-bot'], ['fortress']) // fortress 0/8, deals no damage (nexus safe over turns)
    aiPlays(e, 'fortress', 'LEFT')
    toHumanMana(e, 3)
    e.apply({ kind: 'playModule', uid: uidOf(e, 'HUMAN', 'flame-bot') })
    pass(e) // → AI
    toHumanMana(e, 0) // back to a fresh HUMAN start-of-turn → burn fires
    expect(stack(e, 'LEFT', 'AI')[0]?.hp).toBeLessThan(8 * COMBAT_SCALE)
  })

  it('Thunder Bot stuns the strongest enemy unit at start of your turn', () => {
    const e = build(['thunder-bot'], ['fortress'])
    aiPlays(e, 'fortress', 'LEFT')
    toHumanMana(e, 3)
    e.apply({ kind: 'playModule', uid: uidOf(e, 'HUMAN', 'thunder-bot') })
    pass(e)
    toHumanMana(e, 0) // fresh HUMAN start-of-turn
    expect(stack(e, 'LEFT', 'AI')[0]?.frozen).toBe(true)
  })

  it('Ally Chip converts the weakest enemy unit to your side', () => {
    const e = build(['guardian-ally'], ['extra-orbs'])
    aiPlays(e, 'extra-orbs', 'LEFT')
    expect(stack(e, 'LEFT', 'AI').length).toBe(1)
    toHumanMana(e, 3)
    e.apply({ kind: 'playUltimate', uid: uidOf(e, 'HUMAN', 'guardian-ally') })
    expect(stack(e, 'LEFT', 'AI').length).toBe(0)
    expect(stack(e, 'LEFT', 'HUMAN').some(u => u.cardId === 'extra-orbs')).toBe(true)
  })

  it('Attack Chip deals the target’s missing HP', () => {
    const e = build(['inner-land-mines', 'guardian-attack'], ['fortress']) // fortress 0/8
    toHumanMana(e, 3)
    e.apply({ kind: 'playModule', uid: uidOf(e, 'HUMAN', 'inner-land-mines') })
    aiPlays(e, 'fortress', 'LEFT') // enters through 2 mine damage → 6/8 (missing 2)
    expect(stack(e, 'LEFT', 'AI')[0]?.hp).toBe(6 * COMBAT_SCALE)
    toHumanMana(e, 2)
    e.apply({ kind: 'playUltimate', uid: uidOf(e, 'HUMAN', 'guardian-attack'), target: { kind: 'unit', uid: stack(e, 'LEFT', 'AI')[0]!.uid } })
    expect(stack(e, 'LEFT', 'AI')[0]?.hp).toBe(3 * COMBAT_SCALE) // 6 − (missing 2 + level-1 bonus 1)
  })

  it('Fetch Chip steals HP from the enemy Nexus and draws', () => {
    const e = build(['guardian-fetch'], [])
    toHumanMana(e, 3)
    const enemyBefore = e.snapshot().players.AI.life
    const handBefore = hand(e, 'HUMAN').length
    e.apply({ kind: 'playUltimate', uid: uidOf(e, 'HUMAN', 'guardian-fetch') })
    expect(e.snapshot().players.AI.life).toBe(enemyBefore - 3 * COMBAT_SCALE)
    expect(hand(e, 'HUMAN').length).toBe(handBefore - 1 + 1) // played fetch, drew 1
  })

  it('Summon Chip fills empty friendly lanes with Ally tokens', () => {
    const e = build(['guardian-summon'], [])
    toHumanMana(e, 3)
    e.apply({ kind: 'playUltimate', uid: uidOf(e, 'HUMAN', 'guardian-summon') })
    const total = (['LEFT', 'CENTER', 'RIGHT'] as Lane[]).reduce((n, l) => n + stack(e, l, 'HUMAN').length, 0)
    expect(total).toBe(3) // one token per empty lane
    expect(stack(e, 'LEFT', 'HUMAN')[0]?.atk).toBe(2 * COMBAT_SCALE) // 2/2 base token
  })

  it('Golden Bot adds temporary mana at start of your turn; Bounty draws cards', () => {
    // Bounty: play it, net hand change is +1 (played 1, drew 2 at base).
    const e = build(['guardian-bounty'], [])
    toHumanMana(e, 2)
    const handBefore = hand(e, 'HUMAN').length
    e.apply({ kind: 'playUltimate', uid: uidOf(e, 'HUMAN', 'guardian-bounty') })
    expect(hand(e, 'HUMAN').length).toBe(handBefore - 1 + 2)
  })
})
