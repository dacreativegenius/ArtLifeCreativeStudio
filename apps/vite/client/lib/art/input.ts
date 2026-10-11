import type { Pt } from "./types"

/**
 * v1.0.6 — iPad / Apple Pencil input helpers.
 * iPadOS Safari reports itself as "Macintosh", so touch support is what tells an iPad apart from a Mac.
 */
const ua = typeof navigator !== "undefined" ? navigator.userAgent : ""
const touchPoints = typeof navigator !== "undefined" ? navigator.maxTouchPoints ?? 0 : 0
export const IS_IPAD = /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)
export const IS_IOS = IS_IPAD || /iPhone|iPod/.test(ua)

/** iPad Safari caps the total memory of all canvases; stay comfortably below it. */
export const IOS_CANVAS_BUDGET = 280e6

/** A pointer sample copied out of a (coalesced) PointerEvent so it can be queued and processed per frame. */
export type InputSample = {
  clientX: number
  clientY: number
  pressure: number
  pointerType: string
  timeStamp: number
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/**
 * Stylus pressure filter.
 * WebKit reports pressure 0 on the first Apple Pencil sample and on some coalesced samples — those used
 * to stamp near-invisible grain, which is what made iPad pencil strokes look dotted. Zero samples now
 * reuse the last real pressure, and on iOS a light low-pass + response curve removes the flicker.
 */
export class PressureFilter {
  private last = 0.5
  private has = false

  reset() {
    this.has = false
  }

  next(raw: number): number {
    let p = raw > 0 ? raw : this.has ? this.last : 0.35
    if (IS_IOS) p = Math.pow(p, 0.72)
    p = clamp(p, IS_IOS ? 0.06 : 0.02, 1)
    if (!this.has) {
      this.has = true
      this.last = p
      return p
    }
    this.last += (p - this.last) * (IS_IOS ? 0.4 : 1)
    return this.last
  }
}

/**
 * Fill a gap between two stroke points (Safari can drop pointer frames under load).
 * Uses a Hermite curve that leaves `a` along the previous segment's direction, so bridged gaps
 * stay curved instead of turning into straight chords. Returns only the in-between points.
 */
export function bridgeGap(prev: Pt | undefined, a: Pt, b: Pt, maxStep: number): Pt[] {
  const cx = b.x - a.x
  const cy = b.y - a.y
  const d = Math.hypot(cx, cy)
  const n = Math.min(48, Math.floor(d / Math.max(0.5, maxStep)))
  if (n < 1) return []
  let mx = cx
  let my = cy
  if (prev) {
    const pl = Math.hypot(a.x - prev.x, a.y - prev.y)
    if (pl > 1e-6) {
      mx = ((a.x - prev.x) / pl) * d * 0.5 + cx * 0.5
      my = ((a.y - prev.y) / pl) * d * 0.5 + cy * 0.5
    }
  }
  const out: Pt[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1)
    const t2 = t * t
    const t3 = t2 * t
    const h00 = 2 * t3 - 3 * t2 + 1
    const h10 = t3 - 2 * t2 + t
    const h01 = -2 * t3 + 3 * t2
    const h11 = t3 - t2
    out.push({
      x: h00 * a.x + h10 * mx + h01 * b.x + h11 * cx,
      y: h00 * a.y + h10 * my + h01 * b.y + h11 * cy,
      p: a.p + (b.p - a.p) * t,
    })
  }
  return out
}

/** Light 1-2-1 smoothing passes (ends and corner anchors stay put) — removes high-rate Pencil jitter. */
export function smoothPoints(pts: Pt[], passes = 1): Pt[] {
  let cur = pts
  for (let k = 0; k < passes; k++) {
    if (cur.length < 3) return cur
    const src = cur
    cur = src.map((p, i) => {
      if (i === 0 || i === src.length - 1 || p.corner) return p
      const a = src[i - 1]
      const b = src[i + 1]
      return { ...p, x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 }
    })
  }
  return cur
}

/** Give a canvas's bitmap back right away (Safari only frees canvas memory when it is zero-sized). */
export function releaseCanvas(c: HTMLCanvasElement) {
  c.width = 0
  c.height = 0
}
