/**
 * Ladder tiers (roguelike "ascension"), matching The Tower's 24-tier structure. The same 10 bosses
 * are replayed at escalating difficulty, so the curve rises gradually across many runs. Progression
 * is GATED: you must full-clear a tier's 10-boss ladder to unlock the next (enforced by the game via
 * the saved `highestTierCleared`).
 *
 * Difficulty levers, tuned via `pnpm winrate` against the fun curve in docs/GAME_STATE.md §3:
 *  - AI depth (`tierAiDepth`)   — 1-ply intro (T1-5), 2-ply (T6-8), 3-ply from T9. The dominant lever.
 *  - Boss handicap (`tierBossHandicap`) — bonus life that climbs each tier + an opening mana edge from
 *                    the mid tiers, and an HP capstone on the final Boss rung.
 *  - Enemy card power (`bossCardLevels`) — levels rise every 3 tiers; a small mastery from T9, the full
 *                    mastery ramp from T13, so the top out-cards you rather than just out-lifes you.
 *  The old per-tier PLAYER life nerf ("battle conditions") is removed — difficulty is all on the boss.
 */

import { TUNING } from './tuning'
import { ALL_CARD_IDS } from './cards'
import { CARD_MAX_LEVEL, MASTERY_MAX_LEVEL, G_MAG } from './card-progression'
import type { CardLevels } from './types'

export const MAX_TIER = 24
/** From this tier up, the player takes on "battle conditions" (nerfs), as in The Tower. */
export const BATTLE_CONDITION_TIER = 14
/** The last rung of every tier is the Boss (rung 11) — a huge-HP capstone. = BOSS_DECKS.length. */
export const FINAL_BOSS_RUNG = 11

export interface LadderTier {
  readonly level: number
  readonly name: string
}

export const LADDER_TIERS: readonly LadderTier[] = Array.from({ length: MAX_TIER }, (_, i) => ({
  level: i + 1,
  name: `Tier ${i + 1}`,
}))

export function clampTier(level: number): number {
  return Math.max(1, Math.min(MAX_TIER, Math.floor(level) || 1))
}

/** The player's deck size — now CONSTANT (a full deck from Tier 1). The deck no longer grows 10→34 over
 *  the climb: that growth doubled your board over the early tiers and made your win rate RISE early (an
 *  inverted-U), which is incompatible with a win curve that decreases every tier. You start with a full,
 *  capable deck; climbing grows your permanent COLLECTION (card levels & masteries) instead, and the
 *  enemy scales with it — so your relative power is flat and difficulty rides purely on the tier's `R`.
 *  Post-win rewards SWAP a card in (trim the weakest) rather than enlarge the deck. */
export function maxDeckForTier(level: number): number {
  void level
  return TUNING.DECK_SIZE
}

export function tierName(level: number): string {
  return `Tier ${clampTier(level)}`
}

/**
 * The difficulty model, rebuilt for a STRICTLY DECREASING win curve.
 *
 * HP tankiness was the wrong primary lever: a strong player wins ~100% until the enemy is suddenly
 * overwhelming, so HP gives a flat plateau then a cliff — never a smooth decline. The primary lever is
 * now the enemy's OFFENSE: `tierEnemyPowerMult` multiplies every enemy hit, rising smoothly and
 * monotonically every tier, so the enemy wins the damage race a little more each tier and the player's
 * win rate falls gradually and monotonically. HP is a SYMMETRIC, smooth geometric base shared by both
 * towers (no per-tier mastery jumps that used to bounce survivability around), tuned only to keep the
 * battle length bounded. Difficulty lives in ONE monotonic knob: `tierEnemyPowerMult`.
 */
const HP_GROWTH = 1.15 // per-tier HP ratio for BOTH towers (symmetric) — sets battle length, not difficulty
// The ONE monotonic difficulty ratio R(t): the enemy's total power vs the player, rising every tier.
const R_MIN = 0.85 // T1 easy onboarding win (your full deck vs a weak enemy)
const R_MAX = 1.55 // T24 climax — near the AI's win/loss step so the top lands ~40%, not a crater
const R_SHAPE = 1.0 // LINEAR: with a full (flat-power) deck, win rate tracks R directly, so a steady
//                     linear rise in R gives a steady decline in win rate every tier — the goal.
const RUNG_STEP = 0.04 // within a tier, each later rung is a little stronger
const BOSS_MULT = 1.2 // the final Boss rung's extra power

/** The shared, smooth geometric HP index (no mastery jumps). Both towers scale by this. */
export function tierPowerIndex(level: number): number {
  return HP_GROWTH ** (clampTier(level) - 1)
}

