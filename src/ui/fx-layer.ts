/**
 * A single transparent canvas overlaid on the board. It runs a requestAnimationFrame loop only
 * while effects are alive, then sleeps — no idle burn. The DOM owns the board; this owns the
 * particles: floating damage/heal numbers and a quick beam for ultimates. Coordinates are relative
 * to the canvas's own box, so callers pass rects from getBoundingClientRect minus the root's rect.
 */

interface FloatNum {
  kind: 'float'
  x: number
  y: number
  vy: number
  life: number
  max: number
  text: string
  color: string
  size: number
}
interface Beam {
  kind: 'beam'
  x1: number
  y1: number
  x2: number
  y2: number
  life: number
  max: number
  color: string
}
interface Particle {
  kind: 'particle'
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  color: string
  size: number
}
interface Ring {
  kind: 'ring'
  x: number
  y: number
  maxR: number
  life: number
  max: number
  color: string
}
interface Flash {
  kind: 'flash'
  life: number
  max: number
  color: string
}
interface Bolt {
  kind: 'bolt'
  pts: Array<{ x: number; y: number }>
  life: number
  max: number
  color: string
}
type Effect = FloatNum | Beam | Particle | Ring | Flash | Bolt

export class FxLayer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private effects: Effect[] = []
  private raf = 0
  private last = 0
  private enabled = true

  /** Master toggle (Settings → Visual effects). When off, all particle/beam/ring FX are suppressed. */
  setEnabled(on: boolean): void {
    this.enabled = on
    if (!on) this.effects = []
  }

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'ttg-fx'
    parent.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    this.resize()
  }

  resize(): void {
    const r = this.canvas.parentElement!.getBoundingClientRect()
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
    this.canvas.width = Math.max(1, Math.floor(r.width * dpr))
    this.canvas.height = Math.max(1, Math.floor(r.height * dpr))
    this.canvas.style.width = `${r.width}px`
    this.canvas.style.height = `${r.height}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  floatText(x: number, y: number, text: string, color: string, size = 20): void {
    if (!this.enabled) return
    this.effects.push({ kind: 'float', x, y, vy: -0.03, life: 900, max: 900, text, color, size })
    this.wake()
  }

  beam(x1: number, y1: number, x2: number, y2: number, color = '#ff5b6e'): void {
    if (!this.enabled) return
    this.effects.push({ kind: 'beam', x1, y1, x2, y2, life: 360, max: 360, color })
    this.wake()
  }

  /** A short particle burst — used for unit deaths and combat impacts. Visual only (Math.random is
   *  fine here; it never touches game state). */
  burst(x: number, y: number, color: string, count = 14, power = 0.4): void {
    if (!this.enabled) return
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.5
      const sp = power * (0.4 + Math.random())
      this.effects.push({
        kind: 'particle',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 0.1,
        life: 520 + Math.random() * 260,
        max: 780,
        color,
        size: 2 + Math.random() * 3,
      })
    }
    this.wake()
  }

  /** Expanding ring — a spell impact / freeze / buff pulse. */
  ring(x: number, y: number, color: string, maxR = 60): void {
    if (!this.enabled) return
    this.effects.push({ kind: 'ring', x, y, maxR, life: 440, max: 440, color })
    this.wake()
  }

  /** A jagged lightning bolt between two points (Chain Lightning, electric hits). Visual only. */
  bolt(x1: number, y1: number, x2: number, y2: number, color = '#bff2ff'): void {
    if (!this.enabled) return
    const segs = 7
    const pts: Array<{ x: number; y: number }> = [{ x: x1, y: y1 }]
    const nx = -(y2 - y1)
    const ny = x2 - x1
    const len = Math.hypot(nx, ny) || 1
    for (let i = 1; i < segs; i++) {
      const f = i / segs
      const jitter = (Math.random() - 0.5) * 26
      pts.push({ x: x1 + (x2 - x1) * f + (nx / len) * jitter, y: y1 + (y2 - y1) * f + (ny / len) * jitter })
    }
    pts.push({ x: x2, y: y2 })
    this.effects.push({ kind: 'bolt', pts, life: 300, max: 300, color })
    this.wake()
  }

  /** A big impact — ring + particle burst. For missile/mine explosions and black holes. */
  explode(x: number, y: number, color: string, power = 0.7): void {
    this.ring(x, y, color, 46)
    this.burst(x, y, color, 20, power)
  }

  /** Full-board colour flash — for board-wide spells (Nuke). */
  flash(color: string): void {
    if (!this.enabled) return
    this.effects.push({ kind: 'flash', life: 460, max: 460, color })
    this.wake()
  }

  private wake(): void {
    if (this.raf) return
    this.last = 0
    this.raf = requestAnimationFrame(t => this.tick(t))
  }

  private tick(t: number): void {
    const dt = this.last ? t - this.last : 16
    this.last = t
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    for (const e of this.effects) e.life -= dt
    this.effects = this.effects.filter(e => e.life > 0)

    for (const e of this.effects) {
      const k = e.life / e.max
      if (e.kind === 'float') {
        e.y += e.vy * dt
        ctx.globalAlpha = Math.min(1, k * 1.6)
        ctx.font = `800 ${e.size}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.lineWidth = 3
        ctx.strokeStyle = 'rgba(0,0,0,0.85)'
        ctx.strokeText(e.text, e.x, e.y)
        ctx.fillStyle = e.color
        ctx.fillText(e.text, e.x, e.y)
      } else if (e.kind === 'beam') {
        ctx.globalAlpha = Math.min(1, k * 2)
        ctx.strokeStyle = e.color
        ctx.lineWidth = 3 + 3 * k
        ctx.shadowColor = e.color
        ctx.shadowBlur = 12
        ctx.beginPath()
        ctx.moveTo(e.x1, e.y1)
        ctx.lineTo(e.x2, e.y2)
        ctx.stroke()
        ctx.shadowBlur = 0
      } else if (e.kind === 'ring') {
        const grow = 1 - k
        const r = 6 + e.maxR * grow
        ctx.globalAlpha = Math.min(1, k * 1.6)
        ctx.strokeStyle = e.color
        ctx.lineWidth = 3 + 4 * k
        ctx.shadowColor = e.color
        ctx.shadowBlur = 14
        ctx.beginPath()
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.shadowBlur = 0
      } else if (e.kind === 'flash') {
        ctx.globalAlpha = k * 0.55
        ctx.fillStyle = e.color
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
      } else if (e.kind === 'bolt') {
        ctx.globalAlpha = Math.min(1, k * 2.2)
        ctx.strokeStyle = e.color
        ctx.shadowColor = e.color
        ctx.shadowBlur = 16
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(e.pts[0]!.x, e.pts[0]!.y)
        for (let i = 1; i < e.pts.length; i++) ctx.lineTo(e.pts[i]!.x, e.pts[i]!.y)
        ctx.lineWidth = 5 * k + 1
        ctx.stroke()
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2 * k + 0.5
        ctx.stroke()
        ctx.shadowBlur = 0
      } else {
        e.vy += 0.0006 * dt // gravity
        e.x += e.vx * dt
        e.y += e.vy * dt
        ctx.globalAlpha = Math.min(1, k * 1.4)
        ctx.fillStyle = e.color
        ctx.shadowColor = e.color
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
      }
    }
    ctx.globalAlpha = 1

    if (this.effects.length > 0) {
      this.raf = requestAnimationFrame(nt => this.tick(nt))
    } else {
      this.raf = 0
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    }
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.canvas.remove()
  }
}
