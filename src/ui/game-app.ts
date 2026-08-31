/**
 * Tower: The Gathering — the DOM game app. Framework-free. It owns the engine + AI, renders the
 * snapshot to the board, routes clicks (select a card → pick a lane / target), steps the AI turn,
 * and animates from the engine's event list via the canvas FX layer.
 *
 * Ladder: a single match vs the current boss (starter deck for now — deck editing between bosses is
 * a later pass, see docs/GAME_DESIGN.md). Win → advance; loss → retry. Each match end fires
 * `onResult`, which the embed host forwards to the parent window.
 */

import {
  BOSS_DECKS,
  STARTER_DECK,
  createEngine,
  getCard,
  type Action,
  type Engine,
  type GameEvent,
  type Lane,
  type Side,
  type Target,
} from '../engine'
import { HeuristicAI } from '../ai'
import { cardArtUrl } from './card-art'
import { FxLayer } from './fx-layer'

const LANES: readonly Lane[] = ['LEFT', 'CENTER', 'RIGHT']

export interface MatchResult {
  readonly winner: Side
  readonly boss: number
  readonly bossName: string
  readonly turns: number
  readonly humanLifeRemaining: number
  readonly aiLifeRemaining: number
}

export interface GameAppOptions {
  onResult?: (r: MatchResult) => void
  boss?: number // 1..10
  seed?: string
}

interface Selection {
  uid: number
  kind: 'UNIT' | 'MODULE' | 'ULTIMATE'
  lanes: Set<Lane>
  targets: Set<number>
  needsTarget: boolean
}

export class GameApp {
  private readonly root: HTMLElement
  private readonly fx: FxLayer
  private readonly onResult: ((r: MatchResult) => void) | undefined
  private readonly seed: string

  private engine!: Engine
  private ai!: HeuristicAI
  private bossIndex: number
  private selection: Selection | null = null
  private busy = false
  private hint = ''

  // rebuilt each render from legalActions — the single source of truth for what HUMAN can do now
  private legalUnitLanes = new Map<number, Set<Lane>>()
  private legalModules = new Set<number>()
  private legalUltimates = new Map<number, { needsTarget: boolean; targets: Set<number> }>()

  constructor(root: HTMLElement, opts: GameAppOptions = {}) {
    this.root = root
    this.root.classList.add('ttg-root')
    this.onResult = opts.onResult
    this.seed = opts.seed ?? 'ttg'
    this.bossIndex = Math.min(Math.max(1, opts.boss ?? 1), BOSS_DECKS.length)
    this.fx = new FxLayer(this.root)
    globalThis.addEventListener?.('resize', () => this.fx.resize())
    this.startMatch(this.bossIndex)
  }

  // -------------------------------------------------------------------------
  // Match lifecycle
  // -------------------------------------------------------------------------

  private startMatch(bossIndex: number): void {
    this.bossIndex = bossIndex
    const boss = BOSS_DECKS[bossIndex - 1]!
    const { engine } = createEngine({
      humanDeck: STARTER_DECK,
      aiDeck: boss.cards,
      seed: `${this.seed}-b${bossIndex}`,
    })
    this.engine = engine
    this.ai = new HeuristicAI(engine, 'AI', boss.archetype)
    this.selection = null
    this.busy = false
    this.hint = ''
    this.render()
  }