/** Player Tower HP bonus over START_LIFE — total = START_LIFE × tierPowerIndex. The enemy uses the SAME
 *  base (symmetric); its edge is the difficulty ratio R (split into HP + offense), not a lopsided base. */
export function tierBaseLife(level: number): number {
  return Math.round(TUNING.START_LIFE * (tierPowerIndex(level) - 1))
}

/**
 * THE difficulty ratio R(t, rung): the enemy's total power relative to the player, rising **monotonically
 * and geometrically** from R_MIN (T1, easy) to R_MAX (T24). It is split evenly — `√R` into HP (the enemy
 * survives longer) and `√R` into offense (it hits harder) — so total power scales by R while battles stay
 * bounded, and the win rate falls smoothly every tier. This is the single knob the whole curve rides on.
 */
function tierR(level: number, index: number): number {
  const t = clampTier(level)
  const frac = (t - 1) / (MAX_TIER - 1)
  const base = R_MIN * (R_MAX / R_MIN) ** (frac ** R_SHAPE) // geometric, concave, monotonic
  return base * (1 + (index - 1) * RUNG_STEP) * (index >= FINAL_BOSS_RUNG ? BOSS_MULT : 1)
}

/** The enemy's offense multiplier — the √R half of the difficulty ratio. Applied to unit ATK + skills. */
export function tierEnemyPowerMult(level: number, index = 1): number {
  return Math.sqrt(tierR(level, index))
}

/** Search depth by tier: a beatable 1-ply intro (T1-5), 2-ply anti-cheese (T6-8), and a 3-ply searcher
 *  from Tier 9 up. (3-ply ≈ 31ms/turn, imperceptible.) */
export function tierAiDepth(level: number): number {
  const t = clampTier(level)
  return t <= 3 ? 1 : 2 // uniform 2-ply from T4 — depth-3 played defensively and LOST to a racing player,
  //                       causing a win-rate inversion (T9 easier than T7); difficulty rides on R instead
}

/**
 * Boss life/mana edge for (tier, boss index). HP is now SYMMETRIC — the enemy sits on the same geometric
 * HP base as the player, with only a tiny within-tier rung bump — because difficulty comes from offense
 * (`tierEnemyPowerMult`), not tankiness. `bonusLife` is the part over START_LIFE + tierBaseLife.
 */
export function tierBossHandicap(level: number, index: number): { bonusLife: number; bonusStartMana: number } {
  const t = clampTier(level)
  const i = index // 1..11 — position within the tier's ladder (11 = the final Boss)
  const playerTotal = TUNING.START_LIFE + tierBaseLife(t)
  // Enemy HP = player HP × √R (the tankiness half of the difficulty ratio).
  const enemyHpMult = Math.sqrt(tierR(t, i))
  const bonusLife = Math.round(playerTotal * (enemyHpMult - 1))
  const bonusStartMana = t >= 18 ? 1 : 0 // a small opening tempo edge at the top only
  return { bonusLife, bonusStartMana }
}

/** Battle-condition player nerf: starting life lost, from Tier 14 up, accelerating past Tier 20 —
 *  but tempered so the very top isn't a one-hit coin-flip (the boss's huge HP carries the wall). */
export function tierPlayerLifePenalty(level: number): number {
  // Removed for the TCG direction — a shrinking life bar is exactly the "punishing" feel we don't
  // want. Difficulty comes from the boss's gentle handicap + maxed cards, not from gimping the player.
  void level
  return 0
}

/** The card level every enemy card runs at a tier — rises one step every 3 tiers, maxed by ~T19. */
export function bossCardLevel(level: number): number {
  return Math.min(CARD_MAX_LEVEL, 1 + Math.floor((clampTier(level) - 1) / 3))
}

/** The mastery every enemy card runs at a tier. Ramps EARLY (from T6) and reaches max by ~T17, so the
 *  enemy's card power keeps pace as the player's deck-engine comes fully online around T9-12 — otherwise
 *  the player's relative strength spikes there and the win curve bumps back up (non-monotonic). */
export function bossCardMastery(level: number): number {
  const t = clampTier(level)
  return Math.min(MASTERY_MAX_LEVEL, Math.max(0, Math.round((t - 5) * 0.8)))
}

/** The full enemy card-level map for a tier — the single source shared by the game and the harnesses
 *  (previously duplicated in three places, which could silently drift). */
export function bossCardLevels(level: number): CardLevels {
  const lvl = bossCardLevel(level)
  const mastery = bossCardMastery(level)
  const out: CardLevels = {}
  for (const id of ALL_CARD_IDS) out[id] = { level: lvl, mastery }
  return out
}
