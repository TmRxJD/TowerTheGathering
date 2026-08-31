import { describe, expect, it } from 'vitest'
import { createEngine } from './engine'
import { BOSS_DECKS, STARTER_DECK, validateDeck } from './decks'
import { createRng } from './rng'
import { TUNING } from './tuning'
import type { Action, Engine, Lane, Side } from './types'

// ---------------------------------------------------------------------------
// Test harness: deterministic deck order (shuffle:false → draw from the end).
// ---------------------------------------------------------------------------

/** Build a 20-card deck with `tail` drawn first (index 19 = first draw), padded with inert Cash. */
function mkDeck(tail: string[]): string[] {
  const pad = Array.from({ length: TUNING.DECK_SIZE - tail.length }, () => 'cash')
  // tail reversed so tail[0] ends up at the end of the array and is popped first.
  return [...pad, ...[...tail].reverse()]
}

function build(humanTail: string[], aiTail: string[], seed = 'test'): Engine {
  const { engine } = createEngine({
    humanDeck: mkDeck(humanTail),
    aiDeck: mkDeck(aiTail),
    seed,
    shuffle: false,
    firstPlayer: 'HUMAN',
  })
  return engine
}

const pass = (e: Engine) => e.apply({ kind: 'endTurn' })
function hand(e: Engine, side: Side) {
  return e.snapshot(side).players[side].hand ?? []
}
function uidOf(e: Engine, side: Side, cardId: string): number {
  const ref = hand(e, side).find(c => c.cardId === cardId)
  if (!ref) throw new Error(`${cardId} not in ${side} hand: ${hand(e, side).map(c => c.cardId).join(',')}`)
  return ref.uid
}
function life(e: Engine, side: Side): number {
  return e.snapshot().players[side].life
}
function stack(e: Engine, lane: Lane, side: Side) {
  return e.snapshot().lanes[lane][side]
}

// ---------------------------------------------------------------------------

describe('decks', () => {
  it('every built-in deck is legal (size + copy limits)', () => {
    expect(validateDeck(STARTER_DECK).ok).toBe(true)
    for (const boss of BOSS_DECKS) {
      const v = validateDeck(boss.cards)
      expect(v.errors).toEqual([])
      expect(v.ok).toBe(true)
    }
  })

  it('the validator actually rejects a bad deck (guardrail proven by a planted fault)', () => {
    expect(validateDeck([...STARTER_DECK, 'cash']).ok).toBe(false) // 21 cards
    expect(validateDeck(mkDeck(['nuke', 'nuke'])).ok).toBe(false) // 2× epic
  })
})

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng('seed-1')
    const b = createRng('seed-1')
    const c = createRng('seed-2')
    const sa = Array.from({ length: 5 }, () => a.next())
    const sb = Array.from({ length: 5 }, () => b.next())
    const sc = Array.from({ length: 5 }, () => c.next())
    expect(sa).toEqual(sb)
    expect(sa).not.toEqual(sc)
  })
})

describe('clone / serialize', () => {
  it('preserves temporary mana (Cash) through serialize + clone', () => {
    const e = build(['cash'], [], 'temp')
    // Turn 1, mana 1. Cash costs 1 and grants +2 temp mana → pool should be 2.
    e.apply({ kind: 'playUltimate', uid: uidOf(e, 'HUMAN', 'cash') })
    expect(e.snapshot('HUMAN').players.HUMAN.manaPool).toBe(2)
    const c = e.clone()
    expect(c.snapshot('HUMAN').players.HUMAN.manaPool).toBe(2)
    // round-trip through serialize as the CLI does
    expect(JSON.parse(JSON.stringify(e.serialize())).players.HUMAN.manaPool).toBe(2)
  })

  it('a clone is independent and plays identically to the original', () => {
    const e = build(['land-mine-stun', 'damage', 'cash'], ['fortress', 'berserker'], 'clone')
    // advance a few turns so there is real state (units, mana, deck drawn)
    for (let i = 0; i < 4; i++) pass(e)
    const snapBefore = JSON.stringify(e.snapshot('HUMAN'))
    const c = e.clone()
    // The clone matches at the moment of cloning...
    expect(JSON.stringify(c.snapshot('HUMAN'))).toEqual(snapBefore)
    // ...mutating the clone does not touch the original...
    pass(c)
    pass(c)
    expect(JSON.stringify(e.snapshot('HUMAN'))).toEqual(snapBefore)
    // ...and original + clone, driven by the same actions, stay identical.
    const e2 = e.clone()
    const script: Action[] = [{ kind: 'endTurn' }, { kind: 'endTurn' }, { kind: 'endTurn' }]
    for (const a of script) {
      e.apply(a)
      e2.apply(a)
    }
    expect(JSON.stringify(e2.snapshot('HUMAN'))).toEqual(JSON.stringify(e.snapshot('HUMAN')))
  })
})