  private finishMatch(): void {
    const res = this.engine.result()
    if (!res) return
    const boss = BOSS_DECKS[this.bossIndex - 1]!
    this.onResult?.({
      winner: res.winner,
      boss: this.bossIndex,
      bossName: boss.name,
      turns: res.turns,
      humanLifeRemaining: res.humanLifeRemaining,
      aiLifeRemaining: res.aiLifeRemaining,
    })
    this.render()
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private computeLegal(): void {
    this.legalUnitLanes.clear()
    this.legalModules.clear()
    this.legalUltimates.clear()
    if (this.busy || this.engine.isOver() || this.engine.snapshot().activeSide !== 'HUMAN') return
    for (const a of this.engine.legalActions('HUMAN')) {
      if (a.kind === 'playUnit') {
        if (!this.legalUnitLanes.has(a.uid)) this.legalUnitLanes.set(a.uid, new Set())
        this.legalUnitLanes.get(a.uid)!.add(a.lane)
      } else if (a.kind === 'playModule') {
        this.legalModules.add(a.uid)
      } else if (a.kind === 'playUltimate') {
        if (!this.legalUltimates.has(a.uid)) {
          this.legalUltimates.set(a.uid, { needsTarget: a.target !== undefined, targets: new Set() })
        }
        if (a.target && a.target.kind === 'unit') {
          const entry = this.legalUltimates.get(a.uid)!
          entry.needsTarget = true
          entry.targets.add(a.target.uid)
        }
      }
    }
  }

  private onCardClick(uid: number): void {
    if (this.busy || this.engine.snapshot().activeSide !== 'HUMAN') return
    if (this.selection?.uid === uid) {
      this.selection = null
      this.hint = ''
      this.render()
      return
    }
    const hand = this.engine.snapshot('HUMAN').players.HUMAN.hand ?? []
    const ref = hand.find(c => c.uid === uid)
    if (!ref) return
    const def = getCard(ref.cardId)

    if (def.type === 'MODULE') {
      if (this.legalModules.has(uid)) this.doAction({ kind: 'playModule', uid })
      else this.flashHint('No backline slot or not enough mana')
      return
    }
    if (def.type === 'UNIT') {
      const lanes = this.legalUnitLanes.get(uid)
      if (!lanes || lanes.size === 0) {
        this.flashHint('Not enough mana, or every lane is full')
        return
      }
      this.selection = { uid, kind: 'UNIT', lanes, targets: new Set(), needsTarget: false }
      this.hint = 'Pick a lane'
      this.render()
      return
    }
    // ULTIMATE
    const u = this.legalUltimates.get(uid)
    if (!u) {
      this.flashHint('Not enough mana, or no legal target')
      return
    }
    if (!u.needsTarget) {
      this.doAction({ kind: 'playUltimate', uid })
      return
    }
    this.selection = { uid, kind: 'ULTIMATE', lanes: new Set(), targets: u.targets, needsTarget: true }
    this.hint = 'Pick a target'
    this.render()
  }

  private onLaneClick(lane: Lane): void {
    const sel = this.selection
    if (!sel || sel.kind !== 'UNIT' || !sel.lanes.has(lane)) return
    this.doAction({ kind: 'playUnit', uid: sel.uid, lane })
  }

  private onUnitClick(uid: number): void {
    const sel = this.selection
    if (!sel || !sel.needsTarget || !sel.targets.has(uid)) return
    const target: Target = { kind: 'unit', uid }
    this.doAction({ kind: 'playUltimate', uid: sel.uid, target })
  }

  private flashHint(msg: string): void {
    this.hint = msg
    this.render()
  }

  private doAction(action: Action): void {
    this.selection = null
    this.hint = ''
    const events = this.engine.apply(action)
    this.renderAndAnimate(events)
    if (this.engine.isOver()) this.finishMatch()
  }

  private onEndTurn(): void {
    if (this.busy || this.engine.isOver() || this.engine.snapshot().activeSide !== 'HUMAN') return
    this.selection = null
    this.busy = true
    this.hint = 'Opponent is planning…'
    // HUMAN combat resolves inside this apply, then the turn passes to the AI.
    const events = this.engine.apply({ kind: 'endTurn' })
    this.renderAndAnimate(events)
    if (this.engine.isOver()) {
      this.busy = false
      this.finishMatch()
      return
    }
    globalThis.setTimeout(() => this.runAiTurn(), 650)
  }

  private runAiTurn(): void {
    if (this.engine.isOver()) {
      this.busy = false
      this.finishMatch()
      return
    }
    if (this.engine.snapshot().activeSide !== 'AI') {
      this.busy = false
      this.hint = ''
      this.render()
      return
    }
    const events = this.ai.takeTurn() // AI plays its whole turn, incl. its combat, then passes back
    this.renderAndAnimate(events)
    this.busy = false
    this.hint = ''
    if (this.engine.isOver()) this.finishMatch()
    else this.render()
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private render(): void {
    this.computeLegal()
    const snap = this.engine.snapshot('HUMAN')
    const ai = snap.players.AI
    const human = snap.players.HUMAN
    const over = this.engine.isOver()

    const el = (html: string): string => html
    const parts: string[] = []
    parts.push(this.nexusHtml('ai', 'Enemy Nexus', BOSS_DECKS[this.bossIndex - 1]!.name, ai))
    parts.push('<div class="ttg-board">')
    for (const lane of LANES) {
      const droppable = this.selection?.kind === 'UNIT' && this.selection.lanes.has(lane)
      parts.push(`<div class="ttg-lane${droppable ? ' droppable' : ''}" data-lane="${lane}">`)
      parts.push('<div class="half ai">')
      for (const u of snap.lanes[lane].AI) parts.push(this.unitHtml(u))
      parts.push('</div>')
      parts.push(`<div class="lane-label">${lane}</div><div class="divider"></div>`)
      parts.push('<div class="half human">')
      for (const u of snap.lanes[lane].HUMAN) parts.push(this.unitHtml(u))
      parts.push('</div>')
      parts.push('</div>')
    }
    parts.push('</div>')
    parts.push(this.nexusHtml('human', 'Your Nexus', 'Commander', human))

    parts.push('<div class="ttg-controls">')
    parts.push(`<span class="ttg-turn">Turn <b>${snap.turn}</b></span>`)
    if (this.hint) parts.push(`<span class="ttg-hint">${this.hint}</span>`)
    const disabled = this.busy || over || snap.activeSide !== 'HUMAN'
    parts.push(`<button class="ttg-btn" data-act="end" ${disabled ? 'disabled' : ''}>End Turn</button>`)
    parts.push('</div>')

    parts.push('<div class="ttg-hand">')
    for (const ref of human.hand ?? []) parts.push(this.handCardHtml(ref.uid, ref.cardId))
    parts.push('</div>')

    if (over) parts.push(this.overlayHtml())

    // Replace all board content but keep the FX canvas (z-index keeps it above the flow content,
    // below the game-over overlay — DOM order is irrelevant here).
    this.root.querySelectorAll(':scope > :not(.ttg-fx)').forEach(n => n.remove())
    const wrap = document.createElement('div')
    wrap.innerHTML = el(parts.join(''))
    while (wrap.firstChild) this.root.appendChild(wrap.firstChild)
    this.bindEvents()
    this.fx.resize()
  }

  private nexusHtml(
    side: 'ai' | 'human',
    who: string,
    sub: string,
    p: { life: number; maxLife: number; manaPool: number; manaMax: number; deckCount: number; modules: readonly { cardId: string; name: string }[] },
  ): string {
    const pips = Array.from({ length: 10 }, (_, i) => `<span class="ttg-pip ${i < p.manaPool ? 'on' : ''}"></span>`).join('')
    const mods = p.modules
      .map(m => `<div class="ttg-module" title="${m.name}" style="background-image:url('${cardArtUrl(m.cardId) ?? ''}')"></div>`)
      .join('')
    return `
      <div class="ttg-nexus ${side}">
        <div class="who">${who}<small>${sub}</small></div>
        <div class="ttg-stat"><span class="ttg-life">${Math.max(0, p.life)}</span><span class="lbl">/${p.maxLife} HP</span></div>
        <div class="ttg-stat"><span class="ttg-mana">${p.manaPool}</span><span class="lbl">/${p.manaMax}</span><span class="ttg-pips">${pips}</span></div>
        <div class="spacer"></div>
        <div class="ttg-stat"><span class="lbl">Deck ${p.deckCount}</span></div>
        <div class="ttg-modules">${mods}</div>
      </div>`
  }

  private unitHtml(u: {
    uid: number
    cardId: string
    name: string
    atk: number
    hp: number
    keywords: readonly string[]
    tapped: boolean
    frozen: boolean
    invulnerable: boolean
    isFront: boolean
  }): string {
    const targetable = this.selection?.needsTarget && this.selection.targets.has(u.uid)
    const kw = u.keywords
      .map(k => `<span>${k === 'firstStrike' ? 'FS' : k[0]!.toUpperCase()}</span>`)
      .join('')
    const status = [u.frozen ? '❄' : '', u.tapped ? '💤' : '', u.invulnerable ? '🛡' : ''].join('')
    const cls = ['ttg-unit', u.isFront ? 'front' : 'reserve', targetable ? 'targetable' : ''].join(' ').trim()
    return `
      <div class="${cls}" data-uid="${u.uid}" style="background-image:url('${cardArtUrl(u.cardId) ?? ''}')">
        <div class="kw">${kw}</div><div class="status">${status}</div>
        <div class="ttg-badge atk">${u.atk}</div>
        <div class="ttg-badge hp">${u.hp}</div>
        <div class="nm">${u.name}</div>
      </div>`
  }

  private handCardHtml(uid: number, cardId: string): string {
    const def = getCard(cardId)
    const affordable =
      this.legalUnitLanes.has(uid) || this.legalModules.has(uid) || this.legalUltimates.has(uid)
    const selected = this.selection?.uid === uid
    const cls = ['ttg-card', selected ? 'selected' : '', affordable ? '' : 'unaffordable'].join(' ').trim()
    const stats =
      def.type === 'UNIT'
        ? `<div class="stat-row"><b class="a">${def.atk ?? 0}</b><b class="h">${def.hp ?? 0}</b></div>`
        : ''
    return `
      <div class="${cls}" data-card="${uid}" title="${def.text}" style="background-image:url('${cardArtUrl(cardId) ?? ''}')">
        <div class="cost">${def.cost}</div>
        <div class="cn">${def.name}</div>
        <div class="ct">${def.type}</div>
        ${stats}
      </div>`
  }

  private overlayHtml(): string {
    const res = this.engine.result()!
    const won = res.winner === 'HUMAN'
    const boss = BOSS_DECKS[this.bossIndex - 1]!
    const last = this.bossIndex >= BOSS_DECKS.length
    let title: string
    let btn: string
    if (won && last) {
      title = '<h2 class="win">Ladder Cleared!</h2>'
      btn = '<button class="ttg-btn" data-act="restart">Play Again</button>'
    } else if (won) {
      title = '<h2 class="win">Victory</h2>'
      btn = '<button class="ttg-btn" data-act="next">Next Boss →</button>'
    } else {
      title = '<h2 class="lose">Defeated</h2>'
      btn = '<button class="ttg-btn" data-act="retry">Retry</button>'
    }
    return `<div class="ttg-over">${title}<p>Boss ${this.bossIndex}: ${boss.name} · ${res.turns} turns</p>${btn}</div>`
  }

  private bindEvents(): void {
    this.root.querySelectorAll<HTMLElement>('[data-card]').forEach(n =>
      n.addEventListener('click', () => this.onCardClick(Number(n.dataset.card))),
    )
    this.root.querySelectorAll<HTMLElement>('.ttg-lane').forEach(n =>
      n.addEventListener('click', () => this.onLaneClick(n.dataset.lane as Lane)),
    )
    this.root.querySelectorAll<HTMLElement>('.ttg-unit[data-uid]').forEach(n =>
      n.addEventListener('click', e => {
        e.stopPropagation()
        this.onUnitClick(Number(n.dataset.uid))
      }),
    )
    this.root.querySelectorAll<HTMLElement>('[data-act]').forEach(n =>
      n.addEventListener('click', () => this.onControl(n.dataset.act!)),
    )
  }

  private onControl(act: string): void {
    if (act === 'end') this.onEndTurn()
    else if (act === 'next') this.startMatch(this.bossIndex + 1)
    else if (act === 'retry') this.startMatch(this.bossIndex)
    else if (act === 'restart') this.startMatch(1)
  }

  // -------------------------------------------------------------------------
  // Animation from events
  // -------------------------------------------------------------------------

  private renderAndAnimate(events: GameEvent[]): void {
    this.render()
    const rootRect = this.root.getBoundingClientRect()
    const centerOf = (sel: string): { x: number; y: number } | null => {
      const node = this.root.querySelector(sel)
      if (!node) return null
      const r = node.getBoundingClientRect()
      return { x: r.left - rootRect.left + r.width / 2, y: r.top - rootRect.top + r.height / 2 }
    }
    for (const ev of events) {
      if (ev.type === 'damage' && ev.amount > 0) {
        const c = centerOf(`.ttg-unit[data-uid="${ev.targetUid}"]`)
        if (c) this.fx.floatText(c.x, c.y, `-${ev.amount}`, ev.crit ? '#ffd257' : '#ff8f5b', ev.crit ? 26 : 20)
      } else if (ev.type === 'nexusDamage' && ev.amount > 0) {
        const c = centerOf(`.ttg-nexus.${ev.side === 'AI' ? 'ai' : 'human'}`)
        if (c) this.fx.floatText(c.x, c.y, `-${ev.amount}`, '#ff5b6e', 24)
      } else if (ev.type === 'heal' && ev.amount > 0) {
        const c = ev.targetUid
          ? centerOf(`.ttg-unit[data-uid="${ev.targetUid}"]`)
          : centerOf(`.ttg-nexus.${ev.side === 'AI' ? 'ai' : 'human'}`)
        if (c) this.fx.floatText(c.x, c.y, `+${ev.amount}`, '#4ade80', 20)
      } else if (ev.type === 'ultimateCast' && ev.target && ev.target.kind === 'unit') {
        const from = centerOf(`.ttg-nexus.${ev.side === 'AI' ? 'ai' : 'human'}`)
        const to = centerOf(`.ttg-unit[data-uid="${ev.target.uid}"]`)
        if (from && to) this.fx.beam(from.x, from.y, to.x, to.y, ev.side === 'AI' ? '#ff5b6e' : '#5b8cff')
      }
    }
  }

  destroy(): void {
    this.fx.destroy()
    this.root.innerHTML = ''
  }
}
