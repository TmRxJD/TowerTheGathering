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
  ALL_CARD_IDS,
  BATTLE_CONDITION_TIER,
  BOSS_DECKS,
  CARD_MAX_LEVEL,
  MASTERY_MAX_LEVEL,
  CARD_PROG,
  MAX_TIER,
  STARTER_DECK,
  cardEffectLabel,
  cardLevelValue,
  clampTier,
  formatCardValue,
  createEngine,
  getCard,
  rewardCandidates,
  tierAiDepth,
  tierBossHandicap,
  tierName,
  tierPlayerLifePenalty,
  TUNING,
  type Action,
  type CardLevels,
  type Engine,
  type GameEvent,
  type Lane,
  type PlayerView,
  type Side,
  type Target,
  type UnitView,
} from '../engine'
import { SearchAI } from '../ai'
import { cardArtUrl, portraitUrl } from './card-art'
import { FxLayer } from './fx-layer'
import { loadSave, writeSave, type SaveState } from './save'

const LANES: readonly Lane[] = ['LEFT', 'CENTER', 'RIGHT']

/** Plain-language keyword meanings shown in the hover preview and help panel. */
const KEYWORD_INFO: Record<string, string> = {
  defender: 'Defender — enemies must destroy it before hitting units behind it.',
  firstStrike: 'First Strike — deals its damage before the enemy strikes back.',
  reach: 'Reach — can strike an adjacent lane when its own lane is clear.',
  spillover: 'Spillover — leftover (overkill) damage carries to the enemy Nexus.',
  trap: 'Trap — triggers and is destroyed when an enemy enters its lane.',
}

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
  portrait: HTMLElement
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
  private ai!: SearchAI
  private humanAi!: SearchAI
  private bossIndex: number
  private tier = 1
  private selection: Selection | null = null
  private busy = false
  private hint = ''
  private prevActive: Side | null = null
  private watching = false
  private watchTimer: ReturnType<typeof setTimeout> | null = null
  /** The player's deck for the current ladder run; grows/trims via the reward step between bosses. */
  private playerDeck: string[] = [...STARTER_DECK]
  private save: SaveState = { highestTierCleared: 0, run: null, collection: {}, shards: 0 }
  private collSort: 'cost' | 'rarity' | 'type' = 'cost'
  private toastEl!: HTMLElement
  /** True during a menu "Watch Demo" run — a throwaway ladder that never touches the saved run. */
  private demo = false
  /** The constructor sets up a backdrop match behind the menu; don't persist it as a real run until
   *  the player actually starts one from the menu. */
  private started = false

  // persistent skeleton refs
  private ladderEl!: HTMLElement
  private bossSelect!: HTMLSelectElement
  private watchBtn!: HTMLButtonElement
  private previewEl!: HTMLElement
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
    this.save = loadSave()
    if (this.save.run) {
      this.playerDeck = [...this.save.run.deck]
      this.bossIndex = this.save.run.bossIndex
      this.tier = this.save.run.tier
    }
    this.buildSkeleton()
    this.fx = new FxLayer(this.root)
    globalThis.addEventListener?.('resize', () => this.fx.resize())
    this.startMatch(this.bossIndex)
    this.showMenu()
  }

  /** Persist the current run + best progress. A demo run never persists. */
  private persist(): void {
    if (this.demo || !this.started) return
    this.save.run = { tier: this.tier, bossIndex: this.bossIndex, deck: [...this.playerDeck] }
    writeSave(this.save)
  }

  // -------------------------------------------------------------------------
  // Skeleton (built once)
  // -------------------------------------------------------------------------

  private buildSkeleton(): void {
    this.root.innerHTML = ''

    const header = this.div('ttg-header')
    const logo = this.div('ttg-logo')
    logo.textContent = 'Tower: The Gathering'
    this.ladderEl = this.div('ttg-ladder')
    const spacer = this.div('spacer')
    this.bossSelect = document.createElement('select')
    this.bossSelect.className = 'ttg-select'
    for (const b of BOSS_DECKS) {
      const opt = document.createElement('option')
      opt.value = String(b.index)
      opt.textContent = `Boss ${b.index} · ${b.name}`
      this.bossSelect.appendChild(opt)
    }
    this.bossSelect.addEventListener('change', () => this.startMatch(Number(this.bossSelect.value) || 1))
    this.watchBtn = document.createElement('button')
    this.watchBtn.className = 'ttg-mini'
    this.watchBtn.textContent = '▶ Autoplay'
    this.watchBtn.title = 'Autoplay — watch the AI play both sides'
    this.watchBtn.addEventListener('click', () => this.toggleWatch())
    const restartBtn = document.createElement('button')
    restartBtn.className = 'ttg-mini'
    restartBtn.textContent = '↻'
    restartBtn.title = 'Restart this match'
    restartBtn.addEventListener('click', () => this.startMatch(this.bossIndex))
    const deckBtn = document.createElement('button')
    deckBtn.className = 'ttg-mini'
    deckBtn.textContent = '🂡 Deck'
    deckBtn.title = 'View your deck'
    deckBtn.addEventListener('click', () => this.showDeck())
    const helpBtn = document.createElement('button')
    helpBtn.className = 'ttg-mini'
    helpBtn.textContent = '?'
    helpBtn.title = 'How to play'
    helpBtn.addEventListener('click', () => this.showHelp())
    header.append(logo, this.ladderEl, spacer, this.bossSelect, this.watchBtn, deckBtn, restartBtn, helpBtn)

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

    this.previewEl = this.div('ttg-preview')
    this.previewEl.style.display = 'none'
    this.toastEl = this.div('ttg-toast')
    this.toastEl.style.display = 'none'

    this.root.append(
      header,
      this.banner,
      this.nexus.AI.el,
      board,
      controls,
      this.nexus.HUMAN.el,
      this.handEl,
      this.previewEl,
      this.toastEl,
      this.vignette,
    )
  }

  private buildNexus(side: 'ai' | 'human'): NexusRefs {
    const el = this.div(`ttg-nexus ${side}`)
    const portrait = this.div('ttg-portrait')
    if (side === 'human') {
      const url = portraitUrl('player')
      if (url) {
        portrait.style.backgroundImage = `url('${url}')`
        portrait.classList.add('img', 'contain')
      } else portrait.textContent = '🗼'
    }
    // The AI portrait is set per match from the boss name (see startMatch).
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
    return { el, portrait, hpFill, hpTxt, manaNum, crystals, deck, modules }
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
    const hc = tierBossHandicap(this.tier, bossIndex)
    const depth = tierAiDepth(this.tier)
    const { engine } = createEngine({
      humanDeck: this.playerDeck,
      aiDeck: boss.cards,
      seed: `${this.seed}-t${this.tier}-b${bossIndex}`,
      bonusLife: { AI: hc.bonusLife, HUMAN: -tierPlayerLifePenalty(this.tier) },
      bonusStartMana: { AI: hc.bonusStartMana },
      // Your leveled collection vs bosses whose cards level up with the tier.
      cardLevels: { HUMAN: this.demo ? {} : this.save.collection, AI: this.aiCardLevels() },
    })
    this.engine = engine
    this.ai = new SearchAI(engine, 'AI', boss.archetype, depth)
    this.humanAi = new SearchAI(engine, 'HUMAN', 'balanced', depth)
    this.selection = null
    this.busy = false
    this.hint = ''
    this.prevActive = null
    if (this.watchTimer) clearTimeout(this.watchTimer)
    this.resetBoard()
    const sub = this.nexus.AI.el.querySelector('.who small')
    if (sub) sub.textContent = boss.name
    const portrait = portraitUrl(boss.name)
    if (portrait) {
      this.nexus.AI.portrait.style.backgroundImage = `url('${portrait}')`
      this.nexus.AI.portrait.classList.add('img')
      this.nexus.AI.portrait.textContent = ''
    } else {
      this.nexus.AI.portrait.classList.remove('img')
      this.nexus.AI.portrait.textContent = '🏰'
    }
    this.bossSelect.value = String(this.bossIndex)
    this.persist()
    this.render()
    if (this.watching) this.watchTimer = globalThis.setTimeout(() => this.autoStep(), 700)
  }

  private resetBoard(): void {
    this.overlay?.remove()
    this.overlay = null
    this.root.querySelectorAll('.ttg-modal, .ttg-help').forEach(n => n.remove())
    this.hidePreview()
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
    if (this.demo) {
      this.demo = false
      this.showMenu()
      return
    }
    // Winning a boss earns shards. Income scales with tier² so higher tiers are the real source and
    // maxing the whole collection is a long, climb-the-ladder grind — not something tier 1 can do.
    if (res.winner === 'HUMAN') {
      const gained = this.tier * this.tier * 2 + this.bossIndex
      this.save.shards += gained
      if (this.bossIndex >= BOSS_DECKS.length) {
        this.save.highestTierCleared = Math.max(this.save.highestTierCleared, this.tier)
      }
      writeSave(this.save)
      this.showToast(`+${gained} shards`)
    }
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
    if (this.watching || this.busy || this.engine.snapshot().activeSide !== 'HUMAN' || this.engine.isOver())
      return
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
    this.hidePreview()
    this.selection = null
    this.hint = ''
    const events = this.engine.apply(action)
    this.renderAndAnimate(events)
    if (fromRect) this.flyForAction(action, fromRect)
    if (this.engine.isOver()) this.finishMatch()
  }

  private toggleWatch(): void {
    this.watching = !this.watching
    if (this.watching) {
      this.selection = null
      this.hint = ''
      this.render()
      if (!this.engine.isOver()) this.watchTimer = globalThis.setTimeout(() => this.autoStep(), 400)
    } else {
      if (this.watchTimer) clearTimeout(this.watchTimer)
      this.watchTimer = null
      this.render()
    }
  }

  /** One autoplay step = one full turn by whichever side is active, then a beat before the next. */
  private autoStep(): void {
    if (!this.watching) return
    if (this.engine.isOver()) return this.onWatchGameOver()
    const active = this.engine.snapshot().activeSide
    const bot = active === 'AI' ? this.ai : this.humanAi
    const events = bot.takeTurn()
    this.renderAndAnimate(events)
    if (this.engine.isOver()) return this.onWatchGameOver()
    this.watchTimer = globalThis.setTimeout(() => this.autoStep(), 1000)
  }

  /** When a demo match ends: if the AI won a non-final boss, roll on to the next one (rewards are
   *  auto-skipped during a demo) so Watch Demo plays the whole ladder. Otherwise stop and show the
   *  result. */
  private onWatchGameOver(): void {
    const res = this.engine.result()
    // A DEMO plays the whole ladder; autoplaying a real run stops after the match for the reward flow.
    if (this.demo && res && res.winner === 'HUMAN' && this.bossIndex < BOSS_DECKS.length && this.watching) {
      this.watchTimer = globalThis.setTimeout(() => {
        if (this.watching) this.advanceBoss() // startMatch re-arms autoStep while watching
      }, 1500)
      return
    }
    this.watching = false
    this.finishMatch()
  }

  private onEndTurn(): void {
    if (this.watching || this.busy || this.engine.isOver() || this.engine.snapshot().activeSide !== 'HUMAN')
      return
    this.hidePreview()
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
    const live = !this.engine.isOver()
    this.nexus.HUMAN.el.classList.toggle('active', live && snap.activeSide === 'HUMAN')
    this.nexus.AI.el.classList.toggle('active', live && snap.activeSide === 'AI')
    this.reconcileUnits(snap)
    this.reconcileHand(snap.players.HUMAN)

    for (const lane of LANES) {
      const drop = this.selection?.kind === 'UNIT' && this.selection.lanes.has(lane)
      this.laneEls[lane].classList.toggle('droppable', !!drop)
    }
    this.root.classList.toggle('targeting', !!this.selection?.needsTarget)

    // Ladder header
    const boss = BOSS_DECKS[this.bossIndex - 1]!
    let dots = ''
    for (let i = 1; i <= BOSS_DECKS.length; i++) {
      const cls = i < this.bossIndex ? 'done' : i === this.bossIndex ? 'cur' : ''
      dots += `<span class="dot ${cls}"></span>`
    }
    const cond = this.tier >= BATTLE_CONDITION_TIER ? ' <span class="cond">⚠ conditions</span>' : ''
    this.ladderEl.innerHTML = `<b>${tierName(this.tier)}</b> · Boss ${this.bossIndex}/${BOSS_DECKS.length} · ${boss.name} <span class="pipline">${dots}</span>${cond}`
    this.watchBtn.classList.toggle('active', this.watching)
    this.watchBtn.textContent = this.watching ? '⏸ Autoplay' : '▶ Autoplay'

    this.turnEl.innerHTML = `Turn <b>${snap.turn}</b>`
    this.hintEl.textContent = this.hint
    const myTurn = !this.busy && !this.watching && !this.engine.isOver() && snap.activeSide === 'HUMAN'
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
      this.applyArt(d, m.cardId)
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
    this.applyArt(node, u.cardId)
    node.innerHTML =
      '<div class="kw"></div><div class="status"></div>' +
      '<div class="ttg-badge atk"></div><div class="ttg-badge hp"></div><div class="nm"></div>'
    node.addEventListener('click', e => {
      e.stopPropagation()
      this.onUnitClick(u.uid)
    })
    node.addEventListener('mouseenter', () => this.showPreview(u.cardId, node.getBoundingClientRect()))
    node.addEventListener('mouseleave', () => this.hidePreview())
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
    node.title = def.text
    const stats =
      def.type === 'UNIT'
        ? `<div class="stat-row"><b class="a">${def.atk ?? 0}</b><b class="h">${def.hp ?? 0}</b></div>`
        : ''
    node.innerHTML =
      `<div class="cost">${def.cost}</div>` +
      `<div class="card-art">${stats}</div>` +
      `<div class="cn">${def.name}</div><div class="ct">${def.type}</div>`
    this.applyArt(node.querySelector('.card-art') as HTMLElement, cardId)
    node.addEventListener('click', () => this.onCardClick(uid))
    node.addEventListener('mouseenter', () => this.showPreview(cardId, node.getBoundingClientRect()))
    node.addEventListener('mouseleave', () => this.hidePreview())
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

  /** Screen centers of every unit belonging to the caster's opponent — for board-wide cast FX. */
  private enemyCenters(caster: Side): Array<{ x: number; y: number }> {
    const opp = caster === 'HUMAN' ? 'AI' : 'HUMAN'
    const out: Array<{ x: number; y: number }> = []
    for (const node of this.unitNodes.values()) {
      if (node.dataset.side !== opp) continue
      const c = this.centerIn(node.getBoundingClientRect())
      if (c) out.push(c)
    }
    return out
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
          if (c) {
            this.fx.floatText(c.x, c.y, `-${ev.amount}`, ev.crit ? '#ffd257' : '#ff9550', ev.crit ? 27 : 20)
            this.fx.burst(c.x, c.y, ev.crit ? '#ffd257' : '#ffa060', ev.crit ? 12 : 7, 0.32)
          }
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
      } else if (ev.type === 'unitDied') {
        const node = this.unitNodes.get(ev.uid)
        const c = node ? this.centerIn(node.getBoundingClientRect()) : null
        if (c) this.fx.burst(c.x, c.y, ev.side === 'AI' ? '#ff6b7e' : '#7fb0ff', 18, 0.5)
      } else if (ev.type === 'ultimateCast') {
        this.castFx(ev.cardId, ev.side, ev.target)
        if (ev.side === 'AI') this.showToast(`Enemy casts ${getCard(ev.cardId).name}`)
      }
    }
  }

  /** Distinct cast visual per ultimate — a beam + coloured impact ring/burst for targeted spells,
   *  a board flash + shake for Nuke, and a sparkle on your own nexus for economy/utility spells. */
  private castFx(cardId: string, side: Side, target: Target | undefined): void {
    const self = this.centerIn(this.nexus[side].el.getBoundingClientRect())
    const node = target && target.kind === 'unit' ? this.unitNodes.get(target.uid) : undefined
    const t = node ? this.centerIn(node.getBoundingClientRect()) : null
    const beam = (color: string) => {
      if (self && t) this.fx.beam(self.x, self.y, t.x, t.y, color)
    }
    const sparkle = (color: string) => {
      if (self) {
        this.fx.ring(self.x, self.y, color, 40)
        this.fx.burst(self.x, self.y, color, 10, 0.3)
      }
    }
    switch (cardId) {
      case 'death-ray':
        beam('#ff3b5c')
        if (t) {
          this.fx.ring(t.x, t.y, '#ff3b5c', 74)
          this.fx.burst(t.x, t.y, '#ff5b6e', 22, 0.65)
        }
        this.shake()
        break
      case 'plasma-cannon':
        beam('#b07bff')
        if (t) {
          this.fx.ring(t.x, t.y, '#b07bff', 56)
          this.fx.burst(t.x, t.y, '#c78bff', 12, 0.42)
        }
        break
      case 'energy-net':
        if (t) {
          this.fx.ring(t.x, t.y, '#6fe0ff', 52)
          this.fx.burst(t.x, t.y, '#8fd0ff', 14, 0.28)
        }
        break
      case 'demon-mode':
        if (t) {
          this.fx.ring(t.x, t.y, '#ff4d4d', 54)
          this.fx.burst(t.x, t.y, '#ff6b6b', 16, 0.5)
        }
        break
      case 'ultimate-crit':
        if (t) {
          this.fx.ring(t.x, t.y, '#ffd257', 54)
          this.fx.burst(t.x, t.y, '#ffd257', 14, 0.4)
        }
        break
      case 'recovery-package':
        if (t) {
          this.fx.ring(t.x, t.y, '#43e08a', 50)
          this.fx.burst(t.x, t.y, '#5ff0a0', 12, 0.32)
        }
        break
      case 'nuke':
        this.fx.flash('#ff5b6e')
        this.shake()
        break
      case 'chain-lightning': {
        // A bolt from the tower to the first target, then arcing on to nearby enemies.
        if (self && t) this.fx.bolt(self.x, self.y, t.x, t.y, '#bff2ff')
        if (t) this.fx.explode(t.x, t.y, '#8fe4ff', 0.4)
        let prev = t
        for (const c of this.enemyCenters(side).filter(c => !t || Math.hypot(c.x - t.x, c.y - t.y) > 6).slice(0, 2)) {
          if (prev) this.fx.bolt(prev.x, prev.y, c.x, c.y, '#bff2ff')
          this.fx.explode(c.x, c.y, '#8fe4ff', 0.3)
          prev = c
        }
        break
      }
      case 'smart-missiles':
        for (const c of this.enemyCenters(side)) this.fx.explode(c.x, c.y, '#ffb060', 0.5)
        this.shake()
        break
      case 'black-hole':
        for (const c of this.enemyCenters(side)) {
          this.fx.ring(c.x, c.y, '#b07bff', 62)
          this.fx.burst(c.x, c.y, '#c78bff', 16, 0.4)
        }
        break
      case 'chrono-field':
        this.fx.flash('#6fe0ff')
        for (const c of this.enemyCenters(side)) this.fx.ring(c.x, c.y, '#6fe0ff', 44)
        break
      case 'spotlight':
        if (t) {
          this.fx.ring(t.x, t.y, '#ffd257', 56)
          this.fx.burst(t.x, t.y, '#ffe08a', 12, 0.3)
        }
        break
      case 'shrink-ray':
        if (t) {
          this.fx.ring(t.x, t.y, '#c78bff', 40)
          this.fx.burst(t.x, t.y, '#c78bff', 10, 0.25)
        }
        break
      case 'cash':
      case 'coins':
        sparkle('#ffd257')
        break
      case 'wave-skip':
        sparkle('#6fe0ff')
        break
      case 'intro-sprint':
      case 'free-upgrades':
        sparkle('#7fb0ff')
        break
      case 'second-wind':
        sparkle('#ffd257')
        break
      default:
        if (t) beam(side === 'AI' ? '#ff5b6e' : '#5b8cff')
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

  private toastTimer: ReturnType<typeof setTimeout> | null = null
  private showToast(text: string): void {
    this.toastEl.textContent = text
    this.toastEl.style.display = 'block'
    this.toastEl.classList.remove('show')
    void this.toastEl.offsetWidth
    this.toastEl.classList.add('show')
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = globalThis.setTimeout(() => {
      this.toastEl.classList.remove('show')
      this.toastEl.style.display = 'none'
    }, 1800)
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
  // Card hover preview + help
  // -------------------------------------------------------------------------

  private showPreview(cardId: string, rect: DOMRect): void {
    const def = getCard(cardId)
    const stats =
      def.type === 'UNIT'
        ? `<span class="pv-stat atk">${def.atk ?? 0} ATK</span><span class="pv-stat hp">${def.hp ?? 0} HP</span>`
        : ''
    const kw = (def.keywords ?? [])
      .map(k => `<div class="pv-kwline">${KEYWORD_INFO[k] ?? k}</div>`)
      .join('')
    this.previewEl.dataset.rarity = def.rarity
    this.previewEl.innerHTML =
      `<div class="pv-art"></div>` +
      `<div class="pv-head"><span class="pv-cost">${def.cost}</span><span class="pv-name">${def.name}</span></div>` +
      `<div class="pv-meta">${def.type} · ${def.rarity}</div>` +
      (stats ? `<div class="pv-stats">${stats}</div>` : '') +
      `<div class="pv-text">${def.text}</div>` +
      (kw ? `<div class="pv-kw">${kw}</div>` : '')
    this.applyArt(this.previewEl.querySelector('.pv-art') as HTMLElement, cardId)
    this.previewEl.style.display = 'block'
    const r = this.rootRect()
    const pw = this.previewEl.offsetWidth
    const ph = this.previewEl.offsetHeight
    let left = rect.left - r.left + rect.width / 2 - pw / 2
    left = Math.max(8, Math.min(left, r.width - pw - 8))
    let top = rect.top - r.top - ph - 10
    if (top < 6) top = rect.bottom - r.top + 10 // flip below if it would clip the top
    this.previewEl.style.left = `${left}px`
    this.previewEl.style.top = `${top}px`
  }

  private hidePreview(): void {
    this.previewEl.style.display = 'none'
  }

  private showHelp(): void {
    this.root.querySelector('.ttg-help')?.remove()
    const kw = Object.values(KEYWORD_INFO)
      .map(v => `<li>${v}</li>`)
      .join('')
    const el = this.div('ttg-help')
    el.innerHTML =
      `<div class="help-card">` +
      `<h3>How to play</h3>` +
      `<p><b>Goal:</b> drop the enemy Nexus to 0 HP. You start at 20; the ladder bosses start tougher.</p>` +
      `<p><b>Each turn:</b> you gain +1 mana (max 10) and draw a card. Spend mana to play cards, then press <b>End Turn</b> to fight.</p>` +
      `<p><b>Lanes:</b> units stack in the Left / Center / Right lanes. Only the <b>front</b> unit fights each turn; it trades damage with the enemy's front unit. A lane with no enemy unit sends your front unit's damage straight to the Nexus.</p>` +
      `<p><b>Card types:</b> <b>Units</b> fight in a lane · <b>Modules</b> give lasting effects from your backline (max ${TUNING.BACKLINE_SLOTS}) · <b>Ultimates</b> are one-time spells.</p>` +
      `<p><b>Deck-out:</b> once your deck is empty, drawing hurts you a little more each time — so games always end.</p>` +
      `<p><b>Keywords:</b></p><ul>${kw}</ul>` +
      `<p class="help-tip">Tip: hover any card to see it full-size. Use <b>Autoplay</b> to watch the AI play both sides.</p>` +
      `<button class="ttg-btn ready">Got it</button>` +
      `</div>`
    el.addEventListener('click', e => {
      if (e.target === el || (e.target as HTMLElement).tagName === 'BUTTON') el.remove()
    })
    this.root.appendChild(el)
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
    h2.textContent = won ? (last ? `${tierName(this.tier)} Cleared!` : 'Victory') : 'Defeated'
    const p = document.createElement('p')
    if (won && last) {
      p.textContent =
        this.tier < MAX_TIER
          ? `${tierName(this.tier)} conquered — ${tierName(this.tier + 1)} unlocked!`
          : `You conquered all ${MAX_TIER} tiers. Legendary.`
    } else {
      p.textContent = `${tierName(this.tier)} · Boss ${this.bossIndex}: ${boss.name} · ${res.turns} turns`
    }
    const btn = document.createElement('button')
    btn.className = 'ttg-btn ready'
    btn.textContent = won ? (last ? 'Menu →' : 'Choose Reward →') : 'Retry'
    btn.addEventListener('click', () => {
      overlay.remove()
      this.overlay = null
      if (won && last) {
        this.save.run = null // run finished; the menu lets you pick a tier for a fresh run
        writeSave(this.save)
        this.showMenu()
      } else if (won) {
        this.showReward() // pick a card, trim, then advance
      } else {
        this.startMatch(this.bossIndex) // retry same boss, same deck
      }
    })
    overlay.append(h2, p, btn)
    this.root.appendChild(overlay)
    this.overlay = overlay
  }

  /** Bosses' cards level up with the tier (and gain masteries deep in), so higher tiers hit harder
   *  through smarter/stronger cards, not just raw life. */
  private aiCardLevels(): CardLevels {
    const level = Math.min(CARD_MAX_LEVEL, 1 + Math.floor((this.tier - 1) / 3))
    // From tier 13 the bosses' masteries come online and level up with the tier (13→1 … 21→9).
    const mastery = this.tier >= 13 ? Math.min(MASTERY_MAX_LEVEL, this.tier - 12) : 0
    const out: CardLevels = {}
    for (const id of ALL_CARD_IDS) out[id] = { level, mastery }
    return out
  }

  private resetLadder(tier = this.tier): void {
    this.demo = false
    this.tier = clampTier(tier)
    this.playerDeck = [...STARTER_DECK]
    this.bossIndex = 1
  }

  private advanceBoss(): void {
    this.startMatch(this.bossIndex + 1)
  }

  // -------------------------------------------------------------------------
  // Start menu
  // -------------------------------------------------------------------------

  private showMenu(): void {
    this.root.querySelector('.ttg-menu')?.remove()
    if (this.watchTimer) clearTimeout(this.watchTimer)
    this.watching = false
    this.demo = false
    const run = this.save.run
    const unlockedMax = clampTier(this.save.highestTierCleared + 1) // gate: play up to the next tier
    const best =
      this.save.highestTierCleared > 0
        ? `<div class="menu-best">Highest tier cleared: ${tierName(this.save.highestTierCleared)}${this.save.highestTierCleared >= MAX_TIER ? ' — all tiers!' : ''}</div>`
        : `<div class="menu-best">Clear a tier's 10 bosses to unlock the next.</div>`

    // Tier picker (only unlocked tiers). Defaults to the run's tier, else the newest unlocked.
    let opts = ''
    for (let t = 1; t <= unlockedMax; t++) {
      const sel = t === (run?.tier ?? unlockedMax) ? ' selected' : ''
      const cond = t >= BATTLE_CONDITION_TIER ? ' ⚠' : ''
      opts += `<option value="${t}"${sel}>${tierName(t)}${cond}</option>`
    }
    const locked = unlockedMax < MAX_TIER ? ` <span class="tier-locked">🔒 ${tierName(unlockedMax + 1)}+</span>` : ''
    const tierRow = `<div class="menu-tier">Tier: <select class="ttg-select" id="ttg-tiersel">${opts}</select>${locked}</div>`

    const primary = run
      ? `<button class="ttg-btn ready" data-m="continue">▶ Continue — ${tierName(run.tier)}, Boss ${run.bossIndex}</button>` +
        `<button class="ttg-mini" data-m="new">↺ New Run (selected tier)</button>`
      : `<button class="ttg-btn ready" data-m="new">▶ Start Run</button>`

    const el = this.div('ttg-menu')
    el.innerHTML =
      `<div class="menu-card">` +
      `<div class="menu-logo">Tower: The Gathering</div>` +
      `<div class="menu-sub">A 1v1 mana lane battler — climb the 10-boss ladder across ${MAX_TIER} tiers.</div>` +
      best +
      tierRow +
      `<div class="menu-btns">` +
      primary +
      `<button class="ttg-mini" data-m="collection">🃏 Collection (💠 ${this.fmtShards(this.save.shards)})</button>` +
      `<button class="ttg-mini" data-m="watch">👁 Watch Demo</button>` +
      `<button class="ttg-mini" data-m="help">? How to Play</button>` +
      `<button class="ttg-mini menu-reset" data-m="reset">♻ Reset Progress</button>` +
      `</div></div>`
    const tierSel = () => Number((el.querySelector('#ttg-tiersel') as HTMLSelectElement | null)?.value) || 1
    el.querySelectorAll<HTMLElement>('[data-m]').forEach(b =>
      b.addEventListener('click', () => {
        const m = b.dataset.m
        if (m === 'help') {
          this.showHelp()
          return
        }
        if (m === 'collection') {
          this.showCollection()
          return
        }
        if (m === 'reset') {
          this.confirmResetProgress()
          return
        }
        el.remove()
        if (m === 'continue' && this.save.run) {
          this.started = true
          this.demo = false
          this.tier = this.save.run.tier
          this.playerDeck = [...this.save.run.deck]
          this.startMatch(this.save.run.bossIndex)
        } else if (m === 'watch') {
          this.demo = true
          this.tier = tierSel()
          this.playerDeck = [...STARTER_DECK]
          this.startMatch(1)
          this.toggleWatch()
        } else {
          this.started = true
          this.resetLadder(tierSel())
          this.startMatch(1)
        }
      }),
    )
    this.root.appendChild(el)
  }

  // -------------------------------------------------------------------------
  // Collection (card levels + masteries)
  // -------------------------------------------------------------------------

  private collEntry(cardId: string): { level: number; mastery: number } {
    return this.save.collection[cardId] ?? { level: 1, mastery: 0 }
  }

  /** Escalating level cost — early levels are affordable, maxing a card is a real investment.
   *  L1→2: 6 · 2→3: 24 · 3→4: 54 · 4→5: 96 · 5→6: 150 · 6→7: 216  (546 to max one card's levels). */
  private levelCost(level: number): number {
    return level * level * 6
  }
  /** Mastery is the long-term sink: unlock 60, then +60 per level (2700 for a full 0→9).
   *  A single card fully maxed ≈ 3246; the whole 62-card collection ≈ 200k shards. */
  private masteryCost(mastery: number): number {
    return 60 * (mastery + 1)
  }

  /** Shard total display — compact for large balances (12345 → "12.3k"). */
  private fmtShards(n: number): string {
    if (n >= 100000) return `${Math.floor(n / 1000)}k`
    if (n >= 10000) return `${(Math.floor(n / 100) / 10).toFixed(1)}k`
    return String(n)
  }

  /** Wipe all saved progress (tiers, collection, shards, run) after confirmation, then reset to a
   *  fresh menu. Irreversible — hence the explicit confirm step. */
  private confirmResetProgress(): void {
    this.root.querySelector('.ttg-confirm')?.remove()
    const el = this.div('ttg-modal ttg-confirm')
    el.innerHTML =
      `<div class="modal-card confirm-card">` +
      `<h3>Reset all progress?</h3>` +
      `<div class="modal-sub">This permanently clears every cleared tier, all card levels &amp; masteries, and your ${this.fmtShards(this.save.shards)} 💠. This cannot be undone.</div>` +
      `<div class="confirm-btns"><button class="ttg-mini" data-c="cancel">Cancel</button><button class="ttg-btn danger" data-c="reset">Reset everything</button></div>` +
      `</div>`
    el.querySelectorAll<HTMLElement>('[data-c]').forEach(b =>
      b.addEventListener('click', () => {
        if (b.dataset.c === 'reset') {
          this.save = { highestTierCleared: 0, run: null, collection: {}, shards: 0 }
          writeSave(this.save)
          el.remove()
          this.showMenu()
        } else {
          el.remove()
        }
      }),
    )
    el.addEventListener('click', e => {
      if (e.target === el) el.remove()
    })
    this.root.appendChild(el)
  }

  /** Order the collection by the active sort key. */
  private sortedCardIds(): string[] {
    const rarityRank = { epic: 0, rare: 1, common: 2 } as const
    const typeRank = { UNIT: 0, MODULE: 1, ULTIMATE: 2 } as const
    const byCost = (a: string, b: string) =>
      getCard(a).cost - getCard(b).cost || getCard(a).name.localeCompare(getCard(b).name)
    return [...ALL_CARD_IDS].sort((a, b) => {
      if (this.collSort === 'rarity') return rarityRank[getCard(a).rarity] - rarityRank[getCard(b).rarity] || byCost(a, b)
      if (this.collSort === 'type') return typeRank[getCard(a).type] - typeRank[getCard(b).type] || byCost(a, b)
      return byCost(a, b)
    })
  }

  /** Collection: a compact grid of card faces (no scroll). Persistent close ✕, sort, number legend. */
  private showCollection(): void {
    this.root.querySelector('.ttg-collection')?.remove()
    const el = this.div('ttg-modal ttg-collection')
    const card = this.div('modal-card')

    const sortBtns = (['cost', 'rarity', 'type'] as const)
      .map(k => `<button class="coll-sort${this.collSort === k ? ' on' : ''}" data-sort="${k}">${k[0]!.toUpperCase()}${k.slice(1)}</button>`)
      .join('')
    card.innerHTML =
      `<h3>Collection · 💠 ${this.fmtShards(this.save.shards)}</h3>` +
      `<div class="modal-sub">Win battles to earn 💠 shards — spend them to level cards (1→7) and their Mastery (1→9). Tap a card.</div>` +
      `<div class="coll-legend"><span class="lg-cost">◆</span> mana cost · <span class="lg-lvl">L1</span> your level · <span class="lg-stat">2 / 4</span> ATK / HP (units)</div>` +
      `<div class="coll-toolbar"><span>Sort:</span> ${sortBtns}</div>`
    const grid = this.div('coll-faces')
    for (const id of this.sortedCardIds()) {
      const { level, mastery } = this.collEntry(id)
      grid.appendChild(this.cardFace(id, 'mini', () => this.showCardDetail(id), `${mastery > 0 ? '★' : ''}L${level}`))
    }
    card.appendChild(grid)
    el.appendChild(card)

    // Persistent close, anchored to the overlay (viewport corner) so it never scrolls out of reach.
    const x = document.createElement('button')
    x.className = 'modal-x'
    x.title = 'Close'
    x.textContent = '✕'
    el.appendChild(x)

    const close = () => el.remove()
    x.addEventListener('click', close)
    card.querySelectorAll<HTMLElement>('.coll-sort').forEach(b =>
      b.addEventListener('click', () => {
        this.collSort = (b.dataset.sort as 'cost' | 'rarity' | 'type') ?? 'cost'
        this.showCollection()
      }),
    )
    el.addEventListener('click', e => {
      if (e.target === el) close()
    })
    this.root.appendChild(el)
  }

  /** Full card detail (mirrors the game): rarity, art, one effect line, a level strip, and the
   *  Mastery track. One number, one place — the current value already folds in the mastery bonus. */
  private showCardDetail(cardId: string): void {
    this.root.querySelector('.ttg-detail')?.remove()
    const def = getCard(cardId)
    const prog = CARD_PROG[cardId]
    const { level, mastery } = this.collEntry(cardId)
    const max = level >= CARD_MAX_LEVEL
    const masteryMaxed = mastery >= MASTERY_MAX_LEVEL

    const el = this.div('ttg-modal ttg-detail')
    el.dataset.rarity = def.rarity
    // Current effect value — includes any mastery bonus, so it's the single source of truth.
    const cur = formatCardValue(cardId, cardLevelValue(cardId, level, mastery))
    const levelChips = (prog?.levels ?? [])
      .map((v, i) => `<span class="lchip${i + 1 === level ? ' cur' : ''}"><i>${i + 1}</i>${formatCardValue(cardId, v)}</span>`)
      .join('')
    const masteryDots = Array.from({ length: MASTERY_MAX_LEVEL }, (_, i) =>
      `<span class="mchip${i < mastery ? ' on' : ''}${i + 1 === mastery ? ' cur' : ''}">${i + 1}</span>`,
    ).join('')
    const masterySection = prog
      ? `<div class="detail-mastery${mastery > 0 ? ' on' : ''}">` +
        `<div class="dm-title">★ ${prog.masteryName}</div>` +
        `<div class="dm-text">${prog.masteryText}</div>` +
        (max ? `<div class="mtrack">${masteryDots}</div>` : `<div class="dm-lock">Unlocks at base Lv ${CARD_MAX_LEVEL}</div>`) +
        `</div>`
      : ''

    el.innerHTML =
      `<div class="detail-card" data-rarity="${def.rarity}">` +
      `<div class="detail-rarity">${def.rarity.toUpperCase()} · ${def.type}${def.cost != null ? ` · ${def.cost}◆` : ''}</div>` +
      `<div class="detail-name">${def.name}</div>` +
      `<div class="detail-art"></div>` +
      `<div class="detail-effect"><b>${cur}</b> ${cardEffectLabel(cardId)}</div>` +
      `<div class="dtrack-label">Base Lv ${level}/${CARD_MAX_LEVEL}${mastery > 0 ? ` · ★ Mastery ${mastery}/${MASTERY_MAX_LEVEL}` : ''}</div>` +
      `<div class="detail-levels">${levelChips}</div>` +
      masterySection +
      `<div class="detail-btns"></div>` +
      `</div>`
    this.applyArt(el.querySelector('.detail-art') as HTMLElement, cardId)

    const btns = el.querySelector('.detail-btns')!
    const back = document.createElement('button')
    back.className = 'ttg-mini'
    back.textContent = '← Back'
    back.addEventListener('click', () => {
      el.remove()
      this.showCollection()
    })
    const action = document.createElement('button')
    action.className = 'ttg-btn ready'
    if (!max) {
      const cost = this.levelCost(level)
      action.textContent = `Level Up · ${cost}💠`
      action.disabled = this.save.shards < cost
      action.addEventListener('click', () => {
        if (this.save.shards < cost) return
        this.save.shards -= cost
        this.save.collection[cardId] = { level: level + 1, mastery }
        writeSave(this.save)
        this.showCardDetail(cardId)
      })
    } else if (!masteryMaxed) {
      const cost = this.masteryCost(mastery)
      action.textContent = `${mastery === 0 ? 'Unlock' : 'Level Up'} Mastery · ${cost}💠`
      action.disabled = this.save.shards < cost
      action.addEventListener('click', () => {
        if (this.save.shards < cost) return
        this.save.shards -= cost
        this.save.collection[cardId] = { level, mastery: mastery + 1 }
        writeSave(this.save)
        this.showCardDetail(cardId)
      })
    } else {
      action.textContent = 'Fully mastered ★'
      action.disabled = true
    }
    btns.append(back, action)
    el.addEventListener('click', e => {
      if (e.target === el) {
        el.remove()
        this.showCollection()
      }
    })
    this.root.appendChild(el)
  }

  // -------------------------------------------------------------------------
  // Deck view
  // -------------------------------------------------------------------------

  private showDeck(): void {
    this.root.querySelector('.ttg-modal')?.remove()
    const counts = this.deckCounts()
    const entries = Object.keys(counts)
      .map(id => ({ id, n: counts[id]! }))
      .sort((a, b) => getCard(a.id).cost - getCard(b.id).cost || getCard(a.id).name.localeCompare(getCard(b.id).name))
    const by = (t: string) => this.playerDeck.filter(id => getCard(id).type === t).length

    // Mana curve, buckets 1..7 with 7 = 7+.
    const curve = new Array(7).fill(0)
    for (const id of this.playerDeck) curve[Math.min(7, Math.max(1, getCard(id).cost)) - 1]++
    const maxc = Math.max(1, ...curve)
    const curveHtml =
      `<div class="deck-curve">` +
      curve
        .map((c, i) => {
          const label = i === 6 ? '7+' : String(i + 1)
          const h = Math.round((c / maxc) * 46)
          return `<div class="dc-col"><div class="dc-bar" style="height:${h}px"><span>${c || ''}</span></div><div class="dc-lbl">${label}</div></div>`
        })
        .join('') +
      `</div>`

    const el = this.div('ttg-modal')
    const card = this.div('modal-card')
    card.innerHTML =
      `<h3>Your Deck (${this.playerDeck.length})</h3>` +
      `<div class="modal-sub">${by('UNIT')} units · ${by('MODULE')} modules · ${by('ULTIMATE')} ultimates</div>` +
      curveHtml
    const grid = this.div('modal-grid')
    for (const e of entries) {
      grid.appendChild(this.cardFace(e.id, 'mini', () => {}, e.n > 1 ? `×${e.n}` : undefined))
    }
    const close = document.createElement('button')
    close.className = 'ttg-mini'
    close.textContent = 'Close'
    close.addEventListener('click', () => el.remove())
    card.append(grid, close)
    el.appendChild(card)
    el.addEventListener('click', e => {
      if (e.target === el) el.remove()
    })
    this.root.appendChild(el)
  }

  // -------------------------------------------------------------------------
  // Deckbuilding between bosses
  // -------------------------------------------------------------------------

  private showReward(): void {
    const cands = rewardCandidates(this.playerDeck, Math.random)
    const el = this.div('ttg-modal')
    const card = this.div('modal-card')
    card.innerHTML = `<h3>Victory — choose a card</h3><div class="modal-sub">Add one to your deck for this run.</div>`
    const counts = this.deckCounts()
    const row = this.div('modal-cards')
    for (const id of cands) {
      const have = counts[id] ?? 0
      const badge = have > 0 ? `×${have} in deck` : 'new'
      row.appendChild(
        this.cardFace(id, '', () => {
          this.playerDeck.push(id)
          el.remove()
          this.showTrim()
        }, badge),
      )
    }
    const skip = document.createElement('button')
    skip.className = 'ttg-mini'
    skip.textContent = 'Skip'
    skip.addEventListener('click', () => {
      el.remove()
      this.advanceBoss()
    })
    card.append(row, skip)
    el.appendChild(card)
    this.root.appendChild(el)
  }

  private showTrim(): void {
    const el = this.div('ttg-modal')
    const card = this.div('modal-card')
    card.innerHTML =
      `<h3>Trim your deck</h3>` +
      `<div class="modal-sub">Your deck has ${this.playerDeck.length}. Remove one to return to ${TUNING.DECK_SIZE}.</div>`
    const grid = this.div('modal-grid')
    this.playerDeck.forEach((id, idx) =>
      grid.appendChild(
        this.cardFace(id, 'mini', () => {
          this.playerDeck.splice(idx, 1)
          el.remove()
          this.advanceBoss()
        }),
      ),
    )
    card.appendChild(grid)
    el.appendChild(card)
    this.root.appendChild(el)
  }

  private deckCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const id of this.playerDeck) counts[id] = (counts[id] ?? 0) + 1
    return counts
  }

  /** A non-interactive card face (for reward/trim screens), with hover preview, an optional click,
   *  and an optional corner badge (e.g. how many copies you already run). */
  /** Paint card art onto `node` (a card's art box, or a board token). The art fills via `cover`; a
   *  blue tile sits behind it so transparent .webp illustrations read on the same ground as the base
   *  .jpg tiles. The art box shares the art's ~4:3 aspect, so cover neither crops sides nor gaps. */
  private applyArt(node: HTMLElement, cardId: string): void {
    const url = cardArtUrl(cardId) ?? ''
    // `contain` shows the WHOLE illustration whatever its aspect (base cards are ~4:3 landscape,
    // UW/module art is square-to-portrait) — nothing is ever cropped. The tile gradient fills the
    // remaining margin so every card reads as a framed illustration, regardless of asset type.
    node.style.backgroundImage = `url('${url}'), radial-gradient(circle at 50% 40%, #24467a 0%, #0c1830 100%)`
    node.style.backgroundSize = 'contain, cover'
    node.style.backgroundRepeat = 'no-repeat, no-repeat'
    node.style.backgroundPosition = 'center, center'
  }

  private cardFace(cardId: string, extraCls: string, onClick: () => void, badge?: string): HTMLElement {
    const def = getCard(cardId)
    const node = this.div(`ttg-card ${extraCls}`.trim())
    node.dataset.rarity = def.rarity
    const stats =
      def.type === 'UNIT'
        ? `<div class="stat-row"><b class="a">${def.atk ?? 0}</b><b class="h">${def.hp ?? 0}</b></div>`
        : ''
    node.innerHTML =
      `<div class="cost">${def.cost}</div>` +
      (badge ? `<div class="owned">${badge}</div>` : '') +
      `<div class="card-art">${stats}</div>` +
      `<div class="cn">${def.name}</div>`
    this.applyArt(node.querySelector('.card-art') as HTMLElement, cardId)
    node.addEventListener('click', onClick)
    node.addEventListener('mouseenter', () => this.showPreview(cardId, node.getBoundingClientRect()))
    node.addEventListener('mouseleave', () => this.hidePreview())
    return node
  }

  destroy(): void {
    if (this.watchTimer) clearTimeout(this.watchTimer)
    this.fx.destroy()
    this.root.innerHTML = ''
  }
}
