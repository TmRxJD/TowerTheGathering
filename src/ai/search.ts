/**
 * Search AI. It looks ahead by cloning the engine and *simulating*, so it plays real combat math
 * rather than static guesses.
 *
 * - depth 1: for each legal play, clone → apply → simulate ending the turn (its own combat resolves)
 *   → evaluate. Greedy-keeps the best-improving play. Strong, but blind to the opponent's reply — so
 *   it can be cheesed (overcommit into a wipe, race into your lethal, be baited into removal).
 * - depth 2 (default for bosses): the value of a line is measured AFTER the opponent's best reply —
 *   it clones, ends its turn, lets a depth-1 searcher play the opponent's whole turn, and only then
 *   evaluates. So it won't overcommit into your Nuke, won't race into your lethal, and holds
 *   blockers/removal for what you can actually do. That's what makes it feel like it's reading you.
 *
 * The opponent model in the depth-2 sim plays from the cloned state (it can "see" the board's real
 * threats), which is a deliberate, pragmatic strength boost that makes the AI hard to cheese.
 *
 * It never touches the real engine's RNG (clones carry their own copy) and acts only through the
 * public API, so outside of its own planning it cannot cheat.
 */

import type { Action, Engine, GameEvent, Side } from '../engine'
import type { Archetype } from '../engine'

const LANES = ['LEFT', 'CENTER', 'RIGHT'] as const

const AGGR: Readonly<Record<Archetype, number>> = {
  balanced: 1,
  turtle: 0.85,
  aggro: 1.2,
  ramp: 0.95,
  'nuke-control': 0.9,
  'orbs-burst': 1.15,
}

export class SearchAI {
  private readonly aggression: number
  private readonly opp: Side
  constructor(
    private readonly engine: Engine,
    private readonly side: Side,
    archetype: Archetype = 'balanced',
    private readonly depth = 1,
  ) {
    this.aggression = AGGR[archetype]
    this.opp = side === 'HUMAN' ? 'AI' : 'HUMAN'
  }

  takeTurn(): GameEvent[] {
    const events: GameEvent[] = []
    for (let guard = 0; guard < 40; guard++) {
      if (this.engine.isOver()) break
      const legal = this.engine.legalActions(this.side)
      const plays = legal.filter(a => a.kind !== 'endTurn')
      if (plays.length === 0) break

      const baseline = this.lineValue(this.engine)
      let best: Action | null = null
      let bestVal = baseline + 0.4 // a play must beat "just end the turn" by a small margin
      for (const a of plays) {
        const c = this.engine.clone()
        c.apply(a)
        const val = this.lineValue(c)
        if (val > bestVal) {
          bestVal = val
          best = a
        }
      }
      if (!best) break
      events.push(...this.engine.apply(best))
    }
    events.push(...this.engine.apply({ kind: 'endTurn' }))
    return events
  }

  /** Value of a line: end the turn from `e`, then (at depth ≥ 2) let the opponent reply optimally,
   *  and evaluate the resulting position from our perspective. */
  private lineValue(e: Engine): number {
    const c = e.clone()
    c.apply({ kind: 'endTurn' })
    if (this.depth >= 2 && !c.isOver() && c.snapshot().activeSide === this.opp) {
      // Model the opponent's best turn with a shallower searcher (bounded recursion).
      new SearchAI(c, this.opp, 'balanced', this.depth - 1).takeTurn()
    }
    return this.evaluate(c)
  }

  /** Evaluate a position from our perspective. Higher is better for us. */
  private evaluate(e: Engine): number {
    const winner = e.result()?.winner ?? null
    if (winner) return winner === this.side ? 1_000_000 : -1_000_000

    const snap = e.snapshot(this.side)
    const me = snap.players[this.side]
    const foe = snap.players[this.opp]

    let s = (me.life - foe.life) * 4

    for (const lane of LANES) {
      for (const u of snap.lanes[lane][this.side]) s += u.atk * 1.2 * this.aggression + u.hp
      for (const u of snap.lanes[lane][this.opp]) s -= u.atk * 1.2 + u.hp
      const mf = snap.lanes[lane][this.side][0]
      const ef = snap.lanes[lane][this.opp][0]
      if (mf && !ef && !mf.tapped && !mf.frozen) s += mf.atk * 1.5 * this.aggression
      if (ef && !mf && !ef.tapped && !ef.frozen) s -= ef.atk * 1.5
    }

    s += (me.modules.length - foe.modules.length) * 0.6
    s += (me.handCount - foe.handCount) * 0.4
    // Prize surviving life when low — discourages suicidal races the 2-ply reply would punish anyway.
    if (me.life <= 6) s -= (7 - me.life) * 3
    return s
  }
}
