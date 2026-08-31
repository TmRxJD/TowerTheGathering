/**
 * Heuristic AI commander. Rule-based, not search. It sees only what a player would — `snapshot('AI')`
 * hides the opponent's hand — and acts through the same public API a human does (`legalActions` /
 * `apply`), so it cannot cheat.
 *
 * Each MAIN phase it greedily picks the highest-scoring legal action until only `endTurn` remains or
 * nothing scores positive. Scoring reads the board every time: it pushes for lethal down open lanes,
 * blocks/removes real threats when it is the one under pressure, spends Cash only to enable a bigger
 * play, and refuses to buff an empty board or help the opponent (Enemy Balance) unless it is a ramp
 * deck that is behind. Archetype nudges the weights so the ten bosses feel distinct. A search AI is a
 * deliberate v2 — this is tuned against the harness.
 */

import type { Action, Engine, GameEvent, Lane, PlayerView, Side, Target, UnitView } from '../engine'
import { getCard } from '../engine'
import type { Archetype } from '../engine'

const LANES: readonly Lane[] = ['LEFT', 'CENTER', 'RIGHT']

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
  turtle: { unit: 1, removal: 1.15, buff: 0.7, defense: 1.7, ramp: 0.95, tempo: 0.8 },
  aggro: { unit: 1.35, removal: 0.85, buff: 1.5, defense: 0.5, ramp: 0.75, tempo: 1.2 },
  ramp: { unit: 0.95, removal: 1, buff: 0.85, defense: 0.95, ramp: 1.7, tempo: 1.05 },
  'nuke-control': { unit: 0.8, removal: 1.35, buff: 0.65, defense: 1.4, ramp: 1.05, tempo: 1 },
  'orbs-burst': { unit: 1.3, removal: 0.9, buff: 1.35, defense: 0.6, ramp: 0.9, tempo: 1.2 },
}

const RAMP_CARDS = new Set(['coins', 'critical-coin', 'wave-accelerator'])
const DEFENSE_MODULES = new Set([
  'health',
  'health-regen',
  'extra-defense',
  'slow-aura',
  'energy-shield',
  'package-chance',
  'land-mine-chance',
])
const BUFF_MODULES = new Set(['damage', 'attack-speed', 'critical-chance', 'orbs-speed', 'super-tower'])
const NEEDS_BOARD_TO_BUFF = new Set(['damage', 'attack-speed', 'critical-chance', 'orbs-speed'])

export class HeuristicAI {
  constructor(
    private readonly engine: Engine,
    private readonly side: Side,
    private readonly archetype: Archetype = 'balanced',
  ) {}

