import {
  DOC_H,
  DOC_W,
  blendOp,
  effLayers,
  type BrushId,
  type EraseItem,
  type Item,
  type Layer,
  type PathItem,
  type PathNode,
  type Pt,
  type Rect,
  type ShapeItem,
  type StrokeItem,
  type SubPath,
  uid,
} from "./types"
import { IS_IOS } from "./input"

/** v1.0.6: iPad pencil grain is stamped denser (and never thinner than 3 grains) so strokes read solid, not dotted. */
const STAMP_SPACING = IS_IOS ? 0.3 : 0.45
const GRAIN_MIN = IS_IOS ? 4 : 2
/** v1.0.7: iPad grain count multiplier + alpha floor, so light Apple Pencil pressure never fades into dots. */
const GRAIN_MULT = IS_IOS ? 2.4 : 1.8
const GRAIN_ALPHA_MIN = IS_IOS ? 0.5 : 0.3

export type XY = { x: number; y: number }

export function mulberry32(seed: number) {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const isVectorBrush = (b: BrushId) => b === "vector-pressure" || b === "vector-fixed"

/** Catmull-Rom resample so simplified vector anchors render as smooth curves. */
export function catmull(points: Pt[]): Pt[] {
  if (points.length < 3) return points.slice()
  const out: Pt[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]
    // corner anchors (Anchor Point tool) kill the tangent on that side → sharp point
    const p0 = p1.corner ? p1 : points[i - 1] ?? p1
    const p3 = p2.corner ? p2 : points[i + 2] ?? p2
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    const steps = Math.max(1, Math.min(24, Math.ceil(len / 3)))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      const t2 = t * t
      const t3 = t2 * t
      const x =
        0.5 *
        (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)
      const y =
        0.5 *
        (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
      out.push({ x, y, p: p1.p + (p2.p - p1.p) * t })
    }
  }
  out.push(points[points.length - 1])
  return out
}

/**
 * Catmull-Rom anchors → one cubic bezier per anchor span (for SVG export). Keeps the
 * exported path at exactly the anchor count instead of hundreds of resampled points.
 */
export function catmullBeziers(P: (XY & { corner?: boolean })[]): { c1: XY; c2: XY; to: XY }[] {
  const out: { c1: XY; c2: XY; to: XY }[] = []
  for (let i = 0; i < P.length - 1; i++) {
    const p1 = P[i]
    const p2 = P[i + 1]
    const p0 = p1.corner ? p1 : P[i - 1] ?? p1
    const p3 = p2.corner ? p2 : P[i + 2] ?? p2
    out.push({
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      to: { x: p2.x, y: p2.y },
    })
  }
  return out
}

function cumulative(pts: XY[]) {
  const lens = [0]
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  return { lens, total: lens[lens.length - 1] }
}

function taperAt(d: number, total: number, len: number) {
  if (len <= 0) return 1
  const a = Math.min(1, d / len)
  const b = Math.min(1, (total - d) / len)
  return Math.sqrt(Math.max(0, Math.min(a, b)))
}

/* ---------------- Pencil (graphite grain stamps) ---------------- */

export type PencilRange = {
  /** Only stamp grain at arc length >= from. */
  from?: number
  /** Only stamp grain below this arc length; "stable" = the part of a live stroke that can no longer change. */
  to?: number | "stable"
  /** Number of real (non-predicted) points — needed for "stable". */
  realCount?: number
  /** Draw the Tech Pencil graphite core (default true). */
  core?: boolean
}

/**
 * Pencil grain. With a range it draws only part of the stroke, so a live stroke can be rendered
 * incrementally (v1.0.4): the settled part is stamped once into a cache, only the tip is redrawn.
 * Returns the resolved `to` length (the stable length when to = "stable").
 */
