import {
  DOC_H,
  DOC_W,
  type BrushId,
  type EraseItem,
  type Item,
  type Layer,
  type Pt,
  type Rect,
  type ShapeItem,
  type StrokeItem,
} from "./types"
import { hexToRgb } from "./color"

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
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
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
  const pts = s.points
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
    case "image":
      ctx.drawImage(it.canvas, it.x, it.y, it.w, it.h)
      break
  }
  ctx.restore()
}

/* ---------------- Geometry ---------------- */

export function outlineOf(it: Item): { pts: XY[]; closed: boolean } {
  switch (it.kind) {
    case "stroke":
      return { pts: isVectorBrush(it.brush) ? catmull(it.points) : it.points, closed: false }
    case "erase":
      return { pts: it.points, closed: false }
    case "shape":
      if (it.shape === "ellipse") return { pts: ellipseSamples(it.points), closed: true }
      return { pts: it.points, closed: it.shape === "rect" }
    case "image":
      return {
        pts: [
          { x: it.x, y: it.y },
          { x: it.x + it.w, y: it.y },
          { x: it.x + it.w, y: it.y + it.h },
          { x: it.x, y: it.y + it.h },
        ],
        closed: true,
      }
  }
}

export function itemBounds(it: Item): Rect {
  if (it.kind === "image") return { x: it.x, y: it.y, w: it.w, h: it.h }
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
  const pad = it.size / 2
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
  if (it.kind === "erase") return false
  if (it.kind === "image") {
    if (x < it.x || y < it.y || x > it.x + it.w || y > it.y + it.h) return false
    const cx = Math.floor(((x - it.x) / it.w) * it.canvas.width)
    const cy = Math.floor(((y - it.y) / it.h) * it.canvas.height)
    const c = it.canvas.getContext("2d")
    if (!c) return true
    return c.getImageData(cx, cy, 1, 1).data[3] > 0
  }
  const b = itemBounds(it)
  if (x < b.x - tol || y < b.y - tol || x > b.x + b.w + tol || y > b.y + b.h + tol) return false
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
  return []
}

export function setAnchor(it: Item, idx: number, x: number, y: number): Item {
  if (it.kind === "stroke" || it.kind === "shape") {
    const points = it.points.slice()
    points[idx] = { ...points[idx], x, y }
    return { ...it, points }
  }
  return it
}

export function translateItem(it: Item, dx: number, dy: number): Item {
  if (it.kind === "image") return { ...it, x: it.x + dx, y: it.y + dy }
  return { ...it, points: it.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) } as Item
}

export function scaleItem(it: Item, ox: number, oy: number, sx: number, sy: number): Item {
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
    ctx.drawImage(tmp, 0, 0)
    ctx.globalAlpha = 1
  }
  return c
}

/** Scanline flood fill on a flattened composite; returns a cropped colour bitmap. */
export function floodFill(src: ImageData, sx: number, sy: number, color: string, tol: number) {
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
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  const out = ctx.createImageData(w, h)
  const { r, g, b } = hexToRgb(color)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grown[(y + minY) * W + (x + minX)]) continue
      const o = (y * w + x) * 4
      out.data[o] = r
      out.data[o + 1] = g
      out.data[o + 2] = b
      out.data[o + 3] = 255
    }
  }
  ctx.putImageData(out, 0, 0)
  return { canvas, x: minX, y: minY, w, h }
}