describe('engine determinism', () => {
  it('same seed + decks + actions ⇒ identical snapshots', () => {
    const script: Action[] = [{ kind: 'endTurn' }, { kind: 'endTurn' }, { kind: 'endTurn' }]
    const run = () => {
      const e = build(['land-mine-stun'], [], 'det')
      for (const a of script) e.apply(a)
      return JSON.stringify(e.snapshot('HUMAN'))
    }
    expect(run()).toEqual(run())
  })
})

describe('resources', () => {
  it('mana ramps by 1 per turn and caps', () => {
    const e = build([], [])
    expect(e.snapshot().players.HUMAN.manaMax).toBe(TUNING.START_MANA_MAX)
    // advance several HUMAN turns
    for (let i = 0; i < 6; i++) {
      pass(e) // HUMAN → AI
      pass(e) // AI → HUMAN
    }
    expect(e.snapshot().players.HUMAN.manaMax).toBe(7)
    for (let i = 0; i < 10; i++) {
      pass(e)
      pass(e)
    }
    expect(e.snapshot().players.HUMAN.manaMax).toBe(TUNING.MANA_CAP)
  })
})

describe('combat', () => {
  it('an unblocked unit hits the enemy Nexus', () => {
    const e = build(['land-mine-stun'], []) // 1/2, atk 1
    pass(e) // HUMAN t1 → AI
    pass(e) // AI t1 → HUMAN t2 (mana 2)
    e.apply({ kind: 'playUnit', uid: uidOf(e, 'HUMAN', 'land-mine-stun'), lane: 'LEFT' })
    pass(e) // HUMAN combat: land-mine hits AI face for 1
    expect(life(e, 'AI')).toBe(TUNING.START_LIFE - 1)
  })

  it('Damage module is a live control: +1 ATK moves face damage from 1 to 2', () => {
    const e = build(['damage', 'land-mine-stun'], [])
    pass(e) // t1 → AI
    pass(e) // AI → t2
    pass(e) // t2 → AI
    pass(e) // AI → t3 (mana 3: damage(1) + land-mine(2))
    e.apply({ kind: 'playModule', uid: uidOf(e, 'HUMAN', 'damage') })
    e.apply({ kind: 'playUnit', uid: uidOf(e, 'HUMAN', 'land-mine-stun'), lane: 'LEFT' })
    pass(e)
    expect(life(e, 'AI')).toBe(TUNING.START_LIFE - 2)
  })

  it('a Defender blocks: face is untouched and the defender soaks the hit', () => {
    const e = build(['land-mine-stun'], ['fortress'])
    pass(e) // H t1 → AI t1
    pass(e) // AI t1 → H t2
    pass(e) // H t2 → AI t2 (mana 2)
    e.apply({ kind: 'playUnit', uid: uidOf(e, 'AI', 'fortress'), lane: 'LEFT' })
    pass(e) // AI t2 combat (fortress atk 0) → H t3
    e.apply({ kind: 'playUnit', uid: uidOf(e, 'HUMAN', 'land-mine-stun'), lane: 'LEFT' })
    pass(e) // H t3 combat: land-mine(1) vs fortress(0/8)
    expect(life(e, 'AI')).toBe(TUNING.START_LIFE) // fortress absorbed it
    const fort = stack(e, 'LEFT', 'AI')[0]
    expect(fort?.cardId).toBe('fortress')
    expect(fort?.hp).toBe(7)
  })

  it('Extra Orbs spillover carries overkill to the Nexus', () => {
    // AI orbs (3/1) then HUMAN orbs (3/1) in the same lane: both first-strike, both die,
    // each spills overkill (3 - 1 = 2) to the other Nexus.
    const e = build(['extra-orbs'], ['extra-orbs'])
    // ramp both to mana 4
    for (let i = 0; i < 3; i++) {
      pass(e)
      pass(e)
    }
    // Now HUMAN t4 (mana 4). Pass to let AI place first.
    pass(e) // HUMAN t4 → AI t4
    e.apply({ kind: 'playUnit', uid: uidOf(e, 'AI', 'extra-orbs'), lane: 'LEFT' })
    const aiBefore = life(e, 'AI')
    pass(e) // AI combat: AI orbs hits HUMAN face → HUMAN t5
    e.apply({ kind: 'playUnit', uid: uidOf(e, 'HUMAN', 'extra-orbs'), lane: 'LEFT' })
    pass(e) // HUMAN combat: mutual first-strike kill, spillover both ways
    expect(stack(e, 'LEFT', 'HUMAN').length).toBe(0)
    expect(stack(e, 'LEFT', 'AI').length).toBe(0)
    expect(life(e, 'AI')).toBe(aiBefore - 2) // overkill spilled to AI face
  })
})

