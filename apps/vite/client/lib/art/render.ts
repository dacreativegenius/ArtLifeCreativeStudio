import {
  DOC_H,
  DOC_W,
  blendOp,
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
} from "./types"

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

function drawPencil(ctx: CanvasRenderingContext2D, s: StrokeItem) {
  const pts = catmull(s.points)
  if (!pts.length) return
  const pressure = s.brush === "pencil-pressure"
  const { lens, total } = cumulative(pts)
  const tLen = Math.min(total * 0.3, s.size * 5)
  ctx.fillStyle = s.color
  let idx = 0
  const stamp = (x: number, y: number, p: number, d: number) => {
    const rnd = mulberry32(s.seed + idx++ * 7919)
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
    const grains = Math.max(2, Math.round(rad * 1.8))
    for (let g = 0; g < grains; g++) {
      const ang = rnd() * Math.PI * 2
      const dist = Math.sqrt(rnd()) * rad
      const gs = 0.55 + rnd() * Math.max(0.5, rad * 0.35)
      ctx.globalAlpha = Math.min(1, a * (0.3 + rnd() * 0.7))
      ctx.fillRect(x + Math.cos(ang) * dist - gs / 2, y + Math.sin(ang) * dist - gs / 2, gs, gs)
    }
    return rad
  }
  let rad = stamp(pts[0].x, pts[0].y, pts[0].p, 0)
  let next = Math.max(0.45, rad * 0.45)
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const l0 = lens[i - 1]
    const seg = lens[i] - l0
    if (seg <= 0) continue
    while (next <= lens[i]) {
      const f = (next - l0) / seg
      rad = stamp(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.p + (b.p - a.p) * f, next)
      next += Math.max(0.45, rad * 0.45)
    }
  }
  ctx.globalAlpha = 1
}

/* ---------------- Vector ---------------- */

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
  const widths = pts.map((p, i) => (s.size * (0.1 + 0.9 * p.p) * Math.max(0.06, taperAt(lens[i], total, tLen))) / 2)
  const left: XY[] = []
  const right: XY[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n - 1, i + 1)]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l = Math.hypot(dx, dy) || 1
    const nx = -dy / l
    const ny = dx / l
    left.push({ x: pts[i].x + nx * widths[i], y: pts[i].y + ny * widths[i] })
    right.push({ x: pts[i].x - nx * widths[i], y: pts[i].y - ny * widths[i] })
  }
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
  const widths = pts.map((p, i) => (s.size * (0.1 + 0.9 * p.p) * Math.max(0.06, taperAt(lens[i], total, tLen))) / 2)
  const left: XY[] = []
  const right: XY[] = []
  const angles: number[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n - 1, i + 1)]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l = Math.hypot(dx, dy) || 1
    const nx = -dy / l
    const ny = dx / l
    angles.push(Math.atan2(dy, dx))
    left.push({ x: pts[i].x + nx * widths[i], y: pts[i].y + ny * widths[i] })
    right.push({ x: pts[i].x - nx * widths[i], y: pts[i].y - ny * widths[i] })
  }
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

function ellipseSegments(pts: XY[]) {
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

function mapPath(it: PathItem, f: (x: number, y: number) => XY): PathItem {
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
  for (const l of layers) {
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
export function traceMask(m: NonNullable<ReturnType<typeof floodMask>>): SubPath[] {
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
      const simple = rdpClosed(mids, 1.1)
      if (simple.length < 3 || polyArea(simple) < 3) continue
      out.push({ closed: true, nodes: smoothNodes(simple) })
    }
  }
  return out
}