export function drawPencil(ctx: CanvasRenderingContext2D, s: StrokeItem, range?: PencilRange): number {
  const pts = catmull(s.points)
  if (!pts.length) return 0
  const pressure = s.brush === "pencil-pressure"
  const { lens, total } = cumulative(pts)
  const tLen = Math.min(total * 0.3, s.size * 5)
  const from = range?.from ?? 0
  let to = Infinity
  if (range?.to === "stable") {
    // Catmull span i depends on points i-1 … i+2, so spans before point n-2 are final.
    const n = Math.min(range.realCount ?? s.points.length, s.points.length)
    if (n < 4) to = 0
    else {
      let k = 0
      for (let i = 0; i < n - 2; i++) {
        const a = s.points[i]
        const b = s.points[i + 1]
        k += Math.max(1, Math.min(24, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3)))
      }
      to = lens[Math.min(k, lens.length - 1)]
      // the taper length is only final once the stroke is long enough; the end taper moves with the tip
      if (pressure) to = total * 0.3 >= s.size * 5 ? Math.min(to, total - tLen - 1) : 0
      to = Math.max(0, to)
    }
  } else if (typeof range?.to === "number") to = range.to
  ctx.fillStyle = s.color
  let idx = 0
  const stamp = (x: number, y: number, p: number, d: number) => {
    const id = idx++
    let w: number
    let a: number
    if (pressure) {
      const t = Math.max(0.12, taperAt(d, total, tLen))
      w = s.size * (0.12 + 0.88 * p) * t
      a = s.opacity * (0.12 + 0.88 * p) * (0.5 + 0.5 * t)
    } else {
      w = s.size
      a = s.opacity * 0.85
    }
    const rad = Math.max(0.4, w / 2)
    if (d < from || d >= to) return rad
    const rnd = mulberry32(s.seed + id * 7919)
    // v1.0.7 iPad: a soft graphite core under every stamp — the stamps overlap, so the core forms a
    // continuous line and grain can never leave visible gaps, whatever Safari does with the samples
    if (IS_IOS && pressure) {
      const cs = Math.max(0.9, rad * 0.75)
      ctx.globalAlpha = Math.min(1, a * 0.22)
      ctx.fillRect(x - cs / 2, y - cs / 2, cs, cs)
    }
    const grains = Math.max(GRAIN_MIN, Math.round(rad * (pressure ? GRAIN_MULT : 2.2)))
    for (let g = 0; g < grains; g++) {
      const ang = rnd() * Math.PI * 2
      // Tech Pencil: tight scatter — grains hug the centre line, smaller and more even
      const dist = pressure ? Math.sqrt(rnd()) * rad : rnd() * rad * 0.7
      const gs = pressure ? 0.55 + rnd() * Math.max(0.5, rad * 0.35) : 0.45 + rnd() * Math.max(0.3, rad * 0.18)
      ctx.globalAlpha = Math.min(1, a * (pressure ? GRAIN_ALPHA_MIN + rnd() * (1 - GRAIN_ALPHA_MIN) : 0.6 + rnd() * 0.4))
      ctx.fillRect(x + Math.cos(ang) * dist - gs / 2, y + Math.sin(ang) * dist - gs / 2, gs, gs)
    }
    return rad
  }
  let rad = stamp(pts[0].x, pts[0].y, pts[0].p, 0)
  let next = Math.max(0.45, rad * STAMP_SPACING)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const l0 = lens[i - 1]
    const seg = lens[i] - l0
    if (seg <= 0) continue
    while (next <= lens[i]) {
      const f = (next - l0) / seg
      rad = stamp(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.p + (b.p - a.p) * f, next)
      next += Math.max(0.45, rad * STAMP_SPACING)
    }
  }
  // Tech Pencil: a crisp graphite core under the grain keeps the line sharp
  if (!pressure && pts.length > 1 && range?.core !== false) {
    ctx.globalAlpha = s.opacity * 0.55
    ctx.strokeStyle = s.color
    ctx.lineWidth = Math.max(0.5, s.size * 0.5)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.beginPath()
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  return to === Infinity ? total : to
}

/* ---------------- Vector ---------------- */

/** v1.0.6: soften sample-to-sample width flicker (Apple Pencil pressure noise → ragged ink edges). */
function smoothWidths(w: number[]): number[] {
  if (w.length < 5) return w
  const out = w.slice()
  for (let i = 2; i < w.length - 2; i++) out[i] = (w[i - 2] + 2 * w[i - 1] + 3 * w[i] + 2 * w[i + 1] + w[i + 2]) / 9
  return out
}

/**
 * Outline frame of a variable-width stroke. v1.0.6: the edge normal comes from a window of the path
 * (about the local brush radius) instead of the two nearest samples — dense, jittery iPad Pencil input
 * used to swing those normals wildly, which is what made Pressure Ink edges look jagged and fractured.
 */
function strokeFrame(pts: Pt[], lens: number[], widths: number[]) {
  const n = pts.length
  const left: XY[] = []
  const right: XY[] = []
  const angles: number[] = []
  for (let i = 0; i < n; i++) {
    const r = Math.max(1.2, widths[i] * 0.7)
    let j = i
    let k = i
    let guard = 0
    while (j > 0 && lens[i] - lens[j] < r && guard++ < 48) j--
    guard = 0
    while (k < n - 1 && lens[k] - lens[i] < r && guard++ < 48) k++
    if (j === k) {
      j = Math.max(0, i - 1)
      k = Math.min(n - 1, i + 1)
    }
    const dx = pts[k].x - pts[j].x
    const dy = pts[k].y - pts[j].y
    const l = Math.hypot(dx, dy) || 1
    const nx = -dy / l
    const ny = dx / l
    angles.push(Math.atan2(dy, dx))
    left.push({ x: pts[i].x + nx * widths[i], y: pts[i].y + ny * widths[i] })
    right.push({ x: pts[i].x - nx * widths[i], y: pts[i].y - ny * widths[i] })
  }
  return { left, right, angles }
}

/** Outline geometry of a pressure vector stroke (shared by canvas + SVG export). */
export function pressureGeometry(s: StrokeItem) {
  const pts = catmull(s.points)
  const n = pts.length
  if (!n) return null
  const { lens, total } = cumulative(pts)
  if (n === 1 || total < 0.5) {
    return { dot: { x: pts[0].x, y: pts[0].y, r: Math.max(0.5, (s.size * (0.1 + 0.9 * pts[0].p)) / 2) }, left: [] as XY[], right: [] as XY[], pts, widths: [] as number[] }
  }
  const tLen = Math.min(total * 0.25, s.size * 3)
  const widths = smoothWidths(pts.map((p, i) => (s.size * (0.1 + 0.9 * p.p) * Math.max(0.06, taperAt(lens[i], total, tLen))) / 2))
  const { left, right } = strokeFrame(pts, lens, widths)
  return { dot: null, left, right, pts, widths }
}

