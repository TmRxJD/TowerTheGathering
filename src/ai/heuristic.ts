/**
 * Heuristic AI commander. Rule-based, not search. It sees only what a player would — `snapshot('AI')`
 * hides the human's hand — and acts through the same public API a human does (`legalActions` /
 * `apply`), so it cannot cheat.
 *
 * Each MAIN phase it greedily picks the highest-scoring legal action until only `endTurn` remains or
 * nothing scores positive. Scores are nudged by the deck's `archetype` so the ten bosses feel
 * distinct (a Turtle values Fortress/Regen; an Aggro dumps units and buffs). A search/expectimax AI
 * is a deliberate v2 — this is tuned against the harness instead.
 */

import type { Action, Engine, GameEvent, Lane, Side, Target, UnitView } from '../engine'
import { getCard } from '../engine'
import type { Archetype } from '../engine'

const LANES: readonly Lane[] = ['LEFT', 'CENTER', 'RIGHT']

/** Per-archetype multipliers applied to a card's base score by family. */
interface Bias {
  unit: number
  removal: number
  buff: number
  defense: number
  ramp: number
  tempo: number
}

const BIAS: Readonly<Record<Archetype, Bias>> = {
  balanced: { unit: 1, removal: 1, buff: 1, defense: 1, ramp: 1, tempo: 1 },
  turtle: { unit: 1.1, removal: 1.1, buff: 0.6, defense: 1.8, ramp: 0.9, tempo: 0.7 },
  aggro: { unit: 1.4, removal: 0.8, buff: 1.6, defense: 0.4, ramp: 0.7, tempo: 1.2 },
  ramp: { unit: 0.9, removal: 1, buff: 0.8, defense: 0.9, ramp: 1.8, tempo: 1.1 },
  'nuke-control': { unit: 0.7, removal: 1.4, buff: 0.6, defense: 1.5, ramp: 1, tempo: 1 },
  'orbs-burst': { unit: 1.3, removal: 0.9, buff: 1.4, defense: 0.6, ramp: 0.9, tempo: 1.2 },
}

const RAMP_CARDS = new Set(['coins', 'cash', 'critical-coin', 'wave-accelerator', 'enemy-balance'])
const DEFENSE_CARDS = new Set([
  'fortress',
  'land-mine-stun',
  'health',
  'health-regen',
  'extra-defense',
  'slow-aura',
  'energy-shield',
  'second-wind',
  'land-mine-chance',
])
const BUFF_CARDS = new Set([
  'damage',
  'attack-speed',
  'critical-chance',
  'orbs-speed',
  'super-tower',
  'demon-mode',
  'ultimate-crit',
  'recovery-package',
])
const REMOVAL_CARDS = new Set(['plasma-cannon', 'death-ray', 'energy-net', 'nuke', 'wave-skip'])

export class HeuristicAI {
  constructor(
    private readonly engine: Engine,
    private readonly side: Side,
    private readonly archetype: Archetype = 'balanced',
  ) {}

  /** Play the whole MAIN phase and end the turn. Returns all events produced. */
  takeTurn(): GameEvent[] {
    const events: GameEvent[] = []
    // Bounded loop: each play consumes a card or mana, so legalActions strictly shrinks; the cap is
    // a backstop against a scoring bug, never reached in normal play.
    for (let guard = 0; guard < 64; guard++) {
      const actions = this.engine.legalActions(this.side)
      if (actions.length === 0) break
      const plays = actions.filter(a => a.kind !== 'endTurn')
      if (plays.length === 0) break
      let best: Action | null = null
      let bestScore = 0.01 // must beat "do nothing"
      for (const a of plays) {
        const s = this.score(a)
        if (s > bestScore) {
          bestScore = s
          best = a
        }
      }
      if (!best) break
      events.push(...this.engine.apply(best))
      if (this.engine.isOver()) return events
    }
    events.push(...this.engine.apply({ kind: 'endTurn' }))
    return events
  }

  // -------------------------------------------------------------------------

  private bias(): Bias {
    return BIAS[this.archetype]
  }

