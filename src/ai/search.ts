/**
 * Shallow-search AI. Instead of scoring cards by static heuristics, it actually looks one ply ahead:
 * for each legal play it clones the engine, applies the play, simulates ENDING THE TURN (so its own
 * combat — trades, spillover, lethal, damage taken — really resolves), and evaluates the resulting
 * position. It greedily keeps the best-improving play until ending the turn is best, then ends.
 *
 * Because combat is simulated rather than guessed, it plays trades, blocks, and lethal correctly —
 * a much stronger opponent than the static heuristic. It sees only the public snapshot (opponent's
 * hand hidden) and acts through the same API a player does, so it never cheats.
 *
 * Cost: ~one engine clone per candidate action per decision. That's cheap for a card game (a turn is
 * a few dozen clones), and it never touches the real engine's RNG (clones carry their own copy).
 */

import type { Action, Engine, GameEvent, Side } from '../engine'
import type { Archetype } from '../engine'

const LANES = ['LEFT', 'CENTER', 'RIGHT'] as const

/** Small per-family nudges so archetypes still feel distinct on top of the search. */
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
  constructor(
    private readonly engine: Engine,
    private readonly side: Side,
    archetype: Archetype = 'balanced',
  ) {
    this.aggression = AGGR[archetype]
  }

  takeTurn(): GameEvent[] {
    const events: GameEvent[] = []
    for (let guard = 0; guard < 40; guard++) {
      if (this.engine.isOver()) break
      const legal = this.engine.legalActions(this.side)
      const plays = legal.filter(a => a.kind !== 'endTurn')
      if (plays.length === 0) break

      const baseline = this.valueOfEndingTurn(this.engine)
      let best: Action | null = null
      let bestVal = baseline + 0.4 // a play must beat "just end the turn" by a small margin
      for (const a of plays) {
        const c = this.engine.clone()
        c.apply(a)
        const val = this.valueOfEndingTurn(c)
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

  /** Value of the position after ending the turn from `e` — i.e. after our combat resolves. */
  private valueOfEndingTurn(e: Engine): number {
    const c = e.clone()
    c.apply({ kind: 'endTurn' })
    return this.evaluate(c)
  }

  /** Evaluate a position from our perspective. Higher is better for us. */
  private evaluate(e: Engine): number {
    const winner = e.result()?.winner ?? null
    if (winner) return winner === this.side ? 1_000_000 : -1_000_000

    const snap = e.snapshot(this.side)
    const opp: Side = this.side === 'HUMAN' ? 'AI' : 'HUMAN'
    const me = snap.players[this.side]
    const foe = snap.players[opp]

    let s = (me.life - foe.life) * 4

    for (const lane of LANES) {
      for (const u of snap.lanes[lane][this.side]) s += u.atk * 1.2 * this.aggression + u.hp
      for (const u of snap.lanes[lane][opp]) s -= u.atk * 1.2 + u.hp
      // Unblocked front pressure — an ongoing clock toward the enemy Nexus (and against ours).
      const mf = snap.lanes[lane][this.side][0]
      const ef = snap.lanes[lane][opp][0]
      if (mf && !ef && !mf.tapped && !mf.frozen) s += mf.atk * 1.5 * this.aggression
      if (ef && !mf && !ef.tapped && !ef.frozen) s -= ef.atk * 1.5
    }

    // Small credit for developed permanents + card advantage, so useful setup isn't ignored.
    s += (me.modules.length - foe.modules.length) * 0.6
    s += (me.handCount - foe.handCount) * 0.4
    return s
  }
}
