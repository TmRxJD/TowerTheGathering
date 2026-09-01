/**
 * Tower: The Gathering — engine type contract.
 *
 * Single source of truth for the shape of the game. Zero runtime behaviour, zero framework
 * imports: the UI, the AI, the harness, and the host site all depend on these types and nothing
 * else.
 *
 * Design reference: docs/GAME_DESIGN.md
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type Lane = 'LEFT' | 'CENTER' | 'RIGHT'
export const LANES: readonly Lane[] = ['LEFT', 'CENTER', 'RIGHT']

export type Side = 'HUMAN' | 'AI'
export const SIDES: readonly Side[] = ['HUMAN', 'AI']

export type CardType = 'UNIT' | 'MODULE' | 'ULTIMATE'
export type Rarity = 'common' | 'rare' | 'epic'

export type Phase = 'DRAW' | 'MAIN' | 'COMBAT' | 'END'

/** Behavioural flags a card/unit can carry. See docs/GAME_DESIGN.md § Keywords. */
export type Keyword =
  | 'defender' // forced to lane front; blocks units behind it
  | 'firstStrike' // deals combat damage in the first-strike step
  | 'reach' // may hit an adjacent lane's front when its own lane is clear
  | 'spillover' // overkill combat damage carries to the Nexus
  | 'trap' // triggers and dies when an enemy enters its lane

// ---------------------------------------------------------------------------
// Static card definitions (the catalog — pure data)
// ---------------------------------------------------------------------------

/**
 * A card's immutable definition. The catalog (`cards.ts`) is pure data; behaviour lives in the
 * engine, keyed by `id`. The repo's data says what a number *is*; the engine says what it *does*.
 */
export interface CardDef {
  readonly id: string // stable slug, e.g. 'fortress'
  readonly name: string
  readonly rarity: Rarity
  readonly type: CardType
  readonly cost: number
  /** Units only. */
  readonly atk?: number
  /** Units only. */
  readonly hp?: number
  readonly keywords?: readonly Keyword[]
  /** Human-readable rules text (also shown on the card face). */
  readonly text: string
  /** Art filename under src/ui/assets/cards/ (real Tower card thumbnails). */
  readonly art: string
}

// ---------------------------------------------------------------------------
// Runtime instances
// ---------------------------------------------------------------------------

/** A physical card, tracked by unique id from the moment it exists in a deck/hand/discard. */
export interface CardRef {
  readonly uid: number
  readonly cardId: string
}

/** A unit in play, in a lane stack. Index 0 of a stack is the front (the combatant). */
export interface UnitInstance {
  readonly uid: number
  readonly cardId: string
  owner: Side
  lane: Lane
  atk: number // current effective base (buffs from modules are added at combat time)
  hp: number
  maxHp: number
  /** Own innate keywords (module-granted keywords are layered on at read time). */
  readonly innate: ReadonlySet<Keyword>
  /** >0 → cannot act (Slow Aura entry). Decrements at end of the owner's turn. */
  tappedTurns: number
  /** >0 → cannot act (Energy Net, Land Mine Stun freeze). Decrements at end of owner's turn. */
  frozenTurns: number
  /** Set for the current combat only (Super Tower, Demon Mode). */
  invulnerableThisTurn: boolean
  /** Demon Mode marks its target for end-of-turn sacrifice. */
  sacrificeAtEndOfTurn: boolean
  /** Ultimate Crit charges the unit's next attack to hit the Nexus for 3×, bypassing blockers. */
  chargedCritMultiplier: number
  /** Spotlight: extra damage this unit takes from every source while it lives. */
  vulnerable: number
  /** Death Penalty: the first damage this unit takes destroys it outright. */
  marked: boolean
}

/** A module in a player's backline. `data` holds per-module counters (Super Tower turn, etc.). */
export interface ModuleInstance {
  readonly uid: number
  readonly cardId: string
  owner: Side
  data: Record<string, number | boolean>
}