function drawVectorPressure(ctx: CanvasRenderingContext2D, s: StrokeItem) {
  const pts = catmull(s.points)
  const n = pts.length
  if (!n) return
  ctx.globalAlpha = s.opacity
  ctx.fillStyle = s.color
  const { lens, total } = cumulative(pts)
  if (n === 1 || total < 0.5) {
    ctx.beginPath()
    ctx.arc(pts[0].x, pts[0].y, Math.max(0.5, (s.size * (0.1 + 0.9 * pts[0].p)) / 2), 0, Math.PI * 2)
    ctx.fill()
    return
  }
  const tLen = Math.min(total * 0.25, s.size * 3)
  const widths = smoothWidths(pts.map((p, i) => (s.size * (0.1 + 0.9 * p.p) * Math.max(0.06, taperAt(lens[i], total, tLen))) / 2))
  const { left, right, angles } = strokeFrame(pts, lens, widths)
  ctx.beginPath()
  ctx.moveTo(left[0].x, left[0].y)
  for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y)
  const ae = angles[n - 1]
  ctx.arc(pts[n - 1].x, pts[n - 1].y, widths[n - 1], ae + Math.PI / 2, ae - Math.PI / 2, true)
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y)
  const as = angles[0]
  ctx.arc(pts[0].x, pts[0].y, widths[0], as - Math.PI / 2, as + Math.PI / 2, true)
  ctx.closePath()
  ctx.fill()
}

function drawVectorFixed(ctx: CanvasRenderingContext2D, s: StrokeItem) {
  const pts = catmull(s.points)
  if (!pts.length) return
  ctx.globalAlpha = s.opacity
  ctx.strokeStyle = s.color
  ctx.lineWidth = s.size
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.stroke()
}

/* ---------------- Shapes ---------------- */

const K = 0.5523

function ellipseCenter(pts: XY[]) {
  return { x: (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4, y: (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4 }
}

export function ellipseSegments(pts: XY[]) {
  const c = ellipseCenter(pts)
  return [0, 1, 2, 3].map((i) => {
    const P = pts[i]
    const Q = pts[(i + 1) % 4]
    return {
      P,
      c1: { x: P.x + K * (Q.x - c.x), y: P.y + K * (Q.y - c.y) },
      c2: { x: Q.x + K * (P.x - c.x), y: Q.y + K * (P.y - c.y) },
      Q,
    }
  })
}

export function ellipseSamples(pts: XY[], per = 12): XY[] {
  const out: XY[] = []
  for (const seg of ellipseSegments(pts)) {
    for (let i = 0; i < per; i++) {
      const t = i / per
      const u = 1 - t
      out.push({
        x: u * u * u * seg.P.x + 3 * u * u * t * seg.c1.x + 3 * u * t * t * seg.c2.x + t * t * t * seg.Q.x,
        y: u * u * u * seg.P.y + 3 * u * u * t * seg.c1.y + 3 * u * t * t * seg.c2.y + t * t * t * seg.Q.y,
      })
    }
  }
  return out
}

function drawShape(ctx: CanvasRenderingContext2D, s: ShapeItem) {
  const p = s.points
  ctx.globalAlpha = s.opacity
  ctx.beginPath()
  if (s.shape === "line") {
    ctx.moveTo(p[0].x, p[0].y)
    ctx.lineTo(p[1].x, p[1].y)
  } else if (s.shape === "rect") {
    ctx.moveTo(p[0].x, p[0].y)
    for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y)
    ctx.closePath()
  } else {
    const segs = ellipseSegments(p)
    ctx.moveTo(p[0].x, p[0].y)
    for (const sg of segs) ctx.bezierCurveTo(sg.c1.x, sg.c1.y, sg.c2.x, sg.c2.y, sg.Q.x, sg.Q.y)
    ctx.closePath()
  }
  if (s.fill && s.shape !== "line") {
    ctx.fillStyle = s.fill
    ctx.fill()
  }
  if (s.size > 0) {
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.size
    ctx.lineCap = "round"
    ctx.lineJoin = s.shape === "rect" ? "miter" : "round"
    ctx.stroke()
  }
}

/* ---------------- Bezier paths (pen tool + live-paint fills) ---------------- */

const isStraight = (a: PathNode, b: PathNode) => a.ox === a.x && a.oy === a.y && b.ix === b.x && b.iy === b.y

export function subpathSamples(sp: SubPath, per = 16): XY[] {
  const n = sp.nodes.length
  if (!n) return []
  const out: XY[] = [{ x: sp.nodes[0].x, y: sp.nodes[0].y }]
  const segs = sp.closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const a = sp.nodes[i]
    const b = sp.nodes[(i + 1) % n]
    if (isStraight(a, b)) {
      out.push({ x: b.x, y: b.y })
      continue
    }
    for (let s = 1; s <= per; s++) {
      const t = s / per
      const u = 1 - t
      out.push({
        x: u * u * u * a.x + 3 * u * u * t * a.ox + 3 * u * t * t * b.ix + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * a.oy + 3 * u * t * t * b.iy + t * t * t * b.y,
      })
    }
  }
  return out
}

