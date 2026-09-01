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

### 4.1 Shared HP pool — battle length (`tierBaseLife`)
```
baseLifeRaw(t) = round((t-1)*0.8) + round(max(0, t-16)*1.3)
tierBaseLife(t) = baseLifeRaw(t) * COMBAT_SCALE        // added to BOTH Towers
```
Base Tower HP is `START_LIFE = 200` (20 × scale). Kept deliberately **small** so battles stay snappy:
`200 + tierBaseLife` = 200 (T1), 290 (T12), 480 (T24). Battles still run long enough to reach
**fatigue** at the top, where the climbed‑up bigger deck pays off.

### 4.2 AI search depth (`tierAiDepth`) — the dominant difficulty lever vs a human
```
t ≤ 6   → 1‑ply   (simple "intro" AI — easy onboarding)
7..11   → 2‑ply   (anti‑cheese lookahead)
t ≥ 12  → 3‑ply   (reads two of your turns ahead)
```
A searching enemy out‑plays a human regardless of HP, so **depth is what actually shapes the curve** —
kept low for the easy tiers, stepping up only for the mid and top.

### 4.3 Enemy life edge (`tierBossHandicap(tier, index)`) — smooth, gentle, no walls
Added to the enemy **on top of** the shared pool. `index` is the rung, 1..11. `bonusLife` is `×scale`.
```
climb     = round((tier-6)*3.2 + max(0, tier-14)*4.0)   // across-tier difficulty: PRIMARY lever
                                                        //   NEGATIVE early (T1 -16 → frail enemies),
                                                        //   crosses ~T6, accelerates late
bossRamp  = round((index-1) * (0.4 + tier*0.12))        // later rungs of a tier a touch harder
finalBoss = index>=11 ? round(baseLifeRaw(t)*0.8) + round(t*0.6) : 0   // the "Boss" HP chunk
bonusLife      = (climb + bossRamp + finalBoss) * COMBAT_SCALE
bonusStartMana = tier >= 23 ? 1 : 0
```
The old `brutal`/`nightmare`/`capstone` spikes were **removed** — that is the whole point of the TCG
retune. Worked examples (enemy HP = 200 + tierBaseLife + bonusLife):

| Tier | rung‑1 enemy HP | rung‑11 Boss HP |
|---|---|---|
| 1 | 40 | 100 |
| 6 | 240 | 420 |
| 12 | 480 | 800 |
| 18 | 910 | 1420 |
| 24 | 1460 | 2150 |

The **final Boss (rung 11)** carries a distinct HP chunk (`finalBoss`) as the tier's climax — a real
fight, not a passive‑skill wall. `climb` was made steeper this build to compensate for the buffed
player cards.

### 4.4 Player "battle conditions" nerf — REMOVED
```
tierPlayerLifePenalty(t) = 0     // was max(0,t-13)*5; a shrinking life bar is exactly the "punishing"
                                 // feel the TCG direction rejects. Difficulty now comes from the
                                 // enemy's gentle handicap + maxed cards, not gimping you.
```

### 4.5 Enemy card levels (`bossLevels`, mirrors the game's `aiCardLevels`)
```
level   = min(7, 1 + floor((tier-1)/3))          // rises every 3 tiers → 7 by T19
mastery = tier >= 13 ? min(9, tier-12) : 0        // T13 +1 … T21+ maxed (9)
```
Enemy offense is a top‑tier difficulty lever: masteries come online at T13 and, at the top tiers
(19+), climb to near‑maxed so the enemy out‑cards you at the climax through stronger cards rather than
more life.

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

**Card upgrade values** (`card-progression.ts`): every card has a 7‑entry `levels` array (its stat at
L1..L7) and a **mastery** (0..9) that either adds `masteryBonus` per level or unlocks a named
`masterySpecial` ability. `cardLevelValue = (levels[level-1] + mastery*masteryBonus) × (scale if
combat)`.

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

Format: **Name** (unit stats) · rarity · mana cost · L1→L7 (the levelled value, as displayed) · mastery
name · effect. Numbers are the real in‑engine values from `card-progression.ts` (combat values ×10).
The four **% army buffs** (Damage, Attack Speed, Amplify Bot, Bot Bot) add a percentage of each unit's
own ATK, so they scale your attackers gradually and leave 0‑ATK walls as walls.

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
| **Range** | common | 1 | +10→+70 ATK | Long Shot | Your units gain Reach and +ATK. |
| **Health** | common | 2 | +50→+180 HP | Health+ | +max Tower HP immediately (and heal that much). |
| **Health Regen** | common | 2 | +10→+70 HP | Health Regen+ | Start of turn: heal your Tower and all units. |
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
| **Scout Chip** | rare | 2 | 10→70 | Recon | All enemy units have −ATK. |
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
| **Negative Mass Projector** | epic | 3 | 10→70 | Heavy | −ATK from all enemy units. |
| **Sharp Fortitude** | epic | 4 | +40→+160 HP | Barbed | +max Tower HP (healed); attackers take thorns. |
| **Wormhole Redirector** | epic | 3 | 10→70 | Conduit | Tower HP recovered at the start of each turn. |
| **Space Displacer** | epic | 4 | 10→70 | Organize | HP of a Mine spawned in each empty lane each turn. |
| **Black Hole Digestor** | epic | 3 | 1→7 | Digest | +temp mana each turn (× copies, NOT × module count). |
| **Galaxy Compressor** | epic | 3 | 1→3 | Recover | Less Ultimate cost on turns you heal your Tower. Reduction capped. |
| **Project Funding** | epic | 4 | 5%→22% | Investment | +% of unit ATK per 3 mana in your pool (was flat; now a % army buff). |
| **Pulsar Harvester** | epic | 4 | 10→70 | Decay | −ATK from an enemy your unit damages. |
| **Singularity Harness** | epic | 3 | +10→+70 ATK | Bot Boost | +ATK to your Mine & Wall tokens. |
| **Dimension Core** | epic | 4 | +10→+70 | Overcharge | +damage to your damage‑dealing Ultimates. |
| **Harmony Conductor** | epic | 4 | 1→3 | Discord | N enemy fronts miss their attack each turn (caps at 3 = the board). |
| **Magnetic Hook** | epic | 4 | 20→80 | Reel | Damage to the strongest enemy unit each turn. |
| **Multiverse Nexus** | epic | 4 | 1→4 | Synchrony | After you play an Ultimate, sync N free ones (fire together). Count capped. |
| **Om Chip** | epic | 3 | +10→+70 ATK | Focus | Start of turn: your strongest unit gains +ATK. |
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

Latest curve (N=12, depth‑2 player): T1‑5 ~89‑98% → T6‑12 mostly ~90‑95% (with a T7‑8 dip to ~63‑65%,
where Saboteur/Scatter bite the now‑gentler player buffs) → T13‑18 ~67‑87% → T19‑24 ~56‑67%. The top
is intentionally a few points easier than the pillar‑3 spec (the harness player is stronger than a real
human, so real win rates sit lower; fun > punishing).

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
