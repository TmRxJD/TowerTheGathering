/**
 * Seeded, deterministic RNG. Same seed → same stream, forever. Everything random in the game
 * (shuffles, Critical Chance 30%, Land Mine Chance 50%) draws from one of these so a game is fully
 * reproducible from (seed, decks, inputs). See docs/GAME_DESIGN.md § Determinism.
 *
 * Algorithm: xmur3 to hash the string seed into a 32-bit state, then mulberry32 for the stream.
 * Small, fast, well-distributed enough for a card game; not for cryptography.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number
  /** Integer in [0, n). */
  int(n: number): number
  /** True with probability p (0..1). */
  chance(p: number): boolean
  /** In-place Fisher–Yates shuffle; returns the same array. */
  shuffle<T>(arr: T[]): T[]
}

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createRng(seed: string): Rng {
  const seedFn = xmur3(seed)
  const next = mulberry32(seedFn())
  const rng: Rng = {
    next,
    int: (n: number) => Math.floor(next() * n),
    chance: (p: number) => next() < p,
    shuffle: <T>(arr: T[]): T[] => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const tmp = arr[i] as T
        arr[i] = arr[j] as T
        arr[j] = tmp
      }
      return arr
    },
  }
  return rng
}
