# Powerstone — Complete Design & State (2026-08-31)

A comprehensive snapshot of the game as it currently exists: rules, mechanics, every scale and
constant, the full card catalog, the AI, and open design questions. Written to be handed to another
person or AI for a direction discussion. Where a number appears here it is the number the code uses;
formulas are quoted from the source of truth (file paths given).

> **Number scale.** All *combat* quantities — unit ATK/HP, Tower life, and every damage/heal/defense
> card value — live on a **×10 scale** (`COMBAT_SCALE = 10` in `tuning.ts`). Scaling is applied once,
> centrally, in `cardLevelValue()` for the cards listed in `COMBAT_CARDS`, and directly on the tuning
> constants. Non‑combat values (coins, draw/mana/reveal counts, freeze turns, and every %/chance/
> multiplier) are **unscaled**. The numbers in this document are the real in‑engine values. The scale
> exists so a card level can step by a *percent* and still render as a clean whole number.

---

## 1. What the game is

**Powerstone** is a 1‑vs‑1, single‑player‑vs‑AI **mana lane‑battler card game** themed on the mobile
game *The Tower: Idle Tower Defense* (closer to Hearthstone than to Magic). You are a **Tower** with an
HP bar; you play **units** into three lanes, buff them with **modules**, and fire **ultimates**, trying
to reduce the enemy Tower to 0 before yours falls. It is a roguelike ladder: you climb **24 tiers**,
each an eleven‑enemy gauntlet, growing a deck and a permanently‑levelled card collection as you go.

- **Engine‑first**: the rules live in a pure, framework‑free TypeScript engine (`src/engine`), with
  seeded deterministic RNG, event emission, and full serialize/clone. The UI (`src/ui`) is a thin
  DOM/canvas renderer. This means the game is fully headless‑simulatable — the balance numbers below
  come from a self‑play simulator, not guesswork.
- **Stack**: Vanilla TS + Vite, GPL‑3.0, package `@tmrxjd/tower-the-gathering`. Standalone dev host on
  port 5181; an embed build (`pnpm build:embed`) is vendored into the sibling tracker website as an
  iframe at `/games/powerstone`.

### The intended experience (design pillars)
1. **The fun is building up your deck and board.** Each battle should last long enough to develop a
   board and enjoy your engine before it resets for the next enemy. (Directly shapes the HP/length
   scaling below.)
2. **Climbing pays off, farming does not.** Income scales with tier² so a higher tier is always worth
   more than grinding a cleared one. Deck size grows only by climbing.
3. **A fun, fast TCG difficulty curve — NOT a roguelike wall.** This is a snappy mini‑game, not a
   Tower‑accurate ladder. Battles are short (a few turns longer each tier), and the win rate glides
   from an easy onboarding down to a fair climax — never punishing. Target curve (measured against an
   engaged player): T1‑5 ~90‑100% · T6‑12 ~75‑90% · T13‑18 ~60‑75% · T19‑23 ~45‑60% · T24 ~35‑50%.
   (An earlier draft chased a "5‑10% nightmare wall"; that was the wrong genre and has been removed.)
4. **Faithful to The Tower.** Cards, enemies, bots and guardian chips are adapted from real game
   mechanics, not invented. Effects match what the thing does in The Tower (e.g. Chrono Field is
   crowd control, not damage; Damage is a % ATK multiplier, not a flat add).

---

## 2. Core rules

### The board
- Three **lanes**: `LEFT`, `CENTER`, `RIGHT`. Each side has a stack of units per lane.
- **Lane stack cap**: 4 units per lane per side (`LANE_STACK_CAP`). The unit at index 0 is the
  **front**; only the front unit fights. When it dies the next promotes.
- Each player has a **Tower** with an HP bar and a **mana** pool.

### Turn structure
A turn runs in phases for the active side: **START → MAIN → (combat) → END**, then hands to the
opponent (`engine.ts` `startTurn`/`endTurn`).

- **START**: mana refills to the current max; start‑of‑turn module effects fire (regen, draws,
  bots, death‑wave, hooks, etc. — see the module list); you draw for the turn.
- **MAIN**: you may play cards you can afford (units into lanes, modules, ultimates) in any order.
- **Combat**: your front unit in each lane attacks. Resolution is **plan‑then‑apply**: both relevant
  fronts' damage is computed against the current board, then applied, then a death sweep runs — so
  first‑strike ties can trade both ways cleanly.
