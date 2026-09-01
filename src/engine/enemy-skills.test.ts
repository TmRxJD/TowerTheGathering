/**
 * Per-archetype enemy skills (the boss passives) + the 11th "Boss" rung. Same guard as the rest of
 * the engine tests: flip each skill on and prove the output moves — a skill that is "supported but
 * never fires" is exactly this codebase's signature bug.
 */

import { describe, expect, it } from 'vitest'
import { createEngine } from './engine'
import { BOSS_DECKS, bossSkill } from './decks'
import { tierBossHandicap } from './tiers'
import { getCard } from './cards'
import { TUNING, COMBAT_SCALE } from './tuning'
import type { EnemySkill, Engine, Lane, Side } from './types'

const pass = (e: Engine) => e.apply({ kind: 'endTurn' })
const hand = (e: Engine, s: Side) => e.snapshot(s).players[s].hand ?? []
const uidOf = (e: Engine, s: Side, id: string) => {
  const r = hand(e, s).find(c => c.cardId === id)
  if (!r) throw new Error(`${id} not in ${s} hand`)
  return r.uid
}
const stack = (e: Engine, lane: Lane, s: Side) => e.snapshot().lanes[lane][s]
const lifeOf = (e: Engine, s: Side) => e.snapshot().players[s].life

function build(humanTail: string[], aiTail: string[], aiSkill: EnemySkill = 'none', firstPlayer: Side = 'HUMAN'): Engine {
  const mk = (t: string[]) => {
    const pad = Array.from({ length: TUNING.DECK_SIZE - t.length }, () => 'cash')
    return [...pad, ...[...t].reverse()]
  }
  return createEngine({ humanDeck: mk(humanTail), aiDeck: mk(aiTail), seed: 'es', shuffle: false, firstPlayer, skills: { AI: aiSkill } }).engine
}
function aiPlays(e: Engine, cardId: string, lane: Lane) {
  for (let g = 0; g < 14; g++) {
    const s = e.snapshot()
    if (s.activeSide === 'AI' && s.players.AI.manaPool >= getCard(cardId).cost) {
      e.apply({ kind: 'playUnit', uid: uidOf(e, 'AI', cardId), lane })
      return
    }
    pass(e)
  }
  throw new Error(`AI never played ${cardId}`)
}
function toHumanMana(e: Engine, mana: number) {
  for (let g = 0; g < 60; g++) {
    const s = e.snapshot()
    if (s.activeSide === 'HUMAN' && s.players.HUMAN.manaPool >= mana) return
    pass(e)
  }
  throw new Error('never reached mana')
}

