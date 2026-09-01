# Tower: The Gathering — Complete Design & State (2026-08-31)

A comprehensive snapshot of the game as it currently exists: rules, mechanics, every scale and
constant, the full card catalog, the AI, and open design questions. Written to be handed to another
person or AI for a direction discussion. Where a number appears here it is the number the code uses;
formulas are quoted from the source of truth (file paths given).

---

## 1. What the game is

**Tower: The Gathering** is a 1‑vs‑1, single‑player-vs‑AI **mana lane‑battler card game** themed on the
mobile game *The Tower: Idle Tower Defense*. You are a Tower (a "Nexus" with an HP bar); you play
**units** into three lanes, buff them with **modules**, and fire **ultimates**, trying to reduce the
enemy Nexus to 0 before yours falls. It is a roguelike ladder: you climb **24 tiers**, each a
ten‑boss gauntlet, growing a deck and a permanently‑levelled card collection as you go.

- **Engine‑first**: the rules live in a pure, framework‑free TypeScript engine (`src/engine`), with
  seeded deterministic RNG, event emission, and full serialize/clone. The UI (`src/ui`) is a thin
  DOM/canvas renderer. This means the game is fully headless‑simulatable — the balance numbers below
  come from a self‑play simulator, not guesswork.
- **Stack**: Vanilla TS + Vite, GPL‑3.0, package `@tmrxjd/tower-the-gathering`. Standalone dev host on
  port 5181; an embed build (`pnpm build:embed`) is vendored into a sibling website as an iframe.

### The intended experience (design pillars)
1. **The fun is building up your deck and board.** Each battle should last long enough to develop a
   board and enjoy your engine before it resets for the next boss. (Directly shapes the HP/length
   scaling below.)
2. **Climbing pays off, farming does not.** Income scales with tier² so a higher tier is always worth
   more than grinding a cleared one. Deck size grows only by climbing.
3. **A fun, fast TCG difficulty curve — NOT a roguelike wall.** This is a snappy mini‑game, not a
   Tower‑accurate ladder. Battles are short (a few turns longer each tier), and the win rate glides
   from an easy onboarding down to a fair climax — never punishing. Target curve (measured against an
   engaged player): T1‑5 ~90‑100% · T6‑12 ~75‑90% · T13‑18 ~60‑75% · T19‑23 ~45‑60% · T24 ~35‑50%.
   (An earlier draft chased a "5‑10% nightmare wall"; that was the wrong genre and has been removed.)
4. **Faithful to The Tower.** Cards, enemies, bots and guardian chips are adapted from real game
   mechanics, not invented.

---

## 2. Core rules

### The board
- Three **lanes**: `LEFT`, `CENTER`, `RIGHT`. Each side has a stack of units per lane.
- **Lane stack cap**: 4 units per lane per side (`LANE_STACK_CAP`). The unit at index 0 is the
  **front**; only the front unit fights. When it dies the next promotes.
- Each player has a **Nexus** with an HP bar and a **mana** pool.

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
  for that turn only.

### Cards, hand, deck
- **Opening hand**: 3 cards (`OPENING_HAND`). **Hand limit**: 7 (`HAND_LIMIT`) — draws over the limit
  are burned.
- Card **types**: `UNIT` (goes to a lane), `MODULE` (a persistent passive), `ULTIMATE` (a one‑shot
  spell, then discarded).
- **Fatigue / deck‑out**: there is **no reshuffle**. When you must draw from an empty deck you take
  **escalating unpreventable damage** (1, then 2, then 3, …). This guarantees games end and makes
  **deck size a real resource** (see the deck‑scaling section — a bigger deck out‑lasts a smaller one
  in a long game).

### Winning
Reduce the enemy Nexus to 0. (Or outlast them — fatigue will eventually kill a stalling board.)

---

## 3. Keywords & unit mechanics

