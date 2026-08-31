/**
 * Tower: The Gathering — the engine. State machine, combat, and every card effect.
 *
 * Pure TypeScript: zero DOM, zero framework. It emits an ordered event list from every mutating
 * call (the UI animates from those) and exposes a read-only `snapshot()`. Behaviour is keyed by
 * card `id`; the numbers live in cards.ts / tuning.ts. Rules are docs/GAME_DESIGN.md — read that
 * before changing anything here.
 *
 * A note on the codebase's favourite bug ("a control that changes nothing"): every keyword and
 * module below is wired into a specific place in resolution, and engine.test.ts flips each one and
 * asserts the output moves. If you add a card, add the assertion too.
 */

import { getCard, MINE_TOKEN } from './cards'
import { createRng, type Rng } from './rng'
import { TUNING } from './tuning'
import type {
  Action,
  CardRef,
  Engine,
  EngineOptions,
  GameEvent,
  GameResult,
  GameSnapshot,
  Keyword,
  Lane,
  ModuleInstance,
  ModuleView,
  Phase,
  PlayerState,
  PlayerView,
  SecretInstance,
  Side,
  Target,
  UnitInstance,
  UnitView,
} from './types'
import { LANES, SIDES } from './types'

const ADJACENT: Readonly<Record<Lane, readonly Lane[]>> = {
  LEFT: ['CENTER'],
  CENTER: ['LEFT', 'RIGHT'],
  RIGHT: ['CENTER'],
}

type TargetType = 'none' | 'enemyUnit' | 'anyUnit' | 'friendlyUnit'

/** A single unit's intended combat damage, computed before any of it is applied so a step is
 *  truly simultaneous (both first-strikers trade even if both die). */
type CombatPlan =
  | { readonly attackerUid: number; readonly target: 'nexus'; readonly side: Side; readonly amount: number }
  | {
      readonly attackerUid: number
      readonly target: 'unit'
      readonly uid: number
      readonly hpBefore: number
      readonly amount: number
      readonly crit: boolean
      readonly spillSide?: Side
    }

/** Which ultimates need a target, and of what kind. Drives legalActions + validation. */
const ULTIMATE_TARGET: Readonly<Record<string, TargetType>> = {
  'plasma-cannon': 'enemyUnit',
  'death-ray': 'anyUnit',
  'energy-net': 'enemyUnit',
  'demon-mode': 'friendlyUnit',
  'recovery-package': 'friendlyUnit',
  'ultimate-crit': 'friendlyUnit',
}

class TowerEngine implements Engine {
  private readonly rng: Rng
  private uidSeq = 1
  private turn = 0
  private activeSide: Side
  private phase: Phase = 'MAIN'
  private winner: Side | null = null
  private readonly players: Record<Side, PlayerState>
  private readonly lanes: Record<Lane, Record<Side, UnitInstance[]>>
  /** Bonus mana to grant a side at the start of its next turn (Critical Coin). */
  private readonly pendingMana: Record<Side, number> = { HUMAN: 0, AI: 0 }
  private readonly shuffleDecks: boolean

