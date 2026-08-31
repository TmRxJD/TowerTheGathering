/**
 * Embed host — the entry the Tower Run Tracker loads in an iframe. It mounts the game and speaks a
 * tiny postMessage protocol to its parent so the host can size the frame and receive each match's
 * GameResult:
 *
 *   → { type: 'ttg:ready' }                         once mounted
 *   → { type: 'ttg:content-height', height }         whenever the board's height changes
 *   → { type: 'ttg:result', payload: MatchResult }   when a ladder match ends
 *
 * All messages are posted to the parent; the host validates origin on its side. The bundle is built
 * self-contained with relative asset paths (vite.embed.config.ts) so it can be served from any
 * sub-path under the host's public/ (public/games/tower-the-gathering/).
 */

import '../ui/styles.css'
import { GameApp } from '../ui/game-app'

const params = new URLSearchParams(globalThis.location?.search ?? '')
const root = document.getElementById('app')!

function postToParent(message: unknown): void {
  try {
    window.parent?.postMessage(message, '*')
  } catch {
    /* no parent, or a cross-origin parent that refuses — nothing to do */
  }
}

const opts: ConstructorParameters<typeof GameApp>[1] = {
  onResult: result => postToParent({ type: 'ttg:result', payload: result }),
}
const boss = Number(params.get('boss'))
if (Number.isFinite(boss) && boss >= 1) opts.boss = boss
const seed = params.get('seed')
if (seed) opts.seed = seed

new GameApp(root, opts)

// Report height so the host can size the iframe. Debounced to a frame.
let raf = 0
function reportHeight(): void {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    const height = Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || 0)
    if (height > 0) postToParent({ type: 'ttg:content-height', height })
  })
}
if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(reportHeight)
  ro.observe(document.documentElement)
  ro.observe(root)
}
window.addEventListener('load', reportHeight)

postToParent({ type: 'ttg:ready' })
reportHeight()