/** A face-down secret (Second Wind). */
export interface SecretInstance {
  readonly uid: number
  readonly cardId: string
  owner: Side
}

export interface PlayerState {
  readonly side: Side
  life: number
  maxLife: number
  manaMax: number
  manaPool: number
  deck: CardRef[] // draw from the end (top = last element)
  hand: CardRef[]
  discard: CardRef[]
  modules: ModuleInstance[]
  secrets: SecretInstance[]
  /** How many of this player's turns have begun. */
  turnCount: number
  /** Set by Wave Skip on the opponent: their next combat phase is skipped. */
  skipNextCombat: boolean
  /** Deck-out counter: each draw from an empty deck deals this many (escalating) unpreventable
   *  damage — guarantees stalls resolve. See docs/GAME_DESIGN.md § Fatigue. */
  fatigue: number
  /** Shards farmed in-battle by gold/coin cards (Golden Bot per turn; Golden Tower / Critical Coin /
   *  Coin Orb per kill). Banked to your total by the game ONLY on a win — lose and the coins are lost. */
  goldEarned: number
}

// ---------------------------------------------------------------------------
// Actions (inputs to the engine)
// ---------------------------------------------------------------------------

export type Target =
  | { readonly kind: 'unit'; readonly uid: number }
  | { readonly kind: 'lane'; readonly lane: Lane; readonly side: Side }
  | { readonly kind: 'nexus'; readonly side: Side }

export type Action =
  | { readonly kind: 'playUnit'; readonly uid: number; readonly lane: Lane }
  | { readonly kind: 'playModule'; readonly uid: number }
  | { readonly kind: 'playUltimate'; readonly uid: number; readonly target?: Target }
  | { readonly kind: 'endTurn' }

// ---------------------------------------------------------------------------
// Events (engine → UI; ordered, animate from these)
// ---------------------------------------------------------------------------

export type GameEvent =
  | { readonly type: 'turnStarted'; readonly side: Side; readonly turn: number }
  | { readonly type: 'phaseChanged'; readonly phase: Phase; readonly side: Side }
  | { readonly type: 'manaChanged'; readonly side: Side; readonly pool: number; readonly max: number }
  | { readonly type: 'cardDrawn'; readonly side: Side; readonly card: CardRef | null }
  | { readonly type: 'cardDiscarded'; readonly side: Side; readonly card: CardRef }
  | { readonly type: 'unitPlaced'; readonly unit: UnitInstance; readonly index: number }
  | { readonly type: 'unitPromoted'; readonly uid: number; readonly lane: Lane; readonly side: Side }
  | { readonly type: 'moduleAttached'; readonly module: ModuleInstance }
  | { readonly type: 'moduleDestroyed'; readonly uid: number; readonly side: Side }
  | { readonly type: 'moduleTriggered'; readonly uid: number; readonly cardId: string; readonly side: Side }
  | { readonly type: 'secretSet'; readonly side: Side }
  | { readonly type: 'secretTriggered'; readonly cardId: string; readonly side: Side }
  | { readonly type: 'ultimateCast'; readonly cardId: string; readonly side: Side; readonly target?: Target }
  | {
      readonly type: 'damage'
      readonly targetUid: number
      readonly amount: number
      readonly sourceUid: number | null
      readonly crit: boolean
    }
  | { readonly type: 'nexusDamage'; readonly side: Side; readonly amount: number; readonly life: number }
  | { readonly type: 'heal'; readonly targetUid: number | null; readonly side: Side; readonly amount: number }
  | { readonly type: 'unitBuffed'; readonly uid: number; readonly atk: number; readonly hp: number }
  | { readonly type: 'unitFrozen'; readonly uid: number; readonly turns: number }
  | { readonly type: 'unitTapped'; readonly uid: number }
  | { readonly type: 'unitDied'; readonly uid: number; readonly lane: Lane; readonly side: Side }
  | { readonly type: 'laneResolved'; readonly lane: Lane }
  | { readonly type: 'gameOver'; readonly winner: Side; readonly turns: number }

