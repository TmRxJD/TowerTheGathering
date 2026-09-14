# Tower: The Gathering — game design

A 1v1, turn-based, mana-based **lane battler** against an AI. You are a Tower Commander; the enemy is
an AI Nexus. Themed on *The Tower*'s passive stats, ultimates, and utility mechanics, reshaped into a
digital card game.

This document is the **single source of truth for the rules**. The engine implements exactly what is
written here; where the original pitch's prose and its 31-card table disagreed, the **table won**, and
the deltas are recorded in [§ Card catalog](#card-catalog).

---

## Board & resources

- **Life:** both sides start at **20**. Reaching 0 loses (unless Second Wind is set — see cards).
- **Mana:** start at **1** max on turn 1, **+1 max each of your turns**, capped at **10**. Your pool
  refills to max at the start of your turn. Temporary mana (Cash, Critical Coin) adds to the current
  pool only and does not raise the cap.
- **Lanes:** three — `LEFT`, `CENTER`, `RIGHT`. Combat is resolved lane-by-lane, simultaneously.
- **Hand limit:** 7. Drawing past 7 discards the excess (drawn card is discarded, oldest-first is not
  touched — see `tuning.HAND_LIMIT`). Deck-out: see § Fatigue.
- **Deck:** **20 cards** built from the 31-card pool (see [§ Deckbuilding](#deckbuilding)).

## The lane stack (core combat model)

Each lane holds an **ordered stack of units per side**. Index 0 is the **front**; higher indices are
**reserves**. Stacks have a soft cap of `tuning.LANE_STACK_CAP` (default 4).

- **Only the front unit is the combatant** each turn. Reserves do nothing until the front dies, then
  the next reserve steps up (on the following turn's combat — a freshly-promoted unit does not act the
  turn its predecessor died).
- A **Defender** (Fortress, Land Mine) is forced to the front of its lane and cannot be bypassed:
  whatever is behind it is untargetable until it dies. This is what "attack Fortress first" means.
- Placing a unit adds it to the **back** of the stack, unless it is a Defender and no Defender is
  present, in which case it takes the front. (You cannot stack two Defenders in front of each other;
  the second goes behind the first.)

### Combat resolution (per lane, both sides at once)

For each lane, resolve in strict phases so simultaneity is deterministic:

1. **Entry triggers** already fired when units were placed (Land Mine Stun, Slow Aura tapping). They
   do not re-fire in combat.
2. **First-strike step.** Units with First Strike (Attack Speed module; Extra Orbs; anything with the
   `firstStrike` keyword) deal their damage now. A front unit killed here does **not** deal its own
   damage in step 3.
3. **Main step.** Surviving front units deal ATK to the opposing front unit simultaneously.
4. **Spillover.** If, after the above, one side's lane is **empty** (front cleared, no reserve able to
   act this turn) and the other side still has a front unit, that unit deals its ATK to the enemy
   **Nexus**. Extra Orbs additionally spills *overkill* damage (ATK minus the HP it destroyed) to the
   Nexus in the same step it kills, even if a reserve remains.
5. **On-survive / on-kill triggers.** Berserker (+1/+0 on surviving damage); Critical Coin (mana next
   turn on a friendly kill); Health Regen is a **start-of-turn** heal, not combat.

Tapped units (Slow Aura) neither attack nor block on the turn they enter; they are skipped in steps
2–3 and their lane counts as "no front unit" for spillover against them.

## Turn structure

`DRAW → MAIN → COMBAT → END`, alternating between HUMAN and AI. The starting player skips their first
draw is **not** applied in v1 (both draw normally); the AI takes the second turn.

1. **Draw & Mana.** +1 max mana (cap 10), refill pool, draw 1 (plus Coins / Enemy Balance extras).
   Health Regen and other start-of-turn triggers fire here.
2. **Main.** Play units into lanes, attach modules to the backline (max 3 slots), cast ultimates.
   Order is free; each costs mana from the current pool.
3. **Combat.** All three lanes resolve as above. The active player is the attacker; both sides' units
   still trade, matching the pitch's "attack simultaneously down their columns".
4. **End.** Resolve end-of-turn triggers (Land Mine Chance spawn; temporary mana expires; Demon Mode
   sacrifices its target; tapped units untap).

## Card types

- **UNIT** — placed into a lane stack. Has ATK/HP and optional keywords.
- **MODULE** — placed in the backline (max `tuning.BACKLINE_SLOTS`, default 3). Persistent global or
  lane effect. Some are one-shot shields that destroy themselves on trigger.
- **ULTIMATE** — one-time spell cast from hand; resolves immediately, then goes to the discard (or is
  exiled where noted).

### Keywords

| Keyword | Meaning |
|---|---|
| `defender` | Forced to lane front; must be destroyed before units behind it can be targeted. |
| `firstStrike` | Deals combat damage in the first-strike step. |
| `reach` | May target/attack across into a neighbouring lane's front when its own lane is clear (granted by the Range module; Fortress has it too so it walls a wider front — see catalog). |
| `spillover` | Overkill combat damage carries to the Nexus (Extra Orbs). |
| `trap` | On an enemy entering this lane, the card triggers and is destroyed (Land Mine Stun). |
| `invulnerable` | Takes no damage this turn (Super Tower, Demon Mode). |
| `frozen` | Cannot act for N turns (Energy Net, Land Mine Stun, Plasma effects). |

---

## Deckbuilding

- Deck size **20**, chosen from the 31-card pool.
- **Copy limits (v1):** up to 3 of any Common, 2 of any Rare, 1 of any Epic. (`tuning.COPY_LIMITS`.)
- The ladder unlocks 3-card booster **choices** after each boss; between matches you swap cards in/out
  of your 20 subject to the copy limits. Starter deck is defined in `src/engine/decks.ts`.

## Enemies & their specials

Each tier is an **11-enemy ladder** (10 archetype enemies + a final Boss). The same enemies recur every
tier, each with a signature **special ability** faithful to the real Tower enemies — so once learned, an
enemy can be planned against at any tier. **In a match, hover (or tap) the enemy Tower** to read the
current enemy's special; the Help screen (`?`) lists all of them. The one-line player-facing text is the
`ENEMY_SKILL_INFO` map (`src/engine/decks.ts`); the mechanical magnitudes are `ENEMY_SKILL` in
`engine.ts` (see also `docs/GAME_STATE.md` §4.6).

| # | Enemy | Special |
|---|---|---|
| 1 | Basic | No special ability — a straight fight. |
| 2 | Fast | **First Strike** — its units strike first in every combat, before yours lands. |
| 3 | Tank | **Armored** — its units enter with a big chunk of bonus HP. |
| 4 | Ranged | **Reach** — its units attack from the back row and can hit an adjacent lane when their own is clear. |
| 5 | Vampire | **Lifedrain** — each of its turns it drains HP from your Tower into its own and shuts off your Health Regen. |
| 6 | Protector | **Damage Reduction** — its units shrug off part of every hit (at least 1 still lands). |
| 7 | Saboteur | **Sabotage** — each of its turns it taps your strongest unit, so it skips its next attack. |
| 8 | Scatter | **Split** — when one of its units dies, a small token spawns in its place. |
| 9 | Overcharge | **Overcharge** — every 3rd of its turns it fires a charged ray for burst damage to your Tower. |
| 10 | Commander | **Rally** — all of its units get bonus ATK. |
| 11 | Boss | No passive, but a massive wall of extra HP — bring sustained damage. |

## Card catalog

The authoritative numbers live in `src/engine/cards.ts` (`CARD_CATALOG`), which this table mirrors.
**Rarity → copy limit** and **class → where it goes** as above.

### Deltas from the original pitch prose (table values kept)

| Card | Prose | Kept (table) |
|---|---|---|
| Extra Orbs | 3 mana | **4 mana**, 3/1 |
| Death Ray | 5 dmg / 4 mana | **6 dmg, 5 mana** |
| Second Wind | 5 mana | **4 mana** |
| Fortress | 0/6 | **0/8** |
| Enemy Balance | "you draw +1, AI +1/+0" | **both draw +1, AI +1 ATK** |

### Commons (copy limit 3)

| Card | Type | Mana | ATK/HP | Effect |
|---|---|---|---|---|
| Damage | Module | 1 | — | Friendly units +1 ATK (global aura). |
| Attack Speed | Module | 2 | — | Your units gain First Strike. |
| Health | Module | 2 | — | +5 max Nexus HP immediately (and heal 5). |
| Health Regen | Module | 2 | — | Start of your turn: heal Nexus and all friendly units +1 HP. |
| Range | Module | 1 | — | Friendly units gain Reach (attack adjacent lane when own lane clear). |
| Cash | Ultimate | 1 | — | +2 temporary mana this turn. |
| Coins | Module | 2 | — | Draw +1 at the start of every one of your turns. |
| Free Upgrades | Ultimate | 3 | — | Reveal top 3; play 1 revealed unit of cost ≤3 into a lane free; rest to bottom. |
| Critical Chance | Module | 2 | — | Friendly units: 30% on hit to deal 2× damage. |
| Enemy Balance | Module | 1 | — | Both sides draw +1 each turn; all AI units +1 ATK. |
| Extra Defense | Module | 3 | — | Incoming Nexus damage reduced by 1 (min 1). |
| Fortress | Unit | 2 | 0/8 | Defender, Reach. Deals no combat damage. |

### Rares (copy limit 2)

| Card | Type | Mana | ATK/HP | Effect |
|---|---|---|---|---|
| Plasma Cannon | Ultimate | 3 | — | Target enemy unit loses 50% current HP (round up). |
| Critical Coin | Module | 3 | — | When a friendly unit kills an enemy unit, +1 mana next turn. |
| Wave Skip | Ultimate | 2 | — | The enemy's next combat phase is skipped. |
| Intro Sprint | Ultimate | 3 | — | Draw 3, then discard 1. |
| Land Mine Stun | Unit | 2 | 1/2 | Trap, Defender. Enemy enters lane → destroy this, freeze that enemy 1 turn. |
| Recovery Package | Ultimate | 3 | — | Heal target unit to full, +2 HP over its base max. |
| Package Chance | Module | 2 | — | When you draw an Ultimate, +2 Nexus HP. |
| Slow Aura | Module | 3 | — | Enemy units enter tapped (can't act the turn they're played). |
| Extra Orbs | Unit | 4 | 3/1 | First Strike, Spillover. |
| Land Mine Chance | Module | 2 | — | End of your turn: 50% to spawn a 1/1 Defender mine in a random empty lane. |
| Orbs Speed | Module | 2 | — | Friendly Extra Orbs units +2 ATK. |

### Epics (copy limit 1)

| Card | Type | Mana | ATK/HP | Effect |
|---|---|---|---|---|
| Death Ray | Ultimate | 5 | — | 6 dmg to a target unit; 2 dmg to the front units of both neighbouring lanes. |
| Energy Net | Ultimate | 4 | — | Freeze target enemy unit 2 turns. |
| Super Tower | Module | 5 | — | Every 3rd of your turns, your units +3 ATK and Invulnerable that combat. |
| Second Wind | Ultimate | 4 | — | Secret: if your Nexus would hit 0, prevent it, set HP to 5, exile this. |
| Demon Mode | Ultimate | 6 | — | Target friendly unit +5 ATK and Invulnerable this turn; sacrifice it at end of turn. |
| Energy Shield | Module | 4 | — | Negates the next instance of direct Nexus damage, then destroys itself. |
| Wave Accelerator | Module | 3 | — | Your ultimates cost 1 less (min 1). |
| Berserker | Unit | 4 | 2/4 | +1/+0 permanently each time it takes damage and survives. |
| Nuke | Ultimate | 8 | — | Destroy all units in all lanes, both sides. |
| Ultimate Crit | Ultimate | 4 | — | Target friendly unit's next attack deals 3× damage directly to the enemy Nexus, bypassing blockers. |

---

## Fatigue

Each draw from an **empty deck** deals escalating **unpreventable** damage to that player (1, then 2,
then 3, …). It bypasses Extra Defense and Energy Shield, but Second Wind still saves once. This
guarantees stalls resolve: two defensive boards that can never break each other will still deck out
and lose, so a game always ends (important for autoplay/demo mode and for a clean result).

## Determinism

Same seed + same deck orders + same inputs ⇒ identical game. All randomness (shuffles, Crit 30%,
Land Mine 50%) flows through the seeded RNG in `src/engine/rng.ts`. This is what lets the harness settle
balance over thousands of headless playouts and what makes shareable/daily seeds possible later.

## AI (v1: heuristic)

`src/ai` is a rule-based commander, not a search. Each turn it: assesses lethal (can it kill the Nexus
this or next turn?), scores each playable card by a value heuristic (tempo, board impact, removal on the
biggest threat), respects its **archetype bias** (each of the 10 ladder bosses weights card families
differently — Turtle, Ramp, Aggro, Nuke-control, …), and plays a mana-efficient sequence. It is tuned
against the harness bots. A search/expectimax AI is a deliberate v2.

## What is intentionally deferred

- Animations/VFX polish (canvas layer exists; particle content is minimal in v1).
- More than 31 cards; the archetype depth the pitch describes grows with the pool.
- Multiplayer. This is single-player vs AI by design.