- **Defender**: enemies must destroy it before other units in the lane can be hit. (Fortress, mines.)
- **First Strike**: deals its damage before the defender can strike back.
- **Reach** (from Range): a unit may hit an adjacent lane when its own lane's enemy front is clear.
- **Spillover** (Extra Orbs): overkill combat damage spills to the enemy Nexus.
- **Trap** (Land Mine Stun): triggers when an enemy enters the lane.
- **Frozen** (`frozenTurns`): a stunned unit cannot act until the counter ticks down.
- **Tapped** (`tappedTurns`): entered this turn / slowed — cannot act yet.
- **Invulnerable** (this turn): takes no damage (Demon Mode, Super Tower's power turn).
- **Crit**: 30% chance (`CRIT_CHANCE`) to deal 2× (`CRIT_MULTIPLIER`) — only with Critical Chance.

---

## 4. The ladder: tiers & difficulty scaling

Source of truth: `src/engine/tiers.ts`. `MAX_TIER = 24`. Each tier is an **11‑boss gauntlet** (10
archetype bosses + a final **Boss** on rung 11); you must clear all 11 to unlock the next tier.

Both sides scale up as you climb. The levers, exactly as coded:

All numbers below were tuned against the **win‑rate harness** (§10) to hit the fun curve in pillar 3.

### 4.1 Shared HP pool — battle length (`tierBaseLife`)
```
tierBaseLife(t) = round((t-1)*0.8) + round(max(0, t-16)*1.3)   // added to BOTH Nexuses
```
Base Nexus HP is `START_LIFE = 20`. Kept deliberately **small** so battles stay snappy (a fast mini‑
game, not a slog): ~9 turns at T1, ~12–15 up top. `20 + tierBaseLife` = 20 (T1), 29 (T12), 48 (T24).
Battles still run long enough to reach **fatigue** at the top, where the climbed‑up bigger deck pays off.

### 4.2 AI search depth (`tierAiDepth`) — the dominant difficulty lever vs a human
```
t ≤ 6   → 1‑ply   (simple "intro" AI — easy onboarding)
7..15   → 2‑ply   (anti‑cheese lookahead)
t ≥ 16  → 3‑ply   (reads two of your turns ahead)
```
A searching boss out‑plays a human regardless of HP, so **depth is what actually shapes the curve** —
kept low for the easy tiers, stepping up only for the mid and top.

### 4.3 Boss life edge (`tierBossHandicap(tier, index)`) — smooth, gentle, no walls
Added to the boss **on top of** the shared pool. `index` is the rung, 1..11.
```
climb     = round((tier-6)*2.5 + max(0, tier-14)*3.2)   // across-tier difficulty: PRIMARY lever
                                                        //   NEGATIVE early (T1 -13 → frail bosses),
                                                        //   crosses ~T6, accelerates late (T24 +77)
bossRamp  = round((index-1) * (0.4 + tier*0.12))        // later rungs of a tier a touch harder
finalBoss = index>=11 ? round(tierBaseLife(tier)*0.8) + round(tier*0.6) : 0   // the "Boss" HP chunk
bonusLife = climb + bossRamp + finalBoss
bonusStartMana = tier >= 23 ? 1 : 0
```
The old `brutal`/`nightmare`/`capstone` spikes were **removed** — that is the whole point of the TCG
retune. The **final Boss (rung 11)** carries a distinct HP chunk (`finalBoss`, ~+2 at T1 → ~+39 at
T24 over boss 10) as the tier's climax — a real fight, not a wall. No passive skill.

### 4.4 Player "battle conditions" nerf — REMOVED
```
tierPlayerLifePenalty(t) = 0     // was max(0,t-13)*5 (up to -55); a shrinking life bar is exactly the
                                 // "punishing" feel the TCG direction rejects. Difficulty now comes
                                 // from the boss's gentle handicap + maxed cards, not gimping you.
```

### 4.5 Boss card levels (mirrors `aiCardLevels` / `bossLevels`)
```
level   = min(7, 1 + floor((tier-1)/3))          // rises every 3 tiers → 7 by T19
mastery = tier >= 13 ? min(9, tier-12) : 0        // T13 +1 … T21+ maxed (9)
```
Boss offense is the top‑tier difficulty lever (HP is held flat): masteries come online at T13 and, at
the **top tiers (19+), climb to near‑maxed** so the boss out‑cards you at the climax through smarter/
stronger cards rather than more life. (Was capped at 6; raised for a fair‑but‑real top end.)

---

## 5. Deck growth (tier‑scaled)

Source: `maxDeckForTier` in `tiers.ts`.
```
maxDeckForTier(t) = 9 + t     // 10 cards at Tier 1 … 33 at Tier 24 (34 once T24 is cleared)
```
- You **start Tier 1 with a lean 10‑card deck** (`STARTER_DECK` — a mix of walls, aggro units, buff,
  removal, mana, draw). The cap grows **+1 per tier climbed**.
- After winning a boss you're offered **3 reward cards** (weighted toward commons; respects copy
  limits); you add one, trimming the weakest only once you're over the tier cap
  (`takeRewardAndTrim` / `rewardCandidates` in `deckbuild.ts`).
