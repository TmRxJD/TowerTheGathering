/**
 * Card levels (1-7) and masteries (0-9) — a faithful adaptation of The Tower's card system, where a
 * card levels up 7 times and, once maxed, its named MASTERY levels up a further 9 times. Collecting
 * a card levels its main number; reaching max level unlocks the mastery, then each mastery level
 * adds more (a scaling secondary ability).
 *
 * Backward-compatible by design: `levels[0]` (level 1) equals the card's original value, so an
 * un-levelled deck plays exactly as before and existing balance/tests are unaffected — leveling is
 * pure upside. The engine reads a card's value for its owner via `cardLevelValue`.
 *
 * A mastery is either a generic stat boost (`masteryBonus` added PER mastery level to the level value
 * — the real game's common "+", e.g. Damage+) or a distinct ability (`masterySpecial`, handled in the
 * engine, active once mastery level ≥ 1).
 */

import { COMBAT_SCALE } from './tuning'

export const CARD_MAX_LEVEL = 7
export const MASTERY_MAX_LEVEL = 9

/**
 * Cards whose level value is a COMBAT quantity (HP / ATK / damage / thorns / ATK-reduction). Their
 * value is scaled ×COMBAT_SCALE centrally in cardLevelValue, matching the ×10 unit/tower stats. Cards
 * NOT listed here keep their raw value: currency (coins), resource clock (mana/draw/reveal counts),
 * durations (freeze/tap turns), and ratios (%s, multipliers, chances). The army-wide ATK buffs
 * damage/attack-speed/amplify-bot/bot-bot are % buffs (a fraction of each unit's own ATK, applied in
 * unitAtk) — deliberately NOT here, so their level value stays a raw fraction rather than a flat ×10.
 */
export const COMBAT_CARDS: ReadonlySet<string> = new Set([
  // units
  'fortress', 'extra-orbs', 'berserker', 'land-mine-stun',
  // flat ATK buffs / army (the % army buffs — damage/attack-speed/amplify-bot/bot-bot — are excluded)
  'range', 'om-chip', 'super-tower', 'orbs-speed',
  'singularity-harness', 'project-funding', 'guardian-ally',
  // HP / heal / defense
  'health', 'health-regen', 'sharp-fortitude', 'wormhole-redirector', 'recovery-package', 'package-chance',
  'space-displacer', 'second-wind', 'extra-defense',
  // damage dealers
  'death-ray', 'nuke', 'chain-lightning', 'smart-missiles', 'death-wave', 'inner-land-mines', 'poison-swamp',
  'black-hole', 'magnetic-hook', 'demon-mode', 'astral-deliverance', 'anti-cube-portal', 'havoc-bringer',
  'dimension-core', 'flame-bot', 'guardian-attack', 'guardian-summon', 'guardian-fetch', 'spotlight',
  // ATK reduction
  'shrink-ray', 'negative-mass-projector', 'pulsar-harvester', 'guardian-scout',
])

export type MasterySpecial =
  | 'fortress-walls' // Fortress: on death, leaves a 0/4 wall once (rebuilds).
  | 'coin-orb' // Extra Orbs: draw a card when it destroys an enemy unit.
  | 'viking-funeral' // Berserker: on death, deals its ATK to the enemy Tower.
  | 'elite-cannon' // Plasma Cannon: strikes a second enemy unit too.
  | 'radiation' // Nuke: also deals extra damage to the enemy Tower.
  | 'angel-wings' // Second Wind: on trigger, also heals all your units to full.

export interface CardProg {
  /** 7 values, index 0 = level 1 = the card's original value. */
  readonly levels: readonly number[]
  /** For units: which stat the level scales (the other stays at its catalog value). */
  readonly unitStat?: 'atk' | 'hp'
  readonly masteryName: string
  readonly masteryText: string
  /** Generic "+": added to the level value once mastery is unlocked. */
  readonly masteryBonus?: number
  /** A distinct mastery ability handled in the engine. */
  readonly masterySpecial?: MasterySpecial
}