// ---------------------------------------------------------------------------
// Read model (the snapshot the UI renders; never leaks the opponent's hand)
// ---------------------------------------------------------------------------

export interface UnitView {
  readonly uid: number
  readonly cardId: string
  readonly name: string
  readonly atk: number
  readonly hp: number
  readonly maxHp: number
  readonly keywords: readonly Keyword[]
  readonly tapped: boolean
  readonly frozen: boolean
  readonly invulnerable: boolean
  /** Marked for death (Death Penalty): the first hit destroys it regardless of HP. */
  readonly marked: boolean
  /** Extra damage it will take on the next hit (Spotlight vulnerability). */
  readonly vulnerable: number
  readonly isFront: boolean
}

export interface ModuleView {
  readonly uid: number
  readonly cardId: string
  readonly name: string
}

export interface PlayerView {
  readonly side: Side
  readonly life: number
  readonly maxLife: number
  readonly manaMax: number
  readonly manaPool: number
  readonly deckCount: number
  readonly discardCount: number
  readonly handCount: number
  readonly secretCount: number
  readonly modules: readonly ModuleView[]
  /** Shards farmed in-battle by gold/coin cards this game (banked on a win). */
  readonly goldEarned: number
  /** Populated only for the snapshot viewer. */
  readonly hand?: readonly CardRef[]
}

export interface GameSnapshot {
  readonly turn: number
  readonly activeSide: Side
  readonly phase: Phase
  readonly winner: Side | null
  readonly players: Readonly<Record<Side, PlayerView>>
  readonly lanes: Readonly<Record<Lane, Readonly<Record<Side, readonly UnitView[]>>>>
}

// ---------------------------------------------------------------------------
// Result (engine's only handoff to a host)
// ---------------------------------------------------------------------------

export interface GameResult {
  readonly winner: Side
  readonly turns: number
  readonly humanLifeRemaining: number
  readonly aiLifeRemaining: number
}

// ---------------------------------------------------------------------------
// Engine public interface
// ---------------------------------------------------------------------------

export interface EngineOptions {
  readonly seed?: string
  readonly humanDeck: readonly string[] // cardIds, length = tuning.DECK_SIZE
  readonly aiDeck: readonly string[]
  /** Which side takes the first turn. Default 'HUMAN'. */
  readonly firstPlayer?: Side
  /** Test seam: skip the opening shuffle so deck order is deterministic (draw from the end). */
  readonly shuffle?: boolean
  /** Extra starting (and max) life per side — the ladder handicap that scales boss difficulty. */
  readonly bonusLife?: Partial<Record<Side, number>>
  /** Extra starting max mana per side (a small tempo edge for the top bosses). */
  readonly bonusStartMana?: Partial<Record<Side, number>>
  /** Per-side card levels/masteries. Missing entries default to level 1, no mastery. */
  readonly cardLevels?: Partial<Record<Side, CardLevels>>
  /** Per-side innate "enemy skill" — a boss archetype's signature passive (see EnemySkill). */
  readonly skills?: Partial<Record<Side, EnemySkill>>
  /** Per-side offense multiplier on a unit's effective ATK and this side's skill damage. The primary,
   *  SMOOTH ladder-difficulty lever: the enemy hits progressively harder each tier (default 1). */
  readonly powerMult?: Partial<Record<Side, number>>
  /** Turn OFF combat variance (per-attack damage roll + base crit). Deterministic combat for unit tests
   *  that assert exact damage numbers; the real game and win-rate harness leave it on. Default false. */
  readonly deterministicCombat?: boolean
  /** Per-game enemy draw-luck swing magnitude (overrides TUNING.GAME_VARIANCE). Tapered by tier: wide in
   *  the mid (a gradual win curve), narrow at the top (so the hardest tiers stay strictly ordered). */
  readonly gameVariance?: number
}

