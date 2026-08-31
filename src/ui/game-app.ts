/**
 * Tower: The Gathering — the DOM game app. Framework-free.
 *
 * Rendering is a keyed RECONCILER, not innerHTML teardown: every unit, hand card, and nexus part is
 * a persistent node keyed by uid, so CSS transitions and enter/exit animations actually run. render()
 * settles the board to the engine's current state; renderAndAnimate() then plays the flourishes that
 * belong to the events just produced — attack lunges, hit shakes, damage floats (canvas), card-fly on
 * play, animated HP bars, turn banners, and screen shake.
 *
 * It owns the engine + AI, routes clicks (select a card → pick a lane / target), steps the AI turn,
 * and fires onResult at each match end (the embed host forwards it to the parent window).
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
  type PlayerView,
  type Side,
  type Target,
  type UnitView,
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
  boss?: number
  seed?: string
}

interface Selection {
  uid: number
  kind: 'UNIT' | 'MODULE' | 'ULTIMATE'
  lanes: Set<Lane>
  targets: Set<number>
  needsTarget: boolean
}

interface NexusRefs {
  el: HTMLElement
  hpFill: HTMLElement
  hpTxt: HTMLElement
  manaNum: HTMLElement
  crystals: HTMLElement
  deck: HTMLElement
  modules: HTMLElement
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
  private prevActive: Side | null = null

  // persistent skeleton refs
  private banner!: HTMLElement
  private vignette!: HTMLElement
  private nexus!: Record<Side, NexusRefs>
  private laneEls!: Record<Lane, HTMLElement>
  private halves!: Record<Lane, Record<Side, HTMLElement>>
  private turnEl!: HTMLElement
  private hintEl!: HTMLElement
  private endBtn!: HTMLButtonElement
  private handEl!: HTMLElement
  private overlay: HTMLElement | null = null

  // keyed node registries
  private unitNodes = new Map<number, HTMLElement>()
  private cardNodes = new Map<number, HTMLElement>()
  private seenModules = new Set<number>()

  // legality (rebuilt each render)
  private legalUnitLanes = new Map<number, Set<Lane>>()
  private legalModules = new Set<number>()
  private legalUltimates = new Map<number, { needsTarget: boolean; targets: Set<number> }>()

  constructor(root: HTMLElement, opts: GameAppOptions = {}) {
    this.root = root
    this.root.classList.add('ttg-root')
    this.onResult = opts.onResult
    this.seed = opts.seed ?? 'ttg'
    this.bossIndex = Math.min(Math.max(1, opts.boss ?? 1), BOSS_DECKS.length)
    this.buildSkeleton()
    this.fx = new FxLayer(this.root)
    globalThis.addEventListener?.('resize', () => this.fx.resize())
    this.startMatch(this.bossIndex)
  }

  // -------------------------------------------------------------------------
  // Skeleton (built once)
  // -------------------------------------------------------------------------

  private buildSkeleton(): void {
    this.root.innerHTML = ''
    this.banner = this.div('ttg-banner')
    this.banner.appendChild(document.createElement('span'))
    this.vignette = this.div('ttg-vignette')

    this.nexus = { AI: this.buildNexus('ai'), HUMAN: this.buildNexus('human') }

    const board = this.div('ttg-board')
    this.laneEls = {} as Record<Lane, HTMLElement>
    this.halves = {} as Record<Lane, Record<Side, HTMLElement>>
    for (const lane of LANES) {
      const laneEl = this.div('ttg-lane')
      laneEl.dataset.lane = lane
      laneEl.addEventListener('click', () => this.onLaneClick(lane))
      const ai = this.div('half ai')
      const mid = this.div('mid')
      const label = document.createElement('span')
      label.textContent = lane
      mid.appendChild(label)
      const human = this.div('half human')
      laneEl.append(ai, mid, human)
      board.appendChild(laneEl)
      this.laneEls[lane] = laneEl
      this.halves[lane] = { AI: ai, HUMAN: human }
    }

    const controls = this.div('ttg-controls')
    this.turnEl = this.div('ttg-turn')
    this.hintEl = this.div('ttg-hint')
    this.endBtn = document.createElement('button')
    this.endBtn.className = 'ttg-btn'
    this.endBtn.textContent = 'End Turn'
    this.endBtn.addEventListener('click', () => this.onEndTurn())
    controls.append(this.turnEl, this.hintEl, this.endBtn)

    this.handEl = this.div('ttg-hand')

    this.root.append(
      this.banner,
      this.nexus.AI.el,
      board,
      controls,
      this.nexus.HUMAN.el,
      this.handEl,
      this.vignette,
    )
  }

  private buildNexus(side: 'ai' | 'human'): NexusRefs {
    const el = this.div(`ttg-nexus ${side}`)
    const portrait = this.div('ttg-portrait')
    portrait.textContent = side === 'ai' ? '🏰' : '🗼'
    const who = this.div('who')
    who.innerHTML = side === 'ai' ? 'Enemy Nexus<small></small>' : 'Your Nexus<small>Commander</small>'
    const hpwrap = this.div('ttg-hpwrap')
    const hpbar = this.div('ttg-hpbar')
    const hpFill = this.div('ttg-hpfill')
    const hpTxt = this.div('ttg-hptxt')
    hpbar.append(hpFill, hpTxt)
    hpwrap.appendChild(hpbar)
    const mana = this.div('ttg-mana')
    const manaNum = document.createElement('span')
    manaNum.className = 'num'
    const crystals = this.div('ttg-crystals')
    mana.append(manaNum, crystals)
    const deck = this.div('ttg-deck')
    const modules = this.div('ttg-modules')
    el.append(portrait, who, hpwrap, mana, deck, modules)
    return { el, hpFill, hpTxt, manaNum, crystals, deck, modules }
  }

  private div(cls: string): HTMLElement {
    const d = document.createElement('div')
    d.className = cls
    return d
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
    this.prevActive = null
    this.resetBoard()
    const sub = this.nexus.AI.el.querySelector('.who small')
    if (sub) sub.textContent = boss.name
    this.render()
  }

  private resetBoard(): void {
    this.overlay?.remove()
    this.overlay = null
    for (const n of this.unitNodes.values()) n.remove()
    this.unitNodes.clear()
    for (const n of this.cardNodes.values()) n.remove()
    this.cardNodes.clear()
    this.seenModules.clear()
    this.nexus.AI.modules.innerHTML = ''
    this.nexus.HUMAN.modules.innerHTML = ''
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
    this.showOverlay()
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
    if (this.busy || this.engine.snapshot().activeSide !== 'HUMAN' || this.engine.isOver()) return
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
      this.hint = 'Pick a lane ▾'
      this.render()
      return
    }
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
    this.hint = 'Pick a target ✷'
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
    this.doAction({ kind: 'playUltimate', uid: sel.uid, target: { kind: 'unit', uid } })
  }

  private flashHint(msg: string): void {
    this.hint = msg
    this.render()
  }

  private doAction(action: Action): void {
    // Capture the played card's screen box BEFORE it leaves the hand, for the fly animation.
    const originUid = 'uid' in action ? action.uid : undefined
    const fromRect =
      originUid !== undefined ? this.cardNodes.get(originUid)?.getBoundingClientRect() : undefined
    this.selection = null
    this.hint = ''
    const events = this.engine.apply(action)
    this.renderAndAnimate(events)
    if (fromRect) this.flyForAction(action, fromRect)
    if (this.engine.isOver()) this.finishMatch()
  }

  private onEndTurn(): void {
    if (this.busy || this.engine.isOver() || this.engine.snapshot().activeSide !== 'HUMAN') return
    this.selection = null
    this.busy = true
    this.hint = 'Opponent is planning…'
    const events = this.engine.apply({ kind: 'endTurn' })
    this.renderAndAnimate(events)
    if (this.engine.isOver()) {
      this.busy = false
      this.finishMatch()
      return
    }
    globalThis.setTimeout(() => this.runAiTurn(), 900)
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
    const events = this.ai.takeTurn()
    this.busy = false
    this.hint = ''
    this.renderAndAnimate(events)
    if (this.engine.isOver()) this.finishMatch()
  }

  // -------------------------------------------------------------------------
  // Render (reconcile to current state)
  // -------------------------------------------------------------------------

  private render(): void {
    this.computeLegal()
    const snap = this.engine.snapshot('HUMAN')
    this.updateNexus('AI', snap.players.AI)
    this.updateNexus('HUMAN', snap.players.HUMAN)
    this.reconcileUnits(snap)
    this.reconcileHand(snap.players.HUMAN)

    for (const lane of LANES) {
      const drop = this.selection?.kind === 'UNIT' && this.selection.lanes.has(lane)
      this.laneEls[lane].classList.toggle('droppable', !!drop)
    }

    this.turnEl.innerHTML = `Turn <b>${snap.turn}</b>`
    this.hintEl.textContent = this.hint
    const myTurn = !this.busy && !this.engine.isOver() && snap.activeSide === 'HUMAN'
    this.endBtn.disabled = !myTurn
    this.endBtn.classList.toggle('ready', myTurn)

    // Turn banner on a genuine side change.
    if (!this.engine.isOver() && snap.activeSide !== this.prevActive && this.prevActive !== null) {
      this.showBanner(snap.activeSide)
    }
    this.prevActive = snap.activeSide

    this.fx.resize()
  }

  private updateNexus(side: Side, p: PlayerView): void {
    const ref = this.nexus[side]
    const pct = Math.max(0, Math.min(1, p.maxLife > 0 ? p.life / p.maxLife : 0))
    ref.hpFill.style.width = `${pct * 100}%`
    ref.hpFill.classList.toggle('low', pct < 0.34)
    ref.hpTxt.textContent = `${Math.max(0, p.life)} / ${p.maxLife}`
    ref.manaNum.textContent = `${p.manaPool}/${p.manaMax}`
    const n = Math.min(10, Math.max(p.manaMax, p.manaPool))
    let crystals = ''
    for (let i = 0; i < n; i++) crystals += `<span class="ttg-cry ${i < p.manaPool ? 'on' : ''}"></span>`
    ref.crystals.innerHTML = crystals
    ref.deck.textContent = `⛃ ${p.deckCount}`

    ref.modules.innerHTML = ''
    for (const m of p.modules) {
      const d = this.div('ttg-module')
      d.title = `${m.name}`
      d.style.backgroundImage = `url('${cardArtUrl(m.cardId) ?? ''}')`
      if (!this.seenModules.has(m.uid)) {
        d.classList.add('pop')
        this.seenModules.add(m.uid)
      }
      ref.modules.appendChild(d)
    }
  }

  private reconcileUnits(snap: ReturnType<Engine['snapshot']>): void {
    const present = new Set<number>()
    for (const lane of LANES) {
      for (const side of ['AI', 'HUMAN'] as const) {
        snap.lanes[lane][side].forEach((u, i) => {
          present.add(u.uid)
          let node = this.unitNodes.get(u.uid)
          if (!node) {
            node = this.createUnitNode(u, side)
            this.unitNodes.set(u.uid, node)
          }
          this.updateUnitNode(node, u, i === 0)
          this.halves[lane][side].appendChild(node) // keeps stack order (front first)
        })
      }
    }
    for (const [uid, node] of this.unitNodes) {
      if (present.has(uid) || node.dataset.exiting) continue
      node.dataset.exiting = '1'
      node.classList.add('exit')
      node.addEventListener(
        'animationend',
        () => {
          node.remove()
          this.unitNodes.delete(uid)
        },
        { once: true },
      )
    }
  }

  private createUnitNode(u: UnitView, side: Side): HTMLElement {
    const node = this.div('ttg-unit enter')
    node.dataset.uid = String(u.uid)
    node.dataset.side = side
    node.dataset.rarity = getCard(u.cardId).rarity
    node.style.backgroundImage = `url('${cardArtUrl(u.cardId) ?? ''}')`
    node.innerHTML =
      '<div class="kw"></div><div class="status"></div>' +
      '<div class="ttg-badge atk"></div><div class="ttg-badge hp"></div><div class="nm"></div>'
    node.addEventListener('click', e => {
      e.stopPropagation()
      this.onUnitClick(u.uid)
    })
    node.addEventListener('animationend', e => {
      if ((e as AnimationEvent).animationName === 'ttg-unitenter') node.classList.remove('enter')
    })
    return node
  }

  private updateUnitNode(node: HTMLElement, u: UnitView, isFront: boolean): void {
    node.classList.toggle('front', isFront)
    node.classList.toggle('reserve', !isFront)
    node.classList.toggle('frozen', u.frozen)
    node.classList.toggle('tapped', u.tapped)
    const targetable = !!(this.selection?.needsTarget && this.selection.targets.has(u.uid))
    node.classList.toggle('targetable', targetable)

    const atkBadge = node.querySelector('.ttg-badge.atk') as HTMLElement
    const hpBadge = node.querySelector('.ttg-badge.hp') as HTMLElement
    const prevAtk = Number(node.dataset.atk ?? u.atk)
    if (u.atk > prevAtk) {
      atkBadge.classList.remove('buffed')
      void atkBadge.offsetWidth
      atkBadge.classList.add('buffed')
    }
    node.dataset.atk = String(u.atk)
    atkBadge.textContent = String(u.atk)
    hpBadge.textContent = String(u.hp)
    hpBadge.style.color = u.hp < u.maxHp ? '#7a1420' : '#0b0e14'

    const kw = node.querySelector('.kw') as HTMLElement
    kw.innerHTML = u.keywords
      .map(k => `<span>${k === 'firstStrike' ? 'FS' : k[0]!.toUpperCase()}</span>`)
      .join('')
    const status = node.querySelector('.status') as HTMLElement
    status.textContent = [u.frozen ? '❄' : '', u.tapped ? '💤' : '', u.invulnerable ? '🛡' : ''].join('')
    ;(node.querySelector('.nm') as HTMLElement).textContent = u.name
  }

  private reconcileHand(human: PlayerView): void {
    const hand = human.hand ?? []
    const present = new Set<number>()
    for (const ref of hand) {
      present.add(ref.uid)
      let node = this.cardNodes.get(ref.uid)
      if (!node) {
        node = this.createCardNode(ref.uid, ref.cardId)
        this.cardNodes.set(ref.uid, node)
      }
      const affordable =
        this.legalUnitLanes.has(ref.uid) ||
        this.legalModules.has(ref.uid) ||
        this.legalUltimates.has(ref.uid)
      node.classList.toggle('unaffordable', !affordable)
      node.classList.toggle('selected', this.selection?.uid === ref.uid)
      this.handEl.appendChild(node)
    }
    for (const [uid, node] of this.cardNodes) {
      if (present.has(uid) || node.dataset.exiting) continue
      node.dataset.exiting = '1'
      node.classList.add('exit')
      node.addEventListener(
        'animationend',
        () => {
          node.remove()
          this.cardNodes.delete(uid)
        },
        { once: true },
      )
    }
  }

  private createCardNode(uid: number, cardId: string): HTMLElement {
    const def = getCard(cardId)
    const node = this.div('ttg-card enter')
    node.dataset.card = String(uid)
    node.dataset.rarity = def.rarity
    node.style.backgroundImage = `url('${cardArtUrl(cardId) ?? ''}')`
    node.title = def.text
    const stats =
      def.type === 'UNIT'
        ? `<div class="stat-row"><b class="a">${def.atk ?? 0}</b><b class="h">${def.hp ?? 0}</b></div>`
        : ''
    node.innerHTML = `<div class="cost">${def.cost}</div><div class="cn">${def.name}</div><div class="ct">${def.type}</div>${stats}`
    node.addEventListener('click', () => this.onCardClick(uid))
    node.addEventListener('animationend', e => {
      if ((e as AnimationEvent).animationName === 'ttg-cardenter') node.classList.remove('enter')
    })
    return node
  }

  // -------------------------------------------------------------------------
  // Animation
  // -------------------------------------------------------------------------

  private rootRect(): DOMRect {
    return this.root.getBoundingClientRect()
  }

  private centerIn(rect: DOMRect | undefined): { x: number; y: number } | null {
    if (!rect) return null
    const r = this.rootRect()
    return { x: rect.left - r.left + rect.width / 2, y: rect.top - r.top + rect.height / 2 }
  }

  private renderAndAnimate(events: GameEvent[]): void {
    this.render()
    let shook = false
    for (const ev of events) {
      if (ev.type === 'damage' && ev.amount > 0) {
        const src = this.unitNodes.get(ev.sourceUid ?? -1)
        if (src) {
          const up = src.dataset.side === 'HUMAN'
          src.classList.remove('lunge-up', 'lunge-down')
          void src.offsetWidth
          src.classList.add(up ? 'lunge-up' : 'lunge-down')
        }
        const tgt = this.unitNodes.get(ev.targetUid)
        if (tgt) {
          tgt.classList.remove('hit')
          void tgt.offsetWidth
          tgt.classList.add('hit')
          const c = this.centerIn(tgt.getBoundingClientRect())
          if (c) this.fx.floatText(c.x, c.y, `-${ev.amount}`, ev.crit ? '#ffd257' : '#ff9550', ev.crit ? 27 : 20)
        }
      } else if (ev.type === 'nexusDamage' && ev.amount > 0) {
        const c = this.centerIn(this.nexus[ev.side].el.getBoundingClientRect())
        if (c) this.fx.floatText(c.x, c.y, `-${ev.amount}`, '#ff5b6e', 26)
        this.flashVignette('dmg')
        if (!shook) {
          this.shake()
          shook = true
        }
      } else if (ev.type === 'heal' && ev.amount > 0) {
        const node = ev.targetUid != null ? this.unitNodes.get(ev.targetUid) : undefined
        const box = node ? node.getBoundingClientRect() : this.nexus[ev.side].el.getBoundingClientRect()
        const c = this.centerIn(box)
        if (c) this.fx.floatText(c.x, c.y, `+${ev.amount}`, '#43e08a', 20)
        if (ev.targetUid == null) this.flashVignette('heal')
      } else if (ev.type === 'ultimateCast' && ev.target && ev.target.kind === 'unit') {
        const from = this.centerIn(this.nexus[ev.side].el.getBoundingClientRect())
        const to = this.centerIn(this.unitNodes.get(ev.target.uid)?.getBoundingClientRect())
        if (from && to) this.fx.beam(from.x, from.y, to.x, to.y, ev.side === 'AI' ? '#ff5b6e' : '#5b8cff')
      }
    }
  }

  private flyForAction(action: Action, fromRect: DOMRect): void {
    let toRect: DOMRect | undefined
    let art: string | undefined
    if (action.kind === 'playUnit') {
      toRect = this.unitNodes.get(action.uid)?.getBoundingClientRect()
      art = cardArtUrl(this.unitCardId(action.uid) ?? '')
    } else if (action.kind === 'playModule') {
      const mod = this.nexus.HUMAN.modules.lastElementChild as HTMLElement | null
      toRect = mod?.getBoundingClientRect()
      art = mod?.style.backgroundImage.slice(5, -2)
    } else if (action.kind === 'playUltimate') {
      const dest =
        action.target && action.target.kind === 'unit'
          ? this.unitNodes.get(action.target.uid)
          : this.nexus.AI.el
      toRect = dest?.getBoundingClientRect()
    }
    if (!toRect) return
    this.flyClone(fromRect, toRect, art)
  }

  private unitCardId(uid: number): string | null {
    const snap = this.engine.snapshot()
    for (const lane of LANES) for (const s of ['AI', 'HUMAN'] as const) {
      const u = snap.lanes[lane][s].find(x => x.uid === uid)
      if (u) return u.cardId
    }
    return null
  }

  private flyClone(from: DOMRect, to: DOMRect, art: string | undefined): void {
    const r = this.rootRect()
    const clone = this.div('ttg-fly')
    clone.style.left = `${from.left - r.left}px`
    clone.style.top = `${from.top - r.top}px`
    clone.style.width = `${from.width}px`
    clone.style.height = `${from.height}px`
    if (art) clone.style.backgroundImage = `url('${art}')`
    this.root.appendChild(clone)
    const dx = to.left - from.left + (to.width - from.width) / 2
    const dy = to.top - from.top + (to.height - from.height) / 2
    requestAnimationFrame(() => {
      clone.style.transform = `translate(${dx}px, ${dy}px) scale(${Math.max(0.4, to.width / from.width)})`
      clone.style.opacity = '0.2'
    })
    clone.addEventListener('transitionend', () => clone.remove(), { once: true })
    globalThis.setTimeout(() => clone.remove(), 600)
  }

  private flashVignette(kind: 'dmg' | 'heal'): void {
    this.vignette.classList.remove('dmg', 'heal')
    void this.vignette.offsetWidth
    this.vignette.classList.add(kind)
  }

  private shake(): void {
    this.root.classList.remove('shake')
    void this.root.offsetWidth
    this.root.classList.add('shake')
    this.root.addEventListener('animationend', () => this.root.classList.remove('shake'), { once: true })
  }

  private showBanner(active: Side): void {
    const span = this.banner.querySelector('span')!
    span.textContent = active === 'HUMAN' ? 'Your Turn' : 'Enemy Turn'
    this.banner.classList.remove('show', 'you', 'foe')
    this.banner.classList.add(active === 'HUMAN' ? 'you' : 'foe')
    void this.banner.offsetWidth
    this.banner.classList.add('show')
  }

  // -------------------------------------------------------------------------
  // Game-over overlay
  // -------------------------------------------------------------------------

  private showOverlay(): void {
    const res = this.engine.result()
    if (!res) return
    this.overlay?.remove()
    const boss = BOSS_DECKS[this.bossIndex - 1]!
    const won = res.winner === 'HUMAN'
    const last = this.bossIndex >= BOSS_DECKS.length
    const overlay = this.div('ttg-over')
    const h2 = document.createElement('h2')
    h2.className = won ? 'win' : 'lose'
    h2.textContent = won ? (last ? 'Ladder Cleared!' : 'Victory') : 'Defeated'
    const p = document.createElement('p')
    p.textContent = `Boss ${this.bossIndex}: ${boss.name} · ${res.turns} turns`
    const btn = document.createElement('button')
    btn.className = 'ttg-btn ready'
    btn.textContent = won ? (last ? 'Play Again' : 'Next Boss →') : 'Retry'
    btn.addEventListener('click', () => {
      if (won && last) this.startMatch(1)
      else if (won) this.startMatch(this.bossIndex + 1)
      else this.startMatch(this.bossIndex)
    })
    overlay.append(h2, p, btn)
    this.root.appendChild(overlay)
    this.overlay = overlay
  }

  destroy(): void {
    this.fx.destroy()
    this.root.innerHTML = ''
  }
}
