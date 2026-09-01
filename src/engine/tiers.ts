/**
 * Ladder tiers (roguelike "ascension"), matching The Tower's 24-tier structure. The same 10 bosses
 * are replayed at escalating difficulty, so the curve rises gradually across many runs. Progression
 * is GATED: you must full-clear a tier's 10-boss ladder to unlock the next (enforced by the game via
 * the saved `highestTierCleared`).
 *
 * Difficulty levers, tuned via `pnpm winrate` (measured against the HEURISTIC/competent player — the
 * depth-1/2/3 search players are within ~2%, i.e. the game is decided by deck power, not lookahead):
 *  - Difficulty ratio R (`tierR`)     — the ONE knob: the enemy's total power vs the player, split √R
 *                    into HP and √R into offense, rising mildly-convex from R_MIN (T1) to R_MAX (T24).
 *  - Enemy card power (`bossCardLevels`) — TRACKS the player's own realistic levelling, so the mid is a
 *                    fair fight (no walkover from out-levelling the enemy) and R alone sets difficulty.
 *  - Per-game variance (TUNING.GAME_VARIANCE) — a run-to-run swing of the enemy's whole matchup, which
 *                    turns the win/loss response from a step into a GRADUAL decline every tier.
 *  Battle length is a separate, symmetric geometric HP base (`tierPowerIndex`). The player's deck is
 *  FULL from Tier 1 (see maxDeckForTier) so their power is flat and the curve rides purely on R.
 */

import { TUNING } from './tuning'
import { ALL_CARD_IDS } from './cards'
import { CARD_MAX_LEVEL, MASTERY_MAX_LEVEL } from './card-progression'
import type { CardLevels } from './types'

export const MAX_TIER = 24
/** Cosmetic UI threshold only: tiers from here show a "⚠" flavour marker. (The old mechanical player
 *  "battle conditions" nerf was removed — see tierPlayerLifePenalty.) */
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
 * The difficulty model — one ratio R(t), for a gradual declining win curve.
 *
 * Both towers share a SYMMETRIC geometric HP base (`tierPowerIndex`) that only sets battle length. The
 * enemy's edge is the ratio R(t), split evenly: `√R` into HP (it survives longer) and `√R` into offense
 * (it hits harder), so its total power is R× the player's. R rises mildly-convex from R_MIN (T1, easy) to
 * R_MAX (T24, hard). On its own R would give a near-STEP response (the game is deck-determined, so a small
 * power edge tips the whole match), so a per-game variance (TUNING.GAME_VARIANCE) swings the enemy's whole
 * matchup run-to-run — that turns the step into a smooth, gradual decline every tier.
 */
const HP_GROWTH = 1.15 // per-tier HP ratio for BOTH towers (symmetric) — sets battle length, not difficulty
// The ONE difficulty ratio R(t): the enemy's total power vs the player, rising every tier.
const R_MIN = 0.85 // T1 easy onboarding win
const R_MAX = 5.2 // T24 climax. Steep end-ramp so the LAST tiers keep out-pacing the player's still-growing
//                    collection at the very top, so T24 stays strictly the hardest tier (measured at N=40:
//                    T22≈42 > T23≈32 > T24≈31) rather than the player catching up and the order inverting.
const R_SHAPE = 2.4 // strongly convex: very gentle early (easy onboarding), accelerating so the biggest
//                     per-tier difficulty jumps land at the very top (where they're needed to keep the
//                     order strict); the tapered top variance lowers the floor so those jumps register.
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

/** The difficulty ratio R(t, rung): the enemy's total power relative to the player, rising geometrically
 *  from R_MIN (T1) to R_MAX (T24) with a mildly-convex shape (gentle early, steeper late). Split √R/√R
 *  into HP and offense by the callers below; a later rung (and the final Boss) is a little stronger. */
function tierR(level: number, index: number): number {
  const t = clampTier(level)
  const frac = (t - 1) / (MAX_TIER - 1)
  const base = R_MIN * (R_MAX / R_MIN) ** (frac ** R_SHAPE) // geometric, mildly convex, monotonic in tier
  return base * (1 + (index - 1) * RUNG_STEP) * (index >= FINAL_BOSS_RUNG ? BOSS_MULT : 1)
}