/**
 * A boss archetype's signature passive, faithful to the real Tower enemies. Applied to a whole side
 * (normally the AI/boss). 'none' = a plain fight (Basic). Implemented in the engine keyed by this id.
 *  - fast:       its units have First Strike (2× speed → strike first)
 *  - tank:       its units enter with bonus max HP (5× health)
 *  - ranged:     its units have Reach (shoot from range / hit the backline)
 *  - vampire:    each of its turns, drains your Nexus HP into its own and disables your regen
 *  - protector:  its units take reduced combat damage (−, min 1)
 *  - saboteur:   each of its turns, taps your strongest unit (it can't act next turn)
 *  - scatter:    when one of its units dies, it splits — spawns a small token in that lane
 *  - overcharge: every 3rd of its turns, charges a ray → burst damage to your Nexus
 *  - commander:  its units have bonus ATK (buffs its army)
 *  - boss:       the final Boss — a huge pile of extra HP (handled via the tier handicap, no passive)
 */
export type EnemySkill =
  | 'none' | 'fast' | 'tank' | 'ranged' | 'vampire' | 'protector'
  | 'saboteur' | 'scatter' | 'overcharge' | 'commander' | 'boss'

/** A side's card progression, keyed by card id: base level (1-7) and mastery level (0-9, 0 = the
 *  mastery is not yet unlocked). Matches The Tower, where a card levels 7 times and its mastery 9. */
export type CardLevels = Record<string, { level: number; mastery: number }>

// ---------------------------------------------------------------------------
// Serializable full state (for cloning + save/restore; powers search + the CLI)
// ---------------------------------------------------------------------------

export interface UnitState {
  uid: number
  cardId: string
  owner: Side
  lane: Lane
  atk: number
  hp: number
  maxHp: number
  innate: Keyword[]
  tappedTurns: number
  frozenTurns: number
  invulnerableThisTurn: boolean
  sacrificeAtEndOfTurn: boolean
  chargedCritMultiplier: number
  vulnerable: number
  marked: boolean
}

export interface PlayerStateSnapshot {
  side: Side
  life: number
  maxLife: number
  manaMax: number
  manaPool: number
  deck: CardRef[]
  hand: CardRef[]
  discard: CardRef[]
  modules: ModuleInstance[]
  secrets: SecretInstance[]
  turnCount: number
  skipNextCombat: boolean
  fatigue: number
  goldEarned: number
}

export interface EngineState {
  uidSeq: number
  turn: number
  activeSide: Side
  phase: Phase
  winner: Side | null
  players: Record<Side, PlayerStateSnapshot>
  lanes: Record<Lane, Record<Side, UnitState[]>>
  pendingMana: Record<Side, number>
  rngState: number
  shuffleDecks: boolean
  bonusLife: Partial<Record<Side, number>>
  bonusStartMana: Partial<Record<Side, number>>
  cardLevels: Partial<Record<Side, CardLevels>>
  skills: Partial<Record<Side, EnemySkill>>
  powerMult: Partial<Record<Side, number>>
  deterministicCombat: boolean
  enemyLuck: number
}

export interface Engine {
  /** Read model for `viewer` (defaults to HUMAN). Only the viewer's hand is populated. */
  snapshot(viewer?: Side): GameSnapshot
  /** Legal actions for a side during its MAIN phase (plus endTurn). Empty if it is not their turn. */
  legalActions(side: Side): Action[]
  /** Apply an action for the currently active side. Returns the ordered events it produced. */
  apply(action: Action): GameEvent[]
  isOver(): boolean
  result(): GameResult | null
  /** Deep, JSON-safe snapshot of ALL internal state (incl. RNG position). */
  serialize(): EngineState
  /** An independent deep copy — mutating the clone never touches this engine. Powers the search AI. */
  clone(): Engine
}