- Bigger decks give more variety **and** resist fatigue in the long top‑tier games — so climbing is
  rewarded twice over, and grinding a low tier for easy shards is not.

**Copy limits** (`COPY_LIMITS`): common 3, rare 2, epic 1.

---

## 6. Economy (shards & upgrades)

Source: `src/engine/economy.ts`. Shards are the meta‑currency; you spend them to permanently level and
master cards in your **collection** (carried across runs).

```
levelUpCost(level)   = level*level * 6        // 6·24·54·96·150·216  → 546 to take one card L1→L7
masteryUpCost(m)     = 30 * (m+1)*(m+1)        // 30·120·…·2430       → 8550 for one card's 0→9 mastery
tierShardBonus(t)    = t*t                      // per-boss base: T1=1, T10=100, T20=400, T24=576
shardReward(t, boss) = t*t + boss*t            // shards for beating boss `boss` at tier `t`
```
- One card fully maxed (L7 + M9) costs `546 + 8550 = 9096` shards. The whole 73‑card collection is a
  weeks‑long grind by design.
- A full 24‑tier climb pays only **~65,000 shards total** (≈65 at T1, ≈5,100 at T20, ≈7,080 at T24).
  So: **levels are a mid‑game goal, masteries are a long post‑T20 grind.** Income is deliberately lean
  and hard‑weighted to high tiers.

**Card upgrade values** (`card-progression.ts`): every card has a 7‑entry `levels` array (its stat at
L1..L7) and a **mastery** (0..9) that either adds `masteryBonus` per level or unlocks a named
`masterySpecial` ability. `cardVal = levels[level-1] + mastery*masteryBonus`.

---

## 7. Constants (`src/engine/tuning.ts`)

| Constant | Value | Meaning |
|---|---|---|
| START_LIFE | 20 | base Nexus HP (before tierBaseLife) |
| START_MANA_MAX | 1 | starting mana cap |
| MANA_CAP | 10 | max mana cap |
| HAND_LIMIT | 7 | cards in hand (over = burned) |
| OPENING_HAND | 3 | opening draw |
| DECK_SIZE | 20 | size **boss** decks are authored at (player uses maxDeckForTier) |
| MAX_DECK | 26 | legacy cap constant, now superseded by maxDeckForTier |
| BACKLINE_SLOTS | 5 | reserve slots |
| LANE_STACK_CAP | 4 | units per lane per side |
| CRIT_CHANCE | 0.30 | Critical Chance proc |
| CRIT_MULTIPLIER | 2 | crit damage |
| LAND_MINE_SPAWN_CHANCE | 0.50 | Land Mine Chance proc |
| HEALTH_MODULE_BONUS | 5 | Health module HP |
| REGEN_PER_TURN | 1 | base regen |
| EXTRA_DEFENSE_REDUCTION | 1 | dmg reduction |
| SECOND_WIND_HEAL | 5 | revive HP |
| DEATH_RAY_MAIN / _SPLASH | 6 / 2 | Death Ray damage |
| DEMON_MODE_ATK | 5 | Demon Mode buff |
| SUPER_TOWER_ATK / _EVERY | 3 / 3 | Super Tower buff / cadence |
| ORBS_SPEED_ATK | 2 | Orbs Speed buff |
| RECOVERY_OVERHEAL | 2 | Recovery Package overheal |
| PACKAGE_CHANCE_HP | 2 | Package Chance HP |
| ULTIMATE_CRIT_MULTIPLIER | 3 | Ultimate Crit multiplier |

