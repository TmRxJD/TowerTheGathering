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

/** The player's deck-size cap for a tier: 10 at Tier 1, +1 for every tier climbed, so a full climb
 *  reaches 33 by Tier 24 (34 once Tier 24 itself is cleared). The deck grows toward this cap via the
 *  post-win reward cards — bigger decks mean more variety AND resist fatigue in the long top-tier
 *  slogs, so climbing is rewarded and grinding a low tier for easy shards is not. */
export function maxDeckForTier(level: number): number {
  return 9 + clampTier(level)
}

export function tierName(level: number): string {
  return `Tier ${clampTier(level)}`
}

/**
 * CROSSED geometric scaling — the core of the balance. Offense scales geometrically with card power, so
 * HP must too, or a side is one-shot. The subtlety: the two sides' offense differs (the enemy runs full
 * mastery for free; a real player can only afford part of it), so the HP is CROSSED —
 *   - player HP scales with the ENEMY's offense (so you survive the enemy's hits), and
 *   - enemy HP scales with the PLAYER's realistic offense (so your weaker board can still kill it in a
 *     bounded number of turns — the fix for the high-tier turn explosion).
 * At a power mirror this makes a fair fight BY CONSTRUCTION: both take the same "hits to kill". The one
 * difficulty knob (`diff` in tierBossHandicap) then slides the enemy's relative tankiness easy→hard.
 * `offenseIndex` is exactly the card-value growth factor `G_MAG^((L-1)+M/2)` reused for HP.
 */
const PLAYER_MST_FRAC = 0.6 // a real player reaches ~60% of the enemy's free mastery (harness: M~5.6 vs 9)
const offenseIndex = (level: number, mastery: number): number => G_MAG ** (level - 1 + mastery / 2)
/** The ENEMY's offense factor at a tier — drives PLAYER HP (survive the enemy). */
export function tierPowerIndex(level: number): number {
  const t = clampTier(level)
  return offenseIndex(bossCardLevel(t), bossCardMastery(t))
}
/** The PLAYER's realistic offense factor at a tier — drives ENEMY HP (killable in bounded turns). */
function playerPowerIndex(t: number): number {
  return offenseIndex(bossCardLevel(t), bossCardMastery(t) * PLAYER_MST_FRAC)
}

/** Player Tower HP bonus over START_LIFE. BOTH towers scale by the same realistic index (playerPowerIndex),
 *  so the HP economy is symmetric and self-similar — time-to-kill stays bounded and difficulty is carried
 *  purely by the enemy's `diff` multiplier, not by an HP asymmetry that would make one side a slow tank. */
export function tierBaseLife(level: number): number {
  return Math.round(TUNING.START_LIFE * (playerPowerIndex(clampTier(level)) - 1))
}

/** Search depth by tier: a beatable 1-ply intro (T1-5), 2-ply anti-cheese (T6-8), and a 3-ply searcher
 *  from Tier 9 up — it reads two of your turns ahead, so it holds removal, avoids overcommitting, and
 *  sets up lethal far better. (3-ply ≈ 31ms/turn, imperceptible.) */
export function tierAiDepth(level: number): number {
  const t = clampTier(level)
  // Depth is the dominant difficulty lever vs a human: a searching boss out-plays you regardless of
  // HP. Keep bosses SIMPLE (1-ply) through the easy onboarding tiers, then 3-ply takes over from T9
  // (where an engaged player's built-up deck would otherwise coast) to hold the mid-and-late pressure.
  return t <= 5 ? 1 : t <= 8 ? 2 : 3
}

/** The one geometric difficulty knob: the enemy's relative power vs the player, gliding from easy to
 *  hard. DIFF_MIN < 1 means the early enemy is genuinely weaker than you (easy onboarding win); DIFF_MAX
 *  > 1 is the top-tier climax. Interpolated GEOMETRICALLY so the win-rate curve is smooth end to end. */
const DIFF_MIN = 0.55 // T1: enemy at 55% relative HP (easy onboarding win)
const DIFF_MAX = 2.0 // T24: enemy this much tankier (symmetric base makes diff=1 a fair-ish fight)
const DIFF_SHAPE = 0.5 // <1 = concave: diff rises fast early (bite the mid), flattens late (no cliff)
const RUNG_STEP = 0.05 // within a tier, each later rung is +5% tougher
const BOSS_MULT = 1.35 // the final Boss rung's extra HP pile

/**
 * Boss life/mana edge for (tier, boss index). Enemy total life = START_LIFE × tierPowerIndex × diff ×
 * rungMult — i.e. the enemy sits on the SAME geometric HP ladder as the player, offset by one geometric
 * difficulty multiplier `diff`. `bonusLife` is the part over START_LIFE + tierBaseLife (the player pool),
 * so the harness/game formula (START_LIFE + tierBaseLife + bonusLife) yields exactly that total.
 */
export function tierBossHandicap(level: number, index: number): { bonusLife: number; bonusStartMana: number } {
  const t = clampTier(level)
  const i = index // 1..11 — position within the tier's ladder (11 = the final Boss)
  const frac = (t - 1) / (MAX_TIER - 1)
  const diff = DIFF_MIN + (DIFF_MAX - DIFF_MIN) * frac ** DIFF_SHAPE // concave easy→hard offset
  const rungMult = (1 + (i - 1) * RUNG_STEP) * (i >= FINAL_BOSS_RUNG ? BOSS_MULT : 1)
  // Enemy HP scales with the PLAYER's realistic offense (killable in bounded turns), × the difficulty.
  const enemyTotal = TUNING.START_LIFE * playerPowerIndex(t) * diff * rungMult
  const bonusLife = Math.round(enemyTotal - TUNING.START_LIFE - tierBaseLife(t))
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

/** The mastery every enemy card runs at a tier. A small mastery comes online at T9 (the band where an
 *  engaged player's built-up deck otherwise outpaces the enemy), then the real ramp from T13 to maxed. */
export function bossCardMastery(level: number): number {
  const t = clampTier(level)
  return t >= 13 ? Math.min(MASTERY_MAX_LEVEL, t - 12) : t >= 9 ? 1 : 0
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
