/**
 * The 31-card catalog — the authoritative numbers. Pure data; behaviour lives in the engine,
 * keyed by `id`. Mirrors the table in docs/GAME_DESIGN.md, which is the single source of truth.
 * Where the original pitch's prose and its table disagreed, the table won (see the delta table in
 * the design doc). Art is the real Tower card thumbnail under src/ui/assets/cards/.
 */

import type { CardDef } from './types'

export const CARD_CATALOG: Readonly<Record<string, CardDef>> = {
  // --- Commons (copy limit 3) -------------------------------------------------
  damage: {
    id: 'damage',
    name: 'Damage',
    rarity: 'common',
    type: 'MODULE',
    cost: 1,
    text: 'Friendly units have +1 ATK.',
    art: 'damage.jpg',
  },
  'attack-speed': {
    id: 'attack-speed',
    name: 'Attack Speed',
    rarity: 'common',
    type: 'MODULE',
    cost: 2,
    text: 'Your units gain First Strike.',
    art: 'attack-speed.jpg',
  },
  health: {
    id: 'health',
    name: 'Health',
    rarity: 'common',
    type: 'MODULE',
    cost: 2,
    text: '+5 max Tower HP immediately (and heal 5).',
    art: 'health.jpg',
  },
  'health-regen': {
    id: 'health-regen',
    name: 'Health Regen',
    rarity: 'common',
    type: 'MODULE',
    cost: 2,
    text: 'Start of your turn: heal your Tower and all friendly units +1 HP.',
    art: 'health-regen.jpg',
  },
  range: {
    id: 'range',
    name: 'Range',
    rarity: 'common',
    type: 'MODULE',
    cost: 1,
    text: 'Friendly units gain Reach (hit an adjacent lane when their own is clear).',
    art: 'range.jpg',
  },
  cash: {
    id: 'cash',
    name: 'Cash',
    rarity: 'common',
    type: 'ULTIMATE',
    cost: 1,
    text: '+2 temporary mana this turn.',
    art: 'cash.jpg',
  },
  coins: {
    id: 'coins',
    name: 'Coins',
    rarity: 'common',
    type: 'MODULE',
    cost: 1,
    text: 'Economy: if you WIN this battle with Coins in play, earn +N bonus coins (stacks per copy).',
    art: 'coins.jpg',
  },
  'free-upgrades': {
    id: 'free-upgrades',
    name: 'Free Upgrades',
    rarity: 'common',
    type: 'ULTIMATE',
    cost: 3,
    text: 'Reveal the top 3 cards; play one revealed unit of cost 3 or less into a lane for free.',
    art: 'free-upgrades.jpg',
  },
  'critical-chance': {
    id: 'critical-chance',
    name: 'Critical Chance',
    rarity: 'common',
    type: 'MODULE',
    cost: 2,
    text: 'Friendly units have a 30% chance on hit to deal 2× damage.',
    art: 'critical-chance.jpg',
  },
  'enemy-balance': {
    id: 'enemy-balance',
    name: 'Enemy Balance',
    rarity: 'common',
    type: 'MODULE',
    cost: 1,
    text: 'Draw +1 card each turn, but all enemy units have +1 ATK.',
    art: 'enemy-balance.jpg',
  },
  'extra-defense': {
    id: 'extra-defense',
    name: 'Extra Defense',
    rarity: 'common',
    type: 'MODULE',
    cost: 3,
    text: 'Incoming Tower damage is reduced by 1 (minimum 1).',
    art: 'extra-defense.jpg',
  },
  fortress: {
    id: 'fortress',
    name: 'Fortress',
    rarity: 'common',
    type: 'UNIT',
    cost: 2,
    atk: 0,
    hp: 80,
    keywords: ['defender'],
    text: 'Defender. Enemies must destroy it first. Deals no combat damage.',
    art: 'fortress.jpg',
  },

  // --- Rares (copy limit 2) ---------------------------------------------------
  'plasma-cannon': {
    id: 'plasma-cannon',
    name: 'Plasma Cannon',
    rarity: 'rare',
    type: 'ULTIMATE',
    cost: 3,
    text: 'Target enemy unit loses 50% of its current HP (rounded up).',
    art: 'plasma-cannon.jpg',
  },
  'critical-coin': {
    id: 'critical-coin',
    name: 'Critical Coin',
    rarity: 'rare',
    type: 'MODULE',
    cost: 3,
    text: 'Economy: when your unit lands a CRITICAL hit, farm +N coins (banked if you win the battle).',
    art: 'critical-coin.jpg',
  },
  'wave-skip': {
    id: 'wave-skip',
    name: 'Wave Skip',
    rarity: 'rare',
    type: 'ULTIMATE',
    cost: 2,
    text: 'Skip ahead through your deck: draw N cards.',
    art: 'wave-skip.jpg',
  },
  'intro-sprint': {
    id: 'intro-sprint',
    name: 'Intro Sprint',
    rarity: 'rare',
    type: 'ULTIMATE',
    cost: 3,
    text: 'Draw 3 cards, then discard 1.',
    art: 'intro-sprint.jpg',
  },
  'land-mine-stun': {
    id: 'land-mine-stun',
    name: 'Land Mine Stun',
    rarity: 'rare',
    type: 'UNIT',
    cost: 2,
    atk: 10,
    hp: 20,
    keywords: ['trap', 'defender'],
    text: 'Trap, Defender. When an enemy enters this lane, destroy this and freeze that enemy 1 turn.',
    art: 'land-mine-stun.jpg',
  },
  'recovery-package': {
    id: 'recovery-package',
    name: 'Recovery Package',
    rarity: 'rare',
    type: 'ULTIMATE',
    cost: 3,
    text: 'Heal a target unit to full and give it +2 HP over its base maximum.',
    art: 'recovery-package.jpg',
  },
  'package-chance': {
    id: 'package-chance',
    name: 'Package Chance',
    rarity: 'rare',
    type: 'MODULE',
    cost: 2,
    text: 'Whenever you draw an Ultimate, gain +2 Tower HP.',
    art: 'package-chance.jpg',
  },
  'slow-aura': {
    id: 'slow-aura',
    name: 'Slow Aura',
    rarity: 'rare',
    type: 'MODULE',
    cost: 3,
    text: 'Enemy units enter tapped and cannot act the turn they are played.',
    art: 'slow-aura.jpg',
  },
  'extra-orbs': {
    id: 'extra-orbs',
    name: 'Extra Orbs',
    rarity: 'rare',
    type: 'UNIT',
    cost: 4,
    atk: 30,
    hp: 10,
    keywords: ['firstStrike', 'spillover'],
    text: 'First Strike. Overkill damage spills to the enemy Tower.',
    art: 'extra-orbs.jpg',
  },
  'land-mine-chance': {
    id: 'land-mine-chance',
    name: 'Land Mine Chance',
    rarity: 'rare',
    type: 'MODULE',
    cost: 2,
    text: 'End of your turn: 50% chance to spawn a 1/1 Defender mine in a random empty lane.',
    art: 'land-mine-chance.webp',
  },
  'orbs-speed': {
    id: 'orbs-speed',
    name: 'Orbs Speed',
    rarity: 'rare',
    type: 'MODULE',
    cost: 2,
    text: 'Friendly Extra Orbs units have +2 ATK.',
    art: 'orbs-speed.webp',
  },

  // --- Epics (copy limit 1) ---------------------------------------------------
  'death-ray': {
    id: 'death-ray',
    name: 'Death Ray',
    rarity: 'epic',
    type: 'ULTIMATE',
    cost: 5,
    text: '6 damage to a target unit; 2 damage to the front units of both neighbouring lanes.',
    art: 'death-ray.jpg',
  },
  'energy-net': {
    id: 'energy-net',
    name: 'Energy Net',
    rarity: 'epic',
    type: 'ULTIMATE',
    cost: 4,
    text: 'Freeze a target enemy unit for 2 turns.',
    art: 'energy-net.jpg',
  },
  'super-tower': {
    id: 'super-tower',
    name: 'Super Tower',
    rarity: 'epic',
    type: 'MODULE',
    cost: 5,
    text: 'Every 3rd of your turns, your units gain +3 ATK and are Invulnerable that combat.',
    art: 'super-tower.jpg',
  },
  'second-wind': {
    id: 'second-wind',
    name: 'Second Wind',
    rarity: 'epic',
    type: 'ULTIMATE',
    cost: 4,
    text: 'Secret. If your Tower would reach 0, prevent it, set HP to 5, and exile this.',
    art: 'second-wind.jpg',
  },
  'demon-mode': {
    id: 'demon-mode',
    name: 'Demon Mode',
    rarity: 'epic',
    type: 'ULTIMATE',
    cost: 6,
    text: 'A friendly unit gains +5 ATK and Invulnerability this turn; sacrifice it at end of turn.',
    art: 'demon-mode.jpg',
  },
  'energy-shield': {
    id: 'energy-shield',
    name: 'Energy Shield',
    rarity: 'epic',
    type: 'MODULE',
    cost: 4,
    text: 'Negates the next instance of direct Tower damage, then destroys itself.',
    art: 'energy-shield.jpg',
  },
  'wave-accelerator': {
    id: 'wave-accelerator',
    name: 'Wave Accelerator',
    rarity: 'epic',
    type: 'MODULE',
    cost: 3,
    text: 'Your Ultimates cost 1 less (minimum 1).',
    art: 'wave-accelerator.jpg',
  },
  berserker: {
    id: 'berserker',
    name: 'Berserker',
    rarity: 'epic',
    type: 'UNIT',
    cost: 4,
    atk: 20,
    hp: 40,
    text: 'Gains +1/+0 permanently each time it takes damage and survives.',
    art: 'berserker.jpg',
  },
  nuke: {
    id: 'nuke',
    name: 'Nuke',
    rarity: 'epic',
    type: 'ULTIMATE',
    cost: 8,
    text: 'Destroy all units in all lanes, on both sides.',
    art: 'nuke.jpg',
  },
  'ultimate-crit': {
    id: 'ultimate-crit',
    name: 'Ultimate Crit',
    rarity: 'epic',
    type: 'ULTIMATE',
    cost: 4,
    text: "A friendly unit's next attack deals 3× damage straight to the enemy Tower, bypassing blockers.",
    art: 'ultimate-crit.jpg',
  },

  // --- Ultimate Weapons (the 9 real UWs, adapted) -----------------------------
  'chain-lightning': {
    id: 'chain-lightning', name: 'Chain Lightning', rarity: 'rare', type: 'ULTIMATE', cost: 4,
    text: 'Deal 3 damage to a target enemy unit, arcing for 1 less to each next-strongest enemy.',
    art: 'chain-lightning.webp',
  },
  'smart-missiles': {
    id: 'smart-missiles', name: 'Smart Missiles', rarity: 'rare', type: 'ULTIMATE', cost: 3,
    text: 'Deal 2 damage to the front enemy unit in every lane.',
    art: 'smart-missiles.webp',
  },
  'death-wave': {
    id: 'death-wave', name: 'Death Wave', rarity: 'epic', type: 'MODULE', cost: 4,
    text: 'Start of your turn: deal 1 damage to every enemy unit.',
    art: 'death-wave.webp',
  },
  'chrono-field': {
    id: 'chrono-field', name: 'Chrono Field', rarity: 'epic', type: 'ULTIMATE', cost: 5,
    text: 'Freeze all enemy units for N turns.',
    art: 'chrono-field.webp',
  },
  'inner-land-mines': {
    id: 'inner-land-mines', name: 'Inner Land Mines', rarity: 'rare', type: 'MODULE', cost: 3,
    text: 'Mines ring your tower: each enemy unit takes 2 damage as it enters a lane.',
    art: 'inner-land-mines.webp',
  },
  'golden-tower': {
    id: 'golden-tower', name: 'Golden Tower', rarity: 'rare', type: 'MODULE', cost: 3,
    text: 'Economy: the tower turns golden — farm +N coins whenever your unit destroys an enemy (banked if you win).',
    art: 'golden-tower.webp',
  },
  'poison-swamp': {
    id: 'poison-swamp', name: 'Poison Swamp', rarity: 'epic', type: 'MODULE', cost: 4,
    text: 'When an enemy unit dies, its surviving lane-mates take 1 poison damage.',
    art: 'poison-swamp.webp',
  },
  'black-hole': {
    id: 'black-hole', name: 'Black Hole', rarity: 'epic', type: 'ULTIMATE', cost: 6,
    text: 'Destroy the lowest-HP enemy unit in every lane (up to 3 HP).',
    art: 'black-hole.webp',
  },
  spotlight: {
    id: 'spotlight', name: 'Spotlight', rarity: 'rare', type: 'MODULE', cost: 3,
    text: 'Spotlight your arsenal: all of your Ultimate Weapon cards have +N to their effect.',
    art: 'spotlight.webp',
  },

  // --- Cannon modules (attack) ------------------------------------------------
  'astral-deliverance': {
    id: 'astral-deliverance', name: 'Astral Deliverance', rarity: 'epic', type: 'MODULE', cost: 4,
    text: 'Your units bounce: each combat attack also deals 1 damage to the enemy behind its target.',
    art: 'astral-deliverance.webp',
  },
  'being-annihilator': {
    id: 'being-annihilator', name: 'Being Annihilator', rarity: 'epic', type: 'MODULE', cost: 4,
    text: 'The first friendly attack each turn is a guaranteed crit (2× damage).',
    art: 'being-annihilator.webp',
  },
  'death-penalty': {
    id: 'death-penalty', name: 'Death Penalty', rarity: 'epic', type: 'MODULE', cost: 3,
    text: 'Each turn, mark the first enemy unit that enters — the first hit it takes destroys it.',
    art: 'death-penalty.webp',
  },
  'havoc-bringer': {
    id: 'havoc-bringer', name: 'Havoc Bringer', rarity: 'epic', type: 'MODULE', cost: 4,
    text: 'Rend armor: enemy units take +1 damage from your attacks.',
    art: 'havoc-bringer.webp',
  },
  'shrink-ray': {
    id: 'shrink-ray', name: 'Shrink Ray', rarity: 'epic', type: 'ULTIMATE', cost: 3,
    text: "Shrink an enemy unit's mass: its hits weaken — permanently −2 ATK.",
    art: 'shrink-ray.webp',
  },

  // --- Armor modules (defense) ------------------------------------------------
  'anti-cube-portal': {
    id: 'anti-cube-portal', name: 'Anti-Cube Portal', rarity: 'epic', type: 'MODULE', cost: 4,
    text: 'When your unit attacks, a shockwave deals 1 to the enemy fronts in the neighboring lanes.',
    art: 'anti-cube-portal.webp',
  },
  'negative-mass-projector': {
    id: 'negative-mass-projector', name: 'Negative Mass Projector', rarity: 'epic', type: 'MODULE', cost: 3,
    text: 'All enemy units have -1 ATK.',
    art: 'negative-mass-projector.webp',
  },
  'sharp-fortitude': {
    id: 'sharp-fortitude', name: 'Sharp Fortitude', rarity: 'epic', type: 'MODULE', cost: 4,
    text: 'A thorned wall: +4 max Tower HP (healed), and attackers take 1 thorns damage.',
    art: 'sharp-fortitude.webp',
  },
  'wormhole-redirector': {
    id: 'wormhole-redirector', name: 'Wormhole Redirector', rarity: 'epic', type: 'MODULE', cost: 3,
    text: 'Channels recovery: restore 1 Tower HP at the start of each of your turns.',
    art: 'wormhole-redirector.webp',
  },
  'space-displacer': {
    id: 'space-displacer', name: 'Space Displacer', rarity: 'epic', type: 'MODULE', cost: 4,
    text: 'Start of your turn: inner land mines organize — spawn a 0/1 Mine in each empty lane.',
    art: 'space-displacer.webp',
  },

  // --- Generator modules (utility) --------------------------------------------
  'black-hole-digestor': {
    id: 'black-hole-digestor', name: 'Black Hole Digestor', rarity: 'epic', type: 'MODULE', cost: 3,
    text: 'Start of your turn: gain +1 temporary mana for each Module you control.',
    art: 'black-hole-digestor.webp',
  },
  'galaxy-compressor': {
    id: 'galaxy-compressor', name: 'Galaxy Compressor', rarity: 'epic', type: 'MODULE', cost: 3,
    text: 'On any turn you heal your Tower, your Ultimates cost 1 less (min 1).',
    art: 'galaxy-compressor.webp',
  },
  'project-funding': {
    id: 'project-funding', name: 'Project Funding', rarity: 'epic', type: 'MODULE', cost: 4,
    text: 'Your units gain +1 ATK for every 3 mana in your pool.',
    art: 'project-funding.webp',
  },
  'pulsar-harvester': {
    id: 'pulsar-harvester', name: 'Pulsar Harvester', rarity: 'epic', type: 'MODULE', cost: 4,
    text: 'When your unit damages an enemy in combat, that enemy loses 1 ATK.',
    art: 'pulsar-harvester.webp',
  },
  'singularity-harness': {
    id: 'singularity-harness', name: 'Singularity Harness', rarity: 'epic', type: 'MODULE', cost: 3,
    text: 'Supercharges your bots: your Mine and Wall tokens gain +1 ATK.',
    art: 'singularity-harness.webp',
  },

  // --- Core modules (ultimate weapons) ----------------------------------------
  'dimension-core': {
    id: 'dimension-core', name: 'Dimension Core', rarity: 'epic', type: 'MODULE', cost: 4,
    text: 'Your damage-dealing Ultimates deal +1 damage.',
    art: 'dimension-core.webp',
  },
  'harmony-conductor': {
    id: 'harmony-conductor', name: 'Harmony Conductor', rarity: 'epic', type: 'MODULE', cost: 4,
    text: 'Each combat, one enemy front unit misses its attack.',
    art: 'harmony-conductor.webp',
  },
  'magnetic-hook': {
    id: 'magnetic-hook', name: 'Magnetic Hook', rarity: 'epic', type: 'MODULE', cost: 4,
    text: 'Start of your turn: hook the strongest enemy unit for 2 damage.',
    art: 'magnetic-hook.webp',
  },
  'multiverse-nexus': {
    id: 'multiverse-nexus', name: 'Multiverse Nexus', rarity: 'epic', type: 'MODULE', cost: 4,
    text: 'Your Ultimate Weapons sync: after you play an Ultimate, the next Ultimate this turn is free.',
    art: 'multiverse-nexus.webp',
  },
  'om-chip': {
    id: 'om-chip', name: 'Om Chip', rarity: 'epic', type: 'MODULE', cost: 3,
    text: 'Start of your turn: focus fire — your strongest unit gains +1 ATK.',
    art: 'om-chip.webp',
  },

  // --- Bots (the 5 real Tower bots, adapted as companion modules) --------------
  'flame-bot': {
    id: 'flame-bot', name: 'Flame Bot', rarity: 'epic', type: 'MODULE', cost: 3,
    text: 'Start of your turn: burn all enemy units for 2 damage. Burned (enemy) units have −1 ATK.',
    art: 'flame-bot.webp',
  },
  'thunder-bot': {
    id: 'thunder-bot', name: 'Thunder Bot', rarity: 'rare', type: 'MODULE', cost: 3,
    text: 'Start of your turn: stun the strongest enemy unit for 1 turn.',
    art: 'thunder-bot.webp',
  },
  'golden-bot': {
    id: 'golden-bot', name: 'Golden Bot', rarity: 'rare', type: 'MODULE', cost: 2,
    text: 'Economy: start of your turn, farm +N coins (banked if you win the battle).',
    art: 'golden-bot.webp',
  },
  'amplify-bot': {
    id: 'amplify-bot', name: 'Amplify Bot', rarity: 'rare', type: 'MODULE', cost: 3,
    text: 'Amplify: your units have +1 ATK.',
    art: 'amplify-bot.webp',
  },
  'bot-bot': {
    id: 'bot-bot', name: 'Bot Bot', rarity: 'epic', type: 'MODULE', cost: 3,
    text: 'Your units have +1 ATK, and your OTHER Bots trigger twice as strongly.',
    art: 'bot-bot.webp',
  },

  // --- Guardian chips (the 6 released chips, adapted as one-shot activations) ---
  'guardian-ally': {
    id: 'guardian-ally', name: 'Ally Chip', rarity: 'epic', type: 'ULTIMATE', cost: 3,
    text: 'Convert the weakest enemy unit to your side.',
    art: 'guardian-ally.webp',
  },
  'guardian-attack': {
    id: 'guardian-attack', name: 'Attack Chip', rarity: 'rare', type: 'ULTIMATE', cost: 2,
    text: 'Deal damage to a unit equal to the damage it has already taken.',
    art: 'guardian-attack.webp',
  },
  'guardian-bounty': {
    id: 'guardian-bounty', name: 'Bounty Chip', rarity: 'rare', type: 'ULTIMATE', cost: 2,
    text: 'Collect a bounty: draw 2 cards.',
    art: 'guardian-bounty.webp',
  },
  'guardian-fetch': {
    id: 'guardian-fetch', name: 'Fetch Chip', rarity: 'rare', type: 'ULTIMATE', cost: 3,
    text: 'Steal 3 HP from the enemy Tower (heal your own) and draw a card.',
    art: 'guardian-fetch.webp',
  },
  'guardian-summon': {
    id: 'guardian-summon', name: 'Summon Chip', rarity: 'rare', type: 'ULTIMATE', cost: 3,
    text: 'Summon a 2/2 Ally into each empty friendly lane.',
    art: 'guardian-summon.webp',
  },
  'guardian-scout': {
    id: 'guardian-scout', name: 'Scout Chip', rarity: 'rare', type: 'MODULE', cost: 2,
    text: 'Scouted: all enemy units have −1 ATK.',
    art: 'guardian-scout.webp',
  },
}

/** The mine token spawned by Land Mine Chance is not a deck card; defined here for the engine. */
export const MINE_TOKEN: CardDef = {
  id: 'mine-token',
  name: 'Land Mine',
  rarity: 'common',
  type: 'UNIT',
  cost: 0,
  atk: 10,
  hp: 10,
  keywords: ['defender'],
  text: 'Defender. A spawned mine token.',
  art: 'land-mine-chance.webp',
}

/** The ally token summoned by the Summon Chip is not a deck card; defined here for the engine. */
export const SUMMON_TOKEN: CardDef = {
  id: 'summon-token',
  name: 'Summoned Ally',
  rarity: 'common',
  type: 'UNIT',
  cost: 0,
  atk: 20,
  hp: 20,
  text: 'A summoned ally token.',
  art: 'guardian-summon.webp',
}

export const ALL_CARD_IDS: readonly string[] = Object.keys(CARD_CATALOG)

export function getCard(cardId: string): CardDef {
  if (cardId === MINE_TOKEN.id) return MINE_TOKEN
  if (cardId === SUMMON_TOKEN.id) return SUMMON_TOKEN
  const def = CARD_CATALOG[cardId]
  if (!def) throw new Error(`Unknown card id: ${cardId}`)
  return def
}