  private score(a: Action): number {
    if (a.kind === 'endTurn') return 0
    const b = this.bias()
    if (a.kind === 'playUnit') return this.scoreUnit(a.uid, a.lane) * b.unit
    if (a.kind === 'playModule') return this.scoreModule(a.uid)
    return this.scoreUltimate(a.uid, a.target)
  }

  private scoreUnit(uid: number, lane: Lane): number {
    const def = this.cardInHand(uid)
    if (!def) return 0
    const snap = this.engine.snapshot(this.side)
    const opp: Side = this.side === 'HUMAN' ? 'AI' : 'HUMAN'
    const enemyStack = snap.lanes[lane][opp]
    const mineStack = snap.lanes[lane][this.side]
    let v = (def.atk ?? 0) * 1.2 + (def.hp ?? 0) * 0.8
    // Defender into a contested lane is worth more; a body into an open lane pressures the Nexus.
    if (def.keywords?.includes('defender') && enemyStack.length > 0) v += 3
    if (enemyStack.length === 0) v += 1.5 // open lane → face pressure
    if (mineStack.length > 0) v -= 1 // stacking behind an existing unit is less urgent
    return v
  }

  private scoreModule(uid: number): number {
    const def = this.cardInHand(uid)
    if (!def) return 0
    const b = this.bias()
    let v = 2 + (5 - Math.min(5, def.cost)) * 0.2
    if (RAMP_CARDS.has(def.id)) v *= b.ramp
    else if (DEFENSE_CARDS.has(def.id)) v *= b.defense
    else if (BUFF_CARDS.has(def.id)) v *= b.buff
    // Only buff when there is something to buff.
    if ((def.id === 'damage' || def.id === 'attack-speed' || def.id === 'critical-chance') && this.friendlyUnitCount() === 0) {
      v *= 0.3
    }
    return v
  }

  private scoreUltimate(uid: number, target: Target | undefined): number {
    const def = this.cardInHand(uid)
    if (!def) return 0
    const b = this.bias()
    if (def.id === 'nuke') {
      // Only worth it when the enemy board is meaningfully bigger than ours.
      const diff = this.enemyUnitCount() - this.friendlyUnitCount()
      return diff >= 2 ? (4 + diff) * b.removal : 0
    }
    if (REMOVAL_CARDS.has(def.id)) {
      const tgt = target ? this.unitOfTarget(target) : undefined
      const worth = tgt ? tgt.atk * 1.5 + tgt.hp * 0.5 : 1
      return (2 + worth) * b.removal
    }
    if (RAMP_CARDS.has(def.id)) return 2 * b.ramp
    if (BUFF_CARDS.has(def.id)) {
      const tgt = target ? this.unitOfTarget(target) : undefined
      return tgt ? (2 + tgt.atk) * b.buff : 0.5
    }
    return 1.5 * b.tempo
  }

  // -------------------------------------------------------------------------

  private cardInHand(uid: number): ReturnType<typeof getCard> | undefined {
    const hand = this.engine.snapshot(this.side).players[this.side].hand
    const ref = hand?.find(c => c.uid === uid)
    return ref ? getCard(ref.cardId) : undefined
  }

  private unitOfTarget(target: Target): UnitView | undefined {
    if (target.kind !== 'unit') return undefined
    const snap = this.engine.snapshot(this.side)
    for (const lane of LANES) for (const s of ['HUMAN', 'AI'] as const) {
      const u = snap.lanes[lane][s].find(x => x.uid === target.uid)
      if (u) return u
    }
    return undefined
  }

  private friendlyUnitCount(): number {
    const snap = this.engine.snapshot(this.side)
    return LANES.reduce((n, l) => n + snap.lanes[l][this.side].length, 0)
  }

  private enemyUnitCount(): number {
    const snap = this.engine.snapshot(this.side)
    const opp: Side = this.side === 'HUMAN' ? 'AI' : 'HUMAN'
    return LANES.reduce((n, l) => n + snap.lanes[l][opp].length, 0)
  }
}
