/**
 * Card levels (1-7) and masteries (0-9) — a faithful adaptation of The Tower's card system, where a
 * card levels up 7 times and, once maxed, its named MASTERY levels up a further 9 times.
 *
 * Scaling is ONE law (see the header on CARD_PROG below), not 73 hand-authored arrays: a card's value
 * is `base × G^((L-1) + M/2)` for the two geometric classes, so climbing is a smooth, predictable ramp.
 * `base` is each card's original level-1 value, so L1 play is unchanged; only the ramp above it changed.
 * The engine reads a card's value for its owner via `cardLevelValue`.
 */

export const CARD_MAX_LEVEL = 7
export const MASTERY_MAX_LEVEL = 9

/**
 * ONE scaling law for every card (see docs/GAME_STATE.md §6a). A card's value is
 *
 *     value(L, M) = base × G^((L-1) + M/2)
 *
 * where `base` is the level-1 value and `G` is the card's growth class. Levels multiply by a fixed
 * ratio, and a mastery level is worth exactly half a card level — so the whole 7×10 grid is a smooth,
 * predictable geometric ramp instead of 73 hand-authored arrays. Two magnitude classes:
 *   - `mag`   (ATK / HP / damage / heal / flat combat + coin income): G_MAG — steep, "big numbers".
 *   - `ratio` (% of ATK, crit/spawn/kill chances): G_RATIO — gentle, and CAPPED (a chance can't pass ~0.9;
 *              an ATK multiplier can't run away past +200%), because a ratio compounds with a magnitude.
 * The third class, `count`, is NOT geometric: durations, draws, marks, misses, free-casts, cost
 * reductions and mana are bounded by the RULES of the board (a 7-turn stun is broken at any scale), so
 * they keep a small explicit curve with an additive mastery. `base` is preserved at each card's old L1
 * value, so level-1 play is unchanged; only the ramp above L1 is now principled.
 */
export const G_MAG = 1.7 // magnitude growth per level (×24 by L7, ×~260 at L7+M9)
export const G_RATIO = 1.25 // ratio (%) growth per level — gentle, it compounds with a magnitude

const geo = (base: number, g: number, round: (x: number) => number): number[] =>
  Array.from({ length: CARD_MAX_LEVEL }, (_, i) => round(base * g ** i))
const rInt = (x: number): number => Math.round(x)
const r2 = (x: number): number => Math.round(x * 100) / 100

export type MasterySpecial =
  | 'fortress-walls' // Fortress: on death, leaves a 0/4 wall once (rebuilds).
  | 'coin-orb' // Extra Orbs: draw a card when it destroys an enemy unit.
  | 'viking-funeral' // Berserker: on death, deals its ATK to the enemy Tower.
  | 'elite-cannon' // Plasma Cannon: strikes a second enemy unit too.
  | 'radiation' // Nuke: also deals extra damage to the enemy Tower.
  | 'angel-wings' // Second Wind: on trigger, also heals all your units to full.

export type CardClass = 'mag' | 'ratio' | 'count'

export interface CardProg {
  /** Scaling class — see the header. `mag`/`ratio` are geometric; `count` is bounded. */
  readonly cls: CardClass
  /** Level-1 value (preserved from the card's original L1, so L1 play is unchanged). */
  readonly base: number
  /** Per-level growth ratio for `mag`/`ratio` (1 for `count`). */
  readonly g: number
  /** For `ratio`: the hard cap on the effect (a chance ≤ ~0.9; an ATK multiplier ≤ some max). */
  readonly cap?: number
  /** 7 values, index 0 = level 1. Derived geometrically for mag/ratio; explicit for count. */
  readonly levels: readonly number[]
  /** For units: which stat the level scales (the other stays at its catalog value). */
  readonly unitStat?: 'atk' | 'hp'
  readonly masteryName: string
  readonly masteryText: string
  /** `count` only — additive "+" per mastery level (mag/ratio use the geometric M/2 law instead). */
  readonly masteryBonus?: number
  /** A distinct mastery ability handled in the engine. */
  readonly masterySpecial?: MasterySpecial
}