export function tracePath(ctx: CanvasRenderingContext2D | Path2D, subpaths: SubPath[]) {
  for (const sp of subpaths) {
    const n = sp.nodes.length
    if (!n) continue
    ctx.moveTo(sp.nodes[0].x, sp.nodes[0].y)
    const segs = sp.closed ? n : n - 1
    for (let i = 0; i < segs; i++) {
      const a = sp.nodes[i]
      const b = sp.nodes[(i + 1) % n]
      if (isStraight(a, b)) ctx.lineTo(b.x, b.y)
      else ctx.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y)
    }
    if (sp.closed) ctx.closePath()
  }
}

function drawPath(ctx: CanvasRenderingContext2D, it: PathItem) {
  const p = new Path2D()
  tracePath(p, it.subpaths)
  ctx.globalAlpha = it.opacity
  if (it.fill) {
    ctx.fillStyle = it.fill
    ctx.fill(p, it.evenOdd ? "evenodd" : "nonzero")
  }
  if (it.stroke && it.size > 0) {
    ctx.strokeStyle = it.stroke
    ctx.lineWidth = it.size
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.stroke(p)
  }
}

export function mapPath(it: PathItem, f: (x: number, y: number) => XY): PathItem {
  return {
    ...it,
    subpaths: it.subpaths.map((sp) => ({
      closed: sp.closed,
      nodes: sp.nodes.map((n) => {
        const a = f(n.x, n.y)
        const i = f(n.ix, n.iy)
        const o = f(n.ox, n.oy)
        return { x: a.x, y: a.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y }
      }),
    })),
  }
}

function drawErase(ctx: CanvasRenderingContext2D, s: EraseItem) {
  const pts = s.points
  if (!pts.length) return
  ctx.globalCompositeOperation = "destination-out"
  ctx.globalAlpha = 1
  if (s.poly) {
    // lasso cut-out (pencil selection): remove everything inside the polygon
    ctx.fillStyle = "#000000"
    ctx.beginPath()
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.closePath()
    ctx.fill()
    return
  }
  ctx.strokeStyle = "#000000"
  ctx.lineWidth = s.size
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.stroke()
}

export function drawItem(ctx: CanvasRenderingContext2D, it: Item) {
  if (it.hidden) return
  ctx.save()
  switch (it.kind) {
    case "stroke":
      if (it.brush === "vector-pressure") drawVectorPressure(ctx, it)
      else if (it.brush === "vector-fixed") drawVectorFixed(ctx, it)
      else drawPencil(ctx, it)
      break
    case "shape":
      drawShape(ctx, it)
      break
    case "erase":
      drawErase(ctx, it)
      break
    case "path":
      drawPath(ctx, it)
      break
    case "image":
      if (it.rot) {
        ctx.translate(it.x + it.w / 2, it.y + it.h / 2)
        ctx.rotate(it.rot)
        ctx.drawImage(it.canvas, -it.w / 2, -it.h / 2, it.w, it.h)
      } else ctx.drawImage(it.canvas, it.x, it.y, it.w, it.h)
      break
  }
  ctx.restore()
}

/* ---------------- Geometry ---------------- */

export function outlineOf(it: Item): { pts: XY[]; closed: boolean } {
  switch (it.kind) {
    case "stroke":
      return { pts: catmull(it.points), closed: false }
    case "erase":
      return { pts: it.points, closed: false }
    case "shape":
      if (it.shape === "ellipse") return { pts: ellipseSamples(it.points), closed: true }
      return { pts: it.points, closed: it.shape === "rect" }
    case "path":
      return { pts: it.subpaths.flatMap((sp) => subpathSamples(sp)), closed: !!it.subpaths[0]?.closed }
    case "image": {
      const corners = [
        { x: it.x, y: it.y },
        { x: it.x + it.w, y: it.y },
        { x: it.x + it.w, y: it.y + it.h },
        { x: it.x, y: it.y + it.h },
      ]
      if (!it.rot) return { pts: corners, closed: true }
      const cx = it.x + it.w / 2
      const cy = it.y + it.h / 2
      return { pts: corners.map((p) => rotPt(p.x, p.y, cx, cy, it.rot!)), closed: true }
    }
  }
}

export function rotPt(x: number, y: number, cx: number, cy: number, a: number): XY {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: cx + (x - cx) * c - (y - cy) * s, y: cy + (x - cx) * s + (y - cy) * c }
}

/** Separate outlines per sub-path (for drawing selection outlines). */
export function outlinesOf(it: Item): { pts: XY[]; closed: boolean }[] {
  if (it.kind === "path") return it.subpaths.map((sp) => ({ pts: subpathSamples(sp), closed: sp.closed }))
  return [outlineOf(it)]
}

export function rotateItem(it: Item, cx: number, cy: number, a: number): Item {
  if (it.kind === "path") return mapPath(it, (x, y) => rotPt(x, y, cx, cy, a))
  if (it.kind === "image") {
    const c = rotPt(it.x + it.w / 2, it.y + it.h / 2, cx, cy, a)
    return { ...it, x: c.x - it.w / 2, y: c.y - it.h / 2, rot: (it.rot ?? 0) + a }
  }
  return { ...it, points: it.points.map((p) => ({ ...p, ...rotPt(p.x, p.y, cx, cy, a) })) } as Item
}

