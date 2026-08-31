/**
 * Card levels (1-7) and masteries — a faithful adaptation of The Tower's card system. Collecting a
 * card levels it up (scaling its main number); reaching max level unlocks its named MASTERY, a
 * secondary ability. Mastery names come from the real game (see packages/sdk .../cards/data.ts).
 *
 * Backward-compatible by design: `levels[0]` (level 1) equals the card's original value, so an
 * un-levelled deck plays exactly as before and existing balance/tests are unaffected — leveling is
 * pure upside. The engine reads a card's value for its owner via `cardLevelValue`.
 *
 * A mastery is either a generic stat boost (`masteryBonus` added to the level value — the real game's
 * common "+", e.g. Damage+) or a distinct ability (`masterySpecial`, handled in the engine).
 */

export const CARD_MAX_LEVEL = 7

export type MasterySpecial =
  | 'fortress-walls' // Fortress: on death, leaves a 0/4 wall once (rebuilds).
  | 'coin-orb' // Extra Orbs: draw a card when it destroys an enemy unit.
  | 'viking-funeral' // Berserker: on death, deals its ATK to the enemy Nexus.
  | 'elite-cannon' // Plasma Cannon: strikes a second enemy unit too.
  | 'radiation' // Nuke: also deals extra damage to the enemy Nexus.
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
  fortress: { levels: [8, 9, 10, 11, 12, 13, 15], unitStat: 'hp', masteryName: 'Fortress Walls', masteryText: 'On death, a 0/4 wall rebuilds in its place (once).', masterySpecial: 'fortress-walls' },
  'extra-orbs': { levels: [3, 3, 4, 4, 5, 5, 6], unitStat: 'atk', masteryName: 'Coin Orb', masteryText: 'Draw a card whenever it destroys an enemy unit.', masterySpecial: 'coin-orb' },
  berserker: { levels: [2, 2, 3, 3, 4, 4, 5], unitStat: 'atk', masteryName: 'Viking Funeral', masteryText: 'On death, deals its ATK to the enemy Nexus.', masterySpecial: 'viking-funeral' },
  'land-mine-stun': { levels: [1, 1, 1, 2, 2, 2, 3], unitStat: 'atk', masteryName: 'Flashbang', masteryText: '+1 ATK.', masteryBonus: 1 },

  // --- Modules ---
  damage: { levels: [1, 1, 2, 2, 2, 3, 3], masteryName: 'Damage+', masteryText: '+1 ATK to friendly units.', masteryBonus: 1 },
  'attack-speed': { levels: [0, 0, 1, 1, 1, 2, 2], masteryName: 'Attack Speed+', masteryText: 'Your units deal +1 more.', masteryBonus: 1 },
  health: { levels: [5, 6, 7, 8, 9, 10, 12], masteryName: 'Health+', masteryText: '+3 more max Nexus HP.', masteryBonus: 3 },
  'health-regen': { levels: [1, 1, 2, 2, 2, 3, 3], masteryName: 'Health Regen+', masteryText: '+1 more healing each turn.', masteryBonus: 1 },
  range: { levels: [0, 0, 1, 1, 1, 2, 2], masteryName: 'Long Shot', masteryText: 'Reaching units deal +1 more.', masteryBonus: 1 },
  coins: { levels: [1, 1, 1, 2, 2, 2, 3], masteryName: 'Coins+', masteryText: 'Draw +1 more each turn.', masteryBonus: 1 },
  'slow-aura': { levels: [1, 1, 1, 2, 2, 2, 3], masteryName: 'Slow Attack', masteryText: 'Enemies enter tapped +1 more turn.', masteryBonus: 1 },
  'critical-chance': { levels: [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6], masteryName: 'Super Crit', masteryText: '+10% more crit chance.', masteryBonus: 0.1 },
  'enemy-balance': { levels: [1, 1, 2, 2, 2, 3, 3], masteryName: 'Elite Balance', masteryText: 'Draw +1 more each turn.', masteryBonus: 1 },
  'extra-defense': { levels: [1, 1, 2, 2, 2, 3, 3], masteryName: 'Extra Defense+', masteryText: 'Reduce incoming Nexus damage +1 more.', masteryBonus: 1 },
  'critical-coin': { levels: [1, 1, 1, 2, 2, 2, 3], masteryName: 'Double Coins', masteryText: '+1 more mana per kill.', masteryBonus: 1 },
  'package-chance': { levels: [2, 2, 3, 3, 3, 4, 4], masteryName: 'Care Package', masteryText: '+2 more Nexus HP per Ultimate drawn.', masteryBonus: 2 },
  'land-mine-chance': { levels: [0.5, 0.5, 0.55, 0.6, 0.6, 0.65, 0.7], masteryName: 'Minefield', masteryText: '+10% more spawn chance.', masteryBonus: 0.1 },
  'orbs-speed': { levels: [2, 2, 3, 3, 4, 4, 5], masteryName: 'Orbs Speed+', masteryText: '+2 more ATK to Extra Orbs.', masteryBonus: 2 },
  'super-tower': { levels: [3, 3, 4, 4, 5, 5, 6], masteryName: 'Ultimate Tower', masteryText: '+2 more ATK on its power turn.', masteryBonus: 2 },
  'wave-accelerator': { levels: [1, 1, 1, 2, 2, 2, 3], masteryName: 'Spawn Accelerator', masteryText: 'Ultimates cost 1 more less.', masteryBonus: 1 },
  'energy-shield': { levels: [1, 1, 1, 2, 2, 2, 3], masteryName: 'Repel', masteryText: 'Absorbs 1 more instance of Nexus damage.', masteryBonus: 1 },

  // --- Ultimates ---
  cash: { levels: [2, 2, 3, 3, 3, 4, 4], masteryName: 'Big Cash', masteryText: '+1 more temporary mana.', masteryBonus: 1 },
  'free-upgrades': { levels: [3, 3, 4, 4, 4, 5, 5], masteryName: 'Locked Upgrade', masteryText: 'Reveal +1 more card.', masteryBonus: 1 },
  'plasma-cannon': { levels: [0.5, 0.5, 0.55, 0.6, 0.6, 0.65, 0.7], masteryName: 'Elite Cannon', masteryText: 'Also hits a second enemy unit.', masterySpecial: 'elite-cannon' },
  'wave-skip': { levels: [0, 0, 2, 2, 3, 3, 4], masteryName: 'Double Wave Skip', masteryText: 'Heal +2 more on cast.', masteryBonus: 2 },
  'intro-sprint': { levels: [3, 3, 4, 4, 4, 5, 5], masteryName: 'Warp Speed', masteryText: 'Draw +1 more.', masteryBonus: 1 },
  'recovery-package': { levels: [2, 2, 3, 3, 4, 4, 5], masteryName: 'Care Package', masteryText: '+2 more overheal.', masteryBonus: 2 },
  'death-ray': { levels: [6, 6, 7, 8, 8, 9, 10], masteryName: 'Enhanced Ray', masteryText: '+2 more damage.', masteryBonus: 2 },
  'energy-net': { levels: [2, 2, 2, 3, 3, 3, 4], masteryName: 'Electrified Net', masteryText: 'Freeze +1 more turn.', masteryBonus: 1 },
  'second-wind': { levels: [5, 5, 6, 7, 8, 9, 10], masteryName: 'Angel Wings', masteryText: 'Also heals all your units to full when it triggers.', masterySpecial: 'angel-wings' },
  'demon-mode': { levels: [5, 5, 6, 7, 8, 9, 10], masteryName: 'Demon Revenge', masteryText: '+2 more ATK.', masteryBonus: 2 },
  nuke: { levels: [0, 0, 2, 2, 4, 4, 6], masteryName: 'Radiation', masteryText: 'Also deals 6 damage to the enemy Nexus.', masterySpecial: 'radiation' },
  'ultimate-crit': { levels: [3, 3, 3, 4, 4, 4, 5], masteryName: 'Ultimate Crit+', masteryText: '+1 more damage multiplier.', masteryBonus: 1 },

  // --- Expansion cards ---
  'chain-lightning': { levels: [3, 3, 4, 4, 5, 5, 6], masteryName: 'Overload', masteryText: '+1 more to every bolt.', masteryBonus: 1 },
  'smart-missiles': { levels: [2, 2, 3, 3, 3, 4, 4], masteryName: 'Cluster Warheads', masteryText: '+1 more damage per lane.', masteryBonus: 1 },
  'black-hole': { levels: [3, 3, 4, 4, 5, 5, 6], masteryName: 'Singularity', masteryText: 'Destroys tougher units (+1 HP).', masteryBonus: 1 },
  'chrono-field': { levels: [2, 2, 2, 3, 3, 3, 4], masteryName: 'Time Stop', masteryText: 'Freeze +1 more turn.', masteryBonus: 1 },
  spotlight: { levels: [2, 2, 3, 3, 4, 4, 5], masteryName: 'Overexpose', masteryText: '+1 more ATK.', masteryBonus: 1 },
  'death-wave': { levels: [1, 1, 1, 2, 2, 2, 3], masteryName: 'Tsunami', masteryText: '+1 more damage each turn.', masteryBonus: 1 },
  'golden-tower': { levels: [1, 1, 1, 2, 2, 2, 3], masteryName: 'Gilded', masteryText: '+1 more temporary mana each turn.', masteryBonus: 1 },
  'death-penalty': { levels: [2, 2, 3, 3, 3, 4, 4], masteryName: 'Vengeance', masteryText: '+1 more Nexus damage per death.', masteryBonus: 1 },
  'havoc-bringer': { levels: [2, 2, 3, 3, 4, 4, 5], masteryName: 'Havoc+', masteryText: '+1 more ATK to your units.', masteryBonus: 1 },
  'multiverse-nexus': { levels: [1, 1, 2, 2, 2, 3, 3], masteryName: 'Wormhole', masteryText: 'The spawned token has +1 more HP.', masteryBonus: 1 },
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
  damage: { fmt: 'plus', label: 'ATK to all friendly units' },
  'attack-speed': { fmt: 'plus', label: 'ATK to your units (grants First Strike)' },
  health: { fmt: 'plus', label: 'max Nexus HP (healed on play)' },
  'health-regen': { fmt: 'plus', label: 'HP healed to Nexus & units each turn' },
  range: { fmt: 'plus', label: 'ATK to units (grants Reach)' },
  coins: { fmt: 'flat', label: 'cards drawn each turn' },
  'slow-aura': { fmt: 'flat', label: 'turns enemy units enter tapped' },
  'critical-chance': { fmt: 'percent', label: 'chance on hit to deal 2× damage' },
  'enemy-balance': { fmt: 'flat', label: 'cards drawn each turn (enemy units +1 ATK)' },
  'extra-defense': { fmt: 'plus', label: 'incoming Nexus damage reduced (min 1)' },
  'critical-coin': { fmt: 'plus', label: 'mana next turn when a unit kills' },
  'package-chance': { fmt: 'plus', label: 'Nexus HP when you draw an Ultimate' },
  'land-mine-chance': { fmt: 'percent', label: 'chance to spawn a mine each turn' },
  'orbs-speed': { fmt: 'plus', label: 'ATK to your Extra Orbs' },
  'super-tower': { fmt: 'plus', label: 'ATK to your units every 3rd turn (invulnerable)' },
  'wave-accelerator': { fmt: 'plus', label: 'less mana for your Ultimates (min 1)' },
  'energy-shield': { fmt: 'flat', label: 'instances of Nexus damage absorbed' },
  cash: { fmt: 'plus', label: 'temporary mana this turn' },
  'free-upgrades': { fmt: 'flat', label: 'cards revealed (play a free unit ≤3)' },
  'plasma-cannon': { fmt: 'percent', label: "of the target's current HP removed" },
  'wave-skip': { fmt: 'plus', label: 'Nexus HP healed (skips enemy combat)' },
  'intro-sprint': { fmt: 'flat', label: 'cards drawn (then discard 1)' },
  'recovery-package': { fmt: 'plus', label: 'HP over max (heals target to full)' },
  'death-ray': { fmt: 'flat', label: 'damage to a unit (+2 to neighbours)' },
  'energy-net': { fmt: 'flat', label: 'turns an enemy unit is frozen' },
  'second-wind': { fmt: 'flat', label: 'HP revived to if your Nexus would die' },
  'demon-mode': { fmt: 'plus', label: 'ATK this turn (unit is sacrificed after)' },
  nuke: { fmt: 'flat', label: 'bonus Nexus damage (destroys all units)' },
  'ultimate-crit': { fmt: 'flat', label: '× damage straight to the Nexus (bypasses blockers)' },
  'chain-lightning': { fmt: 'flat', label: 'damage to a target, then −1 to two more enemies' },
  'smart-missiles': { fmt: 'flat', label: "damage to each lane's front enemy" },
  'black-hole': { fmt: 'flat', label: 'max HP of the enemy destroyed in each lane' },
  'chrono-field': { fmt: 'flat', label: 'turns all enemy units are frozen' },
  spotlight: { fmt: 'plus', label: 'ATK to a friendly unit (permanent)' },
  'death-wave': { fmt: 'flat', label: 'damage to every enemy unit each turn' },
  'golden-tower': { fmt: 'plus', label: 'temporary mana each turn' },
  'death-penalty': { fmt: 'flat', label: 'Nexus damage when a friendly unit dies' },
  'havoc-bringer': { fmt: 'plus', label: 'ATK to all friendly units' },
  'multiverse-nexus': { fmt: 'flat', label: 'HP of the Defender token spawned each turn' },
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

/** The card's numeric value at `level`, plus its generic mastery bonus if `mastery` is unlocked. */
export function cardLevelValue(cardId: string, level: number, mastery: boolean): number {
  const prog = CARD_PROG[cardId]
  if (!prog) return 0
  const base = prog.levels[clampLevel(level) - 1] ?? prog.levels[0] ?? 0
  return base + (mastery && prog.masteryBonus ? prog.masteryBonus : 0)
}

/** The distinct mastery ability id for a card, if it has one and `mastery` is unlocked. */
export function cardMasterySpecial(cardId: string, mastery: boolean): MasterySpecial | undefined {
  return mastery ? CARD_PROG[cardId]?.masterySpecial : undefined
}

/** For a unit card, which stat its level scales (undefined for non-units / unlevelled). */
export function cardUnitStat(cardId: string): 'atk' | 'hp' | undefined {
  return CARD_PROG[cardId]?.unitStat
}
