/**
 * Card art resolver. Vite bundles every image under assets/cards + assets/frames (real Tower card
 * thumbnails) and hands us URLs; we key them by filename so the catalog's `art` field resolves to a
 * real URL. A missing art file falls back to the rarity frame rather than a broken image.
 */

import { getCard } from '../engine'
import type { Rarity } from '../engine'

// Card, frame, and portrait art are resolved eagerly at build time via import.meta.glob (keyed by
// basename below). NB: adding a new asset while the dev server is running requires a re-transform of
// this module (or a restart) for the glob to pick it up — the production build always re-scans.
// (Portraits include every enemy incl. boss.webp = enemy-boss art; see src/ui/assets/portraits.)
const cardUrls = import.meta.glob('./assets/cards/*.{jpg,webp,png}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const frameUrls = import.meta.glob('./assets/frames/*.{webp,png,jpg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const portraitUrls = import.meta.glob('./assets/portraits/*.{webp,png,jpg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

function byBasename(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, url] of Object.entries(map)) {
    const base = path.slice(path.lastIndexOf('/') + 1)
    out[base] = url
  }
  return out
}

const CARDS = byBasename(cardUrls)
const FRAMES = byBasename(frameUrls)
const PORTRAITS = byBasename(portraitUrls)

/** Portrait for a nexus. Enemy portraits are keyed by boss name (a canonical Tower enemy); the
 *  player uses the Tower art. Falls back to undefined so the caller can drop in a glyph. */
export function portraitUrl(key: string): string | undefined {
  return PORTRAITS[`${key.toLowerCase()}.webp`]
}

const RARITY_FRAME: Record<Rarity, string> = {
  common: 'card-green.webp',
  rare: 'card-blue.webp',
  epic: 'card-orange.webp',
}

export function rarityFrameUrl(rarity: Rarity): string | undefined {
  return FRAMES[RARITY_FRAME[rarity]]
}

export function cardArtUrl(cardId: string): string | undefined {
  const def = getCard(cardId)
  return CARDS[def.art] ?? rarityFrameUrl(def.rarity)
}