  /** Play the whole MAIN phase and end the turn. Returns all events produced. */
  takeTurn(): GameEvent[] {
    const events: GameEvent[] = []
    for (let guard = 0; guard < 64; guard++) {
      const actions = this.engine.legalActions(this.side)
      const plays = actions.filter(a => a.kind !== 'endTurn')
      if (plays.length === 0) break
      let best: Action | null = null
      let bestScore = 0.05
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
  // Board reading
  // -------------------------------------------------------------------------

  private get opp(): Side {
    return this.side === 'HUMAN' ? 'AI' : 'HUMAN'
  }

  private snap() {
    return this.engine.snapshot(this.side)
  }

  private me(): PlayerView {
    return this.snap().players[this.side]
  }

  private foe(): PlayerView {
    return this.snap().players[this.opp]
  }

  private front(lane: Lane, side: Side): UnitView | undefined {
    return this.snap().lanes[lane][side][0]
  }

  private myUnitCount(): number {
    const s = this.snap()
    return LANES.reduce((n, l) => n + s.lanes[l][this.side].length, 0)
  }

  private foeUnitCount(): number {
    const s = this.snap()
    return LANES.reduce((n, l) => n + s.lanes[l][this.opp].length, 0)
  }

  /** Face damage I currently threaten: front ATK in lanes where the enemy has no blocker. */
  private myFacePotential(): number {
    let dmg = 0
    for (const lane of LANES) {
      if (this.front(lane, this.opp)) continue
      const f = this.front(lane, this.side)
      if (f && !f.tapped && !f.frozen) dmg += f.atk
    }
    return dmg
  }

  /** Damage I will take next combat: enemy front ATK in lanes where I have no blocker. */
  private incomingThreat(): number {
    let dmg = 0
    for (const lane of LANES) {
      if (this.front(lane, this.side)) continue
      const f = this.front(lane, this.opp)
      if (f && !f.tapped && !f.frozen) dmg += f.atk
    }
    return dmg
  }

  private countMyModule(cardId: string): number {
    return this.me().modules.reduce((n, m) => (m.cardId === cardId ? n + 1 : n), 0)
  }

  private effCost(cardId: string): number {
    const def = getCard(cardId)
    let c = def.cost
    if (def.type === 'ULTIMATE') c -= this.countMyModule('wave-accelerator')
    return Math.max(1, c)
  }

  // -------------------------------------------------------------------------
  // Scoring
  // -------------------------------------------------------------------------

  private bias(): Bias {
    return BIAS[this.archetype]
  }

  private score(a: Action): number {
    if (a.kind === 'endTurn') return 0
    if (a.kind === 'playUnit') return this.scoreUnit(a.uid, a.lane)
    if (a.kind === 'playModule') return this.scoreModule(a.uid)
    return this.scoreUltimate(a.uid, a.target)
  }

  private handDef(uid: number) {
    const ref = (this.me().hand ?? []).find(c => c.uid === uid)
    return ref ? getCard(ref.cardId) : undefined
  }

  private scoreUnit(uid: number, lane: Lane): number {
    const def = this.handDef(uid)
    if (!def) return 0
    const b = this.bias()
    const atk = def.atk ?? 0
    const hp = def.hp ?? 0
    const enemyFront = this.front(lane, this.opp)
    const myStack = this.snap().lanes[lane][this.side].length

    let v = atk * 1.2 + hp * 0.7 + 1
    if (enemyFront) {
      // Blocking / trading value scales with the threat this lane poses.
      const blockValue = Math.min(enemyFront.atk, hp) * 1.3
      const trade = atk >= enemyFront.hp ? enemyFront.atk * 1.4 + enemyFront.hp * 0.4 : atk * 0.6
      v += blockValue + trade
      if (def.keywords?.includes('defender')) v += 2
      // Only my FIRST unit in a contested lane blocks; reserves are near-idle.
      if (myStack >= 1) v -= 3
    } else {
      // Open lane → face pressure. Worth much more when it helps close the game.
      v += atk * 1.1 + 1.5
      const foeLife = this.foe().life
      const potential = this.myFacePotential() + atk
      if (potential >= foeLife) v += 8 // lethal / near-lethal push
      else if (potential >= foeLife * 0.6) v += 2
      if (myStack >= 1) v -= 2 // don't pile behind an already-attacking unit
    }
    return Math.max(0, v) * b.unit
  }

  private scoreModule(uid: number): number {
    const def = this.handDef(uid)
    if (!def) return 0
    const b = this.bias()
    let v = 2 + (5 - Math.min(5, def.cost)) * 0.25

    if (def.id === 'enemy-balance') {
      // It buffs the OPPONENT's units — only a ramp deck that's behind should risk it.
      const behind = this.me().life < this.foe().life
      return this.archetype === 'ramp' && behind ? 2.2 * b.ramp : 0
    }
    if (RAMP_CARDS.has(def.id)) {
      // Economy is best early (more turns to pay off) and worse when under pressure. manaMax rises
      // by 1 per turn, so it doubles as a "how far into the game" proxy.
      v = (3.4 - this.me().manaMax * 0.22) * b.ramp
      if (this.incomingThreat() >= this.me().life * 0.5) v *= 0.5
      return Math.max(0.3, v)
    }
    if (DEFENSE_MODULES.has(def.id)) {
      const pressure = this.incomingThreat()
      v = (2 + pressure * 0.4) * b.defense
      if (def.id === 'health' || def.id === 'health-regen') v += this.me().life < 10 ? 3 : 0
      return v
    }
    if (BUFF_MODULES.has(def.id)) {
      const boardAtk = this.myBoardAtk()
      if (NEEDS_BOARD_TO_BUFF.has(def.id) && this.myUnitCount() === 0) return 0.2
      v = (1.5 + boardAtk * 0.4) * b.buff
      if (def.id === 'orbs-speed' && !this.haveOrbs()) v = 0.3
      return v
    }
    return v
  }

  private scoreUltimate(uid: number, target: Target | undefined): number {
    const def = this.handDef(uid)
    if (!def) return 0
    const b = this.bias()

    if (def.id === 'cash') {
      // Only worth it to enable a bigger play we can't currently afford.
      const pool = this.me().manaPool
      const enables = (this.me().hand ?? []).some(c => {
        if (c.uid === uid) return false
        const d = getCard(c.cardId)
        const cost = this.effCost(c.cardId)
        const impactful = d.type === 'UNIT' || d.type === 'ULTIMATE'
        return impactful && cost > pool && cost <= pool + 2
      })
      return enables ? 3.5 : 0.2
    }
    if (def.id === 'wave-skip') {
      // Buy a turn when a hit is coming and we can't otherwise stop it.
      return this.incomingThreat() >= this.me().life * 0.4 ? (3 + this.incomingThreat() * 0.3) * b.defense : 0.4
    }
    if (def.id === 'nuke') {
      const diff = this.foeUnitCount() - this.myUnitCount()
      return diff >= 2 ? (4 + diff * 1.5) * b.removal : 0
    }
    if (def.id === 'plasma-cannon' || def.id === 'death-ray' || def.id === 'energy-net') {
      const t = target ? this.unitOfTarget(target) : undefined
      if (!t) return 0
      // Prefer removing the biggest threat; energy-net matters most when it's attacking us.
      const threat = t.atk * 1.6 + t.hp * 0.5
      const bonus = def.id === 'death-ray' ? 2 : 0
      return (1.5 + threat + bonus) * b.removal
    }
    if (def.id === 'demon-mode' || def.id === 'ultimate-crit') {
      const t = target ? this.unitOfTarget(target) : undefined
      if (!t || t.frozen || t.tapped) return 0
      // Best on a hard-hitting attacker, especially into an open lane for reach to face.
      const open = LANES.some(l => this.front(l, this.side)?.uid === t.uid && !this.front(l, this.opp))
      return (2 + t.atk * 1.2 + (open ? 3 : 0)) * b.buff
    }
    if (def.id === 'recovery-package') {
      const t = target ? this.unitOfTarget(target) : undefined
      if (!t) return 0
      const missing = t.maxHp - t.hp
      return missing <= 0 ? 0.2 : (1 + missing * 0.8 + t.atk * 0.4) * b.buff
    }
    if (def.id === 'intro-sprint' || def.id === 'free-upgrades') {
      return 2.2 * b.tempo // card advantage / free tempo
    }
    return 1.2 * b.tempo
  }

  // -------------------------------------------------------------------------

  private unitOfTarget(target: Target): UnitView | undefined {
    if (target.kind !== 'unit') return undefined
    const s = this.snap()
    for (const lane of LANES) for (const side of ['HUMAN', 'AI'] as const) {
      const u = s.lanes[lane][side].find(x => x.uid === target.uid)
      if (u) return u
    }
    return undefined
  }

  private myBoardAtk(): number {
    const s = this.snap()
    let a = 0
    for (const lane of LANES) for (const u of s.lanes[lane][this.side]) a += u.atk
    return a
  }

  private haveOrbs(): boolean {
    const s = this.snap()
    return LANES.some(l => s.lanes[l][this.side].some(u => u.cardId === 'extra-orbs'))
  }
}
