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

import { getCard, MINE_TOKEN, SUMMON_TOKEN } from './cards'
import { cardLevelValue, cardMasterySpecial, cardUnitStat, type MasterySpecial } from './card-progression'
import { createRng, type Rng } from './rng'
import { TUNING } from './tuning'
import type {
  Action,
  CardRef,
  CardLevels,
  EnemySkill,
  Engine,
  EngineOptions,
  EngineState,
  GameEvent,
  GameResult,
  GameSnapshot,
  Keyword,
  Lane,
  ModuleInstance,
  ModuleView,
  Phase,
  PlayerState,
  PlayerStateSnapshot,
  PlayerView,
  SecretInstance,
  Side,
  Target,
  UnitInstance,
  UnitState,
  UnitView,
} from './types'
import { LANES, SIDES } from './types'

/** Magnitudes for the boss "enemy skills" (see EnemySkill). Fixed, modest values — the tier handicap
 *  scales raw difficulty; these give each archetype a distinct, plannable threat. */
const ENEMY_SKILL = {
  tankHp: 3, // Tank: bonus max HP per unit
  commanderAtk: 1, // Commander: bonus ATK to all its units
  protectorReduction: 1, // Protector: combat damage reduction on its units (min 1 still lands)
  vampireDrain: 2, // Vampire: HP drained from your Nexus each of its turns
  saboteurTap: 1, // Saboteur: turns your strongest unit is tapped each of its turns
  overchargeBurst: 4, // Overcharge: burst to your Nexus on its power turn
  overchargeEvery: 3, // …every Nth of its turns
} as const

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
  'chain-lightning': 'enemyUnit',
  spotlight: 'enemyUnit',
  'shrink-ray': 'enemyUnit',
  'guardian-attack': 'anyUnit',
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
  private readonly bonusLife: Partial<Record<Side, number>>
  private readonly bonusStartMana: Partial<Record<Side, number>>
  private readonly cardLevels: Partial<Record<Side, CardLevels>>
  private readonly skills: Partial<Record<Side, EnemySkill>>

  constructor(opts: EngineOptions, restore?: EngineState) {
    this.rng = createRng(opts.seed ?? 'ttg-default')
    this.lanes = {
      LEFT: { HUMAN: [], AI: [] },
      CENTER: { HUMAN: [], AI: [] },
      RIGHT: { HUMAN: [], AI: [] },
    }
    if (restore) {
      // Rebuild from a serialized state (clone / save-restore). Deck contents come from `restore`.
      this.shuffleDecks = restore.shuffleDecks
      this.bonusLife = restore.bonusLife
      this.bonusStartMana = restore.bonusStartMana
      this.cardLevels = restore.cardLevels
      this.skills = restore.skills ?? {}
      this.activeSide = restore.activeSide
      this.players = { HUMAN: this.blankPlayer('HUMAN'), AI: this.blankPlayer('AI') }
      this.loadState(restore)
      return
    }
    this.activeSide = opts.firstPlayer ?? 'HUMAN'
    this.shuffleDecks = opts.shuffle !== false
    this.bonusLife = opts.bonusLife ?? {}
    this.bonusStartMana = opts.bonusStartMana ?? {}
    this.cardLevels = opts.cardLevels ?? {}
    this.skills = opts.skills ?? {}
    this.players = {
      HUMAN: this.newPlayer('HUMAN', opts.humanDeck),
      AI: this.newPlayer('AI', opts.aiDeck),
    }
    for (const side of SIDES) {
      for (let i = 0; i < TUNING.OPENING_HAND; i++) this.drawCard(this.players[side], [])
    }
  }

  private blankPlayer(side: Side): PlayerState {
    return {
      side,
      life: 0,
      maxLife: 0,
      manaMax: 0,
      manaPool: 0,
      deck: [],
      hand: [],
      discard: [],
      modules: [],
      secrets: [],
      turnCount: 0,
      skipNextCombat: false,
      fatigue: 0,
    }
  }

  // -------------------------------------------------------------------------
  // Serialize / clone / restore
  // -------------------------------------------------------------------------

  serialize(): EngineState {
    const copyPlayer = (p: PlayerState): PlayerStateSnapshot => ({
      side: p.side,
      life: p.life,
      maxLife: p.maxLife,
      manaMax: p.manaMax,
      manaPool: p.manaPool,
      deck: p.deck.map(c => ({ ...c })),
      hand: p.hand.map(c => ({ ...c })),
      discard: p.discard.map(c => ({ ...c })),
      modules: p.modules.map(m => ({ uid: m.uid, cardId: m.cardId, owner: m.owner, data: { ...m.data } })),
      secrets: p.secrets.map(s => ({ ...s })),
      turnCount: p.turnCount,
      skipNextCombat: p.skipNextCombat,
      fatigue: p.fatigue,
    })
    const copyUnit = (u: UnitInstance): UnitState => ({
      uid: u.uid,
      cardId: u.cardId,
      owner: u.owner,
      lane: u.lane,
      atk: u.atk,
      hp: u.hp,
      maxHp: u.maxHp,
      innate: [...u.innate],
      tappedTurns: u.tappedTurns,
      frozenTurns: u.frozenTurns,
      invulnerableThisTurn: u.invulnerableThisTurn,
      sacrificeAtEndOfTurn: u.sacrificeAtEndOfTurn,
      chargedCritMultiplier: u.chargedCritMultiplier,
      vulnerable: u.vulnerable,
      marked: u.marked,
    })
    const lanes = {} as Record<Lane, Record<Side, UnitState[]>>
    for (const lane of LANES) {
      lanes[lane] = { HUMAN: this.lanes[lane].HUMAN.map(copyUnit), AI: this.lanes[lane].AI.map(copyUnit) }
    }
    return {
      uidSeq: this.uidSeq,
      turn: this.turn,
      activeSide: this.activeSide,
      phase: this.phase,
      winner: this.winner,
      players: { HUMAN: copyPlayer(this.players.HUMAN), AI: copyPlayer(this.players.AI) },
      lanes,
      pendingMana: { HUMAN: this.pendingMana.HUMAN, AI: this.pendingMana.AI },
      rngState: this.rng.getState(),
      shuffleDecks: this.shuffleDecks,
      bonusLife: { ...this.bonusLife },
      skills: { ...this.skills },
      bonusStartMana: { ...this.bonusStartMana },
      cardLevels: this.cardLevels,
    }
  }

  // -------------------------------------------------------------------------
  // Card levels / masteries
  // -------------------------------------------------------------------------

  private cardEntry(side: Side, cardId: string): { level: number; mastery: number } {
    return this.cardLevels[side]?.[cardId] ?? { level: 1, mastery: 0 }
  }

  /** The card's numeric value for `side`, scaled by its level (+ mastery stat bonus). */
  private cardVal(side: Side, cardId: string): number {
    const e = this.cardEntry(side, cardId)
    return cardLevelValue(cardId, e.level, e.mastery)
  }

  private hasMasterySpecial(side: Side, cardId: string, which: MasterySpecial): boolean {
    return cardMasterySpecial(cardId, this.cardEntry(side, cardId).mastery) === which
  }

  private loadState(state: EngineState): void {
    this.uidSeq = state.uidSeq
    this.turn = state.turn
    this.activeSide = state.activeSide
    this.phase = state.phase
    this.winner = state.winner
    this.pendingMana.HUMAN = state.pendingMana.HUMAN
    this.pendingMana.AI = state.pendingMana.AI
    for (const side of SIDES) {
      const src = state.players[side]
      const p = this.players[side]
      p.life = src.life
      p.maxLife = src.maxLife
      p.manaMax = src.manaMax
      p.manaPool = src.manaPool
      p.deck = src.deck.map(c => ({ ...c }))
      p.hand = src.hand.map(c => ({ ...c }))
      p.discard = src.discard.map(c => ({ ...c }))
      p.modules = src.modules.map(m => ({ uid: m.uid, cardId: m.cardId, owner: m.owner, data: { ...m.data } }))
      p.secrets = src.secrets.map(s => ({ ...s }))
      p.turnCount = src.turnCount
      p.skipNextCombat = src.skipNextCombat
      p.fatigue = src.fatigue
    }
    for (const lane of LANES) {
      for (const side of SIDES) {
        this.lanes[lane][side] = state.lanes[lane][side].map(u => ({
          uid: u.uid,
          cardId: u.cardId,
          owner: u.owner,
          lane: u.lane,
          atk: u.atk,
          hp: u.hp,
          maxHp: u.maxHp,
          innate: new Set<Keyword>(u.innate),
          tappedTurns: u.tappedTurns,
          frozenTurns: u.frozenTurns,
          invulnerableThisTurn: u.invulnerableThisTurn,
          sacrificeAtEndOfTurn: u.sacrificeAtEndOfTurn,
          chargedCritMultiplier: u.chargedCritMultiplier,
          vulnerable: u.vulnerable,
          marked: u.marked,
        }))
      }
    }
    this.rng.setState(state.rngState)
  }

  clone(): Engine {
    return new TowerEngine({ humanDeck: [], aiDeck: [] }, this.serialize())
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  private newPlayer(side: Side, deckIds: readonly string[]): PlayerState {
    const deck: CardRef[] = deckIds.map(cardId => ({ uid: this.uidSeq++, cardId }))
    if (this.shuffleDecks) this.rng.shuffle(deck)
    const life = TUNING.START_LIFE + (this.bonusLife[side] ?? 0)
    return {
      side,
      life,
      maxLife: life,
      manaMax: this.bonusStartMana[side] ?? 0, // raised to START_MANA_MAX+ by the first startTurn
      manaPool: 0,
      deck,
      hand: [],
      discard: [],
      modules: [],
      secrets: [],
      turnCount: 0,
      skipNextCombat: false,
      fatigue: 0,
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

    // Refresh per-turn module counters (guaranteed crits, marks, heal-discount, weapon sync).
    for (const m of p.modules) {
      if (m.cardId === 'being-annihilator') m.data.critsUsed = 0
      if (m.cardId === 'death-penalty') m.data.marksLeft = this.cardVal(side, 'death-penalty')
      if (m.cardId === 'galaxy-compressor') m.data.healedThisTurn = false
      if (m.cardId === 'multiverse-nexus') m.data.freeUltsLeft = 0
    }

    // A Vampire opponent disables all your regen while it drains you (as in The Tower).
    const regenDisabled = this.skillOf(this.opponent(side)) === 'vampire'
    // Start-of-turn: Health Regen (per copy, scaled by level).
    if (!regenDisabled && this.countModule(side, 'health-regen') > 0) {
      const amt = this.cardVal(side, 'health-regen') * this.countModule(side, 'health-regen')
      this.healNexus(side, amt, events)
      for (const lane of LANES) {
        for (const u of this.lanes[lane][side]) this.healUnit(u, amt, events)
      }
    }

    // Draw: 1 + Coins (own) + Enemy Balance (own, both copies drew; levels scale the bonus).
    const draws =
      1 +
      this.countModule(side, 'coins') * this.cardVal(side, 'coins') +
      this.countModule(side, 'enemy-balance') * this.cardVal(side, 'enemy-balance')
    for (let i = 0; i < draws; i++) this.drawCard(p, events)

    // Black Hole Digestor: your upgrades "digest" into temporary mana each turn (per Module held).
    if (this.countModule(side, 'black-hole-digestor') > 0) {
      p.manaPool += this.cardVal(side, 'black-hole-digestor') * this.countModule(side, 'black-hole-digestor') * p.modules.length
      events.push({ type: 'manaChanged', side, pool: p.manaPool, max: p.manaMax })
    }
    // Wormhole Redirector: channel a little Nexus recovery at the start of each turn.
    if (!regenDisabled && this.countModule(side, 'wormhole-redirector') > 0) {
      this.healNexus(side, this.cardVal(side, 'wormhole-redirector') * this.countModule(side, 'wormhole-redirector'), events)
    }
    // Death Wave: damage every enemy unit.
    if (this.countModule(side, 'death-wave') > 0) {
      const dmg = this.cardVal(side, 'death-wave') * this.countModule(side, 'death-wave')
      const opp = this.opponent(side)
      for (const lane of LANES) for (const u of [...this.lanes[lane][opp]]) this.damageUnit(u, dmg, null, false, events)
      if (this.winner !== null) return
    }
    // Magnetic Hook: yank the strongest enemy unit for hook damage.
    if (this.countModule(side, 'magnetic-hook') > 0) {
      const hook = this.cardVal(side, 'magnetic-hook') * this.countModule(side, 'magnetic-hook')
      const target = this.strongestEnemyUnit(side)
      if (target) this.damageUnit(target, hook, null, false, events)
      if (this.winner !== null) return
    }
    // Om Chip: focus fire — your strongest unit gains ATK each turn.
    if (this.countModule(side, 'om-chip') > 0) {
      const focus = this.strongestOwnUnit(side)
      if (focus) {
        focus.atk += this.cardVal(side, 'om-chip') * this.countModule(side, 'om-chip')
        events.push({ type: 'unitBuffed', uid: focus.uid, atk: focus.atk, hp: focus.hp })
      }
    }
    // Flame Bot: burn — damage every enemy unit each turn (their ATK penalty is applied in unitAtk).
    if (this.countModule(side, 'flame-bot') > 0) {
      const dmg = this.cardVal(side, 'flame-bot') * this.countModule(side, 'flame-bot') * this.botAmp(side)
      const opp = this.opponent(side)
      const fb = p.modules.find(m => m.cardId === 'flame-bot')
      if (fb && this.lanes.LEFT[opp].length + this.lanes.CENTER[opp].length + this.lanes.RIGHT[opp].length > 0) {
        events.push({ type: 'moduleTriggered', uid: fb.uid, cardId: 'flame-bot', side }) // burn FX cue
      }
      for (const lane of LANES) for (const u of [...this.lanes[lane][opp]]) this.damageUnit(u, dmg, null, false, events)
      if (this.winner !== null) return
    }
    // Thunder Bot: stun the strongest enemy unit each turn (linger = more turns at higher levels).
    if (this.countModule(side, 'thunder-bot') > 0) {
      const turns = this.cardVal(side, 'thunder-bot') * this.botAmp(side)
      const target = this.strongestEnemyUnit(side)
      if (target) {
        target.frozenTurns = Math.max(target.frozenTurns, turns)
        events.push({ type: 'unitFrozen', uid: target.uid, turns: target.frozenTurns })
      }
    }
    // Golden Bot: coin farming — steady temporary mana each turn.
    if (this.countModule(side, 'golden-bot') > 0) {
      p.manaPool += this.cardVal(side, 'golden-bot') * this.countModule(side, 'golden-bot') * this.botAmp(side)
      events.push({ type: 'manaChanged', side, pool: p.manaPool, max: p.manaMax })
    }
    // Enemy skills that fire at the start of the skilled side's turn.
    const skill = this.skillOf(side)
    const foe = this.opponent(side)
    if (skill === 'vampire') {
      // Drain the enemy Nexus into your own (its regen is disabled below while it faces you).
      this.damageNexus(foe, ENEMY_SKILL.vampireDrain, events)
      if (this.winner !== null) return
      this.healNexus(side, ENEMY_SKILL.vampireDrain, events)
    }
    if (skill === 'overcharge' && p.turnCount > 0 && p.turnCount % ENEMY_SKILL.overchargeEvery === 0) {
      this.damageNexus(foe, ENEMY_SKILL.overchargeBurst, events) // charged ray → burst
      if (this.winner !== null) return
    }
    if (skill === 'saboteur') {
      const target = this.strongestEnemyUnit(side) // sabotage the foe's best unit
      if (target) target.tappedTurns = Math.max(target.tappedTurns, ENEMY_SKILL.saboteurTap)
    }
    // Space Displacer: inner land mines organize around the tower — a Mine per empty lane.
    if (this.countModule(side, 'space-displacer') > 0) {
      const hp = this.cardVal(side, 'space-displacer')
      for (const lane of LANES) {
        if (this.lanes[lane][side].length > 0) continue
        const mine = this.makeUnit(side, MINE_TOKEN.id, lane)
        mine.hp = hp
        mine.maxHp = hp
        this.lanes[lane][side].unshift(mine)
        events.push({ type: 'unitPlaced', unit: mine, index: 0 })
      }
    }

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
      if (!this.rng.chance(this.cardVal(side, 'land-mine-chance'))) continue
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

    // Slow Aura (opponent's): this unit enters tapped for the aura's leveled duration.
    const opp = this.opponent(side)
    if (this.countModule(opp, 'slow-aura') > 0) {
      unit.tappedTurns = this.cardVal(opp, 'slow-aura')
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

    // Inner Land Mines: the enemy's mines detonate on the entering unit for AOE damage.
    if (this.countModule(opp, 'inner-land-mines') > 0) {
      const dmg = this.cardVal(opp, 'inner-land-mines') * this.countModule(opp, 'inner-land-mines')
      this.damageUnit(unit, dmg, null, false, events)
    }
    // Death Penalty: the enemy marks the entering unit for death (a limited number per turn).
    if (unit.hp > 0) {
      for (const m of this.players[opp].modules) {
        if (m.cardId !== 'death-penalty') continue
        const left = typeof m.data.marksLeft === 'number' ? m.data.marksLeft : 0
        if (left > 0) {
          m.data.marksLeft = left - 1
          unit.marked = true
          events.push({ type: 'moduleTriggered', uid: m.uid, cardId: m.cardId, side: opp })
          break
        }
      }
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

    // Health / Sharp Fortitude resolve immediately (raise max Nexus HP and heal).
    if (def.id === 'health' || def.id === 'sharp-fortitude') {
      const bonus = this.cardVal(side, def.id)
      p.maxLife += bonus
      this.healNexus(side, bonus, events)
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

    // Multiverse Nexus: weapons fire together. A PAID ultimate opens a window of free ultimates;
    // each free ultimate consumes one. (effectiveCost returns 0 while the window is open.)
    const mvn = this.countModule(side, 'multiverse-nexus')
    if (mvn > 0) {
      const inst = p.modules.find(m => m.cardId === 'multiverse-nexus')!
      const left = typeof inst.data.freeUltsLeft === 'number' ? inst.data.freeUltsLeft : 0
      if (left > 0) inst.data.freeUltsLeft = left - 1
      else inst.data.freeUltsLeft = this.cardVal(side, 'multiverse-nexus') * mvn
    }

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
        p.manaPool += this.cardVal(side, 'cash')
        events.push({ type: 'manaChanged', side, pool: p.manaPool, max: p.manaMax })
        break
      case 'intro-sprint': {
        for (let i = 0; i < this.cardVal(side, 'intro-sprint'); i++) this.drawCard(p, events)
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
        const revealN = this.cardVal(side, 'free-upgrades')
        for (let i = 0; i < revealN && p.deck.length > 0; i++) revealed.push(p.deck.pop() as CardRef)
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
      case 'wave-skip': {
        this.players[this.opponent(side)].skipNextCombat = true
        const heal = this.cardVal(side, 'wave-skip')
        if (heal > 0) this.healNexus(side, heal, events)
        break
      }
      case 'plasma-cannon': {
        const u = this.unitByTarget(target)
        if (u) {
          const pct = this.cardVal(side, 'plasma-cannon')
          this.damageUnit(u, Math.ceil(u.hp * pct), null, false, events)
          // Elite Cannon mastery: also strike a second enemy unit.
          if (this.hasMasterySpecial(side, 'plasma-cannon', 'elite-cannon')) {
            const second = this.biggestEnemyUnit(side, u.uid)
            if (second) this.damageUnit(second, Math.ceil(second.hp * pct), null, false, events)
          }
        }
        break
      }
      case 'death-ray': {
        const u = this.unitByTarget(target)
        if (u) {
          const lane = u.lane
          const uSide = u.owner
          this.damageUnit(u, this.cardVal(side, 'death-ray') + this.ultBonus(side), null, false, events)
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
          u.frozenTurns = Math.max(u.frozenTurns, this.cardVal(side, 'energy-net'))
          events.push({ type: 'unitFrozen', uid: u.uid, turns: u.frozenTurns })
        }
        break
      }
      case 'recovery-package': {
        const u = this.unitByTarget(target)
        if (u) {
          u.maxHp += this.cardVal(side, 'recovery-package')
          const before = u.hp
          u.hp = u.maxHp
          events.push({ type: 'heal', targetUid: u.uid, side: u.owner, amount: u.hp - before })
        }
        break
      }
      case 'demon-mode': {
        const u = this.unitByTarget(target)
        if (u) {
          u.atk += this.cardVal(side, 'demon-mode')
          u.invulnerableThisTurn = true
          u.sacrificeAtEndOfTurn = true
          events.push({ type: 'unitBuffed', uid: u.uid, atk: u.atk, hp: u.hp })
        }
        break
      }
      case 'ultimate-crit': {
        const u = this.unitByTarget(target)
        if (u) u.chargedCritMultiplier = this.cardVal(side, 'ultimate-crit')
        break
      }
      case 'guardian-attack': {
        // Attack Chip: strike a unit for the damage it has ALREADY taken, plus a level bonus.
        const u = this.unitByTarget(target)
        if (u) {
          const dmg = u.maxHp - u.hp + this.cardVal(side, 'guardian-attack')
          if (dmg > 0) this.damageUnit(u, dmg, null, false, events)
        }
        break
      }
      case 'guardian-ally': {
        // Ally Chip: convert the weakest enemy unit to your side (destroyed if your lane is full).
        const victim = this.weakestEnemyUnit(side)
        if (victim) {
          const opp = this.opponent(side)
          const lane = victim.lane
          const from = this.lanes[lane][opp]
          const i = from.indexOf(victim)
          if (i >= 0) from.splice(i, 1)
          const stack = this.lanes[lane][side]
          if (stack.length < TUNING.LANE_STACK_CAP) {
            victim.owner = side
            victim.tappedTurns = Math.max(victim.tappedTurns, 1) // freshly turned — can't attack this turn
            const buff = this.cardVal(side, 'guardian-ally') - 1 // Loyal Ally mastery: +buff/+buff
            if (buff > 0) {
              victim.atk += buff
              victim.maxHp += buff
              victim.hp += buff
            }
            const index = victim.innate.has('defender') ? 0 : stack.length
            if (index === 0) stack.unshift(victim)
            else stack.push(victim)
            events.push({ type: 'unitPlaced', unit: victim, index })
          }
        }
        break
      }
      case 'guardian-bounty': {
        // Bounty Chip: collect a bounty of cards.
        const n = this.cardVal(side, 'guardian-bounty')
        for (let i = 0; i < n; i++) this.drawCard(p, events)
        break
      }
      case 'guardian-fetch': {
        // Fetch Chip: steal life from the enemy Nexus into yours, then retrieve a card.
        const drain = this.cardVal(side, 'guardian-fetch')
        this.damageNexus(this.opponent(side), drain, events)
        this.healNexus(side, drain, events)
        this.drawCard(p, events)
        break
      }
      case 'guardian-summon': {
        // Summon Chip: call an Ally token into each empty friendly lane.
        const val = this.cardVal(side, 'guardian-summon')
        for (const lane of LANES) {
          if (this.lanes[lane][side].length > 0) continue
          const ally = this.makeUnit(side, SUMMON_TOKEN.id, lane)
          ally.atk = val
          ally.maxHp = val
          ally.hp = val
          this.lanes[lane][side].push(ally)
          events.push({ type: 'unitPlaced', unit: ally, index: 0 })
        }
        break
      }
      case 'nuke': {
        for (const lane of LANES) {
          for (const s of SIDES) {
            for (const u of [...this.lanes[lane][s]]) this.killUnit(u, events)
          }
        }
        // Bonus Nexus damage from level, plus Radiation mastery.
        let dmg = this.cardVal(side, 'nuke')
        if (this.hasMasterySpecial(side, 'nuke', 'radiation')) dmg += 6
        if (dmg > 0) this.damageNexus(this.opponent(side), dmg, events)
        break
      }
      case 'chain-lightning': {
        const first = this.unitByTarget(target)
        if (first) {
          const hit = new Set<number>()
          let bolt = this.cardVal(side, 'chain-lightning') + this.ultBonus(side)
          let u: UnitInstance | undefined = first
          while (u && bolt > 0) {
            hit.add(u.uid)
            this.damageUnit(u, bolt, null, false, events)
            bolt -= 1
            u = bolt > 0 ? this.biggestEnemyUnitExcept(side, hit) : undefined
          }
        }
        break
      }
      case 'smart-missiles': {
        const dmg = this.cardVal(side, 'smart-missiles') + this.ultBonus(side)
        for (const lane of LANES) {
          const front = this.frontUnit(lane, this.opponent(side))
          if (front) this.damageUnit(front, dmg, null, false, events)
        }
        break
      }
      case 'black-hole': {
        const threshold = this.cardVal(side, 'black-hole')
        const opp = this.opponent(side)
        for (const lane of LANES) {
          let weakest: UnitInstance | undefined
          for (const u of this.lanes[lane][opp]) if (!weakest || u.hp < weakest.hp) weakest = u
          if (weakest && weakest.hp <= threshold) this.killUnit(weakest, events)
        }
        break
      }
      case 'chrono-field': {
        const turns = this.cardVal(side, 'chrono-field')
        const opp = this.opponent(side)
        for (const lane of LANES) {
          for (const u of this.lanes[lane][opp]) {
            u.frozenTurns = Math.max(u.frozenTurns, turns)
            events.push({ type: 'unitFrozen', uid: u.uid, turns: u.frozenTurns })
          }
        }
        break
      }
      case 'spotlight': {
        // Enemies in the spotlight take more damage from every source, permanently.
        const u = this.unitByTarget(target)
        if (u) {
          u.vulnerable += this.cardVal(side, 'spotlight')
          events.push({ type: 'unitBuffed', uid: u.uid, atk: u.atk, hp: u.hp })
        }
        break
      }
      case 'shrink-ray': {
        // Shrinking an enemy's mass saps the force of its hits (less damage to you).
        const u = this.unitByTarget(target)
        if (u) {
          u.atk = Math.max(0, u.atk - this.cardVal(side, 'shrink-ray'))
          events.push({ type: 'unitBuffed', uid: u.uid, atk: u.atk, hp: u.hp })
        }
        break
      }
    }
  }

  /** Dimension Core: bonus damage added to this side's damage-dealing Ultimates. */
  private ultBonus(side: Side): number {
    return this.countModule(side, 'dimension-core') * this.cardVal(side, 'dimension-core')
  }

  /** Highest-HP enemy unit of `side`'s foe not already in `exclude`. For Chain Lightning. */
  private biggestEnemyUnitExcept(side: Side, exclude: Set<number>): UnitInstance | undefined {
    const opp = this.opponent(side)
    let best: UnitInstance | undefined
    for (const lane of LANES) for (const u of this.lanes[lane][opp]) {
      if (exclude.has(u.uid)) continue
      if (!best || u.hp > best.hp) best = u
    }
    return best
  }

  /** The enemy unit (of `side`'s foe) with the highest ATK. For Magnetic Hook. */
  private strongestEnemyUnit(side: Side): UnitInstance | undefined {
    const opp = this.opponent(side)
    let best: UnitInstance | undefined
    for (const lane of LANES) for (const u of this.lanes[lane][opp]) {
      if (!best || u.atk > best.atk) best = u
    }
    return best
  }

  /** The enemy unit (of `side`'s foe) with the LOWEST ATK. For the Ally Chip (converts the weakest). */
  private weakestEnemyUnit(side: Side): UnitInstance | undefined {
    const opp = this.opponent(side)
    let best: UnitInstance | undefined
    for (const lane of LANES) for (const u of this.lanes[lane][opp]) {
      if (!best || u.atk < best.atk) best = u
    }
    return best
  }

  /** `side`'s own unit with the highest ATK. For Om Chip. */
  private strongestOwnUnit(side: Side): UnitInstance | undefined {
    let best: UnitInstance | undefined
    for (const lane of LANES) for (const u of this.lanes[lane][side]) {
      if (!best || u.atk > best.atk) best = u
    }
    return best
  }

  /** The enemy unit (of `side`'s foe) with the most HP, excluding `excludeUid`. For Elite Cannon. */
  private biggestEnemyUnit(side: Side, excludeUid: number): UnitInstance | undefined {
    const opp = this.opponent(side)
    let best: UnitInstance | undefined
    for (const lane of LANES) for (const u of this.lanes[lane][opp]) {
      if (u.uid === excludeUid) continue
      if (!best || u.hp > best.hp) best = u
    }
    return best
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

    // Harmony Conductor: prime this combat's pool of enemy "miss-attacks" (one per instance × level).
    for (const s of SIDES) {
      for (const m of this.players[s].modules) {
        if (m.cardId === 'harmony-conductor') m.data.missesLeft = this.cardVal(s, 'harmony-conductor')
      }
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
      if ((step === 'first') === isFirst) {
        // Harmony Conductor: the enemy may force this front to miss its attack.
        if (this.consumeHarmonyMiss(this.opponent(side))) {
          events.push({ type: 'unitTapped', uid: unit.uid })
          continue
        }
        firing.push({ unit, side })
      }
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
    // Astral Deliverance: each attack bounces, hitting the enemy unit behind the front too.
    for (const f of firing) {
      const bounce = this.countModule(f.side, 'astral-deliverance') * this.cardVal(f.side, 'astral-deliverance')
      if (bounce <= 0) continue
      const behind = this.lanes[lane][this.opponent(f.side)][1]
      if (behind) this.damageUnit(behind, bounce, f.unit.uid, false, events)
    }
    // Anti-Cube Portal: an attack sends a shockwave into the enemy fronts of the neighboring lanes.
    for (const f of firing) {
      const shock = this.countModule(f.side, 'anti-cube-portal') * this.cardVal(f.side, 'anti-cube-portal')
      if (shock <= 0) continue
      for (const adj of ADJACENT[lane]) {
        const neighbor = this.frontUnit(adj, this.opponent(f.side))
        if (neighbor) this.damageUnit(neighbor, shock, f.unit.uid, false, events)
      }
    }
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
    // Being Annihilator: a leveled number of this side's attacks each turn are guaranteed crits.
    const ann = this.players[side].modules.find(m => m.cardId === 'being-annihilator')
    if (ann) {
      const used = typeof ann.data.critsUsed === 'number' ? ann.data.critsUsed : 0
      const allowed = this.cardVal(side, 'being-annihilator') * this.countModule(side, 'being-annihilator')
      if (used < allowed) {
        crit = true
        ann.data.critsUsed = used + 1
      }
    }
    if (!crit && this.countModule(side, 'critical-chance') > 0 && this.rng.chance(this.cardVal(side, 'critical-chance'))) {
      crit = true
    }
    if (crit) atk *= TUNING.CRIT_MULTIPLIER
    // Havoc Bringer (rend armor): enemy UNITS take extra damage from this side's attacks.
    const havoc = this.countModule(side, 'havoc-bringer') * this.cardVal(side, 'havoc-bringer')

    const enemyFront = this.frontUnit(lane, opp)
    if (enemyFront) {
      const spill = this.effectiveKeywords(attacker).has('spillover')
      return {
        attackerUid: attacker.uid,
        target: 'unit',
        uid: enemyFront.uid,
        hpBefore: enemyFront.hp,
        amount: atk + havoc,
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
            amount: atk + havoc,
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
      // Sharp Fortitude: the wall's thorns hurt whoever strikes the Nexus.
      const thorns = this.countModule(plan.side, 'sharp-fortitude')
      if (thorns > 0) {
        const attacker = this.findUnit(plan.attackerUid)
        if (attacker) this.damageUnit(attacker, thorns, null, false, events)
      }
      return
    }
    const u = this.findUnit(plan.uid)
    if (!u) return
    if (u.invulnerableThisTurn) {
      events.push({ type: 'damage', targetUid: u.uid, amount: 0, sourceUid: plan.attackerUid, crit: plan.crit })
      return
    }
    let amount = plan.amount + (plan.amount > 0 ? u.vulnerable : 0)
    // Death Penalty: the first damage a Marked unit takes destroys it.
    if (u.marked && amount > 0) {
      amount = Math.max(amount, u.hp)
      u.marked = false
    }
    u.hp -= amount
    events.push({ type: 'damage', targetUid: u.uid, amount, sourceUid: plan.attackerUid, crit: plan.crit })
    damaged.set(u.uid, plan.attackerUid)
    // Pulsar Harvester: the attacker's side saps a surviving enemy's ATK.
    const attacker = this.findUnit(plan.attackerUid)
    if (attacker && u.hp > 0 && u.owner === this.opponent(attacker.owner)) {
      const sap = this.countModule(attacker.owner, 'pulsar-harvester') * this.cardVal(attacker.owner, 'pulsar-harvester')
      if (sap > 0) {
        u.atk = Math.max(0, u.atk - sap)
        events.push({ type: 'unitBuffed', uid: u.uid, atk: u.atk, hp: u.hp })
      }
    }
    if (plan.spillSide && amount >= plan.hpBefore) {
      const overkill = amount - plan.hpBefore
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
    let amt = amount + unit.vulnerable // Spotlight
    // Protector enemy skill: its units shrug off some of every hit (min 1 still lands).
    if (this.skillOf(unit.owner) === 'protector') amt = Math.max(1, amt - ENEMY_SKILL.protectorReduction)
    if (unit.marked) {
      amt = Math.max(amt, unit.hp) // Death Penalty: first hit destroys
      unit.marked = false
    }
    const dealt = Math.min(unit.hp, amt)
    unit.hp -= amt
    events.push({ type: 'damage', targetUid: unit.uid, amount: amt, sourceUid, crit })
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

    // Viking Funeral mastery: a dying Berserker throws its ATK at the enemy Nexus.
    if (unit.atk > 0 && this.hasMasterySpecial(unit.owner, unit.cardId, 'viking-funeral')) {
      this.damageNexus(this.opponent(unit.owner), unit.atk, events)
    }
    // Poison Swamp: an enemy dying spreads poison to its surviving lane-mates.
    const poisoner = this.opponent(unit.owner)
    if (this.countModule(poisoner, 'poison-swamp') > 0) {
      const dmg = this.cardVal(poisoner, 'poison-swamp') * this.countModule(poisoner, 'poison-swamp')
      for (const mate of [...stack]) this.damageUnit(mate, dmg, null, false, events)
    }
    // Scatter enemy skill: a dying (non-token) unit splits — a 1/1 shard takes its place.
    if (
      this.skillOf(unit.owner) === 'scatter' &&
      unit.cardId !== MINE_TOKEN.id &&
      unit.cardId !== SUMMON_TOKEN.id &&
      stack.length < TUNING.LANE_STACK_CAP
    ) {
      const shard = this.makeUnit(unit.owner, MINE_TOKEN.id, unit.lane)
      shard.atk = 1
      shard.hp = 1
      shard.maxHp = 1
      stack.unshift(shard)
      events.push({ type: 'unitPlaced', unit: shard, index: 0 })
    }
    // Fortress Walls mastery: rebuild a small wall in the lane once (the token can't re-trigger).
    if (this.hasMasterySpecial(unit.owner, unit.cardId, 'fortress-walls')) {
      const wall = this.makeUnit(unit.owner, MINE_TOKEN.id, unit.lane)
      wall.hp = 4
      wall.maxHp = 4
      wall.atk = 0
      stack.unshift(wall)
      events.push({ type: 'unitPlaced', unit: wall, index: 0 })
    }

    if (killerUid !== null) {
      const killer = this.findUnit(killerUid)
      if (killer) {
        // Critical Coin: the killer's owner gains mana next turn (scaled by level).
        if (this.countModule(killer.owner, 'critical-coin') > 0) {
          this.pendingMana[killer.owner] += this.cardVal(killer.owner, 'critical-coin') * this.countModule(killer.owner, 'critical-coin')
        }
        // Golden Tower: the golden tower pays out temporary mana for each enemy killed.
        if (this.countModule(killer.owner, 'golden-tower') > 0) {
          const kp = this.players[killer.owner]
          kp.manaPool += this.cardVal(killer.owner, 'golden-tower') * this.countModule(killer.owner, 'golden-tower')
          events.push({ type: 'manaChanged', side: killer.owner, pool: kp.manaPool, max: kp.manaMax })
        }
        // Coin Orb mastery: an Extra Orbs that kills draws a card.
        if (this.hasMasterySpecial(killer.owner, killer.cardId, 'coin-orb')) {
          this.drawCard(this.players[killer.owner], events)
        }
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
    // Galaxy Compressor: a recovery this turn shortens ultimate "cooldowns" (cheaper ults this turn).
    for (const m of p.modules) if (m.cardId === 'galaxy-compressor') m.data.healedThisTurn = true
  }

  private damageNexus(side: Side, amount: number, events: GameEvent[], bypass = false): void {
    if (amount <= 0) return
    const p = this.players[side]

    let applied = amount
    if (!bypass) {
      // Energy Shield: negate this instance; it absorbs a leveled number of instances before breaking.
      const shield = p.modules.find(m => m.cardId === 'energy-shield')
      if (shield) {
        const used = (typeof shield.data.used === 'number' ? shield.data.used : 0) + 1
        shield.data.used = used
        if (used >= this.cardVal(side, 'energy-shield')) this.destroyModule(side, shield.uid, events)
        events.push({ type: 'nexusDamage', side, amount: 0, life: p.life })
        return
      }
      // Extra Defense: reduce per copy (scaled by level), but a hit never drops below 1.
      const reduction = this.cardVal(side, 'extra-defense') * this.countModule(side, 'extra-defense')
      applied = Math.max(1, amount - reduction)
    }

    p.life -= applied
    events.push({ type: 'nexusDamage', side, amount: applied, life: Math.max(0, p.life) })

    if (p.life <= 0) {
      // Second Wind: prevent the fatal blow once, healing to a leveled amount.
      const secretIdx = p.secrets.findIndex(s => s.cardId === 'second-wind')
      if (secretIdx >= 0) {
        const [secret] = p.secrets.splice(secretIdx, 1)
        const heal = this.cardVal(side, 'second-wind')
        p.life = heal
        events.push({ type: 'secretTriggered', cardId: secret!.cardId, side })
        events.push({ type: 'heal', targetUid: null, side, amount: heal })
        // Angel Wings mastery: also heal all your units to full.
        if (this.hasMasterySpecial(side, 'second-wind', 'angel-wings')) {
          for (const lane of LANES) for (const u of this.lanes[lane][side]) this.healUnit(u, u.maxHp, events)
        }
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
      // Deck-out: escalating unpreventable damage so two stalling boards can't draw forever.
      p.fatigue++
      events.push({ type: 'cardDrawn', side: p.side, card: null })
      this.damageNexus(p.side, p.fatigue, events, true)
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
      if (n > 0) this.healNexus(p.side, this.cardVal(p.side, 'package-chance') * n, events)
    }
  }

  // -------------------------------------------------------------------------
  // Unit construction & stat computation
  // -------------------------------------------------------------------------

  private makeUnit(side: Side, cardId: string, lane: Lane, uid = this.uidSeq++): UnitInstance {
    const def = getCard(cardId)
    let atk = def.atk ?? 0
    let hp = def.hp ?? 1
    const unitStat = cardUnitStat(cardId) // level scales the unit's primary stat
    if (unitStat === 'atk') atk = this.cardVal(side, cardId)
    else if (unitStat === 'hp') hp = this.cardVal(side, cardId)
    // Tank enemy skill: its units enter tougher (The Tower's Tank = 5× health).
    if (this.skillOf(side) === 'tank') hp += ENEMY_SKILL.tankHp
    return {
      uid,
      cardId,
      owner: side,
      lane,
      atk,
      hp,
      maxHp: hp,
      innate: new Set<Keyword>(def.keywords ?? []),
      tappedTurns: 0,
      frozenTurns: 0,
      invulnerableThisTurn: false,
      sacrificeAtEndOfTurn: false,
      chargedCritMultiplier: 0,
      vulnerable: 0,
      marked: false,
    }
  }

  /** Effective keywords = innate ∪ module-granted (Attack Speed → firstStrike, Range → reach). */
  private effectiveKeywords(unit: UnitInstance): Set<Keyword> {
    const kw = new Set<Keyword>(unit.innate)
    if (this.countModule(unit.owner, 'attack-speed') > 0) kw.add('firstStrike')
    if (this.countModule(unit.owner, 'range') > 0) kw.add('reach')
    // Enemy skills: Fast → First Strike (2× speed), Ranged → Reach (shoots from range).
    const skill = this.skillOf(unit.owner)
    if (skill === 'fast') kw.add('firstStrike')
    if (skill === 'ranged') kw.add('reach')
    return kw
  }

  /** Effective ATK: base + Damage/Attack-Speed/Range auras + Orbs Speed + Enemy Balance (to the foe) +
   *  Super Tower. Module bonuses scale with the module's card level. */
  private unitAtk(unit: UnitInstance, superTurn: Record<Side, boolean>): number {
    const side = unit.owner
    let atk = unit.atk
    atk += this.countModule(side, 'damage') * this.cardVal(side, 'damage')
    atk += this.countModule(side, 'attack-speed') * this.cardVal(side, 'attack-speed')
    atk += this.countModule(side, 'range') * this.cardVal(side, 'range')
    if (unit.cardId === 'extra-orbs') atk += this.countModule(side, 'orbs-speed') * this.cardVal(side, 'orbs-speed')
    // Singularity Harness: supercharges your "bots" — Mine/Wall tokens gain ATK.
    if (unit.cardId === MINE_TOKEN.id)
      atk += this.countModule(side, 'singularity-harness') * this.cardVal(side, 'singularity-harness')
    // Project Funding: damage scales with your banked mana (per 3 in pool).
    atk += this.countModule(side, 'project-funding') * this.cardVal(side, 'project-funding') * Math.floor(this.players[side].manaPool / 3)
    // Amplify Bot / Bot Bot: your own bots buff your units' ATK (Bot Bot also doubles other bots).
    atk += this.countModule(side, 'amplify-bot') * this.cardVal(side, 'amplify-bot') * this.botAmp(side)
    atk += this.countModule(side, 'bot-bot') * this.cardVal(side, 'bot-bot')
    // Commander enemy skill: it buffs its whole army with bonus ATK.
    if (this.skillOf(side) === 'commander') atk += ENEMY_SKILL.commanderAtk
    // Enemy Balance buffs the units of the module owner's OPPONENT (fixed +1 per copy).
    atk += this.countModule(this.opponent(side), 'enemy-balance')
    // Negative Mass Projector: the enemy's projector saps this unit's ATK.
    atk -= this.countModule(this.opponent(side), 'negative-mass-projector') * this.cardVal(this.opponent(side), 'negative-mass-projector')
    // Scout Chip / Flame Bot: the enemy's recon and burn sap this unit's ATK (Scout by level, burn −1).
    const opp = this.opponent(side)
    atk -= this.countModule(opp, 'guardian-scout') * this.cardVal(opp, 'guardian-scout')
    atk -= this.countModule(opp, 'flame-bot') // burned units deal 1 less per Flame Bot
    if (superTurn[side]) atk += this.cardVal(side, 'super-tower')
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

  /** Bot Bot amplifies your OTHER bots: their magnitude is multiplied by this (×2 with a Bot Bot). */
  private botAmp(side: Side): number {
    return 1 + this.countModule(side, 'bot-bot')
  }

  /** A side's innate boss "enemy skill" (Fast/Tank/Vampire/…), or 'none'. See EnemySkill. */
  private skillOf(side: Side): EnemySkill {
    return this.skills[side] ?? 'none'
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

  /** Spend one of `side`'s Harmony Conductor miss-attacks this combat, if any remain. */
  private consumeHarmonyMiss(side: Side): boolean {
    for (const m of this.players[side].modules) {
      if (m.cardId !== 'harmony-conductor') continue
      const left = typeof m.data.missesLeft === 'number' ? m.data.missesLeft : 0
      if (left > 0) {
        m.data.missesLeft = left - 1
        return true
      }
    }
    return false
  }

  private countAllModules(cardId: string): number {
    return this.countModule('HUMAN', cardId) + this.countModule('AI', cardId)
  }

  private effectiveCost(side: Side, cardId: string): number {
    const def = getCard(cardId)
    let cost = def.cost
    if (def.type === 'ULTIMATE') {
      // Multiverse Nexus: a synced free Ultimate costs nothing.
      const mods = this.players[side].modules
      if (mods.some(m => m.cardId === 'multiverse-nexus' && typeof m.data.freeUltsLeft === 'number' && m.data.freeUltsLeft > 0)) {
        return 0
      }
      cost -= this.cardVal(side, 'wave-accelerator') * this.countModule(side, 'wave-accelerator')
      // Galaxy Compressor: recovering this turn shortens ultimate cooldowns (cheaper).
      if (mods.some(m => m.cardId === 'galaxy-compressor' && m.data.healedThisTurn === true)) {
        cost -= this.cardVal(side, 'galaxy-compressor') * this.countModule(side, 'galaxy-compressor')
      }
    }
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

/** Rebuild an engine from a serialized state (save-restore / CLI). No opening events are produced. */
export function createEngineFromState(state: EngineState): Engine {
  return new TowerEngine({ humanDeck: [], aiDeck: [] }, state)
}
