/**
 * Headless match driver. Plays one complete game with a HeuristicAI on BOTH sides, so a full game
 * (combat, spillover, first strike, crit, secrets, the lot) runs with no UI. The harness runs
 * thousands of these to settle balance and to prove games terminate.
 */

import { createEngine, type Engine, type GameEvent, type GameResult, type Side } from '../engine'
import type { Archetype } from '../engine'
import { HeuristicAI, SearchAI } from '../ai'

export type AiKind = 'search' | 'heuristic'

interface Bot {
  takeTurn(): GameEvent[]
}
function makeBot(kind: AiKind, engine: Engine, side: Side, archetype: Archetype): Bot {
  return kind === 'heuristic' ? new HeuristicAI(engine, side, archetype) : new SearchAI(engine, side, archetype)
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
  /** Which AI drives each side (default 'search' both). Use 'heuristic' for a weaker, more
   *  human-like player to gauge real difficulty against the smart bosses. */
  readonly humanAi?: AiKind
  readonly aiAi?: AiKind
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
    bonusLife: { AI: opts.aiBonusLife ?? 0 },
    bonusStartMana: { AI: opts.aiBonusStartMana ?? 0 },
  })
  const ai: Record<Side, Bot> = {
    HUMAN: makeBot(opts.humanAi ?? 'search', engine, 'HUMAN', opts.humanArchetype ?? 'balanced'),
    AI: makeBot(opts.aiAi ?? 'search', engine, 'AI', opts.aiArchetype ?? 'balanced'),
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