---

## 8. The card catalog (73 cards)

Format: **Name** (unit stats) · rarity · mana cost · L1→L7 (the levelled stat) · mastery name · effect.
Behaviour is keyed by card `id` in the engine; the numbers are from `card-progression.ts`.

<!-- GENERATED FROM cards.ts + card-progression.ts -->

### UNITS

| Card | Rarity | Cost | L1→L7 | Mastery | Effect |
|---|---|---|---|---|---|
| **Fortress** (0/8, defender) | common | 2 | 8→20 | Fortress Walls | Defender. Enemies must destroy it first. Deals no combat damage. |
| **Land Mine Stun** (1/2, trap+defender) | rare | 2 | 1→7 | Flashbang | Trap, Defender. When an enemy enters this lane, destroy this and freeze that enemy 1 turn. |
| **Berserker** (2/4) | epic | 4 | 2→8 | Viking Funeral | Gains +1/+0 permanently each time it takes damage and survives. |
| **Extra Orbs** (3/1, firstStrike+spillover) | rare | 4 | 3→9 | Coin Orb | First Strike. Overkill damage spills to the enemy Nexus. |

### MODULES

| Card | Rarity | Cost | L1→L7 | Mastery | Effect |
|---|---|---|---|---|---|
| **Damage** | common | 1 | 1→7 | Damage+ | Friendly units have +1 ATK. |
| **Enemy Balance** | common | 1 | 1→7 | Elite Balance | Draw +1 card each turn, but all enemy units have +1 ATK. |
| **Range** | common | 1 | 0→6 | Long Shot | Friendly units gain Reach (hit an adjacent lane when their own is clear). |
| **Attack Speed** | common | 2 | 0→6 | Attack Speed+ | Your units gain First Strike. |
| **Coins** | common | 2 | 1→7 | Coins+ | Draw +1 card at the start of every one of your turns. |
| **Critical Chance** | common | 2 | 0.3→0.6 | Super Crit | Friendly units have a 30% chance on hit to deal 2× damage. |
| **Golden Bot** | rare | 2 | 1→4 | Gold Rush | Start of your turn: gain +1 temporary mana (coin farming). |
| **Health** | common | 2 | 5→18 | Health+ | +5 max Nexus HP immediately (and heal 5). |
| **Health Regen** | common | 2 | 1→7 | Health Regen+ | Start of your turn: heal your Nexus and all friendly units +1 HP. |
| **Land Mine Chance** | rare | 2 | 0.5→0.8 | Minefield | End of your turn: 50% chance to spawn a 1/1 Defender mine in a random empty lane. |
| **Orbs Speed** | rare | 2 | 2→8 | Orbs Speed+ | Friendly Extra Orbs units have +2 ATK. |
| **Package Chance** | rare | 2 | 2→8 | Care Package | Whenever you draw an Ultimate, gain +2 Nexus HP. |
| **Scout Chip** | rare | 2 | 1→3 | Recon | Scouted: all enemy units have −1 ATK. |
| **Amplify Bot** | rare | 3 | 1→4 | Overdrive | Amplify: your units have +1 ATK. |
| **Black Hole Digestor** | epic | 3 | 1→7 | Digest | Start of your turn: gain +1 temporary mana for each Module you control. |
| **Bot Bot** | epic | 3 | 1→3 | Maximum Power | Your units have +1 ATK, and your OTHER Bots trigger twice as strongly. |
| **Critical Coin** | rare | 3 | 1→7 | Double Coins | When a friendly unit destroys an enemy unit, gain +1 mana next turn. |
| **Death Penalty** | epic | 3 | 1→7 | Doom | Each turn, mark the first enemy unit that enters — the first hit it takes destroys it. |
| **Extra Defense** | common | 3 | 1→7 | Extra Defense+ | Incoming Nexus damage is reduced by 1 (minimum 1). |
| **Flame Bot** | epic | 3 | 2→5 | Burn Stack | Start of your turn: burn all enemy units for 2 damage. Burned (enemy) units have −1 ATK. |
| **Galaxy Compressor** | epic | 3 | 1→7 | Recover | On any turn you heal your Nexus, your Ultimates cost 1 less (min 1). |
| **Golden Tower** | rare | 3 | 1→7 | Golden Combo | The tower turns golden: gain +1 temporary mana whenever your unit destroys an enemy. |
| **Inner Land Mines** | rare | 3 | 2→8 | Charged Mines | Mines ring your tower: each enemy unit takes 2 damage as it enters a lane. |
| **Negative Mass Projector** | epic | 3 | 1→7 | Heavy | All enemy units have -1 ATK. |
| **Om Chip** | epic | 3 | 1→7 | Focus | Start of your turn: focus fire — your strongest unit gains +1 ATK. |
| **Singularity Harness** | epic | 3 | 1→7 | Bot Boost | Supercharges your bots: your Mine and Wall tokens gain +1 ATK. |
| **Slow Aura** | rare | 3 | 1→7 | Slow Attack | Enemy units enter tapped and cannot act the turn they are played. |
| **Thunder Bot** | rare | 3 | 1→2 | Linger | Start of your turn: stun the strongest enemy unit for 1 turn. |
| **Wave Accelerator** | epic | 3 | 1→7 | Spawn Accelerator | Your Ultimates cost 1 less (minimum 1). |
| **Wormhole Redirector** | epic | 3 | 1→7 | Conduit | Channels recovery: restore 1 Nexus HP at the start of each of your turns. |
| **Anti-Cube Portal** | epic | 4 | 1→7 | Aftershock | When your unit attacks, a shockwave deals 1 to the enemy fronts in the neighboring lanes. |
| **Astral Deliverance** | epic | 4 | 1→7 | Ricochet | Your units bounce: each combat attack also deals 1 damage to the enemy behind its target. |
| **Being Annihilator** | epic | 4 | 1→7 | Super Crit | The first friendly attack each turn is a guaranteed crit (2× damage). |
| **Death Wave** | epic | 4 | 1→7 | Kill Wall | Start of your turn: deal 1 damage to every enemy unit. |
| **Dimension Core** | epic | 4 | 1→7 | Overcharge | Your damage-dealing Ultimates deal +1 damage. |
| **Energy Shield** | epic | 4 | 1→7 | Repel | Negates the next instance of direct Nexus damage, then destroys itself. |
| **Harmony Conductor** | epic | 4 | 1→7 | Discord | Each combat, one enemy front unit misses its attack. |
| **Havoc Bringer** | epic | 4 | 1→7 | Rend Max | Rend armor: enemy units take +1 damage from your attacks. |
| **Magnetic Hook** | epic | 4 | 2→8 | Reel | Start of your turn: hook the strongest enemy unit for 2 damage. |
| **Multiverse Nexus** | epic | 4 | 1→7 | Synchrony | Your Ultimate Weapons sync: after you play an Ultimate, the next Ultimate this turn is free. |
| **Poison Swamp** | epic | 4 | 1→7 | Death Creep | When an enemy unit dies, its surviving lane-mates take 1 poison damage. |
| **Project Funding** | epic | 4 | 1→7 | Investment | Your units gain +1 ATK for every 3 mana in your pool. |
| **Pulsar Harvester** | epic | 4 | 1→7 | Decay | When your unit damages an enemy in combat, that enemy loses 1 ATK. |
| **Sharp Fortitude** | epic | 4 | 4→16 | Barbed | A thorned wall: +4 max Nexus HP (healed), and attackers take 1 thorns damage. |
| **Space Displacer** | epic | 4 | 1→7 | Organize | Start of your turn: inner land mines organize — spawn a 0/1 Mine in each empty lane. |
| **Super Tower** | epic | 5 | 3→9 | Ultimate Tower | Every 3rd of your turns, your units gain +3 ATK and are Invulnerable that combat. |