export function itemBounds(it: Item): Rect {
  if (it.kind === "image" && !it.rot) return { x: it.x, y: it.y, w: it.w, h: it.h }
  const { pts } = outlineOf(it)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const pad = it.kind === "image" ? 0 : it.kind === "path" ? (it.stroke ? it.size / 2 : 0) : it.size / 2
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
}

export function unionBounds(items: Item[]): Rect | null {
  if (!items.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const it of items) {
    const b = itemBounds(it)
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export const rectsIntersect = (a: Rect, b: Rect) =>
  a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y

export function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function pointInPoly(x: number, y: number, poly: XY[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function hitItem(it: Item, x: number, y: number, tol: number): boolean {
  if (it.hidden) return false
  if (it.kind === "erase") return false
  if (it.kind === "image") {
    if (it.rot) {
      const q = rotPt(x, y, it.x + it.w / 2, it.y + it.h / 2, -it.rot)
      x = q.x
      y = q.y
    }
    if (x < it.x || y < it.y || x > it.x + it.w || y > it.y + it.h) return false
    const cx = Math.floor(((x - it.x) / it.w) * it.canvas.width)
    const cy = Math.floor(((y - it.y) / it.h) * it.canvas.height)
    const c = it.canvas.getContext("2d")
    if (!c) return true
    return c.getImageData(cx, cy, 1, 1).data[3] > 0
  }
  const b = itemBounds(it)
  if (x < b.x - tol || y < b.y - tol || x > b.x + b.w + tol || y > b.y + b.h + tol) return false
  if (it.kind === "path") {
    const polys = outlinesOf(it)
    if (it.fill) {
      let inside = false
      for (const pl of polys) if (pointInPoly(x, y, pl.pts)) inside = !inside
      if (inside) return true
    }
    const rr = (it.stroke ? it.size / 2 : 0) + tol
    for (const pl of polys) {
      const n = pl.closed ? pl.pts.length : pl.pts.length - 1
      for (let i = 0; i < n; i++) {
        const a = pl.pts[i]
        const c = pl.pts[(i + 1) % pl.pts.length]
        if (distToSeg(x, y, a.x, a.y, c.x, c.y) <= rr) return true
      }
    }
    return false
  }
  const { pts, closed } = outlineOf(it)
  if (it.kind === "shape" && it.fill && closed && pointInPoly(x, y, pts)) return true
  const r = it.size / 2 + tol
  if (pts.length === 1) return Math.hypot(pts[0].x - x, pts[0].y - y) <= r
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const c = pts[(i + 1) % pts.length]
    if (distToSeg(x, y, a.x, a.y, c.x, c.y) <= r) return true
  }
  return false
}

export function anchorsOf(it: Item): XY[] {
  if (it.kind === "stroke" && isVectorBrush(it.brush)) return it.points
  if (it.kind === "shape") return it.points
  if (it.kind === "path") return it.subpaths.flatMap((sp) => sp.nodes)
  return []
}

export function setAnchor(it: Item, idx: number, x: number, y: number): Item {
  if (it.kind === "path") {
    let k = idx
    return {
      ...it,
      subpaths: it.subpaths.map((sp) => {
        if (k < 0 || k >= sp.nodes.length) {
          k -= sp.nodes.length
          return sp
        }
        const nodes = sp.nodes.slice()
        const n = nodes[k]
        const dx = x - n.x
        const dy = y - n.y
        nodes[k] = { x, y, ix: n.ix + dx, iy: n.iy + dy, ox: n.ox + dx, oy: n.oy + dy }
        k = -1
        return { ...sp, nodes }
      }),
    }
  }
  if (it.kind === "stroke" || it.kind === "shape") {
    const points = it.points.slice()
    points[idx] = { ...points[idx], x, y }
    return { ...it, points }
  }
  return it
}

export function translateItem(it: Item, dx: number, dy: number): Item {
  if (it.kind === "path") return mapPath(it, (x, y) => ({ x: x + dx, y: y + dy }))
  if (it.kind === "image") return { ...it, x: it.x + dx, y: it.y + dy }
  return { ...it, points: it.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) } as Item
}

export function scaleItem(it: Item, ox: number, oy: number, sx: number, sy: number): Item {
  if (it.kind === "path") return mapPath(it, (x, y) => ({ x: ox + (x - ox) * sx, y: oy + (y - oy) * sy }))
  if (it.kind === "image" && it.rot) {
    const cx = ox + (it.x + it.w / 2 - ox) * sx
    const cy = oy + (it.y + it.h / 2 - oy) * sy
    const w = it.w * Math.abs(sx)
    const h = it.h * Math.abs(sy)
    return { ...it, x: cx - w / 2, y: cy - h / 2, w, h }
  }
  if (it.kind === "image") {
    let x = ox + (it.x - ox) * sx
    let y = oy + (it.y - oy) * sy
    let w = it.w * sx
    let h = it.h * sy
    if (w < 0) {
      x += w
      w = -w
    }
    if (h < 0) {
      y += h
      h = -h
    }
    return { ...it, x, y, w, h }
  }
  return {
    ...it,
    points: it.points.map((p) => ({ ...p, x: ox + (p.x - ox) * sx, y: oy + (p.y - oy) * sy })),
  } as Item
}

/** Ramer–Douglas–Peucker on position + pressure, used to turn raw input into vector anchors. */
export function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice()
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let maxD = 0
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = distToSeg(pts[i].x, pts[i].y, pts[a].x, pts[a].y, pts[b].x, pts[b].y)
      const pd = Math.abs(pts[i].p - (pts[a].p + (pts[b].p - pts[a].p) * ((i - a) / (b - a)))) * 8
      const dd = Math.max(d, pd)
      if (dd > maxD) {
        maxD = dd
        idx = i
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/**
 * Mono Liner (v1.0.4): find the corners you actually drew in the raw input (a sharp turn
 * measured over a short arm on each side), keep them as hard corner anchors, and simplify
 * each run between corners on its own — so corners stay corners and curves stay light.
 * `arm` is in document units (pass ~7 screen px ÷ zoom).
 */
export function simplifyKeepCorners(raw: Pt[], eps: number, arm: number, minTurnDeg = 62): Pt[] {
  const n = raw.length
  if (n < 5) return simplify(raw, eps)
  const { lens } = cumulative(raw)
  const turn = new Float32Array(n)
  let lo = 0
  let hi = 0
  for (let i = 1; i < n - 1; i++) {
    while (lo < i && lens[i] - lens[lo + 1] >= arm) lo++
    if (hi < i) hi = i
    while (hi < n - 1 && lens[hi] - lens[i] < arm) hi++
    if (lens[i] - lens[lo] < arm * 0.6 || lens[hi] - lens[i] < arm * 0.6) continue
    const a = raw[lo]
    const b = raw[i]
    const c = raw[hi]
    const a1 = Math.atan2(b.y - a.y, b.x - a.x)
    const a2 = Math.atan2(c.y - b.y, c.x - b.x)
    let d = Math.abs(a2 - a1)
    if (d > Math.PI) d = Math.PI * 2 - d
    turn[i] = d
  }
  const thr = (minTurnDeg * Math.PI) / 180
  const corners: number[] = []
  for (let i = 1; i < n - 1; i++) {
    if (turn[i] < thr) continue
    // local maximum within one arm on each side
    let best = true
    for (let j = i - 1; j >= 0 && lens[i] - lens[j] < arm; j--) if (turn[j] > turn[i]) best = false
    for (let j = i + 1; j < n && lens[j] - lens[i] < arm; j++) if (turn[j] >= turn[i]) best = false
    if (best && (!corners.length || lens[i] - lens[corners[corners.length - 1]] >= arm)) corners.push(i)
  }
  if (!corners.length) return simplify(raw, eps)
  const out: Pt[] = []
  const cuts = [0, ...corners, n - 1]
  for (let k = 0; k < cuts.length - 1; k++) {
    const run = simplify(raw.slice(cuts[k], cuts[k + 1] + 1), eps)
    if (k > 0) run.shift()
    out.push(...run)
  }
  const cornerSet = new Set(corners.map((i) => raw[i]))
  return out.map((p) => (cornerSet.has(p) ? { ...p, corner: true } : p))
}

/** Flatten layers at document resolution (for export and bucket fill). */
export function renderDoc(layers: Layer[], scale = 1, paper = true) {
  const c = document.createElement("canvas")
  c.width = Math.max(1, Math.round(DOC_W * scale))
  c.height = Math.max(1, Math.round(DOC_H * scale))
  const ctx = c.getContext("2d", { willReadFrequently: true })!
  if (paper) {
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, c.width, c.height)
  }
  const tmp = document.createElement("canvas")
  tmp.width = c.width
  tmp.height = c.height
  const t = tmp.getContext("2d")!
  for (const l of effLayers(layers)) {
    if (!l.visible) continue
    t.setTransform(1, 0, 0, 1, 0, 0)
    t.clearRect(0, 0, tmp.width, tmp.height)
    t.setTransform(scale, 0, 0, scale, 0, 0)
    for (const it of l.items) drawItem(t, it)
    ctx.globalAlpha = l.opacity
    ctx.globalCompositeOperation = blendOp(l.blend)
    ctx.drawImage(tmp, 0, 0)
    ctx.globalCompositeOperation = "source-over"
    ctx.globalAlpha = 1
  }
  return c
}

/** Scanline flood fill on a flattened composite; returns the (1px dilated) region mask. */
export function floodMask(src: ImageData, sx: number, sy: number, tol: number) {
  const { width: W, height: H, data } = src
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null
  const j0 = (sy * W + sx) * 4
  const r0 = data[j0]
  const g0 = data[j0 + 1]
  const b0 = data[j0 + 2]
  const a0 = data[j0 + 3]
  const mask = new Uint8Array(W * H)
  const match = (i: number) => {
    const j = i * 4
    return (
      Math.abs(data[j] - r0) + Math.abs(data[j + 1] - g0) + Math.abs(data[j + 2] - b0) + Math.abs(data[j + 3] - a0) <= tol
    )
  }
  const stack: number[] = [sx, sy]
  while (stack.length) {
    const y = stack.pop()!
    const x = stack.pop()!
    const i = y * W + x
    if (mask[i] || !match(i)) continue
    let l = x
    while (l > 0 && !mask[y * W + l - 1] && match(y * W + l - 1)) l--
    let r = x
    while (r < W - 1 && !mask[y * W + r + 1] && match(y * W + r + 1)) r++
    let up = false
    let down = false
    for (let xx = l; xx <= r; xx++) {
      mask[y * W + xx] = 1
      if (y > 0) {
        const k = (y - 1) * W + xx
        if (!mask[k] && match(k)) {
          if (!up) {
            stack.push(xx, y - 1)
            up = true
          }
        } else up = false
      }
      if (y < H - 1) {
        const k = (y + 1) * W + xx
        if (!mask[k] && match(k)) {
          if (!down) {
            stack.push(xx, y + 1)
            down = true
          }
        } else down = false
      }
    }
  }
  // 1px dilation tucks the fill under anti-aliased line edges
  const grown = mask.slice()
  let minX = W
  let minY = H
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue
      if (x > 0) grown[y * W + x - 1] = 1
      if (x < W - 1) grown[y * W + x + 1] = 1
      if (y > 0) grown[(y - 1) * W + x] = 1
      if (y < H - 1) grown[(y + 1) * W + x] = 1
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!grown[y * W + x]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return { grown, W, H, minX, minY, maxX, maxY }
}

/* ---------------- Blob brush: pressure stroke → filled shape ---------------- */

/** Turn a Pressure Ink stroke into a filled, tapered vector shape (blob brush). */
export function strokeToBlob(s: StrokeItem): PathItem | null {
  const g = pressureGeometry(s)
  if (!g) return null
  const base = { id: s.id, kind: "path" as const, stroke: null, size: 0, fill: s.color, opacity: s.opacity, blob: true }
  if (g.dot) {
    const { x, y, r } = g.dot
    const k = r * K
    const nodes: PathNode[] = [
      { x: x + r, y, ix: x + r, iy: y - k, ox: x + r, oy: y + k },
      { x, y: y + r, ix: x + k, iy: y + r, ox: x - k, oy: y + r },
      { x: x - r, y, ix: x - r, iy: y + k, ox: x - r, oy: y - k },
      { x, y: y - r, ix: x - k, iy: y - r, ox: x + k, oy: y - r },
    ]
    return { ...base, subpaths: [{ closed: true, nodes }] }
  }
  const { left, right, pts, widths } = g
  const n = pts.length
  const dir = (i: number) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n - 1, i + 1)]
    return Math.atan2(b.y - a.y, b.x - a.x)
  }
  const CAP = 6
  const poly: XY[] = [...left]
  const ae = dir(n - 1)
  for (let k = 1; k < CAP; k++) {
    const a = ae + Math.PI / 2 - (Math.PI * k) / CAP
    poly.push({ x: pts[n - 1].x + Math.cos(a) * widths[n - 1], y: pts[n - 1].y + Math.sin(a) * widths[n - 1] })
  }
  for (let i = n - 1; i >= 0; i--) poly.push(right[i])
  const as = dir(0)
  for (let k = 1; k < CAP; k++) {
    const a = as - Math.PI / 2 - (Math.PI * k) / CAP
    poly.push({ x: pts[0].x + Math.cos(a) * widths[0], y: pts[0].y + Math.sin(a) * widths[0] })
  }
  // tolerance grows with brush size: far fewer anchors, smooth bezier handles keep the curve
  const simple = rdpClosed(poly, Math.max(0.6, Math.min(2.2, s.size * 0.06)))
  if (simple.length < 3) return null
  return { ...base, subpaths: [{ closed: true, nodes: smoothNodes(simple) }] }
}

