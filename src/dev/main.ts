/** Standalone dev host. `pnpm dev` → http://localhost:5181. The game panel owns its own header
 *  (title, boss picker, Watch/autoplay, restart); this host just mounts it and logs match results. */

import '../ui/styles.css'
import { GameApp, type MatchResult } from '../ui/game-app'

const root = document.getElementById('app')!
const log = document.getElementById('log')!

function onResult(r: MatchResult): void {
  const line = `${r.winner === 'HUMAN' ? '✅ You beat' : '❌ You lost to'} boss ${r.boss} (${r.bossName}) in ${r.turns} turns — you ${r.humanLifeRemaining} HP, foe ${r.aiLifeRemaining} HP\n`
  log.textContent = line + log.textContent
}

new GameApp(root, { onResult })