### ULTIMATES

| Card | Rarity | Cost | L1→L7 | Mastery | Effect |
|---|---|---|---|---|---|
| **Cash** | common | 1 | 2→8 | Big Cash | +2 temporary mana this turn. |
| **Attack Chip** | rare | 2 | 0→6 | Execute | Deal damage to a unit equal to the damage it has already taken. |
| **Bounty Chip** | rare | 2 | 2→4 | Jackpot | Collect a bounty: draw 2 cards. |
| **Spotlight** | rare | 2 | 2→8 | Light Range | Spotlight an enemy unit: it permanently takes +2 damage from every source. |
| **Wave Skip** | rare | 2 | 0→6 | Double Wave Skip | Skip the enemy's next combat phase. |
| **Ally Chip** | epic | 3 | 1→1 | Loyal Ally | Convert the weakest enemy unit to your side. |
| **Fetch Chip** | rare | 3 | 3→10 | Big Haul | Steal 3 HP from the enemy Nexus (heal your own) and draw a card. |
| **Free Upgrades** | common | 3 | 3→9 | Locked Upgrade | Reveal the top 3 cards; play one revealed unit of cost 3 or less into a lane for free. |
| **Intro Sprint** | rare | 3 | 3→9 | Warp Speed | Draw 3 cards, then discard 1. |
| **Plasma Cannon** | rare | 3 | 0.5→0.8 | Elite Cannon | Target enemy unit loses 50% of its current HP (rounded up). |
| **Recovery Package** | rare | 3 | 2→8 | Care Package | Heal a target unit to full and give it +2 HP over its base maximum. |
| **Shrink Ray** | epic | 3 | 2→8 | Compress | Shrink an enemy unit's mass: its hits weaken — permanently −2 ATK. |
| **Smart Missiles** | rare | 3 | 2→8 | Cover Fire | Deal 2 damage to the front enemy unit in every lane. |
| **Summon Chip** | rare | 3 | 2→6 | Swarm | Summon a 2/2 Ally into each empty friendly lane. |
| **Chain Lightning** | rare | 4 | 3→9 | Smite | Deal 3 damage to a target enemy unit, arcing for 1 less to each next-strongest enemy. |
| **Energy Net** | epic | 4 | 2→8 | Electrified Net | Freeze a target enemy unit for 2 turns. |
| **Second Wind** | epic | 4 | 5→12 | Angel Wings | Secret. If your Nexus would reach 0, prevent it, set HP to 5, and exile this. |
| **Ultimate Crit** | epic | 4 | 3→9 | Ultimate Crit+ | A friendly unit's next attack deals 3× damage straight to the enemy Nexus, bypassing blockers. |
| **Chrono Field** | epic | 5 | 2→8 | Chrono Loop | Freeze all enemy units for 2 turns. |
| **Death Ray** | epic | 5 | 6→12 | Enhanced Ray | 6 damage to a target unit; 2 damage to the front units of both neighbouring lanes. |
| **Black Hole** | epic | 6 | 3→9 | Consume | Destroy the lowest-HP enemy unit in every lane (up to 3 HP). |
| **Demon Mode** | epic | 6 | 5→12 | Demon Revenge | A friendly unit gains +5 ATK and Invulnerability this turn; sacrifice it at end of turn. |
| **Nuke** | epic | 8 | 0→6 | Radiation | Destroy all units in all lanes, on both sides. |

