/**
 * Headless match driver. Plays one complete game with a HeuristicAI on BOTH sides, so a full game
 * (combat, spillover, first strike, crit, secrets, the lot) runs with no UI. The harness runs
 * thousands of these to settle balance and to prove games terminate.
 */

import { createEngine, type CardLevels, type Engine, type GameEvent, type GameResult, type Side } from '../engine'
import type { Archetype, EnemySkill } from '../engine'
import { HeuristicAI, SearchAI } from '../ai'

export type AiKind = 'search' | 'heuristic'

interface Bot {
  takeTurn(): GameEvent[]
}
function makeBot(kind: AiKind, engine: Engine, side: Side, archetype: Archetype, depth: number): Bot {
  return kind === 'heuristic' ? new HeuristicAI(engine, side, archetype) : new SearchAI(engine, side, archetype, depth)
}

export interface MatchOptions {
  readonly humanDeck: readonly string[]
  readonly aiDeck: readonly string[]
  readonly seed: string
  readonly humanArchetype?: Archetype
  readonly aiArchetype?: Archetype
  /** Ladder handicap applied to the AI side (see bossHandicap). */
  readonly aiBonusLife?: number
  readonly aiBonusStartMana?: number
  readonly humanBonusLife?: number
  /** Search depth per side (default 2 = anti-cheese; 1 = the beatable intro-tier AI). */
  readonly aiDepth?: number
  readonly humanDepth?: number
  /** Which AI drives each side (default 'search' both). Use 'heuristic' for a weaker, more
   *  human-like player to gauge real difficulty against the smart bosses. */
  readonly humanAi?: AiKind
  readonly aiAi?: AiKind
  /** Per-side card levels/masteries (the player's upgraded collection, the boss's tier scaling). */
  readonly humanCardLevels?: CardLevels
  readonly aiCardLevels?: CardLevels
  /** Per-side innate enemy skill (the boss archetype's signature passive). */
  readonly humanSkill?: EnemySkill
  readonly aiSkill?: EnemySkill
  /** Safety cap; a game that exceeds it is reported as a timeout (never expected). */
  readonly turnCap?: number
}

export interface MatchOutcome {
  readonly result: GameResult | null // null = timeout
  readonly turns: number
  readonly timedOut: boolean
}

export function playMatch(opts: MatchOptions): MatchOutcome {
  const { engine } = createEngine({
    humanDeck: opts.humanDeck,
    aiDeck: opts.aiDeck,
    seed: opts.seed,
    bonusLife: { AI: opts.aiBonusLife ?? 0, HUMAN: opts.humanBonusLife ?? 0 },
    bonusStartMana: { AI: opts.aiBonusStartMana ?? 0 },
    cardLevels: { HUMAN: opts.humanCardLevels ?? {}, AI: opts.aiCardLevels ?? {} },
    skills: { HUMAN: opts.humanSkill ?? 'none', AI: opts.aiSkill ?? 'none' },
  })
  const ai: Record<Side, Bot> = {
    HUMAN: makeBot(opts.humanAi ?? 'search', engine, 'HUMAN', opts.humanArchetype ?? 'balanced', opts.humanDepth ?? 2),
    AI: makeBot(opts.aiAi ?? 'search', engine, 'AI', opts.aiArchetype ?? 'balanced', opts.aiDepth ?? 2),
  }
  const cap = opts.turnCap ?? 300
  let guard = 0
  while (!engine.isOver() && guard < cap) {
    guard++
    const active = engine.snapshot().activeSide
    ai[active].takeTurn()
  }
  const result = engine.result()
  return { result, turns: engine.snapshot().turn, timedOut: result === null }
}