type ProgMeta = Omit<CardProg, 'levels' | 'cls' | 'base' | 'g' | 'cap' | 'masteryBonus'>
/** Magnitude card: geometric integer ramp. */
const mag = (base: number, meta: ProgMeta): CardProg => ({ cls: 'mag', base, g: G_MAG, levels: geo(base, G_MAG, rInt), ...meta })
/** Ratio (%) card: geometric ramp, capped. */
const ratio = (base: number, cap: number, meta: ProgMeta): CardProg => ({ cls: 'ratio', base, g: G_RATIO, cap, levels: geo(base, G_RATIO, r2), ...meta })
/** Count/bounded card: an explicit small curve (game-rule bounded), additive mastery. */
const count = (levels: number[], masteryBonus: number, meta: ProgMeta): CardProg => ({ cls: 'count', base: levels[0]!, g: 1, levels, masteryBonus, ...meta })

export const CARD_PROG: Readonly<Record<string, CardProg>> = {
  // --- Units (level scales the primary stat) ---
  fortress: mag(80, { unitStat: 'hp', masteryName: 'Fortress Walls', masteryText: 'On death, a wall rebuilds in its place (once).', masterySpecial: 'fortress-walls' }),
  'extra-orbs': mag(30, { unitStat: 'atk', masteryName: 'Coin Orb', masteryText: 'Farm bonus coins (= its ATK) whenever it destroys an enemy.', masterySpecial: 'coin-orb' }),
  berserker: mag(20, { unitStat: 'atk', masteryName: 'Viking Funeral', masteryText: 'On death, deals its ATK to the enemy Tower.', masterySpecial: 'viking-funeral' }),
  'land-mine-stun': mag(10, { unitStat: 'atk', masteryName: 'Flashbang', masteryText: 'A leveled trap hits harder.' }),

  // --- Modules ---
  damage: ratio(0.2, 3, { masteryName: 'Damage+', masteryText: 'More ATK to all your units.' }),
  'attack-speed': ratio(0.15, 3, { masteryName: 'Attack Speed+', masteryText: 'Your units deal more (and gain First Strike).' }),
  health: mag(50, { masteryName: 'Health+', masteryText: 'More max Tower HP (healed on play).' }),
  'health-regen': mag(10, { masteryName: 'Health Regen+', masteryText: 'More healing each turn.' }),
  range: ratio(0.1, 3, { masteryName: 'Long Shot', masteryText: 'More ATK to your units (they gain Reach).' }),
  coins: mag(10, { masteryName: 'Interest', masteryText: 'More bonus coins on a win.' }),
  'slow-aura': count([1, 1, 2, 2, 2, 3, 3], 0, { masteryName: 'Slow Attack', masteryText: 'Control card — duration caps low by design (a long tap is a lock).' }),
  'critical-chance': ratio(0.3, 0.9, { masteryName: 'Super Crit', masteryText: 'More crit chance.' }),
  'enemy-balance': count([1, 1, 1, 2, 2, 2, 3], 0, { masteryName: 'Elite Balance', masteryText: 'Draw card — count caps low by design (extra draws each turn compound fast).' }),
  'extra-defense': mag(10, { masteryName: 'Extra Defense+', masteryText: 'Reduce more incoming Tower damage.' }),
  'critical-coin': mag(2, { masteryName: 'Double Coins', masteryText: 'More coins per critical hit.' }),
  'package-chance': mag(20, { masteryName: 'Care Package', masteryText: 'More Tower HP per Ultimate drawn.' }),
  'land-mine-chance': ratio(0.5, 0.9, { masteryName: 'Minefield', masteryText: 'More spawn chance.' }),
  'orbs-speed': mag(20, { masteryName: 'Orbs Speed+', masteryText: 'More ATK to your Extra Orbs.' }),
  'super-tower': mag(30, { masteryName: 'Ultimate Tower', masteryText: 'More ATK on its power turn.' }),
  'wave-accelerator': count([1, 1, 1, 2, 2, 2, 3], 0, { masteryName: 'Spawn Accelerator', masteryText: 'Cost card — reduction caps low by design (min cost is always 1).' }),
  'energy-shield': count([1, 1, 2, 2, 3, 3, 4], 0, { masteryName: 'Repel', masteryText: 'Control card — instance count caps low (each negates a full hit).' }),

  // --- Ultimates ---
  cash: count([2, 3, 4, 5, 6, 7, 8], 1, { masteryName: 'Big Cash', masteryText: '+1 more temporary mana per mastery.' }),
  'free-upgrades': count([3, 4, 5, 6, 7, 8, 9], 1, { masteryName: 'Locked Upgrade', masteryText: 'Reveal +1 more card per mastery.' }),
  'plasma-cannon': ratio(0.3, 0.9, { masteryName: 'Elite Cannon', masteryText: 'Also hits a second enemy unit.', masterySpecial: 'elite-cannon' }),
  'wave-skip': count([2, 3, 4, 5, 6, 7, 8], 1, { masteryName: 'Fast Forward', masteryText: '+1 more card drawn per mastery.' }),
  'intro-sprint': count([3, 4, 5, 6, 7, 8, 9], 1, { masteryName: 'Warp Speed', masteryText: 'Draw +1 more per mastery.' }),
  'recovery-package': mag(20, { masteryName: 'Care Package', masteryText: 'More overheal.' }),
  'death-ray': mag(60, { masteryName: 'Enhanced Ray', masteryText: 'More damage.' }),
  'energy-net': count([2, 2.5, 3, 3.5, 4, 4.5, 5], 0.5, { masteryName: 'Electrified Net', masteryText: '+0.5 more freeze per mastery.' }),
  'second-wind': mag(50, { masteryName: 'Angel Wings', masteryText: 'Also heals all your units to full when it triggers.', masterySpecial: 'angel-wings' }),
  'demon-mode': mag(50, { masteryName: 'Demon Revenge', masteryText: 'More ATK.' }),
  nuke: mag(10, { masteryName: 'Radiation', masteryText: 'Also deals bonus damage to the enemy Tower.', masterySpecial: 'radiation' }),
  'ultimate-crit': count([3, 4, 5, 6, 7, 8, 9], 1, { masteryName: 'Ultimate Crit+', masteryText: '+1 more damage multiplier per mastery.' }),

  // --- Ultimate Weapons (the 9 real UWs) ---
  'chain-lightning': mag(30, { masteryName: 'Smite', masteryText: 'More to every bolt.' }),
  'smart-missiles': mag(20, { masteryName: 'Cover Fire', masteryText: 'More missile damage per lane.' }),
  'death-wave': mag(10, { masteryName: 'Kill Wall', masteryText: 'More wave damage each turn.' }),
  'chrono-field': count([1.5, 1.8, 2.1, 2.4, 2.7, 3, 3.5], 0.25, { masteryName: 'Chrono Loop', masteryText: '+0.25 more freeze per mastery.' }),
  'inner-land-mines': mag(20, { masteryName: 'Charged Mines', masteryText: 'More mine damage.' }),
  'golden-tower': mag(2, { masteryName: 'Golden Combo', masteryText: 'More coins per kill.' }),
  'poison-swamp': mag(10, { masteryName: 'Death Creep', masteryText: 'More poison damage.' }),
  'black-hole': mag(30, { masteryName: 'Consume', masteryText: 'Destroys tougher units.' }),
  spotlight: mag(10, { masteryName: 'Floodlight', masteryText: 'More added to each Ultimate Weapon.' }),

  // --- Cannon modules (attack) ---
  'astral-deliverance': mag(10, { masteryName: 'Ricochet', masteryText: 'More bounce damage.' }),
  'being-annihilator': count([1, 1, 2, 2, 3, 3, 4], 0, { masteryName: 'Super Crit', masteryText: 'Control card — guaranteed-crit count caps low by design.' }),
  'death-penalty': ratio(0.15, 0.9, { masteryName: 'Doom', masteryText: 'Higher instant-kill chance.' }),
  'havoc-bringer': mag(10, { masteryName: 'Rend Max', masteryText: 'Enemy units take more damage from your attacks.' }),
  'shrink-ray': mag(20, { masteryName: 'Compress', masteryText: 'Shrink more ATK.' }),

  // --- Armor modules (defense) ---
  'anti-cube-portal': mag(10, { masteryName: 'Aftershock', masteryText: 'More shockwave damage.' }),
  'negative-mass-projector': ratio(0.1, 0.9, { masteryName: 'Heavy', masteryText: 'Remove more enemy ATK.' }),
  'sharp-fortitude': mag(40, { masteryName: 'Barbed', masteryText: 'More max Tower HP (healed).' }),
  'wormhole-redirector': mag(10, { masteryName: 'Conduit', masteryText: 'More Tower recovery each turn.' }),
  'space-displacer': mag(10, { masteryName: 'Organize', masteryText: 'More mine HP.' }),

  // --- Generator modules (utility) ---
  'black-hole-digestor': count([1, 1, 2, 2, 3, 3, 4], 0, { masteryName: 'Digest', masteryText: 'Mana card — count stays bounded (temp mana each turn per copy).' }),
  'galaxy-compressor': count([1, 1, 1, 2, 2, 2, 3], 0, { masteryName: 'Recover', masteryText: 'Cost card — reduction caps low by design (min cost is always 1).' }),
  'project-funding': ratio(0.05, 3, { masteryName: 'Investment', masteryText: 'More ATK per 3 mana in your pool.' }),
  'pulsar-harvester': ratio(0.05, 0.9, { masteryName: 'Decay', masteryText: 'Sap more enemy ATK on hit.' }),
  'singularity-harness': mag(10, { masteryName: 'Bot Boost', masteryText: 'More token ATK.' }),

  // --- Core modules (ultimate weapons) ---
  'dimension-core': mag(10, { masteryName: 'Overcharge', masteryText: 'More Ultimate damage.' }),
  'harmony-conductor': count([1, 1, 2, 2, 3, 3, 3], 0, { masteryName: 'Discord', masteryText: 'Caps at 3 — the number of enemy fronts on the board.' }),
  'magnetic-hook': mag(20, { masteryName: 'Reel', masteryText: 'More hook damage.' }),
  'multiverse-nexus': count([1, 1, 2, 2, 3, 3, 4], 0, { masteryName: 'Synchrony', masteryText: 'Combo card — free-cast count caps low by design.' }),
  'om-chip': ratio(0.1, 3, { masteryName: 'Focus', masteryText: 'More focus ATK each turn.' }),

  // --- Bots ---
  'flame-bot': mag(20, { masteryName: 'Burn Stack', masteryText: 'More burn damage.' }),
  'thunder-bot': count([1, 1, 2, 2, 2, 3, 3], 0, { masteryName: 'Linger', masteryText: 'Control card — stun duration caps low by design.' }),
  'golden-bot': mag(2, { masteryName: 'Gold Rush', masteryText: 'More coins each turn.' }),
  'amplify-bot': ratio(0.1, 3, { masteryName: 'Overdrive', masteryText: 'More ATK to all your units.' }),
  'bot-bot': ratio(0.15, 3, { masteryName: 'Maximum Power', masteryText: 'More ATK to your units (doubles your other Bots).' }),

  // --- Guardian chips ---
  'guardian-ally': mag(10, { masteryName: 'Loyal Ally', masteryText: 'The converted unit gains more +ATK/+HP.' }),
  'guardian-attack': mag(10, { masteryName: 'Execute', masteryText: 'More bonus damage.' }),
  'guardian-bounty': count([2, 2, 3, 3, 4, 4, 5], 1, { masteryName: 'Jackpot', masteryText: '+1 card drawn per mastery.' }),
  'guardian-fetch': mag(30, { masteryName: 'Big Haul', masteryText: 'More HP stolen.' }),
  'guardian-summon': mag(20, { masteryName: 'Swarm', masteryText: 'Bigger Ally tokens.' }),
  'guardian-scout': ratio(0.1, 0.9, { masteryName: 'Recon', masteryText: 'Remove more enemy ATK.' }),
}

