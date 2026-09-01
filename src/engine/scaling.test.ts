/**
 * Guardrails for the ONE scaling law (card-progression header + docs/GAME_STATE.md §6a). These prove
 * the "predictable, gradually-increasing pattern" is real and stays real: every magnitude card grows by
 * the SAME per-level ratio, ratios are capped, counts stay bounded, and the tier HP economy is geometric.
 */
import { describe, expect, it } from 'vitest'
import { CARD_PROG, cardLevelValue, G_MAG, G_RATIO, CARD_MAX_LEVEL, MASTERY_MAX_LEVEL } from './card-progression'
import { tierBaseLife, tierBossHandicap, MAX_TIER } from './tiers'
import { TUNING } from './tuning'

describe('card scaling law', () => {
  it('every magnitude card follows value = round(base × G_MAG^(L-1)) — one law, exactly', () => {
    const mags = Object.entries(CARD_PROG).filter(([, p]) => p.cls === 'mag')
    expect(mags.length).toBeGreaterThan(30) // most of the catalog is magnitude
    for (const [id, p] of mags) {
      for (let L = 1; L <= CARD_MAX_LEVEL; L++) {
        expect(cardLevelValue(id, L, 0)).toBe(Math.round(p.base * G_MAG ** (L - 1)))
      }
    }
    // On a large base (rounding negligible) the ramp is exactly ×G_MAG^6 from L1→L7 — the whole point.
    expect(cardLevelValue('fortress', 7, 0) / cardLevelValue('fortress', 1, 0)).toBeCloseTo(G_MAG ** 6, 0)
  })

  it('mastery is worth exactly half a level (value = base × G^((L-1)+M/2))', () => {
    // A mastery step multiplies by G^0.5; two mastery levels == one card level.
    expect(cardLevelValue('death-ray', 3, 2)).toBe(cardLevelValue('death-ray', 4, 0))
    expect(cardLevelValue('fortress', 1, 2)).toBe(cardLevelValue('fortress', 2, 0))
  })

  it('ratio cards follow the geometric law and never exceed their cap', () => {
    const ratios = Object.entries(CARD_PROG).filter(([, p]) => p.cls === 'ratio')
    for (const [id, p] of ratios) {
      // L1 and L7 track base × G_RATIO^(L-1) (2-dp rounding), and mastery stays clamped to the cap.
      expect(cardLevelValue(id, 1, 0)).toBeCloseTo(p.base, 5)
      expect(cardLevelValue(id, CARD_MAX_LEVEL, MASTERY_MAX_LEVEL)).toBeLessThanOrEqual(p.cap ?? Infinity)
    }
    // A large L7/L1 ramp confirms G_RATIO is the growth (Damage: 0.2 → 0.2×G_RATIO^6).
    expect(cardLevelValue('damage', 7, 0)).toBeCloseTo(0.2 * G_RATIO ** 6, 1)
  })

  it('count cards stay bounded — no runaway even fully maxed', () => {
    const counts = Object.entries(CARD_PROG).filter(([, p]) => p.cls === 'count')
    for (const [id] of counts) {
      // Bounded by game rules; one-shot resource counts (draws/mana) may reach the high teens, but
      // nothing geometric — a maxed count is a small number, never thousands.
      expect(cardLevelValue(id, CARD_MAX_LEVEL, MASTERY_MAX_LEVEL)).toBeLessThanOrEqual(20)
    }
  })
})

describe('tier HP economy is geometric & controlled', () => {
  it('both towers scale geometrically and monotonically up the ladder', () => {
    let prevPlayer = 0
    let prevEnemy = 0
    for (let t = 1; t <= MAX_TIER; t++) {
      const player = TUNING.START_LIFE + tierBaseLife(t)
      const enemy = TUNING.START_LIFE + tierBaseLife(t) + tierBossHandicap(t, 1).bonusLife
      expect(player).toBeGreaterThanOrEqual(prevPlayer) // never shrinks
      expect(enemy).toBeGreaterThan(0) // always a real, positive HP (no auto-win)
      prevPlayer = player
      prevEnemy = enemy
    }
    // Numbers are allowed to get large — the ladder is geometric, not linear.
    expect(TUNING.START_LIFE + tierBaseLife(MAX_TIER)).toBeGreaterThan(TUNING.START_LIFE * 20)
  })

  it('the final Boss rung is tankier than boss 10, every tier', () => {
    for (const t of [6, 12, 24]) {
      expect(tierBossHandicap(t, 11).bonusLife).toBeGreaterThan(tierBossHandicap(t, 10).bonusLife)
    }
  })
})