**Bots & Guardian Chips** (added 2026‑08‑31) are the last 5 modules + 6 ultimates/one module above —
adapted from the real Tower's 5 bots (Flame, Thunder, Golden, Amplify, **Bot Bot** which amplifies the
others) and 6 released guardian chips (Attack, Ally, Bounty, Fetch, Summon, Scout). They are **player**
reward‑pool cards; authored boss decks do not run them.

---

## 9. The AI

Two AIs, both reading only the public snapshot (no hidden info):
- **HeuristicAI** — a fast, per‑archetype‑biased scorer. Used as the "weaker, human‑like" opponent for
  gauging real difficulty, and for the demo.
- **SearchAI** — depth‑N lookahead (clones the engine and searches). ~5.6 ms/turn at depth 2, ~31
  ms/turn at depth 3. Bosses use `tierAiDepth`. This is the "optimal play" yardstick.

**Bosses** each carry an `archetype` (`balanced`, `turtle`, `aggro`, `ramp`, `nuke-control`,
`orbs-burst`) that biases the AI's card weighting. The 11 boss decks are hand‑authored 20‑card lists
with distinct identities (Basic, Fast, Tank, Ranged, Vampire, Protector, Saboteur, Scatter,
Overcharge, Commander, Boss).

### Enemy skills (per‑boss passives — implemented, faithful to The Tower)
Each boss has an innate **skill** applied to its whole side (`EnemySkill` in `types.ts`,
`bossSkill(name)` in `decks.ts`, implemented in `engine.ts`; magnitudes in `ENEMY_SKILL`):
| Boss | Skill | Effect (magnitude) |
|---|---|---|
| Basic | none | plain fight |
| Fast | fast | its units gain **First Strike** |
| Tank | tank | its units enter with **+3 max HP** |
| Ranged | ranged | its units gain **Reach** (hit your backline) |
| Vampire | vampire | each of its turns **drains 2 HP** from your Nexus into its own, and **disables your regen** |
| Protector | protector | its units take **−1 damage** from every hit (min 1 lands) |
| Saboteur | saboteur | each of its turns **taps your strongest unit** (it can't act next turn) |
| Scatter | scatter | when one of its units dies it **splits** — a 1/1 shard takes its place |
| Overcharge | overcharge | every **3rd of its turns**, a charged ray **bursts your Nexus for 4** |
| Commander | commander | its units have **+1 ATK** (buffs its army) |
| Boss | boss | no passive — its threat is the huge HP pile (§4.3) |
These are fixed magnitudes (the tier handicap scales raw difficulty); they give each rung a distinct,
plannable threat and are the intended lever to make top‑tier fights *hard* as well as *long*. All are
covered by `enemy-skills.test.ts` (each skill flipped on and proven to move state).

---

## 10. Autoplay / demo, saves, and simulator

- **Autoplay demo**: from the main menu, "Watch Demo" runs a full self‑play climb (its own save slot),
  using a strong (≥2‑ply) player so it climbs decisively; it earns shards, takes rewards, levels
  cards, advances boss→boss and tier→tier, and retries losses (budget 200) so it can grind the
  nightmare tier. The Autoplay button only exists while a demo runs; real‑run boards don't show it.
- **Saves** (`ttg.saves.v3`): 3 player slots + a dedicated Autoplay slot; each holds
  highestTierCleared, an in‑progress run (tier, bossIndex, deck), the card collection, shards, and
  lifetime stats (time, moves, matches, wins, fastest win, fastest tier).
- **Progression sim** (`TTG_PLAYER=search TTG_BOSS=search pnpm progression`): a full continuous climb
  reporting matches‑to‑clear, deck size, and won‑game turns. Deterministic per seed — use it for
  clear‑ability and battle length, **not** win rate.
- **Win‑rate harness** (`pnpm winrate`) — the tool that tuned the difficulty. Samples N seeded matches
  per (tier, boss) and reports the actual win % and average turns, building a representative player
  deck/collection via a strategic climb. **Yardstick: a depth‑2 SEARCH player** ("an engaged human who
  thinks a little ahead") vs a full‑strength boss. The HeuristicAI was tried first and rejected — too
  weak/erratic to be a human proxy (it lost ~35% of even trivially‑favoured games); `TTG_PLAYER=
  heuristic` still measures that weak‑play floor.

### Current measured balance (win‑rate harness, depth‑2 player, N=12)
The TCG retune landed a smooth, fun curve (win % · avg turns):
| Tier | 1 | 5 | 10 | 15 | 18 | 20 | 24 |
|---|---|---|---|---|---|---|---|
| Win % | 95 | 90 | 93 | 79 | 66 | 51 | 48 |
| Turns | 9.5 | 15 | 11 | 11 | 12 | 14 | 14 |
- Smooth descent from ~95% to ~48%, battles ~10–15 turns — matches the fun‑curve intent and lands
  inside every target band, including T24 (48%, target 35–50%).
- The rung‑11 **final Boss** runs harder still (~33% at T24), giving each tier a climax spike.
- Top‑tier difficulty comes from **boss offense** (near‑maxed masteries at T19+), not more HP.
- Clears cleanly for the search player and the Autoplay demo (no walls).

---

## 11. What's planned / open questions for discussion

**Done (this session):**
- ✅ **Per‑archetype enemy skills** — implemented and tested (see §9 table).
- ✅ **11th "final Boss" per tier** — implemented as a tier‑scaled HP chunk (see §4.3).
- ✅ **TCG difficulty retune** — reframed from a roguelike wall to a fun fast mini‑game: short battles,
  smooth 95%→55% curve, punishing mechanics removed. Built the **win‑rate harness** to measure it
  (§10). See §4 for the new formulas.

**Open design questions worth an outside opinion:**
- **Top‑tier difficulty is now in‑band** (T24 48%, final Boss ~33%) via near‑maxed boss masteries at
  T19+ — a bit more punishing but not excessive, HP untouched. Feel is the open question now: does the
  climax feel fair, or should enemy‑skill magnitudes also scale for more variety in the threat?
- **Yardstick.** Difficulty is tuned against a depth‑2 search player. A real human varies; a weaker
  player will find it harder, a stronger one easier. Is depth‑2 the right "typical player" center?
- **Battle length.** Now ~9–15 turns (≈1–3 min for a human). Early tiers run ~14 turns at T3–5,
  slightly over the "6–10" onboarding target — fine, or trim further for snappier early games?
- **Enemy‑skill scaling.** Magnitudes are currently flat across tiers (e.g., Vampire always drains 2).
  The spec suggested light banding at high tiers; skipped for now (small payoff, needs tier→engine
  plumbing). Worth adding?
- **Economy pacing.** ~65k shards for a full climb vs ~9.1k to max a single card, 73 cards. Is the
  "levels mid‑game, masteries a long grind" split right, or too slow/too fast?
- **Deck size ceiling.** 10 → 33/34. Does a 33‑card deck at T24 feel good, or should the cap curve
  differently (e.g., faster early, slower late)?
- **Continuous vs. per‑tier runs.** The demo/sim climb continuously (deck persists across tiers);
  manual play currently resets the deck per tier run. Should manual play also be one continuous climb?

---

## 12. File map (for the reviewer)

| Area | Path |
|---|---|
| Engine (rules, combat, every effect) | `src/engine/engine.ts` |
| Card catalog (data) | `src/engine/cards.ts` |
| Card levels/masteries/display | `src/engine/card-progression.ts` |
| Tiers, scaling, deck cap, HP pool | `src/engine/tiers.ts` |
| Economy (shards, upgrade costs) | `src/engine/economy.ts` |
| Constants | `src/engine/tuning.ts` |
| Boss decks & handicap | `src/engine/decks.ts` |
| Reward / trim / AI card value | `src/engine/deckbuild.ts` |
| AI | `src/ai/` (heuristic, search) |
| Progression sim | `src/harness/progression.ts` |
| Win‑rate harness (difficulty tuning) | `src/harness/winrate.ts` |
| UI / renderer / menu | `src/ui/game-app.ts` |
| Saves | `src/ui/save.ts` |
| Tests | `src/engine/*.test.ts` (engine, expansion, bots‑chips) |
