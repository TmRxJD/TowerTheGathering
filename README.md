# Tower: The Gathering

A 1v1, turn-based, mana-based **lane battler** against an AI, themed on *The Tower*. You are a Tower
Commander; the enemy is an AI Nexus. Passive stats, ultimates, and utility mechanics from the game are
reshaped into 31 cards across three lanes.

> **Full design & rules:** [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) — read this first. It is the
> single source of truth; the engine implements exactly what it says.

## Why a separate repo

Deliberately standalone, so nothing tangles with the host site early. Built **engine-first and
framework-free**; the Tower Run Tracker imports the built bundle later as one consumer among possibly
several, embedding it in an iframe exactly like Inner Land Minesweeper and Bemerged.

## Layout

```
src/
  engine/     Pure TS game core. Zero DOM, zero framework, zero I/O.
    types.ts    The contract: CardDef, GameSnapshot, GameEvent, GameResult, the engine interface.
    cards.ts    The 31-card catalog — the authoritative numbers (mirrors docs/GAME_DESIGN.md).
    decks.ts    Starter deck + the 10 ladder boss decks.
    tuning.ts   Every playtest-deferred number, in one place.
    rng.ts      Seeded, deterministic RNG.
    engine.ts   createEngine(): state machine, combat, card effects.
    index.ts    Public barrel — import from here, never deeper.
  ai/         Heuristic commander (rule-based). Consumes the engine's public API only.
  harness/    Headless playout bots. Balance tuning + "is the ladder beatable/fair?" validation.
  ui/         DOM + CSS board and hand, with a canvas FX overlay. No framework.
  dev/        Standalone dev host (vite root, port 5181).
  embed/      Embed host — the iframe entry the tracker loads; speaks the ttg:* postMessage protocol.
  cli/        Headless text playthrough for quick manual sanity checks.
docs/
  GAME_DESIGN.md
```

## Principles

- **Engine emits events, never diffs.** Every mutating call returns an ordered event list; the UI
  animates from that. `snapshot()` is the read model and never leaks hidden state (the opponent's hand).
- **The engine's only output to a host is `GameResult`.** It knows nothing about persistence.
- **Seeded and deterministic.** Same seed + decks + inputs → identical game. Required for the harness
  and for shareable/daily seeds later.
- **The harness is a first-class citizen.** Balance is settled by headless playouts (heuristic vs
  heuristic, and an adversarial bot), not by hand-playing.

## Embedding into the tracker

`pnpm build:embed` writes a self-contained bundle with relative asset paths to `dist-embed/`. Vendor it
into the tracker at `public/games/tower-the-gathering/`. The tracker page (`src/pages/games/…`) loads it
in an origin-checked iframe and listens for:

```
→ { type: 'ttg:ready' }                        once mounted
→ { type: 'ttg:content-height', height }        whenever the board's height changes
→ { type: 'ttg:result', payload: GameResult }   when a ladder match ends (win/loss, boss, turns)
```

## Scripts

```bash
pnpm dev          # standalone dev host on http://localhost:5181
pnpm type-check   # tsc, no emit
pnpm test         # vitest
pnpm harness      # headless balance playouts
pnpm play         # headless CLI playthrough
pnpm build:embed  # build the iframe bundle into dist-embed/
```

## Status

In active bring-up. Engine contract, card catalog, tuning, and seeded RNG land first; combat/effects,
the heuristic AI, the harness, and the UI follow.
