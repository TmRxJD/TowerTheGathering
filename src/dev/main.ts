/** Standalone dev host. `pnpm dev` → http://localhost:5181. Pick a boss and play. */

import '../ui/styles.css'
import { GameApp, type MatchResult } from '../ui/game-app'
import { BOSS_DECKS } from '../engine'

const root = document.getElementById('app')!
const bossSel = document.getElementById('boss') as HTMLSelectElement
const restart = document.getElementById('restart') as HTMLButtonElement
const log = document.getElementById('log')!

for (const b of BOSS_DECKS) {
  const opt = document.createElement('option')
  opt.value = String(b.index)
  opt.textContent = `${b.index}. ${b.name} (${b.archetype})`
  bossSel.appendChild(opt)
}

let app: GameApp | null = null

function onResult(r: MatchResult): void {
  const line = `${r.winner === 'HUMAN' ? '✅ You beat' : '❌ You lost to'} boss ${r.boss} (${r.bossName}) in ${r.turns} turns — you ${r.humanLifeRemaining} HP, foe ${r.aiLifeRemaining} HP\n`
  log.textContent = line + log.textContent
}

function mount(): void {
  app?.destroy()
  root.innerHTML = ''
  app = new GameApp(root, { boss: Number(bossSel.value) || 1, onResult })
}

bossSel.addEventListener('change', mount)
restart.addEventListener('click', mount)
mount()