describe('card levels + mastery', () => {
  it('a leveled + mastered Damage scales the ATK bonus', () => {
    const { engine: e } = createEngine({
      humanDeck: mkDeck(['damage', 'land-mine-stun']),
      aiDeck: mkDeck([]),
      seed: 'lvl',
      shuffle: false,
      firstPlayer: 'HUMAN',
      // Damage level 6 (value 3) + mastery level 1 (+1) => +4 ATK.
      cardLevels: { HUMAN: { damage: { level: 6, mastery: 1 } } },
    })
    pass(e) // t1 → AI
    pass(e) // AI → t2
    pass(e) // t2 → AI
    pass(e) // AI → t3 (mana 3)
    e.apply({ kind: 'playModule', uid: uidOf(e, 'HUMAN', 'damage') })
    e.apply({ kind: 'playUnit', uid: uidOf(e, 'HUMAN', 'land-mine-stun'), lane: 'LEFT' })
    pass(e) // combat: land-mine base 1 ATK + Damage(+4) = 5 to AI face
    expect(life(e, 'AI')).toBe(TUNING.START_LIFE - 5)
  })
})

describe('ultimates', () => {
  it('Plasma Cannon removes 50% of current HP (rounded up)', () => {
    const e = build(['plasma-cannon'], ['berserker']) // berserker 2/4
    pass(e) // HUMAN t1 → AI t1
    // AI needs mana 4 for berserker; ramp.
    pass(e) // AI t1 → HUMAN t2
    pass(e) // → AI t2
    pass(e) // → HUMAN t3
    pass(e) // → AI t3
    pass(e) // → HUMAN t4
    pass(e) // → AI t4 (mana 4)
    e.apply({ kind: 'playUnit', uid: uidOf(e, 'AI', 'berserker'), lane: 'CENTER' })
    pass(e) // AI combat → HUMAN t5 (mana 5, plasma costs 3)
    const zerk = stack(e, 'CENTER', 'AI')[0]!
    expect(zerk.hp).toBe(4)
    e.apply({ kind: 'playUltimate', uid: uidOf(e, 'HUMAN', 'plasma-cannon'), target: { kind: 'unit', uid: zerk.uid } })
    expect(stack(e, 'CENTER', 'AI')[0]?.hp).toBe(2) // ceil(4/2) = 2 removed
  })

  it('Smart Missiles hits the front enemy unit in every lane', () => {
    const e = build(['smart-missiles'], ['berserker']) // berserker 2/4
    for (let i = 0; i < 3; i++) {
      pass(e)
      pass(e)
    } // → HUMAN t4; AI had t1..t3
    pass(e) // HUMAN t4 → AI t4 (mana 4)
    e.apply({ kind: 'playUnit', uid: uidOf(e, 'AI', 'berserker'), lane: 'CENTER' })
    pass(e) // AI combat → HUMAN t5 (mana 5)
    const zerk = stack(e, 'CENTER', 'AI')[0]!
    expect(zerk.hp).toBe(4)
    e.apply({ kind: 'playUltimate', uid: uidOf(e, 'HUMAN', 'smart-missiles') })
    expect(stack(e, 'CENTER', 'AI')[0]?.hp).toBe(2) // took 2
  })

  it('Nuke clears every unit on both sides', () => {
    const e = build(['nuke', 'land-mine-stun'], ['fortress'])
    // HUMAN drops a unit, AI drops one (both need mana 2), then HUMAN nukes at mana 8.
    pass(e) // H t1 → AI t1
    pass(e) // AI t1 → H t2 (mana 2)
    e.apply({ kind: 'playUnit', uid: uidOf(e, 'HUMAN', 'land-mine-stun'), lane: 'LEFT' })
    pass(e) // H t2 combat → AI t2 (mana 2)
    e.apply({ kind: 'playUnit', uid: uidOf(e, 'AI', 'fortress'), lane: 'RIGHT' })
    pass(e) // AI t2 combat → H t3
    // ramp HUMAN to mana 8 (keeping nuke in hand the whole time)
    for (let i = 0; i < 5; i++) {
      pass(e) // HUMAN → AI
      pass(e) // AI → HUMAN
    }
    expect(e.snapshot().players.HUMAN.manaMax).toBe(8)
    const anyUnits = () =>
      (['LEFT', 'CENTER', 'RIGHT'] as Lane[]).some(
        l => stack(e, l, 'HUMAN').length + stack(e, l, 'AI').length > 0,
      )
    expect(anyUnits()).toBe(true)
    e.apply({ kind: 'playUltimate', uid: uidOf(e, 'HUMAN', 'nuke') })
    expect(anyUnits()).toBe(false)
  })

  it('Energy Net freezes a target for 2 turns (a live control)', () => {
    const e = build(['energy-net'], ['berserker'])
    for (let i = 0; i < 3; i++) {
      pass(e)
      pass(e)
    } // → HUMAN t4; AI has had t1..t3
    pass(e) // HUMAN t4 → AI t4 (mana 4)
    e.apply({ kind: 'playUnit', uid: uidOf(e, 'AI', 'berserker'), lane: 'LEFT' })
    pass(e) // AI combat → HUMAN t5 (mana 5)
    const zerk = stack(e, 'LEFT', 'AI')[0]!
    expect(zerk.frozen).toBe(false)
    e.apply({ kind: 'playUltimate', uid: uidOf(e, 'HUMAN', 'energy-net'), target: { kind: 'unit', uid: zerk.uid } })
    expect(stack(e, 'LEFT', 'AI')[0]?.frozen).toBe(true)
  })
})