/**
 * Cut an eraser stroke out of a filled vector shape. Returns the reshaped path,
 * null when the shape was fully erased, or undefined when the eraser didn't touch it.
 */
export function eraseFromPath(it: PathItem, er: EraseItem): PathItem | null | undefined {
  const b = itemBounds(it)
  if (!rectsIntersect(b, itemBounds(er)) || b.w <= 0 || b.h <= 0) return undefined
  const pad = 3
  const scale = Math.max(0.5, Math.min(3, 1800 / Math.max(b.w, b.h)))
  const W = Math.ceil((b.w + pad * 2) * scale)
  const H = Math.ceil((b.h + pad * 2) * scale)
  const c = document.createElement("canvas")
  c.width = W
  c.height = H
  const ctx = c.getContext("2d", { willReadFrequently: true })
  if (!ctx) return undefined
  ctx.setTransform(scale, 0, 0, scale, -(b.x - pad) * scale, -(b.y - pad) * scale)
  drawItem(ctx, { ...it, hidden: false, opacity: 1, fill: "#000000", stroke: null })
  const count = () => {
    const d = ctx.getImageData(0, 0, W, H).data
    let k = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] >= 128) k++
    return k
  }
  const before = count()
  drawItem(ctx, er)
  const data = ctx.getImageData(0, 0, W, H).data
  const grown = new Uint8Array(W * H)
  let after = 0
  let minX = W
  let minY = H
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] < 128) continue
      grown[y * W + x] = 1
      after++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (before - after < 2) return undefined
  if (after < 4 || maxX < 0) return null
  const subs = traceMask({ grown, W, H, minX, minY, maxX, maxY }, Math.max(1.1, scale * 0.8))
  if (!subs.length) return null
  const ox = b.x - pad
  const oy = b.y - pad
  const f = (x: number, y: number) => ({ x: x / scale + ox, y: y / scale + oy })
  return mapPath({ ...it, subpaths: subs, evenOdd: true }, f)
}