/** How a card's numeric value is shown, and what the number MEANS (so the UI reads like the game). */
export type ValueFmt = 'flat' | 'plus' | 'percent'
export interface CardDisplay {
  readonly fmt: ValueFmt
  /** Noun phrase describing the level number, e.g. "ATK to friendly units". */
  readonly label: string
}

export const CARD_DISPLAY: Readonly<Record<string, CardDisplay>> = {
  fortress: { fmt: 'flat', label: 'HP · Defender wall, deals no damage' },
  'extra-orbs': { fmt: 'flat', label: 'ATK · First Strike, spillover' },
  berserker: { fmt: 'flat', label: 'ATK · gains ATK when it survives a hit' },
  'land-mine-stun': { fmt: 'flat', label: 'ATK · Trap: freezes an entering enemy 1 turn' },
  damage: { fmt: 'percent', label: 'more ATK for all your units' },
  'attack-speed': { fmt: 'percent', label: 'more ATK for your units (grants First Strike)' },
  health: { fmt: 'plus', label: 'max Tower HP (healed on play)' },
  'health-regen': { fmt: 'plus', label: 'HP healed to Tower & units each turn' },
  range: { fmt: 'percent', label: 'more unit ATK (grants Reach)' },
  coins: { fmt: 'flat', label: 'bonus coins on a win (per copy in play)' },
  'slow-aura': { fmt: 'flat', label: 'turns enemy units enter tapped' },
  'critical-chance': { fmt: 'percent', label: 'chance on hit to deal 2× damage' },
  'enemy-balance': { fmt: 'flat', label: 'cards drawn each turn (enemy units +1 ATK)' },
  'extra-defense': { fmt: 'plus', label: 'incoming Tower damage reduced (min 1)' },
  'critical-coin': { fmt: 'flat', label: 'coins farmed per critical hit (banked on a win)' },
  'package-chance': { fmt: 'plus', label: 'Tower HP when you draw an Ultimate' },
  'land-mine-chance': { fmt: 'percent', label: 'chance to spawn a mine each turn' },
  'orbs-speed': { fmt: 'plus', label: 'ATK to your Extra Orbs' },
  'super-tower': { fmt: 'plus', label: 'ATK to your units every 3rd turn (invulnerable)' },
  'wave-accelerator': { fmt: 'plus', label: 'less mana for your Ultimates (min 1)' },
  'energy-shield': { fmt: 'flat', label: 'instances of Tower damage absorbed' },
  cash: { fmt: 'plus', label: 'temporary mana this turn' },
  'free-upgrades': { fmt: 'flat', label: 'cards revealed (play a free unit ≤3)' },
  'plasma-cannon': { fmt: 'percent', label: "of the target's current HP removed" },
  'wave-skip': { fmt: 'flat', label: 'cards drawn' },
  'intro-sprint': { fmt: 'flat', label: 'cards drawn (then discard 1)' },
  'recovery-package': { fmt: 'plus', label: 'HP over max (heals target to full)' },
  'death-ray': { fmt: 'flat', label: 'damage to a unit (+ splash to neighbours)' },
  'energy-net': { fmt: 'flat', label: 'turns an enemy unit is frozen' },
  'second-wind': { fmt: 'flat', label: 'HP revived to if your Tower would die' },
  'demon-mode': { fmt: 'plus', label: 'ATK this turn (unit is sacrificed after)' },
  nuke: { fmt: 'flat', label: 'bonus Tower damage (destroys all units)' },
  'ultimate-crit': { fmt: 'flat', label: '× damage straight to the Tower (bypasses blockers)' },
  // Ultimate Weapons
  'chain-lightning': { fmt: 'flat', label: 'damage to a target, arcing to each next enemy' },
  'smart-missiles': { fmt: 'flat', label: "damage to each lane's front enemy" },
  'death-wave': { fmt: 'flat', label: 'damage to every enemy unit each turn' },
  'chrono-field': { fmt: 'flat', label: 'turns all enemy units are frozen' },
  'inner-land-mines': { fmt: 'flat', label: 'damage to each enemy unit as it enters a lane' },
  'golden-tower': { fmt: 'flat', label: 'coins farmed per enemy killed (banked on a win)' },
  'poison-swamp': { fmt: 'flat', label: "damage to a dying enemy's lane-mates" },
  'black-hole': { fmt: 'flat', label: 'max HP of the enemy destroyed in each lane' },
  spotlight: { fmt: 'plus', label: "added to each of your Ultimate Weapons' effect" },
  // Cannon modules
  'astral-deliverance': { fmt: 'flat', label: 'bounce damage to the enemy behind your target' },
  'being-annihilator': { fmt: 'flat', label: 'guaranteed crits (2× damage) each turn' },
  'death-penalty': { fmt: 'percent', label: 'chance an entering enemy is Marked (first hit destroys it)' },
  'havoc-bringer': { fmt: 'plus', label: 'damage enemy units take from your attacks' },
  'shrink-ray': { fmt: 'flat', label: 'ATK shrunk off an enemy unit (permanent)' },
  // Armor modules
  'anti-cube-portal': { fmt: 'flat', label: "shockwave damage to neighboring lanes' enemy fronts" },
  'negative-mass-projector': { fmt: 'percent', label: 'ATK removed from all enemy units' },
  'sharp-fortitude': { fmt: 'plus', label: 'max Tower HP (healed); attackers take thorns' },
  'wormhole-redirector': { fmt: 'flat', label: 'Tower HP recovered at the start of each turn' },
  'space-displacer': { fmt: 'flat', label: 'HP of a Mine spawned in each empty lane each turn' },
  // Generator modules
  'black-hole-digestor': { fmt: 'flat', label: 'temporary mana each turn per copy' },
  'galaxy-compressor': { fmt: 'flat', label: 'less Ultimate cost on turns you heal your Tower' },
  'project-funding': { fmt: 'percent', label: 'more unit ATK per 3 mana in your pool' },
  'pulsar-harvester': { fmt: 'percent', label: 'ATK sapped from an enemy your unit damages' },
  'singularity-harness': { fmt: 'plus', label: 'ATK to your Mine & Wall tokens (your "bots")' },
  // Core modules
  'dimension-core': { fmt: 'plus', label: 'damage to your damage-dealing Ultimates' },
  'harmony-conductor': { fmt: 'flat', label: 'enemy front units that miss their attack each turn' },
  'magnetic-hook': { fmt: 'flat', label: 'damage to the strongest enemy unit each turn' },
  'multiverse-nexus': { fmt: 'flat', label: 'synced free Ultimate(s) after you play one (they fire together)' },
  'om-chip': { fmt: 'percent', label: 'more ATK for your strongest unit each turn' },
  // Bots
  'flame-bot': { fmt: 'flat', label: 'burn damage to all enemy units each turn (they get −1 ATK)' },
  'thunder-bot': { fmt: 'flat', label: 'turns the strongest enemy unit is stunned each turn' },
  'golden-bot': { fmt: 'flat', label: 'coins farmed each turn (banked on a win)' },
  'amplify-bot': { fmt: 'percent', label: 'more ATK for all your units' },
  'bot-bot': { fmt: 'percent', label: 'more ATK for your units (doubles your other Bots)' },
  // Guardian chips
  'guardian-ally': { fmt: 'plus', label: 'ATK/HP on the converted weakest enemy unit' },
  'guardian-attack': { fmt: 'plus', label: "damage on top of the target's missing HP" },
  'guardian-bounty': { fmt: 'flat', label: 'cards drawn' },
  'guardian-fetch': { fmt: 'flat', label: 'HP stolen from the enemy Tower (then draw 1)' },
  'guardian-summon': { fmt: 'flat', label: 'ATK/HP of an Ally summoned in each empty lane' },
  'guardian-scout': { fmt: 'percent', label: 'ATK removed from all enemy units' },
}