- **END**: end‑of‑turn effects (mine spawns, sacrifices); tapped/frozen counters tick down for your
  own units.

### Mana
- Starts at **1 max** (`START_MANA_MAX`), grows **+1 max per turn** up to a cap of **10** (`MANA_CAP`).
  Pool refills to max each of your turns. "Temporary" mana (Cash, Golden Bot, etc.) adds to the pool
  for that turn only. (Mana is **not** scaled ×10 — it is the resource clock, kept small.)

### Cards, hand, deck
- **Opening hand**: 3 cards (`OPENING_HAND`). **Hand limit**: 7 (`HAND_LIMIT`) — draws over the limit
  are burned.
- Card **types**: `UNIT` (goes to a lane), `MODULE` (a persistent passive), `ULTIMATE` (a one‑shot
  spell, then discarded).
- **Fatigue / deck‑out**: there is **no reshuffle**. When you must draw from an empty deck you take
  **escalating unpreventable damage** (10, then 20, then 30, … — `fatigue × COMBAT_SCALE`). This
  guarantees games end and makes **deck size a real resource** (a bigger deck out‑lasts a smaller one
  in a long game).

### Winning
Reduce the enemy Tower to 0. (Or outlast them — fatigue will eventually kill a stalling board.)

---

## 3. Keywords & unit mechanics

- **Defender**: enemies must destroy it before other units in the lane can be hit. (Fortress, mines.)
- **First Strike**: deals its damage before the defender can strike back.
- **Reach** (from Range): a unit may hit an adjacent lane when its own lane's enemy front is clear.
- **Spillover** (Extra Orbs): overkill combat damage spills to the enemy Tower.
- **Trap** (Land Mine Stun): triggers when an enemy enters the lane.
- **Frozen** (`frozenTurns`): a stunned unit cannot act until the counter ticks down. May be
  **fractional** (Chrono Field freezes 1.5 turns at L1) — a unit acts again once the counter reaches 0.