/**
 * Break a multi-contour filled path into separate objects: every outer contour becomes
 * its own shape, holes stay with the outer contour that contains them.
 */
export function splitPath(it: PathItem): PathItem[] {
  if (it.subpaths.length < 2 || it.subpaths.some((sp) => !sp.closed)) return [it]
  const subs = it.subpaths
  const polys = subs.map((sp) => subpathSamples(sp, 6))
  const area = polys.map((p) => polyArea(p))
  const depth = polys.map((p, i) => {
    const q = p[0]
    let d = 0
    polys.forEach((o, j) => {
      if (j !== i && o.length > 2 && pointInPoly(q.x, q.y, o)) d++
    })
    return d
  })
  const outers = subs.map((_, i) => i).filter((i) => depth[i] % 2 === 0)
  if (outers.length < 2) return [it]
  const groups = new Map<number, SubPath[]>(outers.map((i) => [i, [subs[i]]]))
  subs.forEach((sp, i) => {
    if (depth[i] % 2 === 0) return
    const q = polys[i][0]
    let best = -1
    for (const o of outers) if (pointInPoly(q.x, q.y, polys[o]) && (best < 0 || area[o] < area[best])) best = o
    if (best >= 0) groups.get(best)!.push(sp)
  })
  return outers.map((o, k) => ({ ...it, id: k === 0 ? it.id : uid("f"), subpaths: groups.get(o)! }))
}