/** Format a card value for display per its fmt: percent (50%), additive (+2), or plain (5). */
export function formatCardValue(cardId: string, v: number): string {
  const fmt = CARD_DISPLAY[cardId]?.fmt ?? 'flat'
  if (fmt === 'percent') return `${Math.round(v * 100)}%`
  if (fmt === 'plus') return `+${v}`
  return `${v}`
}

export function cardEffectLabel(cardId: string): string {
  return CARD_DISPLAY[cardId]?.label ?? ''
}

export function clampLevel(level: number): number {
  return Math.max(1, Math.min(CARD_MAX_LEVEL, Math.floor(level) || 1))
}

/** Mastery level 0-9 (0 = not yet unlocked). */
export function clampMastery(mastery: number): number {
  return Math.max(0, Math.min(MASTERY_MAX_LEVEL, Math.floor(mastery) || 0))
}

/**
 * The card's numeric value at (level, mastery). ONE law:
 *   mag / ratio: base × G^((L-1) + M/2)   (ratio is capped)
 *   count:       levels[L-1] + masteryBonus × M   (bounded — durations/counts/mana)
 */
export function cardLevelValue(cardId: string, level: number, masteryLevel: number): number {
  const prog = CARD_PROG[cardId]
  if (!prog) return 0
  const L = clampLevel(level)
  const M = clampMastery(masteryLevel)
  if (prog.cls === 'count') {
    return (prog.levels[L - 1] ?? prog.levels[0] ?? 0) + (prog.masteryBonus ?? 0) * M
  }
  const raw = prog.base * prog.g ** (L - 1 + M / 2)
  if (prog.cls === 'ratio') return Math.min(prog.cap ?? Infinity, r2(raw))
  return Math.round(raw)
}

/** The distinct mastery ability id for a card, if it has one and its mastery is unlocked (level ≥ 1). */
export function cardMasterySpecial(cardId: string, masteryLevel: number): MasterySpecial | undefined {
  return clampMastery(masteryLevel) >= 1 ? CARD_PROG[cardId]?.masterySpecial : undefined
}

/** For a unit card, which stat its level scales (undefined for non-units / unlevelled). */
export function cardUnitStat(cardId: string): 'atk' | 'hp' | undefined {
  return CARD_PROG[cardId]?.unitStat
}