export const CARD_PROG: Readonly<Record<string, CardProg>> = {
  // --- Units (level scales the primary stat) ---
  fortress: { levels: [8, 10, 12, 14, 16, 18, 20], unitStat: 'hp', masteryName: 'Fortress Walls', masteryText: 'On death, a 0/4 wall rebuilds in its place (once).', masterySpecial: 'fortress-walls' },
  'extra-orbs': { levels: [3, 4, 5, 6, 7, 8, 9], unitStat: 'atk', masteryName: 'Coin Orb', masteryText: 'Farm bonus coins (= its ATK) whenever it destroys an enemy.', masterySpecial: 'coin-orb' },
  berserker: { levels: [2, 3, 4, 5, 6, 7, 8], unitStat: 'atk', masteryName: 'Viking Funeral', masteryText: 'On death, deals its ATK to the enemy Tower.', masterySpecial: 'viking-funeral' },
  'land-mine-stun': { levels: [1, 2, 3, 4, 5, 6, 7], unitStat: 'atk', masteryName: 'Flashbang', masteryText: '+1 ATK per level.', masteryBonus: 1 },

  // --- Modules ---
  damage: { levels: [0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9], masteryName: 'Damage+', masteryText: '+5% ATK to friendly units, per level.', masteryBonus: 0.05 },
  'attack-speed': { levels: [0.15, 0.25, 0.35, 0.45, 0.55, 0.7, 0.85], masteryName: 'Attack Speed+', masteryText: 'Your units deal +5% more, per level.', masteryBonus: 0.05 },
  health: { levels: [5, 7, 9, 11, 13, 15, 18], masteryName: 'Health+', masteryText: '+2 more max Tower HP per level.', masteryBonus: 2 },
  'health-regen': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Health Regen+', masteryText: '+1 more healing each turn, per level.', masteryBonus: 1 },
  range: { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Long Shot', masteryText: 'Reaching units deal +1 more, per level.', masteryBonus: 1 },
  coins: { levels: [10, 15, 20, 25, 30, 40, 50], masteryName: 'Interest', masteryText: '+10 more bonus coins per level.', masteryBonus: 10 },
  'slow-aura': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Slow Attack', masteryText: 'Enemies enter tapped +1 more turn, per level.', masteryBonus: 1 },
  'critical-chance': { levels: [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6], masteryName: 'Super Crit', masteryText: '+5% more crit chance per level.', masteryBonus: 0.05 },
  'enemy-balance': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Elite Balance', masteryText: 'Draw +1 more each turn, per level.', masteryBonus: 1 },
  'extra-defense': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Extra Defense+', masteryText: 'Reduce incoming Tower damage +1 more, per level.', masteryBonus: 1 },
  'critical-coin': { levels: [2, 3, 4, 5, 6, 8, 10], masteryName: 'Double Coins', masteryText: '+2 more coins per crit, per level.', masteryBonus: 2 },
  'package-chance': { levels: [2, 3, 4, 5, 6, 7, 8], masteryName: 'Care Package', masteryText: '+1 more Tower HP per Ultimate drawn, per level.', masteryBonus: 1 },
  'land-mine-chance': { levels: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8], masteryName: 'Minefield', masteryText: '+5% more spawn chance per level.', masteryBonus: 0.05 },
  'orbs-speed': { levels: [2, 3, 4, 5, 6, 7, 8], masteryName: 'Orbs Speed+', masteryText: '+1 more ATK to Extra Orbs, per level.', masteryBonus: 1 },
  'super-tower': { levels: [3, 4, 5, 6, 7, 8, 9], masteryName: 'Ultimate Tower', masteryText: '+1 more ATK on its power turn, per level.', masteryBonus: 1 },
  'wave-accelerator': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Spawn Accelerator', masteryText: 'Ultimates cost 1 more less, per level.', masteryBonus: 1 },
  'energy-shield': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Repel', masteryText: 'Absorbs 1 more instance per level.', masteryBonus: 1 },

  // --- Ultimates ---
  cash: { levels: [2, 3, 4, 5, 6, 7, 8], masteryName: 'Big Cash', masteryText: '+1 more temporary mana, per level.', masteryBonus: 1 },
  'free-upgrades': { levels: [3, 4, 5, 6, 7, 8, 9], masteryName: 'Locked Upgrade', masteryText: 'Reveal +1 more card, per level.', masteryBonus: 1 },
  'plasma-cannon': { levels: [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6], masteryName: 'Elite Cannon', masteryText: 'Also hits a second enemy unit.', masterySpecial: 'elite-cannon' },
  'wave-skip': { levels: [2, 3, 4, 5, 6, 7, 8], masteryName: 'Fast Forward', masteryText: '+1 more card drawn, per level.', masteryBonus: 1 },
  'intro-sprint': { levels: [3, 4, 5, 6, 7, 8, 9], masteryName: 'Warp Speed', masteryText: 'Draw +1 more, per level.', masteryBonus: 1 },
  'recovery-package': { levels: [2, 3, 4, 5, 6, 7, 8], masteryName: 'Care Package', masteryText: '+1 more overheal, per level.', masteryBonus: 1 },
  'death-ray': { levels: [6, 7, 8, 9, 10, 11, 12], masteryName: 'Enhanced Ray', masteryText: '+1 more damage per level.', masteryBonus: 1 },
  'energy-net': { levels: [2, 2.5, 3, 3.5, 4, 4.5, 5], masteryName: 'Electrified Net', masteryText: '+0.5 more freeze per level.', masteryBonus: 0.5 },
  'second-wind': { levels: [5, 6, 7, 8, 9, 10, 12], masteryName: 'Angel Wings', masteryText: 'Also heals all your units to full when it triggers.', masterySpecial: 'angel-wings' },
  'demon-mode': { levels: [5, 6, 7, 8, 9, 10, 12], masteryName: 'Demon Revenge', masteryText: '+1 more ATK per level.', masteryBonus: 1 },
  nuke: { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Radiation', masteryText: 'Also deals 6 damage to the enemy Tower.', masterySpecial: 'radiation' },
  'ultimate-crit': { levels: [3, 4, 5, 6, 7, 8, 9], masteryName: 'Ultimate Crit+', masteryText: '+1 more damage multiplier per level.', masteryBonus: 1 },

  // --- Ultimate Weapons (the 9 real UWs) ---
  'chain-lightning': { levels: [3, 4, 5, 6, 7, 8, 9], masteryName: 'Smite', masteryText: '+1 to every bolt per level.', masteryBonus: 1 },
  'smart-missiles': { levels: [2, 3, 4, 5, 6, 7, 8], masteryName: 'Cover Fire', masteryText: '+1 missile damage per lane, per level.', masteryBonus: 1 },
  'death-wave': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Kill Wall', masteryText: '+1 wave damage each turn, per level.', masteryBonus: 1 },
  'chrono-field': { levels: [1.5, 1.8, 2.1, 2.4, 2.7, 3, 3.5], masteryName: 'Chrono Loop', masteryText: '+0.25 more freeze per level.', masteryBonus: 0.25 },
  'inner-land-mines': { levels: [2, 3, 4, 5, 6, 7, 8], masteryName: 'Charged Mines', masteryText: '+1 mine damage per level.', masteryBonus: 1 },
  'golden-tower': { levels: [2, 3, 4, 5, 6, 8, 10], masteryName: 'Golden Combo', masteryText: '+2 more coins per kill, per level.', masteryBonus: 2 },
  'poison-swamp': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Death Creep', masteryText: '+1 poison damage per level.', masteryBonus: 1 },
  'black-hole': { levels: [3, 4, 5, 6, 7, 8, 9], masteryName: 'Consume', masteryText: 'Destroys units +1 HP tougher per level.', masteryBonus: 1 },
  spotlight: { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Floodlight', masteryText: '+1 more to each Ultimate Weapon, per level.', masteryBonus: 1 },

  // --- Cannon modules (attack) ---
  'astral-deliverance': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Ricochet', masteryText: '+1 bounce damage per level.', masteryBonus: 1 },
  'being-annihilator': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Super Crit', masteryText: '+1 guaranteed crit per level.', masteryBonus: 1 },
  'death-penalty': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Doom', masteryText: '+1 enemy marked per turn, per level.', masteryBonus: 1 },
  'havoc-bringer': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Rend Max', masteryText: '+1 damage enemies take, per level.', masteryBonus: 1 },
  'shrink-ray': { levels: [2, 3, 4, 5, 6, 7, 8], masteryName: 'Compress', masteryText: '−1 more enemy ATK per level.', masteryBonus: 1 },

  // --- Armor modules (defense) ---
  'anti-cube-portal': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Aftershock', masteryText: '+1 shockwave damage per level.', masteryBonus: 1 },
  'negative-mass-projector': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Heavy', masteryText: '−1 more enemy ATK per level.', masteryBonus: 1 },
  'sharp-fortitude': { levels: [4, 6, 8, 10, 12, 14, 16], masteryName: 'Barbed', masteryText: '+1 max Tower HP per level.', masteryBonus: 1 },
  'wormhole-redirector': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Conduit', masteryText: '+1 Tower recovery each turn, per level.', masteryBonus: 1 },
  'space-displacer': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Organize', masteryText: '+1 mine HP per level.', masteryBonus: 1 },

  // --- Generator modules (utility) ---
  'black-hole-digestor': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Digest', masteryText: '+1 mana per module, per level.', masteryBonus: 1 },
  'galaxy-compressor': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Recover', masteryText: '−1 more Ultimate cost after healing, per level.', masteryBonus: 1 },
  'project-funding': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Investment', masteryText: '+1 ATK per 3 mana, per level.', masteryBonus: 1 },
  'pulsar-harvester': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Decay', masteryText: '−1 more enemy ATK on hit per level.', masteryBonus: 1 },
  'singularity-harness': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Bot Boost', masteryText: '+1 more token ATK per level.', masteryBonus: 1 },

  // --- Core modules (ultimate weapons) ---
  'dimension-core': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Overcharge', masteryText: '+1 Ultimate damage per level.', masteryBonus: 1 },
  'harmony-conductor': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Discord', masteryText: '+1 enemy misses per level.', masteryBonus: 1 },
  'magnetic-hook': { levels: [2, 3, 4, 5, 6, 7, 8], masteryName: 'Reel', masteryText: '+1 hook damage per level.', masteryBonus: 1 },
  'multiverse-nexus': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Synchrony', masteryText: '+1 synced free Ultimate per level.', masteryBonus: 1 },
  'om-chip': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Focus', masteryText: '+1 focus ATK per level.', masteryBonus: 1 },

  // --- Bots ---
  'flame-bot': { levels: [2, 3, 4, 5, 6, 7, 8], masteryName: 'Burn Stack', masteryText: '+1 burn damage per level.', masteryBonus: 1 },
  'thunder-bot': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Linger', masteryText: '+1 stun turn per level.', masteryBonus: 1 },
  'golden-bot': { levels: [2, 3, 4, 5, 6, 8, 10], masteryName: 'Gold Rush', masteryText: '+2 more coins per level.', masteryBonus: 2 },
  'amplify-bot': { levels: [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5], masteryName: 'Overdrive', masteryText: '+5% ATK per level.', masteryBonus: 0.05 },
  'bot-bot': { levels: [0.15, 0.2, 0.25, 0.3, 0.35, 0.45, 0.55], masteryName: 'Maximum Power', masteryText: '+5% ATK per level.', masteryBonus: 0.05 },

  // --- Guardian chips ---
  'guardian-ally': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Loyal Ally', masteryText: 'The converted unit gains +1/+1 more per level.', masteryBonus: 1 },
  'guardian-attack': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Execute', masteryText: '+1 bonus damage per level.', masteryBonus: 1 },
  'guardian-bounty': { levels: [2, 3, 4, 5, 6, 7, 8], masteryName: 'Jackpot', masteryText: '+1 card drawn per level.', masteryBonus: 1 },
  'guardian-fetch': { levels: [3, 4, 5, 6, 7, 8, 10], masteryName: 'Big Haul', masteryText: '+1 HP stolen per level.', masteryBonus: 1 },
  'guardian-summon': { levels: [2, 3, 4, 5, 6, 7, 8], masteryName: 'Swarm', masteryText: '+1 token ATK/HP per level.', masteryBonus: 1 },
  'guardian-scout': { levels: [1, 2, 3, 4, 5, 6, 7], masteryName: 'Recon', masteryText: '−1 more enemy ATK per level.', masteryBonus: 1 },
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
  berserker: { fmt: 'flat', label: 'ATK · gains +1 ATK when it survives a hit' },
  'land-mine-stun': { fmt: 'flat', label: 'ATK · Trap: freezes an entering enemy 1 turn' },
  damage: { fmt: 'percent', label: 'more ATK for all your units' },
  'attack-speed': { fmt: 'percent', label: 'more ATK for your units (grants First Strike)' },
  health: { fmt: 'plus', label: 'max Tower HP (healed on play)' },
  'health-regen': { fmt: 'plus', label: 'HP healed to Tower & units each turn' },
  range: { fmt: 'plus', label: 'ATK to units (grants Reach)' },
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
  'death-ray': { fmt: 'flat', label: 'damage to a unit (+2 to neighbours)' },
  'energy-net': { fmt: 'flat', label: 'turns an enemy unit is frozen' },
  'second-wind': { fmt: 'flat', label: 'HP revived to if your Tower would die' },
  'demon-mode': { fmt: 'plus', label: 'ATK this turn (unit is sacrificed after)' },
  nuke: { fmt: 'flat', label: 'bonus Tower damage (destroys all units)' },
  'ultimate-crit': { fmt: 'flat', label: '× damage straight to the Tower (bypasses blockers)' },
  // Ultimate Weapons
  'chain-lightning': { fmt: 'flat', label: 'damage to a target, arcing −1 to each next enemy' },
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
  'death-penalty': { fmt: 'flat', label: 'entering enemies Marked (first hit destroys them)' },
  'havoc-bringer': { fmt: 'plus', label: 'damage enemy units take from your attacks' },
  'shrink-ray': { fmt: 'flat', label: 'ATK shrunk off an enemy unit (permanent)' },
  // Armor modules
  'anti-cube-portal': { fmt: 'flat', label: "shockwave damage to neighboring lanes' enemy fronts" },
  'negative-mass-projector': { fmt: 'flat', label: 'ATK removed from all enemy units' },
  'sharp-fortitude': { fmt: 'plus', label: 'max Tower HP (healed); attackers take 1 thorns' },
  'wormhole-redirector': { fmt: 'flat', label: 'Tower HP recovered at the start of each turn' },
  'space-displacer': { fmt: 'flat', label: 'HP of a Mine spawned in each empty lane each turn' },
  // Generator modules
  'black-hole-digestor': { fmt: 'flat', label: 'temporary mana each turn per Module you control' },
  'galaxy-compressor': { fmt: 'flat', label: 'less Ultimate cost on turns you heal your Tower' },
  'project-funding': { fmt: 'plus', label: 'ATK to your units per 3 mana in your pool' },
  'pulsar-harvester': { fmt: 'flat', label: 'ATK removed from an enemy your unit damages' },
  'singularity-harness': { fmt: 'plus', label: 'ATK to your Mine & Wall tokens (your "bots")' },
  // Core modules
  'dimension-core': { fmt: 'plus', label: 'damage to your damage-dealing Ultimates' },
  'harmony-conductor': { fmt: 'flat', label: 'enemy front units that miss their attack each turn' },
  'magnetic-hook': { fmt: 'flat', label: 'damage to the strongest enemy unit each turn' },
  'multiverse-nexus': { fmt: 'flat', label: 'synced free Ultimate(s) after you play one (they fire together)' },
  'om-chip': { fmt: 'plus', label: 'ATK to your strongest unit each turn' },
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
  'guardian-scout': { fmt: 'flat', label: 'ATK removed from all enemy units' },
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

/** The card's numeric value at `level`, plus its generic mastery bonus scaled by `masteryLevel`. */
export function cardLevelValue(cardId: string, level: number, masteryLevel: number): number {
  const prog = CARD_PROG[cardId]
  if (!prog) return 0
  const base = prog.levels[clampLevel(level) - 1] ?? prog.levels[0] ?? 0
  const val = base + (prog.masteryBonus ? prog.masteryBonus * clampMastery(masteryLevel) : 0)
  return COMBAT_CARDS.has(cardId) ? val * COMBAT_SCALE : val
}

/** The distinct mastery ability id for a card, if it has one and its mastery is unlocked (level ≥ 1). */
export function cardMasterySpecial(cardId: string, masteryLevel: number): MasterySpecial | undefined {
  return clampMastery(masteryLevel) >= 1 ? CARD_PROG[cardId]?.masterySpecial : undefined
}

/** For a unit card, which stat its level scales (undefined for non-units / unlevelled). */
export function cardUnitStat(cardId: string): 'atk' | 'hp' | undefined {
  return CARD_PROG[cardId]?.unitStat
}
