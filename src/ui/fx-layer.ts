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
type Effect = FloatNum | Beam

export class FxLayer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private effects: Effect[] = []
  private raf = 0
  private last = 0

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
    this.effects.push({ kind: 'float', x, y, vy: -0.03, life: 900, max: 900, text, color, size })
    this.wake()
  }

  beam(x1: number, y1: number, x2: number, y2: number, color = '#ff5b6e'): void {
    this.effects.push({ kind: 'beam', x1, y1, x2, y2, life: 360, max: 360, color })
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
      } else {
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