/** Convert a Pressure Ink stroke (legacy) or keep any other item as-is. */
export const toBlobIfPressure = (it: Item): Item =>
  it.kind === "stroke" && it.brush === "vector-pressure" ? strokeToBlob(it) ?? it : it

/* ---------------- Live-paint: region mask → vector path ---------------- */

function rdpOpen(pts: XY[], eps: number): XY[] {
  if (pts.length < 3) return pts.slice()
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let maxD = 0
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = distToSeg(pts[i].x, pts[i].y, pts[a].x, pts[a].y, pts[b].x, pts[b].y)
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

function rdpClosed(pts: XY[], eps: number): XY[] {
  if (pts.length < 4) return pts.slice()
  let far = 0
  let fd = -1
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y)
    if (d > fd) {
      fd = d
      far = i
    }
  }
  const a = rdpOpen(pts.slice(0, far + 1), eps)
  const b = rdpOpen([...pts.slice(far), pts[0]], eps)
  return [...a, ...b.slice(1, -1)]
}

function polyArea(pts: XY[]) {
  let s = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y)
  return Math.abs(s / 2)
}

/** Polygon → bezier nodes: gentle turns become smooth anchors, sharp turns stay corners. */
function smoothNodes(pts: XY[]): PathNode[] {
  const n = pts.length
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n]
    const b = pts[(i + 1) % n]
    const v1x = p.x - a.x
    const v1y = p.y - a.y
    const v2x = b.x - p.x
    const v2y = b.y - p.y
    const l1 = Math.hypot(v1x, v1y) || 1
    const l2 = Math.hypot(v2x, v2y) || 1
    const cos = (v1x * v2x + v1y * v2y) / (l1 * l2)
    if (cos < 0.62) return { x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y }
    const tx = b.x - a.x
    const ty = b.y - a.y
    const tl = Math.hypot(tx, ty) || 1
    const ux = tx / tl
    const uy = ty / tl
    return { x: p.x, y: p.y, ix: p.x - (ux * l1) / 3, iy: p.y - (uy * l1) / 3, ox: p.x + (ux * l2) / 3, oy: p.y + (uy * l2) / 3 }
  })
}

/** Trace every boundary (outer edges + holes) of a region mask into closed bezier sub-paths. */
export function traceMask(m: NonNullable<ReturnType<typeof floodMask>>, eps = 1.1): SubPath[] {
  const { grown, W, H, minX, minY, maxX, maxY } = m
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && grown[y * W + x] === 1
  const VW = W + 1
  const next = new Map<number, number[]>()
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = y0 * VW + x0
    const arr = next.get(k)
    if (arr) arr.push(y1 * VW + x1)
    else next.set(k, [y1 * VW + x1])
  }
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!at(x, y)) continue
      if (!at(x, y - 1)) add(x, y, x + 1, y)
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1)
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1)
      if (!at(x - 1, y)) add(x, y + 1, x, y)
    }
  }
  const out: SubPath[] = []
  for (const start of Array.from(next.keys())) {
    while (next.get(start)?.length) {
      const loop: XY[] = []
      let k = start
      let guard = 0
      do {
        const arr = next.get(k)!
        const v = arr.pop()!
        if (!arr.length) next.delete(k)
        loop.push({ x: k % VW, y: Math.floor(k / VW) })
        k = v
      } while (k !== start && next.has(k) && guard++ < 5e6)
      if (loop.length < 4) continue
      // edge midpoints remove the pixel staircase before simplifying
      const mids = loop.map((p, i) => {
        const q = loop[(i + 1) % loop.length]
        return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
      })
      const simple = rdpClosed(mids, eps)
      if (simple.length < 3 || polyArea(simple) < 3) continue
      out.push({ closed: true, nodes: smoothNodes(simple) })
    }
  }
  return out
}