- **Tapped** (`tappedTurns`): entered this turn / slowed — cannot act yet.
- **Invulnerable** (this turn): takes no damage (Demon Mode, Super Tower's power turn).
- **Crit**: 30% chance (`CRIT_CHANCE`) to deal 2× (`CRIT_MULTIPLIER`) — only with Critical Chance.

---

## 4. The ladder: tiers & difficulty scaling

Source of truth: `src/engine/tiers.ts`. `MAX_TIER = 24`. Each tier is an **11‑enemy gauntlet** (10
archetype enemies + a final **Boss** on rung 11, `FINAL_BOSS_RUNG = 11`); you must clear all 11 to
unlock the next tier. Ladder is gated (`run.maxCleared`), but you may replay any beaten enemy to farm.

All numbers below were tuned against the **win‑rate harness** (§10) to hit the fun curve in pillar 3.

The HP economy is **geometric and self‑similar** (see §6a for the card side of the same law). This is
the fix for the old hand‑tuned mess: card power grows geometrically with level, so HP must too, or the
two diverge and the curve becomes un‑tunable (which is exactly what happened with the old polynomial
`climb`). Everything below rides on ONE geometric backbone plus ONE difficulty multiplier.

### 4.1 The power index (`tierPowerIndex` / `playerPowerIndex`) — the geometric backbone
```
offenseIndex(L, M) = G_MAG^((L-1) + M/2)                 // the card-value growth factor, reused for HP
tierPowerIndex(t)  = offenseIndex(bossCardLevel(t), bossCardMastery(t))          // enemy's full power
playerPowerIndex(t)= offenseIndex(bossCardLevel(t), bossCardMastery(t) * 0.6)    // a real player's ~60%
```
Both towers' HP scale off `playerPowerIndex` (a symmetric, self‑similar base) so **time‑to‑kill stays
bounded at every tier** — the number of turns to end a battle barely moves up the ladder even as the raw
HP climbs into the tens of thousands. (`PLAYER_MST_FRAC = 0.6` reflects that a real deck reaches ~60% of
the enemy's free mastery — measured: harness deckMst ≈ 5.6 vs the enemy's 9.)

### 4.2 Player Tower HP (`tierBaseLife`)
```
tierBaseLife(t) = round(START_LIFE × (playerPowerIndex(t) - 1))   // total player HP = START_LIFE × index
```
`START_LIFE = 200`. Player HP: 200 (T1) → ~1.5k (T12) → ~16k (T24). Big geometric numbers, but the
enemy scales in lockstep so battles stay ~8‑18 turns.

### 4.3 Enemy life edge (`tierBossHandicap(tier, index)`) — ONE geometric difficulty knob
```
diff(t)  = DIFF_MIN + (DIFF_MAX - DIFF_MIN) × frac^DIFF_SHAPE     // frac = (t-1)/(MAX_TIER-1)
         //  DIFF_MIN 0.55 (T1 easy) → DIFF_MAX 2.0 (T24); DIFF_SHAPE 0.5 = concave (bite the mid, no top cliff)
rungMult = (1 + (index-1)*0.05) × (index==11 ? 1.35 : 1)          // later rungs + the Boss HP pile
enemyHP  = START_LIFE × playerPowerIndex(t) × diff(t) × rungMult  // bonusLife = enemyHP − 200 − tierBaseLife
bonusStartMana = tier >= 18 ? 1 : 0                              // a small opening tempo edge at the top
```
`diff` is the whole difficulty curve: at `diff = 1` the towers are on the same HP base (a fair fight, so
the depth‑2 player's skill edge shows), `diff < 1` is the easy onboarding, `diff > 1` is the climax. It
interpolates *geometrically/concavely*, so the win‑rate curve is smooth end to end — no sawtooth, no
one‑shot cliff. There is no low‑HP floor to special‑case: `DIFF_MIN > 0` keeps every enemy positive.

### 4.4 Player "battle conditions" nerf — REMOVED
```
tierPlayerLifePenalty(t) = 0     // a shrinking life bar is the "punishing" feel the TCG direction rejects.
```

### 4.5 Enemy card levels (`bossCardLevels` in `tiers.ts` — one source, shared by game + harnesses)
```
level   = min(7, 1 + floor((tier-1)/3))                     // rises every 3 tiers → 7 by T19
mastery = tier >= 13 ? min(9, tier-12) : (tier >= 9 ? 1 : 0) // small mastery from T9, full ramp from T13
```
Enemy card power is a difficulty lever: a **small mastery from T9** (the band where a built‑up player
deck otherwise coasts) plus the full mastery ramp from T13 → near‑maxed by T21, so the enemy out‑cards
you at the climax through stronger cards rather than only more life. This formula was **deduplicated**
from three copies (game UI + two harnesses) into `bossCardLevels`, so they can't drift.

### 4.6 Enemy skills (boss passives)
Each of the 10 archetype enemies carries an innate **`EnemySkill`** (serialized per side; `bossSkill()`
maps the canonical name; magnitudes in `ENEMY_SKILL` in `engine.ts`, combat values ×scale). The final
Boss and the Basic enemy have none.

| Enemy | Skill |
|---|---|
| Fast | its units gain **First Strike** |
| Tank | its units enter with **+30 HP** |
| Ranged | its units gain **Reach** |
| Vampire | **drains 20** from your Tower each of its turns and **disables your regen** |
| Protector | its units take **−10 damage** per hit (min 10) |
| Saboteur | **taps your strongest unit** at the start of its turn |
| Scatter | a dying unit **splits into a 10/10 shard** that survives |
| Overcharge | **bursts your Tower for 40** every 3rd turn |
| Commander | its whole army has **+10 ATK** |
| Boss / Basic | none (the Boss's threat is its HP pile) |

---

## 5. Deck growth (tier‑scaled)

Source: `maxDeckForTier` in `tiers.ts`.
```
maxDeckForTier(t) = 9 + t     // 10 cards at Tier 1 … 33 at Tier 24 (34 once T24 is cleared)
```
- You **start Tier 1 with a lean 10‑card deck** (`STARTER_DECK`). The cap grows **+1 per tier climbed**.
- After winning an enemy you're offered **3 reward cards** (weighted toward commons; respects copy
  limits); you add one, trimming the weakest only once you're over the tier cap
  (`takeRewardAndTrim` / `rewardCandidates` in `deckbuild.ts`).
- Bigger decks give more variety **and** resist fatigue in the long top‑tier games — so climbing is
  rewarded twice over.

**Copy limits** (`COPY_LIMITS`): common 3, rare 2, epic 1.

---

## 6. Economy (coins & upgrades)

Source: `src/engine/economy.ts`. **Coins** are the meta‑currency (icon 🪙; the save field is still named
`shards` internally). You spend them to permanently level and master cards in your **collection**
(carried across runs). Coin income is *farmed in battle* by economy cards (Coins, Golden Bot, Golden
Tower, Critical Coin, Coin Orb) into a per‑player `goldEarned` accumulator that is **banked only on a
win**, plus the flat per‑enemy reward below.

```
levelUpCost(level)   = level*level * 6         // 6·24·54·96·150·216  → 546 to take one card L1→L7
masteryUpCost(m)     = 30 * (m+1)*(m+1)         // 30·120·…·2430       → 8550 for one card's 0→9 mastery
tierShardBonus(t)    = t*t                       // per-enemy base: T1=1, T10=100, T20=400, T24=576
shardReward(t, boss) = t*t + boss*t             // coins for beating enemy `boss` at tier `t`
```
- One card fully maxed (L7 + M9) costs `546 + 8550 = 9096` coins. The whole 73‑card collection is a
  weeks‑long grind by design.
- **Levels are a mid‑game goal, masteries are a long post‑T20 grind.** Income is deliberately lean and
  hard‑weighted to high tiers. The AI rates pure‑economy cards low (no combat value), by design.

---

## 6a. The scaling law (`card-progression.ts`)

**One law, not 73 hand‑authored arrays.** A card's value at level `L` (1‑7) and mastery `M` (0‑9) is:

```
value(L, M) = base × G^((L-1) + M/2)
```

`base` is the card's level‑1 value (preserved, so L1 play is unchanged) and `G` is its growth class.
A mastery level is worth exactly **half a card level**. Two magnitude classes plus one bounded class:

| Class | Cards | `G` | Behaviour |
|---|---|---|---|
| **mag** | ATK / HP / damage / heal / flat combat + coin income (most of the catalog) | **1.7** | Steep, "big numbers": ×24 by L7, **×~260 at L7 + M9**. Predictable — every mag card grows by the *same* ×1.7 each level. |
| **ratio** | % of ATK, crit / spawn / kill chances | **1.25** | Gentle, and **capped** (chances ≤ 0.9, ATK multipliers ≤ +200%) — a ratio compounds with a magnitude, so it can't be allowed to run away. |
| **count** | durations, draws, marks, misses, free‑casts, cost, mana | — | **NOT geometric.** These are bounded by the *rules* of the board (a 7‑turn stun is broken at any scale), so they keep a small explicit curve. A maxed count is a small number, never thousands. |

So climbing gives a smooth, predictable power ramp, and the numbers are allowed to reach the tens of
thousands (a maxed Fortress is 80 → 21,028 HP) — the whole point of a big‑number idle‑game ladder. The
tier HP economy (§4) reuses the *same* `G_MAG` factor, so offense and HP grow together and battles stay
~8‑18 turns at every tier. Guardrails in `scaling.test.ts` prove the law holds and stays held.

Economy: a card fully maxed (L7 + M9) still costs `levelUpCost` + `masteryUpCost` = 9,096 coins.

---

## 7. Constants (`src/engine/tuning.ts`)

Combat constants are shown at their real ×10 value (`COMBAT_SCALE = 10`).

| Constant | Value | Meaning |
|---|---|---|
| START_LIFE | 200 | base Tower HP (before tierBaseLife) |
| START_MANA_MAX | 1 | starting mana cap |
| MANA_CAP | 10 | max mana cap |
| HAND_LIMIT | 7 | cards in hand (over = burned) |
| OPENING_HAND | 3 | opening draw |
| DECK_SIZE | 20 | size **enemy** decks are authored at (player uses maxDeckForTier) |
| MAX_DECK | 26 | legacy cap constant, superseded by maxDeckForTier |
| BACKLINE_SLOTS | 5 | reserve slots |
| LANE_STACK_CAP | 4 | units per lane per side |
| CRIT_CHANCE | 0.30 | Critical Chance proc (unscaled) |
| CRIT_MULTIPLIER | 2 | crit damage (unscaled) |
| LAND_MINE_SPAWN_CHANCE | 0.50 | Land Mine Chance proc (unscaled) |
| HEALTH_MODULE_BONUS | 50 | Health module HP |
| REGEN_PER_TURN | 10 | base regen |
| EXTRA_DEFENSE_REDUCTION | 10 | dmg reduction |
| SECOND_WIND_HEAL | 50 | revive HP |
| DEATH_RAY_MAIN / _SPLASH | 60 / 20 | Death Ray damage |
| DEMON_MODE_ATK | 50 | Demon Mode buff |
| SUPER_TOWER_ATK / _EVERY | 30 / 3 | Super Tower buff / cadence |
| ORBS_SPEED_ATK | 20 | Orbs Speed buff |
| RECOVERY_OVERHEAL | 20 | Recovery Package overheal |
| PACKAGE_CHANCE_HP | 20 | Package Chance HP |
| ULTIMATE_CRIT_MULTIPLIER | 3 | Ultimate Crit multiplier (unscaled) |

---

## 8. The card catalog (73 cards)

Format: **Name** (unit stats) · rarity · mana cost · L1→L7 · mastery name · effect.

> **The `L1→L7` values below are the OLD linear ramp and are kept only as a rough guide to each card's
> role.** The live values now follow the geometric law in §6a: the FIRST number (L1 `base`) is still
> exact, but L7 = `base × 1.7^6 ≈ base × 24` for a magnitude card (so Fortress is 80 → ~1,931, not 200),
> ratio cards grow by ×1.25/level and cap, and count cards stay the small bounded numbers shown. See
> `card-progression.ts` for the exact per‑card class/base.

**% ATK cards** (Damage, Attack Speed, Amplify Bot, Bot Bot, Range, Project Funding, Om Chip — and the
enemy‑sapping Negative Mass Projector, Scout Chip, Pulsar Harvester) work off a percentage of a unit's
own ATK, so they scale gradually, leave 0‑ATK walls as walls, and never zero the board with a flat number.

### UNITS

| Card | Rarity | Cost | L1→L7 | Mastery | Effect |
|---|---|---|---|---|---|
| **Fortress** (0/80, defender) | common | 2 | 80→200 HP | Fortress Walls | Defender, deals no damage. On death, a 0/40 wall rebuilds once. |
| **Land Mine Stun** (10/20, trap) | rare | 2 | 10→70 ATK | Flashbang | Trap, Defender. On enemy entry: destroy this, freeze that enemy 1 turn. |
| **Extra Orbs** (30/10, firstStrike) | rare | 4 | 30→90 ATK | Coin Orb | First Strike; overkill spills to the enemy Tower. Mastery: farm coins on kill. |
| **Berserker** (20/40) | epic | 4 | 20→80 ATK | Viking Funeral | +10 ATK each time it survives a hit. Mastery: on death, hits enemy Tower for its ATK. |

### MODULES

| Card | Rarity | Cost | L1→L7 | Mastery | Effect |
|---|---|---|---|---|---|
| **Damage** | common | 1 | 20%→90% | Damage+ | All your units deal +% of their own ATK. (+5%/mastery.) |
| **Attack Speed** | common | 2 | 15%→85% | Attack Speed+ | Your units gain First Strike and deal +% of their own ATK. |
| **Range** | common | 1 | 10%→50% | Long Shot | Your units gain Reach and +% of their own ATK. |
| **Health** | common | 2 | +50→+180 HP | Health+ | +max Tower HP immediately (and heal that much). |
| **Health Regen** | common | 2 | +10→+70 HP | Health Regen+ | Start of turn: heal your Tower and all units (copy scaling caps at 2). |
| **Coins** | common | 1 | 10→50 | Interest | Bonus coins on a win, per copy in play. (Economy.) |
| **Critical Chance** | common | 2 | 30%→60% | Super Crit | Your units have a % chance on hit to deal 2× damage. |
| **Enemy Balance** | common | 1 | 1→3 | Elite Balance | Draw +N cards each turn, but all enemy units get +10 ATK. (Count capped — extra draws compound fast.) |
| **Extra Defense** | common | 3 | +10→+70 | Extra Defense+ | Incoming Tower damage reduced (min 10). |
| **Critical Coin** | rare | 3 | 2→10 | Double Coins | Coins farmed per critical hit (banked on a win). |
| **Package Chance** | rare | 2 | +20→+80 HP | Care Package | +Tower HP whenever you draw an Ultimate. |
| **Slow Aura** | rare | 3 | 1→3 | Slow Attack | Enemy units enter tapped for N turns. (Duration capped — a long tap is a lock.) |
| **Land Mine Chance** | rare | 2 | 50%→80% | Minefield | % chance to spawn a mine each turn. |
| **Orbs Speed** | rare | 2 | +20→+80 ATK | Orbs Speed+ | +ATK to your Extra Orbs units. |
| **Golden Bot** | rare | 2 | 2→10 | Gold Rush | Coins farmed each turn (banked on a win). |
| **Amplify Bot** | rare | 3 | 10%→50% | Overdrive | Amplify: all your units deal +% of their own ATK. |
| **Scout Chip** | rare | 2 | 10%→50% | Recon | Removes % of every enemy unit’s ATK. |
| **Thunder Bot** | rare | 3 | 1→3 | Linger | Start of turn: stun the strongest enemy N turns (×Bot Bot). Duration capped. |
| **Inner Land Mines** | rare | 3 | 20→80 | Charged Mines | Damage to each enemy unit as it enters a lane. |
| **Golden Tower** | rare | 3 | 2→10 | Golden Combo | Coins farmed per enemy killed (banked on a win). |
| **Spotlight** | rare | 3 | +10→+70 | Floodlight | +N added to each of your Ultimate Weapon cards' effect. |
| **Super Tower** | epic | 5 | +30→+90 ATK | Ultimate Tower | Every 3rd turn: your units +ATK and Invulnerable that combat. |
| **Energy Shield** | epic | 4 | 1→4 | Repel | Absorbs N instances of Tower damage (each negates a full hit). |
| **Wave Accelerator** | epic | 3 | +1→+3 | Spawn Accelerator | Your Ultimates cost N less (min 1). Reduction capped. |
| **Death Wave** | epic | 4 | 10→70 | Kill Wall | Damage to every enemy unit each turn. |
| **Poison Swamp** | epic | 4 | 10→70 | Death Creep | Damage to a dying enemy's lane‑mates. |
| **Being Annihilator** | epic | 4 | 1→7 | Super Crit | N guaranteed crits (2×) each turn. |
| **Death Penalty** | epic | 3 | 15%→60% | Doom | % chance an entering enemy is Marked (first hit destroys it). +3%/mastery. |
| **Havoc Bringer** | epic | 4 | +10→+70 | Rend Max | Enemy units take +N damage from your attacks. |
| **Astral Deliverance** | epic | 4 | 10→70 | Ricochet | Bounce damage to the enemy behind your target. |
| **Anti‑Cube Portal** | epic | 4 | 10→70 | Aftershock | Shockwave damage to neighboring lanes' enemy fronts. |
| **Negative Mass Projector** | epic | 3 | 10%→50% | Heavy | Removes % of every enemy unit’s ATK. |
| **Sharp Fortitude** | epic | 4 | +40→+160 HP | Barbed | +max Tower HP (healed); attackers take thorns. |
| **Wormhole Redirector** | epic | 3 | 10→70 | Conduit | Tower HP recovered at the start of each turn. |
| **Space Displacer** | epic | 4 | 10→70 | Organize | HP of a Mine spawned in each empty lane each turn. |
| **Black Hole Digestor** | epic | 3 | 1→7 | Digest | +temp mana each turn (× copies, NOT × module count). |
| **Galaxy Compressor** | epic | 3 | 1→3 | Recover | Less Ultimate cost on turns you heal your Tower. Reduction capped. |
| **Project Funding** | epic | 4 | 5%→22% | Investment | +% of unit ATK per 3 mana in your pool (was flat; now a % army buff). |
| **Pulsar Harvester** | epic | 4 | 5%→25% | Decay | Saps % of the ATK of an enemy your unit damages (stacks per hit). |
| **Singularity Harness** | epic | 3 | +10→+70 ATK | Bot Boost | +ATK to your Mine & Wall tokens. |
| **Dimension Core** | epic | 4 | +10→+70 | Overcharge | +damage to your damage‑dealing Ultimates. |
| **Harmony Conductor** | epic | 4 | 1→3 | Discord | N enemy fronts miss their attack each turn (caps at 3 = the board). |
| **Magnetic Hook** | epic | 4 | 20→80 | Reel | Damage to the strongest enemy unit each turn. |
| **Multiverse Nexus** | epic | 4 | 1→4 | Synchrony | After you play an Ultimate, sync N free ones (fire together). Count capped. |
| **Om Chip** | epic | 3 | 10%→50% | Focus | Start of turn: your strongest unit gains +% of its own ATK (compounds). |
| **Flame Bot** | epic | 3 | 20→80 | Burn Stack | Burn all enemy units each turn (they also get −10 ATK). |
| **Bot Bot** | epic | 3 | 15%→55% | Maximum Power | Your units deal +% ATK; doubles your other Bots. |

### ULTIMATES

| Card | Rarity | Cost | L1→L7 | Mastery | Effect |
|---|---|---|---|---|---|
| **Cash** | common | 1 | +2→+8 | Big Cash | +temporary mana this turn. |
| **Free Upgrades** | common | 3 | 3→9 | Locked Upgrade | Reveal N cards; play a free unit ≤3 cost. |
| **Plasma Cannon** | rare | 3 | 30%→60% | Elite Cannon | Remove % of the target's current HP. Mastery: hits a 2nd unit. |
| **Wave Skip** | rare | 2 | 2→8 | Fast Forward | Draw N cards. |
| **Intro Sprint** | rare | 3 | 3→9 | Warp Speed | Draw N cards (then discard 1). |
| **Recovery Package** | rare | 3 | +20→+80 | Care Package | Heal a unit to full, +N over max. |
| **Smart Missiles** | rare | 3 | 20→80 | Cover Fire | Damage to each lane's front enemy. |
| **Chain Lightning** | rare | 4 | 30→90 | Smite | Damage a target, arcing −10 to each next enemy. |
| **Shrink Ray** | epic | 3 | 20→80 | Compress | Permanently shrink an enemy's ATK. |
| **Death Ray** | epic | 5 | 60→120 | Enhanced Ray | Damage a unit (+20 to neighbours). |
| **Energy Net** | epic | 4 | 2→5 | Electrified Net | Freeze an enemy unit N turns. |
| **Second Wind** | epic | 4 | 50→120 | Angel Wings | Revive your Tower to N HP if it would die. Mastery: full‑heal your units. |
| **Demon Mode** | epic | 6 | +50→+120 ATK | Demon Revenge | A unit gains +ATK & Invuln this turn; sacrificed after. |
| **Nuke** | epic | 8 | 10→70 | Radiation | Destroy all units; +bonus Tower damage. |
| **Ultimate Crit** | epic | 4 | 3→9 | Ultimate Crit+ | ×N damage straight to the Tower (bypasses blockers). |
| **Chrono Field** | epic | 5 | 1.5→3.5 | Chrono Loop | Freeze ALL enemy units N turns (crowd control; fractional). |
| **Black Hole** | epic | 6 | 30→90 | Consume | Destroy the highest‑HP enemy (≤N) in each lane. |
| **Ally Chip** | epic | 3 | +10→+70 | Loyal Ally | Convert the weakest enemy unit to your side (+ATK/HP). |
| **Attack Chip** | rare | 2 | +10→+70 | Execute | Deal the target's missing HP + N. |
| **Bounty Chip** | rare | 2 | 2→8 | Jackpot | Draw N cards. |
| **Fetch Chip** | rare | 3 | 30→100 | Big Haul | Steal N HP from the enemy Tower, then draw 1. |
| **Summon Chip** | rare | 3 | 20→80 | Swarm | Summon an N/N Ally in each empty friendly lane. |

**Ultimate Weapons** — the 9 real UWs are Chain Lightning, Smart Missiles, Death Wave, Chrono Field,
Inner Land Mines, Golden Tower, Poison Swamp, Black Hole, and Spotlight (the module that boosts the
others). **Bots** (5): Flame, Thunder, Golden, Amplify, Bot Bot. **Guardian chips** (6): Ally, Attack,
Bounty, Fetch, Summon, Scout (Repair is unreleased and omitted). Bots/chips are player reward‑pool
cards; authored enemy decks don't include them.

---

## 9. Enemies (the 11 rungs)

`BOSS_DECKS` in `decks.ts` — each a 20‑card deck with an archetype the AI reads to weight its play.

| # | Name | Archetype | # | Name | Archetype |
|---|---|---|---|---|---|
| 1 | Basic | balanced | 7 | Saboteur | nuke‑control |
| 2 | Fast | aggro | 8 | Scatter | aggro |
| 3 | Tank | turtle | 9 | Overcharge | balanced |
| 4 | Ranged | orbs‑burst | 10 | Commander | balanced |
| 5 | Vampire | balanced | 11 | **Boss** | balanced |
| 6 | Protector | turtle | | | |

---

## 10. The AI & balancing tools

- **SearchAI** (`src/ai/search.ts`) is the real opponent: it clones the engine and simulates. Depth 1
  is greedy; depth 2 measures a line *after the opponent's best reply* (anti‑cheese); depth 3 reads two
  turns ahead. Depth by tier is the dominant human‑difficulty lever (§4.2). It acts only through the
  public API and never touches the real RNG.
- **HeuristicAI** (`src/ai/heuristic.ts`) is a fast static‑eval fallback (public snapshot only, per‑
  enemy archetype bias) — used for smoke tests and as a weak‑play floor. It is too weak/erratic to be
  the difficulty yardstick.
- **`pnpm winrate`** (`src/harness/winrate.ts`) is the difficulty tool: samples N seeded matches per
  (tier, enemy), reporting actual win% + turns, with a **depth‑2 search player** as the "engaged human"
  yardstick vs the full‑strength enemy. `TTG_PLAYER=heuristic` measures the weak‑play floor.
- **`pnpm progression`** is a deterministic climb (clear‑ability + turns only; it cannot measure win
  rate). `pnpm harness` / `harness:ladder` are the older self‑play harnesses.

Latest curve (N=12, depth‑2 player), after the **geometric scaling rebuild** (§6a + §4): a SMOOTH,
monotonic decline with no sawtooth and no cliff — T2‑8 ~90‑98% → T9‑15 ~98‑100% → T16 83% → T18 70% →
**T19‑24 ~41‑52%**, T24 **52%**, turns ~8‑23. On‑target at the top (T16‑24 in band) and the anchors.
The one soft spot is the **T9‑15 plateau (~100%)**: at a fair power mirror the depth‑2 harness player
simply wins, so HP‑based difficulty can't pull the mid below ~95% without inflating turns — but a real
human is weaker than depth‑2, so their mid‑game sits lower and more in band. This curve replaced a
hand‑tuned one whose polynomial HP fought the geometric card ramp (an un‑tunable sawtooth); the
self‑similar geometric economy is what made it smooth and predictable.

---

## 11. Open design questions

- **Finer battle‑length tuning.** Target for a *human*: T10 ~1 min, T24 ~3‑4 min. Sim won‑turns are
  T10 ≈ 19 and top‑tier ~12‑16 (board‑decided fast lethals up top).
- **Continuous climb in MANUAL play.** The deck currently resets per tier run in manual play; the demo/
  sim already persist across tiers. Deck editing between enemies is via the post‑win reward pick.
- **Enemy‑skill scaling.** Magnitudes are currently flat across tiers (e.g. Vampire always drains 20);
  they could scale with tier for a sharper late game.
- **Further % conversions.** Only the four army‑wide flat ATK buffs were converted to %; other steep
  flat curves (e.g. big HP/damage jumps) could follow the same treatment if they prove OP‑quick.

---

## 12. Where things live

| Concern | File |
|---|---|
| Rules engine | `src/engine/engine.ts` |
| Constants / scale | `src/engine/tuning.ts` (`COMBAT_SCALE`) |
| Card catalog (data) | `src/engine/cards.ts` |
| Card levels / mastery / display | `src/engine/card-progression.ts` |
| Tiers & difficulty | `src/engine/tiers.ts` |
| Enemy decks & skills | `src/engine/decks.ts` |
| Economy | `src/engine/economy.ts` |
| Deckbuilding | `src/engine/deckbuild.ts` |
| AI | `src/ai/search.ts`, `src/ai/heuristic.ts` |
| Harnesses | `src/harness/*.ts` |
| UI | `src/ui/game-app.ts`, `src/ui/fx-layer.ts`, `src/ui/save.ts` |
| Design source of truth | `docs/GAME_DESIGN.md` |