describe('enemy skills (flip the skill, output moves)', () => {
  it('bossSkill maps the canonical names, incl. the final Boss', () => {
    expect(bossSkill('Basic')).toBe('none')
    expect(bossSkill('Fast')).toBe('fast')
    expect(bossSkill('Vampire')).toBe('vampire')
    expect(bossSkill('Commander')).toBe('commander')
    expect(bossSkill('Boss')).toBe('boss')
  })

  it('Tank: its units enter with bonus HP', () => {
    const plain = build([], ['fortress'], 'none')
    aiPlays(plain, 'fortress', 'LEFT')
    const baseHp = stack(plain, 'LEFT', 'AI')[0]!.hp
    const tank = build([], ['fortress'], 'tank')
    aiPlays(tank, 'fortress', 'LEFT')
    expect(stack(tank, 'LEFT', 'AI')[0]!.hp).toBe(baseHp + 3 * COMBAT_SCALE)
  })

  it('Commander: its units have bonus ATK', () => {
    const e = build([], ['extra-orbs'], 'commander')
    aiPlays(e, 'extra-orbs', 'LEFT')
    expect(stack(e, 'LEFT', 'AI')[0]!.atk).toBe((3 + 1) * COMBAT_SCALE) // extra-orbs 3 ATK + commander
  })

  it('Fast grants First Strike; Ranged grants Reach', () => {
    const fast = build([], ['fortress'], 'fast')
    aiPlays(fast, 'fortress', 'LEFT')
    expect(stack(fast, 'LEFT', 'AI')[0]!.keywords).toContain('firstStrike')
    const ranged = build([], ['fortress'], 'ranged')
    aiPlays(ranged, 'fortress', 'LEFT')
    expect(stack(ranged, 'LEFT', 'AI')[0]!.keywords).toContain('reach')
  })

  it('Protector: its units take reduced damage', () => {
    // Smart Missiles hits the front enemy in each lane for 2.
    const plain = build(['smart-missiles'], ['fortress'], 'none')
    aiPlays(plain, 'fortress', 'LEFT')
    toHumanMana(plain, 3)
    plain.apply({ kind: 'playUltimate', uid: uidOf(plain, 'HUMAN', 'smart-missiles') })
    expect(stack(plain, 'LEFT', 'AI')[0]!.hp).toBe((8 - 2) * COMBAT_SCALE) // 8 − 2

    const prot = build(['smart-missiles'], ['fortress'], 'protector')
    aiPlays(prot, 'fortress', 'LEFT')
    toHumanMana(prot, 3)
    prot.apply({ kind: 'playUltimate', uid: uidOf(prot, 'HUMAN', 'smart-missiles') })
    expect(stack(prot, 'LEFT', 'AI')[0]!.hp).toBe((8 - 1) * COMBAT_SCALE) // 8 − max(1×scale, 2−1)
  })

  it('Vampire drains your Nexus each of its turns and disables your regen', () => {
    // AI (vampire) with no units: the only thing that can move life is the drain.
    const e = build(['health-regen'], [], 'vampire')
    toHumanMana(e, 2)
    e.apply({ kind: 'playModule', uid: uidOf(e, 'HUMAN', 'health-regen') })
    const before = lifeOf(e, 'HUMAN')
    for (let i = 0; i < 6; i++) pass(e) // several AI turns fire the drain
    // Life strictly dropped despite owning Health Regen (which the vampire disables).
    expect(lifeOf(e, 'HUMAN')).toBeLessThan(before)
  })

  it('Saboteur taps your strongest unit at the start of its turn', () => {
    const e = build(['extra-orbs'], [], 'saboteur')
    toHumanMana(e, 4)
    e.apply({ kind: 'playUnit', uid: uidOf(e, 'HUMAN', 'extra-orbs'), lane: 'LEFT' })
    pass(e) // → AI turn: saboteur taps your best unit
    expect(stack(e, 'LEFT', 'HUMAN')[0]!.tapped).toBe(true)
  })

  it('Overcharge bursts your Nexus on its power turns', () => {
    const e = build([], [], 'overcharge') // no AI units → only the burst can hurt you
    const before = lifeOf(e, 'HUMAN')
    for (let i = 0; i < 8; i++) pass(e)
    expect(lifeOf(e, 'HUMAN')).toBeLessThan(before)
  })

  it('Scatter: a dying unit splits into a shard that survives', () => {
    const plain = build(['nuke'], ['fortress'], 'none')
    aiPlays(plain, 'fortress', 'LEFT')
    toHumanMana(plain, 8)
    plain.apply({ kind: 'playUltimate', uid: uidOf(plain, 'HUMAN', 'nuke') })
    expect(stack(plain, 'LEFT', 'AI').length).toBe(0) // nuked, nothing left

    const scat = build(['nuke'], ['fortress'], 'scatter')
    aiPlays(scat, 'fortress', 'LEFT')
    toHumanMana(scat, 8)
    scat.apply({ kind: 'playUltimate', uid: uidOf(scat, 'HUMAN', 'nuke') })
    expect(stack(scat, 'LEFT', 'AI').length).toBe(1) // the split shard survived the sweep
  })
})

describe('the 11th boss (final Boss)', () => {
  it('the ladder has 11 rungs and the last is the Boss', () => {
    expect(BOSS_DECKS.length).toBe(11)
    expect(BOSS_DECKS[10]!.name).toBe('Boss')
  })

  it('the final boss always has more HP than boss 10, with a real pile up top', () => {
    // TCG tuning: a distinct HP chunk, not a punishing wall — modest early, biggest at the top.
    for (const t of [1, 12, 24]) {
      expect(tierBossHandicap(t, 11).bonusLife).toBeGreaterThan(tierBossHandicap(t, 10).bonusLife)
    }
    expect(tierBossHandicap(24, 11).bonusLife).toBeGreaterThan(tierBossHandicap(24, 10).bonusLife + 25)
  })
})