/** The enemy's offense multiplier — the √R half of the difficulty ratio. Applied to unit ATK + skills. */
export function tierEnemyPowerMult(level: number, index = 1): number {
  return Math.sqrt(tierR(level, index))
}

/** Per-game draw-luck variance, TAPERED by tier. Wide through the mid so the win curve declines
 *  gradually (close matchups become coin-flips); narrow at the top so the hardest tiers don't all pile
 *  up at one lucky-win floor — the win keeps dropping and T22 > T23 > T24 stays strictly ordered. */
export function tierGameVariance(level: number): number {
  const t = clampTier(level)
  return t <= 14 ? 0.28 : Math.max(0.07, 0.28 - (t - 14) * 0.021) // 0.28 → ~0.07 by T24
}

/** Search depth by tier: a beatable 1-ply intro (T1-5), 2-ply anti-cheese (T6-8), and a 3-ply searcher
 *  from Tier 9 up. (3-ply ≈ 31ms/turn, imperceptible.) */
export function tierAiDepth(level: number): number {
  const t = clampTier(level)
  return t <= 3 ? 1 : 2 // uniform 2-ply from T4 — depth-3 played defensively and LOST to a racing player,
  //                       causing a win-rate inversion (T9 easier than T7); difficulty rides on R instead
}

/**
 * Boss HP edge for (tier, boss index): enemy HP = player HP × √R (the tankiness half of the ratio R; the
 * offense half is tierEnemyPowerMult). `bonusLife` is the part over START_LIFE + tierBaseLife, so the
 * harness/game formula (START_LIFE + tierBaseLife + bonusLife) yields exactly that HP.
 */
export function tierBossHandicap(level: number, index: number): { bonusLife: number; bonusStartMana: number } {
  const t = clampTier(level)
  const i = index // 1..11 — position within the tier's ladder (11 = the final Boss)
  const playerTotal = TUNING.START_LIFE + tierBaseLife(t)
  // Enemy HP = player HP × √R (the tankiness half of the difficulty ratio).
  const enemyHpMult = Math.sqrt(tierR(t, i))
  const bonusLife = Math.round(playerTotal * (enemyHpMult - 1))
  // Summit tempo: by T23 the enemy's card power is maxed (mastery capped) and its STATS are a saturated
  // lever — 10-20% more HP/ATK can't flip which of the 11 matchups are winnable, so the top tiers pin at
  // the same ~31% composition floor and T23≈T24. Starting mana is NOT saturated: an early tempo lead lets
  // the enemy land a big card first and flip close races, tipping a matchup or two. Granting it ONLY at
  // the final tier pulls T24 clear below T23 (no mid cliff — this was the T18 mana step's old sin).
  // Mana is a COARSE lever: +1 across all 11 rungs flips ~1.2 matchups at once (T24 31→21, a ~10-pt drop),
  // and +2 barely differs — there is no "half a mana". To land the ~5% ask we give the tempo edge to only
  // the back HALF of the final tier's ladder (its later, already-tougher rungs, i≥6), tipping ~half the
  // matchups for ~half the drop → T24 clears T23 by ~5% without overshooting.
  const bonusStartMana = t >= MAX_TIER && i >= 6 ? 1 : 0
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

/** Enemy card level per tier — tracks the player's own realistic deck-levelling (harness deckLvl ≈ 4.7
 *  at T5, ~7 by T13) so the mid is a FAIR fight, not a walkover from the player out-levelling the enemy.
 *  Difficulty then comes from R (tierR), not from a card-power mismatch. */
export function bossCardLevel(level: number): number {
  return Math.min(CARD_MAX_LEVEL, 1 + Math.round((clampTier(level) - 1) * 0.8))
}

/** The mastery every enemy card runs at a tier. Ramps EARLY (from T6) and reaches max by ~T17, so the
 *  enemy's card power keeps pace as the player's deck-engine comes fully online around T9-12 — otherwise
 *  the player's relative strength spikes there and the win curve bumps back up (non-monotonic). */
export function bossCardMastery(level: number): number {
  const t = clampTier(level)
  // Tracks the player's realistic mastery buying (harness deckMst ≈ 1.5 at T10, ~6 by T24) + a touch more.
  return Math.min(MASTERY_MAX_LEVEL, Math.max(0, Math.round((t - 7) * 0.5)))
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