  constructor(opts: EngineOptions) {
    this.rng = createRng(opts.seed ?? 'ttg-default')
    this.activeSide = opts.firstPlayer ?? 'HUMAN'
    this.shuffleDecks = opts.shuffle !== false
    this.lanes = {
      LEFT: { HUMAN: [], AI: [] },
      CENTER: { HUMAN: [], AI: [] },
      RIGHT: { HUMAN: [], AI: [] },
    }
    this.players = {
      HUMAN: this.newPlayer('HUMAN', opts.humanDeck),
      AI: this.newPlayer('AI', opts.aiDeck),
    }
    for (const side of SIDES) {
      for (let i = 0; i < TUNING.OPENING_HAND; i++) this.drawCard(this.players[side], [])
    }
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private newPlayer(side: Side, deckIds: readonly string[]): PlayerState {
    const deck: CardRef[] = deckIds.map(cardId => ({ uid: this.uidSeq++, cardId }))
    if (this.shuffleDecks) this.rng.shuffle(deck)
    return {
      side,
      life: TUNING.START_LIFE,
      maxLife: TUNING.START_LIFE,
      manaMax: 0, // raised to START_MANA_MAX by the first startTurn
      manaPool: 0,
      deck,
      hand: [],
      discard: [],
      modules: [],
      secrets: [],
      turnCount: 0,
      skipNextCombat: false,
    }
  }

  /** Call once after construction to run the first player's opening turn up to MAIN. */
  start(): GameEvent[] {
    const events: GameEvent[] = []
    this.startTurn(this.activeSide, events)
    return events
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  isOver(): boolean {
    return this.winner !== null
  }

  result(): GameResult | null {
    if (this.winner === null) return null
    return {
      winner: this.winner,
      turns: this.turn,
      humanLifeRemaining: Math.max(0, this.players.HUMAN.life),
      aiLifeRemaining: Math.max(0, this.players.AI.life),
    }
  }

  legalActions(side: Side): Action[] {
    if (this.winner !== null || side !== this.activeSide || this.phase !== 'MAIN') return []
    const p = this.players[side]
    const actions: Action[] = [{ kind: 'endTurn' }]
    for (const ref of p.hand) {
      const def = getCard(ref.cardId)
      const cost = this.effectiveCost(side, ref.cardId)
      if (cost > p.manaPool) continue
      if (def.type === 'UNIT') {
        for (const lane of LANES) {
          if (this.lanes[lane][side].length < TUNING.LANE_STACK_CAP) {
            actions.push({ kind: 'playUnit', uid: ref.uid, lane })
          }
        }
      } else if (def.type === 'MODULE') {
        if (p.modules.length < TUNING.BACKLINE_SLOTS) actions.push({ kind: 'playModule', uid: ref.uid })
      } else {
        const tt = ULTIMATE_TARGET[def.id] ?? 'none'
        if (tt === 'none') {
          actions.push({ kind: 'playUltimate', uid: ref.uid })
        } else {
          for (const target of this.legalTargets(side, tt)) {
            actions.push({ kind: 'playUltimate', uid: ref.uid, target })
          }
        }
      }
    }
    return actions
  }

  apply(action: Action): GameEvent[] {
    if (this.winner !== null) return []
    const side = this.activeSide
    const events: GameEvent[] = []
    switch (action.kind) {
      case 'endTurn':
        this.endTurn(events)
        break
      case 'playUnit':
        this.playUnit(side, action.uid, action.lane, events)
        break
      case 'playModule':
        this.playModule(side, action.uid, events)
        break
      case 'playUltimate':
        this.playUltimate(side, action.uid, action.target, events)
        break
    }
    return events
  }

  // -------------------------------------------------------------------------
  // Turn flow
  // -------------------------------------------------------------------------

  private startTurn(side: Side, events: GameEvent[]): void {
    this.turn++
    this.phase = 'DRAW'
    const p = this.players[side]
    p.turnCount++
    events.push({ type: 'turnStarted', side, turn: this.turn })
    events.push({ type: 'phaseChanged', phase: 'DRAW', side })

    // Mana: +1 max (cap), refill, plus any pending bonus (Critical Coin).
    p.manaMax = Math.min(TUNING.MANA_CAP, p.manaMax + 1)
    p.manaPool = p.manaMax + this.pendingMana[side]
    this.pendingMana[side] = 0
    events.push({ type: 'manaChanged', side, pool: p.manaPool, max: p.manaMax })

    // Start-of-turn: Health Regen.
    if (this.countModule(side, 'health-regen') > 0) {
      const amt = TUNING.REGEN_PER_TURN * this.countModule(side, 'health-regen')
      this.healNexus(side, amt, events)
      for (const lane of LANES) {
        for (const u of this.lanes[lane][side]) this.healUnit(u, amt, events)
      }
    }

    // Draw: 1 + Coins (own) + Enemy Balance (any side in play).
    const draws = 1 + this.countModule(side, 'coins') + this.countAllModules('enemy-balance')
    for (let i = 0; i < draws; i++) this.drawCard(p, events)

    this.phase = 'MAIN'
    events.push({ type: 'phaseChanged', phase: 'MAIN', side })
  }

  private endTurn(events: GameEvent[]): void {
    const side = this.activeSide
    // COMBAT
    this.phase = 'COMBAT'
    events.push({ type: 'phaseChanged', phase: 'COMBAT', side })
    const p = this.players[side]
    if (p.skipNextCombat) {
      p.skipNextCombat = false
    } else {
      this.resolveCombat(side, events)
    }
    if (this.winner !== null) return

    // END
    this.phase = 'END'
    events.push({ type: 'phaseChanged', phase: 'END', side })
    this.endPhase(side, events)
    if (this.winner !== null) return

    // Hand over to the other side.
    this.activeSide = side === 'HUMAN' ? 'AI' : 'HUMAN'
    this.startTurn(this.activeSide, events)
  }

  private endPhase(side: Side, events: GameEvent[]): void {
    // Land Mine Chance: 50% per copy to spawn a mine in a random empty lane.
    const mineModules = this.countModule(side, 'land-mine-chance')
    for (let i = 0; i < mineModules; i++) {
      if (!this.rng.chance(TUNING.LAND_MINE_SPAWN_CHANCE)) continue
      const empty = LANES.filter(l => this.lanes[l][side].length === 0)
      if (empty.length === 0) break
      const lane = empty[this.rng.int(empty.length)] as Lane
      const unit = this.makeUnit(side, MINE_TOKEN.id, lane)
      this.lanes[lane][side].unshift(unit)
      events.push({ type: 'unitPlaced', unit, index: 0 })
    }

    // Demon Mode sacrifices; tapped/frozen tick down for THIS side's units.
    for (const lane of LANES) {
      const stack = this.lanes[lane][side]
      for (const u of [...stack]) {
        u.invulnerableThisTurn = false
        if (u.sacrificeAtEndOfTurn) {
          this.killUnit(u, events)
          continue
        }
        if (u.tappedTurns > 0) u.tappedTurns--
        if (u.frozenTurns > 0) u.frozenTurns--
      }
    }
  }

  // -------------------------------------------------------------------------
  // Playing cards
  // -------------------------------------------------------------------------

  private takeFromHand(p: PlayerState, uid: number): CardRef {
    const idx = p.hand.findIndex(c => c.uid === uid)
    if (idx < 0) throw new Error(`card ${uid} not in ${p.side} hand`)
    return p.hand.splice(idx, 1)[0] as CardRef
  }

  private spend(p: PlayerState, cost: number): void {
    if (cost > p.manaPool) throw new Error('not enough mana')
    p.manaPool -= cost
  }

  private playUnit(side: Side, uid: number, lane: Lane, events: GameEvent[]): void {
    const p = this.players[side]
    const ref = p.hand.find(c => c.uid === uid)
    if (!ref) throw new Error(`unit ${uid} not in hand`)
    const def = getCard(ref.cardId)
    if (def.type !== 'UNIT') throw new Error(`${def.id} is not a unit`)
    if (this.lanes[lane][side].length >= TUNING.LANE_STACK_CAP) throw new Error('lane full')
    this.spend(p, this.effectiveCost(side, ref.cardId))
    this.takeFromHand(p, uid)
    const unit = this.makeUnit(side, ref.cardId, lane, ref.uid)

    // Slow Aura (opponent's): this unit enters tapped.
    const opp = this.opponent(side)
    if (this.countModule(opp, 'slow-aura') > 0) {
      unit.tappedTurns = 1
      events.push({ type: 'unitTapped', uid: unit.uid })
    }

    const stack = this.lanes[lane][side]
    let index = stack.length
    const isDefender = unit.innate.has('defender')
    if (isDefender && (stack.length === 0 || !stack[0]!.innate.has('defender'))) {
      stack.unshift(unit)
      index = 0
    } else {
      stack.push(unit)
    }
    events.push({ type: 'unitPlaced', unit, index })

    // Enemy trap: opponent's Land Mine Stun in this lane triggers on our entry.
    this.triggerEnemyTraps(side, lane, unit, events)
  }

  private triggerEnemyTraps(entering: Side, lane: Lane, unit: UnitInstance, events: GameEvent[]): void {
    const opp = this.opponent(entering)
    const oppStack = this.lanes[lane][opp]
    const traps = oppStack.filter(u => u.innate.has('trap'))
    for (const trap of traps) {
      events.push({ type: 'moduleTriggered', uid: trap.uid, cardId: trap.cardId, side: opp })
      unit.frozenTurns = Math.max(unit.frozenTurns, 1)
      events.push({ type: 'unitFrozen', uid: unit.uid, turns: unit.frozenTurns })
      this.killUnit(trap, events)
    }
  }

  private playModule(side: Side, uid: number, events: GameEvent[]): void {
    const p = this.players[side]
    const ref = p.hand.find(c => c.uid === uid)
    if (!ref) throw new Error(`module ${uid} not in hand`)
    const def = getCard(ref.cardId)
    if (def.type !== 'MODULE') throw new Error(`${def.id} is not a module`)
    if (p.modules.length >= TUNING.BACKLINE_SLOTS) throw new Error('backline full')
    this.spend(p, this.effectiveCost(side, ref.cardId))
    this.takeFromHand(p, uid)
    const mod: ModuleInstance = { uid: ref.uid, cardId: ref.cardId, owner: side, data: {} }
    p.modules.push(mod)
    events.push({ type: 'moduleAttached', module: mod })

    // Health module resolves immediately (raises max and heals).
    if (def.id === 'health') {
      p.maxLife += TUNING.HEALTH_MODULE_BONUS
      this.healNexus(side, TUNING.HEALTH_MODULE_BONUS, events)
    }
  }

  private playUltimate(side: Side, uid: number, target: Target | undefined, events: GameEvent[]): void {
    const p = this.players[side]
    const ref = p.hand.find(c => c.uid === uid)
    if (!ref) throw new Error(`ultimate ${uid} not in hand`)
    const def = getCard(ref.cardId)
    if (def.type !== 'ULTIMATE') throw new Error(`${def.id} is not an ultimate`)
    const tt = ULTIMATE_TARGET[def.id] ?? 'none'
    if (tt !== 'none' && !this.isValidTarget(side, tt, target)) throw new Error(`bad target for ${def.id}`)
    this.spend(p, this.effectiveCost(side, ref.cardId))
    this.takeFromHand(p, uid)
    events.push({ type: 'ultimateCast', cardId: def.id, side, ...(target ? { target } : {}) })

    // Second Wind is a face-down secret, not an immediate effect.
    if (def.id === 'second-wind') {
      const secret: SecretInstance = { uid: ref.uid, cardId: ref.cardId, owner: side }
      p.secrets.push(secret)
      events.push({ type: 'secretSet', side })
      return
    }

    this.resolveUltimate(side, def.id, target, events)
    p.discard.push(ref)
  }

  private resolveUltimate(side: Side, cardId: string, target: Target | undefined, events: GameEvent[]): void {
    const p = this.players[side]
    switch (cardId) {
      case 'cash':
        p.manaPool += 2
        events.push({ type: 'manaChanged', side, pool: p.manaPool, max: p.manaMax })
        break
      case 'intro-sprint': {
        for (let i = 0; i < 3; i++) this.drawCard(p, events)
        // Discard the lowest-value card (a unit/module cost tiebreak). Deterministic.
        if (p.hand.length > 0) {
          const worst = [...p.hand].sort((a, b) => getCard(a.cardId).cost - getCard(b.cardId).cost)[0]!
          this.takeFromHand(p, worst.uid)
          p.discard.push(worst)
          events.push({ type: 'cardDiscarded', side, card: worst })
        }
        break
      }
      case 'free-upgrades': {
        const revealed: CardRef[] = []
        for (let i = 0; i < 3 && p.deck.length > 0; i++) revealed.push(p.deck.pop() as CardRef)
        const eligible = revealed.filter(r => {
          const d = getCard(r.cardId)
          return d.type === 'UNIT' && d.cost <= 3
        })
        let chosen: CardRef | undefined
        if (eligible.length > 0) {
          chosen = [...eligible].sort(
            (a, b) => this.unitValue(getCard(b.cardId)) - this.unitValue(getCard(a.cardId)),
          )[0]
          const lane = this.emptiestLane(side)
          if (this.lanes[lane][side].length < TUNING.LANE_STACK_CAP) {
            const unit = this.makeUnit(side, chosen!.cardId, lane, chosen!.uid)
            const stack = this.lanes[lane][side]
            const index = unit.innate.has('defender') ? 0 : stack.length
            if (index === 0) stack.unshift(unit)
            else stack.push(unit)
            events.push({ type: 'unitPlaced', unit, index })
            this.triggerEnemyTraps(side, lane, unit, events)
          } else {
            chosen = undefined
          }
        }
        // Everything not played goes to the bottom of the deck (draw order preserved-ish).
        for (const r of revealed) {
          if (chosen && r.uid === chosen.uid) continue
          p.deck.unshift(r)
        }
        break
      }
      case 'wave-skip':
        this.players[this.opponent(side)].skipNextCombat = true
        break
      case 'plasma-cannon': {
        const u = this.unitByTarget(target)
        if (u) {
          const dmg = Math.ceil(u.hp / 2)
          this.damageUnit(u, dmg, null, false, events)
        }
        break
      }
      case 'death-ray': {
        const u = this.unitByTarget(target)
        if (u) {
          const lane = u.lane
          const uSide = u.owner
          this.damageUnit(u, TUNING.DEATH_RAY_MAIN, null, false, events)
          for (const adj of ADJACENT[lane]) {
            const front = this.frontUnit(adj, uSide)
            if (front) this.damageUnit(front, TUNING.DEATH_RAY_SPLASH, null, false, events)
          }
        }
        break
      }
      case 'energy-net': {
        const u = this.unitByTarget(target)
        if (u) {
          u.frozenTurns = Math.max(u.frozenTurns, 2)
          events.push({ type: 'unitFrozen', uid: u.uid, turns: u.frozenTurns })
        }
        break
      }
      case 'recovery-package': {
        const u = this.unitByTarget(target)
        if (u) {
          u.maxHp += TUNING.RECOVERY_OVERHEAL
          const before = u.hp
          u.hp = u.maxHp
          events.push({ type: 'heal', targetUid: u.uid, side: u.owner, amount: u.hp - before })
        }
        break
      }
      case 'demon-mode': {
        const u = this.unitByTarget(target)
        if (u) {
          u.atk += TUNING.DEMON_MODE_ATK
          u.invulnerableThisTurn = true
          u.sacrificeAtEndOfTurn = true
          events.push({ type: 'unitBuffed', uid: u.uid, atk: u.atk, hp: u.hp })
        }
        break
      }
      case 'ultimate-crit': {
        const u = this.unitByTarget(target)
        if (u) u.chargedCritMultiplier = TUNING.ULTIMATE_CRIT_MULTIPLIER
        break
      }
      case 'nuke': {
        for (const lane of LANES) {
          for (const s of SIDES) {
            for (const u of [...this.lanes[lane][s]]) this.killUnit(u, events)
          }
        }
        break
      }
    }
  }

  // -------------------------------------------------------------------------
  // Combat
  // -------------------------------------------------------------------------

  private resolveCombat(active: Side, events: GameEvent[]): void {
    const superTurn: Record<Side, boolean> = {
      HUMAN: this.superTowerActive('HUMAN'),
      AI: this.superTowerActive('AI'),
    }
    if (superTurn[active]) {
      for (const lane of LANES) for (const u of this.lanes[lane][active]) u.invulnerableThisTurn = true
    }

    for (const lane of LANES) {
      this.resolveLane(lane, active, superTurn, events)
      events.push({ type: 'laneResolved', lane })
      if (this.winner !== null) return
    }
  }

  private resolveLane(
    lane: Lane,
    active: Side,
    superTurn: Record<Side, boolean>,
    events: GameEvent[],
  ): void {
    // Two steps, each resolved simultaneously: first-strikers, then everyone else. The main step
    // re-reads the fronts, so a reserve promoted after a first-strike kill fights in the main step.
    this.combatStep(lane, active, superTurn, events, 'first')
    if (this.winner !== null) return
    this.combatStep(lane, active, superTurn, events, 'main')
  }

  /** Resolve one combat step in a lane: plan both fronts' damage against the CURRENT board, apply it
   *  all at once (no kills mid-step), then sweep deaths. This is what makes a tie trade both ways. */
  private combatStep(
    lane: Lane,
    active: Side,
    superTurn: Record<Side, boolean>,
    events: GameEvent[],
    step: 'first' | 'main',
  ): void {
    const opp = this.opponent(active)
    const firing: Array<{ unit: UnitInstance; side: Side }> = []
    for (const [unit, side] of [
      [this.frontUnit(lane, active), active],
      [this.frontUnit(lane, opp), opp],
    ] as const) {
      if (!unit || !this.canAct(unit)) continue
      const isFirst = this.effectiveKeywords(unit).has('firstStrike')
      if ((step === 'first') === isFirst) firing.push({ unit, side })
    }
    if (firing.length === 0) return

    const plans: CombatPlan[] = []
    for (const f of firing) {
      const plan = this.computePlan(f.unit, lane, f.side, superTurn)
      if (plan) plans.push(plan)
    }
    // Apply all damage before resolving any death, so both sides of a tie land their hit.
    const damaged = new Map<number, number>() // victimUid → last attackerUid (kill attribution)
    for (const plan of plans) this.applyPlan(plan, events, damaged)
    // Berserker grows on surviving damage; then the dead are cleared and reserves promote.
    for (const uid of damaged.keys()) {
      const u = this.findUnit(uid)
      if (u && u.hp > 0 && u.cardId === 'berserker') {
        u.atk += 1
        events.push({ type: 'unitBuffed', uid: u.uid, atk: u.atk, hp: u.hp })
      }
    }
    for (const side of SIDES) {
      for (const u of [...this.lanes[lane][side]]) {
        if (u.hp <= 0) this.killUnit(u, events, damaged.get(u.uid) ?? null)
      }
    }
  }

  /** Compute a unit's intended combat damage without applying it (charged crit → face bypass;
   *  front duel with spillover; reach into an adjacent lane; else the Nexus). */
  private computePlan(
    attacker: UnitInstance,
    lane: Lane,
    side: Side,
    superTurn: Record<Side, boolean>,
  ): CombatPlan | null {
    const opp = this.opponent(side)
    const baseAtk = this.unitAtk(attacker, superTurn)

    // Ultimate Crit: next attack hits the enemy Nexus for atk × multiplier, bypassing blockers.
    if (attacker.chargedCritMultiplier > 0) {
      const dmg = baseAtk * attacker.chargedCritMultiplier
      attacker.chargedCritMultiplier = 0
      return { attackerUid: attacker.uid, target: 'nexus', side: opp, amount: dmg }
    }
    if (baseAtk <= 0) return null

    let atk = baseAtk
    let crit = false
    if (this.countModule(side, 'critical-chance') > 0 && this.rng.chance(TUNING.CRIT_CHANCE)) {
      crit = true
      atk *= TUNING.CRIT_MULTIPLIER
    }

    const enemyFront = this.frontUnit(lane, opp)
    if (enemyFront) {
      const spill = this.effectiveKeywords(attacker).has('spillover')
      return {
        attackerUid: attacker.uid,
        target: 'unit',
        uid: enemyFront.uid,
        hpBefore: enemyFront.hp,
        amount: atk,
        crit,
        ...(spill ? { spillSide: opp } : {}),
      }
    }

    // Lane clear. Reach → adjacent lane's enemy front; else the Nexus.
    if (this.effectiveKeywords(attacker).has('reach')) {
      for (const adj of ADJACENT[lane]) {
        const adjFront = this.frontUnit(adj, opp)
        if (adjFront) {
          return {
            attackerUid: attacker.uid,
            target: 'unit',
            uid: adjFront.uid,
            hpBefore: adjFront.hp,
            amount: atk,
            crit,
          }
        }
      }
    }
    return { attackerUid: attacker.uid, target: 'nexus', side: opp, amount: atk }
  }

  /** Apply one plan's damage. Does NOT kill — the step's sweep does that after every plan lands. */
  private applyPlan(plan: CombatPlan, events: GameEvent[], damaged: Map<number, number>): void {
    if (plan.target === 'nexus') {
      this.damageNexus(plan.side, plan.amount, events)
      return
    }
    const u = this.findUnit(plan.uid)
    if (!u) return
    if (u.invulnerableThisTurn) {
      events.push({ type: 'damage', targetUid: u.uid, amount: 0, sourceUid: plan.attackerUid, crit: plan.crit })
      return
    }
    u.hp -= plan.amount
    events.push({ type: 'damage', targetUid: u.uid, amount: plan.amount, sourceUid: plan.attackerUid, crit: plan.crit })
    damaged.set(u.uid, plan.attackerUid)
    if (plan.spillSide && plan.amount >= plan.hpBefore) {
      const overkill = plan.amount - plan.hpBefore
      if (overkill > 0) this.damageNexus(plan.spillSide, overkill, events)
    }
  }

  // -------------------------------------------------------------------------
  // Damage / heal / death
  // -------------------------------------------------------------------------

  /** Deal `amount` to a unit; returns damage actually dealt. Handles invuln, crit event, Berserker. */
  private damageUnit(
    unit: UnitInstance,
    amount: number,
    sourceUid: number | null,
    crit: boolean,
    events: GameEvent[],
  ): number {
    if (unit.invulnerableThisTurn || amount <= 0) {
      events.push({ type: 'damage', targetUid: unit.uid, amount: 0, sourceUid, crit })
      return 0
    }
    const dealt = Math.min(unit.hp, amount)
    unit.hp -= amount
    events.push({ type: 'damage', targetUid: unit.uid, amount, sourceUid, crit })
    if (unit.hp > 0) {
      // Berserker: +1/+0 on surviving damage.
      if (unit.cardId === 'berserker') {
        unit.atk += 1
        events.push({ type: 'unitBuffed', uid: unit.uid, atk: unit.atk, hp: unit.hp })
      }
    } else {
      this.killUnit(unit, events, sourceUid)
    }
    return dealt
  }

  private killUnit(unit: UnitInstance, events: GameEvent[], killerUid: number | null = null): void {
    const stack = this.lanes[unit.lane][unit.owner]
    const idx = stack.indexOf(unit)
    if (idx < 0) return // already removed
    stack.splice(idx, 1)
    events.push({ type: 'unitDied', uid: unit.uid, lane: unit.lane, side: unit.owner })
    if (idx === 0 && stack.length > 0) {
      events.push({ type: 'unitPromoted', uid: stack[0]!.uid, lane: unit.lane, side: unit.owner })
    }
    // Critical Coin: the killer's owner gains +1 mana next turn (only on a real killer).
    if (killerUid !== null) {
      const killer = this.findUnit(killerUid)
      if (killer && this.countModule(killer.owner, 'critical-coin') > 0) {
        this.pendingMana[killer.owner] += this.countModule(killer.owner, 'critical-coin')
      }
    }
  }

  private healUnit(unit: UnitInstance, amount: number, events: GameEvent[]): void {
    if (unit.hp >= unit.maxHp) return
    const before = unit.hp
    unit.hp = Math.min(unit.maxHp, unit.hp + amount)
    events.push({ type: 'heal', targetUid: unit.uid, side: unit.owner, amount: unit.hp - before })
  }

  private healNexus(side: Side, amount: number, events: GameEvent[]): void {
    const p = this.players[side]
    if (p.life >= p.maxLife) return
    const before = p.life
    p.life = Math.min(p.maxLife, p.life + amount)
    events.push({ type: 'heal', targetUid: null, side, amount: p.life - before })
  }

  private damageNexus(side: Side, amount: number, events: GameEvent[]): void {
    if (amount <= 0) return
    const p = this.players[side]

    // Energy Shield: negate the whole next instance, then destroy the shield.
    const shield = p.modules.find(m => m.cardId === 'energy-shield')
    if (shield) {
      this.destroyModule(side, shield.uid, events)
      events.push({ type: 'nexusDamage', side, amount: 0, life: p.life })
      return
    }

    // Extra Defense: reduce by 1 per copy, but a hit never drops below 1.
    const reduction = TUNING.EXTRA_DEFENSE_REDUCTION * this.countModule(side, 'extra-defense')
    const applied = Math.max(1, amount - reduction)

    p.life -= applied
    events.push({ type: 'nexusDamage', side, amount: applied, life: Math.max(0, p.life) })

    if (p.life <= 0) {
      // Second Wind: prevent the fatal blow once.
      const secretIdx = p.secrets.findIndex(s => s.cardId === 'second-wind')
      if (secretIdx >= 0) {
        const [secret] = p.secrets.splice(secretIdx, 1)
        p.life = TUNING.SECOND_WIND_HEAL
        events.push({ type: 'secretTriggered', cardId: secret!.cardId, side })
        events.push({ type: 'heal', targetUid: null, side, amount: TUNING.SECOND_WIND_HEAL })
        return
      }
      this.declareWinner(this.opponent(side), events)
    }
  }

  private destroyModule(side: Side, uid: number, events: GameEvent[]): void {
    const p = this.players[side]
    const idx = p.modules.findIndex(m => m.uid === uid)
    if (idx < 0) return
    p.modules.splice(idx, 1)
    events.push({ type: 'moduleDestroyed', uid, side })
  }

  private declareWinner(side: Side, events: GameEvent[]): void {
    if (this.winner !== null) return
    this.winner = side
    events.push({ type: 'gameOver', winner: side, turns: this.turn })
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private drawCard(p: PlayerState, events: GameEvent[]): void {
    if (p.deck.length === 0) {
      events.push({ type: 'cardDrawn', side: p.side, card: null })
      return
    }
    const card = p.deck.pop() as CardRef
    if (p.hand.length >= TUNING.HAND_LIMIT) {
      // Over the hand limit: the drawn card is discarded (burned).
      p.discard.push(card)
      events.push({ type: 'cardDiscarded', side: p.side, card })
      return
    }
    p.hand.push(card)
    events.push({ type: 'cardDrawn', side: p.side, card })

    // Package Chance: drawing an Ultimate grants Nexus HP.
    if (getCard(card.cardId).type === 'ULTIMATE') {
      const n = this.countModule(p.side, 'package-chance')
      if (n > 0) this.healNexus(p.side, TUNING.PACKAGE_CHANCE_HP * n, events)
    }
  }

  // -------------------------------------------------------------------------
  // Unit construction & stat computation
  // -------------------------------------------------------------------------

  private makeUnit(side: Side, cardId: string, lane: Lane, uid = this.uidSeq++): UnitInstance {
    const def = getCard(cardId)
    return {
      uid,
      cardId,
      owner: side,
      lane,
      atk: def.atk ?? 0,
      hp: def.hp ?? 1,
      maxHp: def.hp ?? 1,
      innate: new Set<Keyword>(def.keywords ?? []),
      tappedTurns: 0,
      frozenTurns: 0,
      invulnerableThisTurn: false,
      sacrificeAtEndOfTurn: false,
      chargedCritMultiplier: 0,
    }
  }

  /** Effective keywords = innate ∪ module-granted (Attack Speed → firstStrike, Range → reach). */
  private effectiveKeywords(unit: UnitInstance): Set<Keyword> {
    const kw = new Set<Keyword>(unit.innate)
    if (this.countModule(unit.owner, 'attack-speed') > 0) kw.add('firstStrike')
    if (this.countModule(unit.owner, 'range') > 0) kw.add('reach')
    return kw
  }

  /** Effective ATK: base + Damage aura + Orbs Speed + Enemy Balance (to the module owner's foe) + Super Tower. */
  private unitAtk(unit: UnitInstance, superTurn: Record<Side, boolean>): number {
    let atk = unit.atk
    atk += this.countModule(unit.owner, 'damage')
    if (unit.cardId === 'extra-orbs') atk += TUNING.ORBS_SPEED_ATK * this.countModule(unit.owner, 'orbs-speed')
    // Enemy Balance buffs the units of the module owner's OPPONENT.
    atk += this.countModule(this.opponent(unit.owner), 'enemy-balance')
    if (superTurn[unit.owner]) atk += TUNING.SUPER_TOWER_ATK
    return Math.max(0, atk)
  }

  private canAct(unit: UnitInstance): boolean {
    return unit.tappedTurns === 0 && unit.frozenTurns === 0
  }

  private superTowerActive(side: Side): boolean {
    if (this.countModule(side, 'super-tower') === 0) return false
    const tc = this.players[side].turnCount
    return tc > 0 && tc % TUNING.SUPER_TOWER_EVERY === 0
  }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  private opponent(side: Side): Side {
    return side === 'HUMAN' ? 'AI' : 'HUMAN'
  }

  private frontUnit(lane: Lane, side: Side): UnitInstance | undefined {
    return this.lanes[lane][side][0]
  }

  private findUnit(uid: number): UnitInstance | undefined {
    for (const lane of LANES) for (const s of SIDES) {
      const u = this.lanes[lane][s].find(x => x.uid === uid)
      if (u) return u
    }
    return undefined
  }

  private unitByTarget(target: Target | undefined): UnitInstance | undefined {
    if (!target || target.kind !== 'unit') return undefined
    return this.findUnit(target.uid)
  }

  private countModule(side: Side, cardId: string): number {
    return this.players[side].modules.reduce((n, m) => (m.cardId === cardId ? n + 1 : n), 0)
  }

  private countAllModules(cardId: string): number {
    return this.countModule('HUMAN', cardId) + this.countModule('AI', cardId)
  }

  private effectiveCost(side: Side, cardId: string): number {
    const def = getCard(cardId)
    let cost = def.cost
    if (def.type === 'ULTIMATE') cost -= this.countModule(side, 'wave-accelerator')
    return Math.max(1, cost)
  }

  private unitValue(def: { atk?: number; hp?: number; cost: number }): number {
    return (def.atk ?? 0) + (def.hp ?? 0) + def.cost
  }

  private emptiestLane(side: Side): Lane {
    let best: Lane = 'CENTER'
    let bestN = Infinity
    for (const lane of LANES) {
      const n = this.lanes[lane][side].length
      if (n < bestN) {
        bestN = n
        best = lane
      }
    }
    return best
  }

  private legalTargets(side: Side, tt: TargetType): Target[] {
    const out: Target[] = []
    for (const lane of LANES) for (const s of SIDES) {
      const wantEnemy = tt === 'enemyUnit' && s === this.opponent(side)
      const wantFriendly = tt === 'friendlyUnit' && s === side
      const wantAny = tt === 'anyUnit'
      if (!(wantEnemy || wantFriendly || wantAny)) continue
      for (const u of this.lanes[lane][s]) out.push({ kind: 'unit', uid: u.uid })
    }
    return out
  }

  private isValidTarget(side: Side, tt: TargetType, target: Target | undefined): boolean {
    if (!target || target.kind !== 'unit') return false
    const u = this.findUnit(target.uid)
    if (!u) return false
    if (tt === 'enemyUnit') return u.owner === this.opponent(side)
    if (tt === 'friendlyUnit') return u.owner === side
    return true
  }

  // -------------------------------------------------------------------------
  // Snapshot
  // -------------------------------------------------------------------------

  snapshot(viewer: Side = 'HUMAN'): GameSnapshot {
    const players: Record<Side, PlayerView> = {
      HUMAN: this.playerView('HUMAN', viewer),
      AI: this.playerView('AI', viewer),
    }
    const lanes = {} as Record<Lane, Record<Side, UnitView[]>>
    for (const lane of LANES) {
      lanes[lane] = {
        HUMAN: this.lanes[lane].HUMAN.map((u, i) => this.unitView(u, i)),
        AI: this.lanes[lane].AI.map((u, i) => this.unitView(u, i)),
      }
    }
    return {
      turn: this.turn,
      activeSide: this.activeSide,
      phase: this.phase,
      winner: this.winner,
      players,
      lanes,
    }
  }

  private playerView(side: Side, viewer: Side): PlayerView {
    const p = this.players[side]
    const modules: ModuleView[] = p.modules.map(m => ({
      uid: m.uid,
      cardId: m.cardId,
      name: getCard(m.cardId).name,
    }))
    const base: PlayerView = {
      side,
      life: p.life,
      maxLife: p.maxLife,
      manaMax: p.manaMax,
      manaPool: p.manaPool,
      deckCount: p.deck.length,
      discardCount: p.discard.length,
      handCount: p.hand.length,
      secretCount: p.secrets.length,
      modules,
    }
    if (side === viewer) return { ...base, hand: p.hand.map(c => ({ uid: c.uid, cardId: c.cardId })) }
    return base
  }

  private unitView(u: UnitInstance, index: number): UnitView {
    const superTurn = { HUMAN: this.superTowerActive('HUMAN'), AI: this.superTowerActive('AI') }
    return {
      uid: u.uid,
      cardId: u.cardId,
      name: getCard(u.cardId).name,
      atk: this.unitAtk(u, superTurn),
      hp: u.hp,
      maxHp: u.maxHp,
      keywords: [...this.effectiveKeywords(u)],
      tapped: u.tappedTurns > 0,
      frozen: u.frozenTurns > 0,
      invulnerable: u.invulnerableThisTurn,
      isFront: index === 0,
    }
  }
}

/** Create and start a game. The returned events are the opening turn up to the first MAIN phase. */
export function createEngine(opts: EngineOptions): { engine: Engine; opening: GameEvent[] } {
  const engine = new TowerEngine(opts)
  const opening = engine.start()
  return { engine, opening }
}
