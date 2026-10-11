import type { Pt } from "./types"
import { distToSeg, simplify } from "./render"

/**
 * Hold-to-shape (v1.0.5): when you finish a stroke and keep the pen still, the rough stroke is
 * replaced by a clean line, circle / ellipse, rectangle / square, triangle, polygon or smooth curve.
 * The result is still a normal brush stroke (same brush, colour, size), just with perfect geometry.
 */
export type QuickShape = { kind: "line" | "ellipse" | "polygon" | "curve"; label: string; points: Pt[] }

const DEG = Math.PI / 180

/** Snap the line a→b to 0° / 45° / 90° … when it's within 4° of one. */
export function snapLineAngle(a: { x: number; y: number }, b: { x: number; y: number }) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  const snap = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4)
  if (Math.abs(ang - snap) > 4 * DEG) return { x: b.x, y: b.y }
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  return { x: a.x + Math.cos(snap) * len, y: a.y + Math.sin(snap) * len }
}

function turnAt(prev: Pt, p: Pt, next: Pt) {
  const a1 = Math.atan2(p.y - prev.y, p.x - prev.x)
  const a2 = Math.atan2(next.y - p.y, next.x - p.x)
  let d = Math.abs(a2 - a1)
  if (d > Math.PI) d = Math.PI * 2 - d
  return d
}

export function recognizeShape(raw: Pt[], zoom: number): QuickShape | null {
  if (raw.length < 3) return null
  let L = 0
  let pSum = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < raw.length; i++) {
    const q = raw[i]
    if (i) L += Math.hypot(q.x - raw[i - 1].x, q.y - raw[i - 1].y)
    pSum += q.p
    minX = Math.min(minX, q.x)
    minY = Math.min(minY, q.y)
    maxX = Math.max(maxX, q.x)
    maxY = Math.max(maxY, q.y)
  }
  if (L * zoom < 24) return null
  const p = pSum / raw.length
  const w = maxX - minX
  const h = maxY - minY
  const diag = Math.hypot(w, h) || 1
  const a = raw[0]
  const b = raw[raw.length - 1]
  const chord = Math.hypot(b.x - a.x, b.y - a.y)
  // flat copy without pressure, so simplify() only looks at the geometry
  const flat = raw.map((q) => ({ x: q.x, y: q.y, p: 1 }))

  // ---- straight line
  let maxDev = 0
  for (const q of raw) maxDev = Math.max(maxDev, distToSeg(q.x, q.y, a.x, a.y, b.x, b.y))
  if (chord > 0.85 * L && maxDev < Math.max(4 / zoom, chord * 0.07)) {
    const e = snapLineAngle(a, b)
    return { kind: "line", label: "straight line", points: [{ x: a.x, y: a.y, p }, { x: e.x, y: e.y, p }] }
  }

  const closed = chord < Math.max(0.2 * L, 18 / zoom)
  if (closed) {
    // ---- polygon (triangle, rectangle / square, …)
    let verts = simplify(flat, diag * 0.07)
    if (verts.length > 2 && Math.hypot(verts[0].x - verts[verts.length - 1].x, verts[0].y - verts[verts.length - 1].y) < diag * 0.2) verts.pop()
    // drop vertices that aren't real corners (incl. a start point in the middle of an edge)
    for (let pass = 0; pass < 3 && verts.length > 3; pass++) {
      verts = verts.filter((v, i) => turnAt(verts[(i - 1 + verts.length) % verts.length], v, verts[(i + 1) % verts.length]) > 28 * DEG)
    }
    // ---- circle / ellipse test
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const rx = w / 2 || 1
    const ry = h / 2 || 1
    let sum = 0
    let sum2 = 0
    for (const q of raw) {
      const r = Math.hypot((q.x - cx) / rx, (q.y - cy) / ry)
      sum += r
      sum2 += r * r
    }
    const mean = sum / raw.length
    const cv = Math.sqrt(Math.max(0, sum2 / raw.length - mean * mean)) / (mean || 1)
    const roundish = cv < 0.12

    if (!roundish && verts.length === 3) {
      return { kind: "polygon", label: "triangle", points: [...verts, verts[0]].map((v) => ({ x: v.x, y: v.y, p, corner: true })) }
    }
    if (!roundish && verts.length === 4) {
      const angles = verts.map((v, i) => turnAt(verts[(i + 3) % 4], v, verts[(i + 1) % 4]))
      const rightAngles = angles.every((t) => Math.abs(t - Math.PI / 2) < 18 * DEG)
      const e0 = Math.atan2(verts[1].y - verts[0].y, verts[1].x - verts[0].x)
      const off = Math.abs(((e0 % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2))
      const axis = Math.min(off, Math.PI / 2 - off) < 10 * DEG
      if (rightAngles && axis) {
        let x0 = minX
        let y0 = minY
        let x1 = maxX
        let y1 = maxY
        const square = Math.abs(w - h) < Math.max(w, h) * 0.1
        if (square) {
          const s = (w + h) / 2
          x0 = cx - s / 2
          x1 = cx + s / 2
          y0 = cy - s / 2
          y1 = cy + s / 2
        }
        const pts = [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ]
        // start at the corner nearest where you began drawing
        let s0 = 0
        pts.forEach((q, i) => {
          if (Math.hypot(q.x - a.x, q.y - a.y) < Math.hypot(pts[s0].x - a.x, pts[s0].y - a.y)) s0 = i
        })
        const ordered = [0, 1, 2, 3, 0].map((k) => pts[(s0 + k) % 4])
        return { kind: "polygon", label: square ? "square" : "rectangle", points: ordered.map((q) => ({ ...q, p, corner: true })) }
      }
      return { kind: "polygon", label: "four-sided shape", points: [...verts, verts[0]].map((v) => ({ x: v.x, y: v.y, p, corner: true })) }
    }
    if (cv < 0.22) {
      // drawing direction (clockwise or not) and start angle follow your stroke
      let area = 0
      for (let i = 0; i < raw.length; i++) {
        const u = raw[i]
        const v = raw[(i + 1) % raw.length]
        area += u.x * v.y - v.x * u.y
      }
      const dir = area >= 0 ? 1 : -1
      const circle = rx / ry > 0.86 && rx / ry < 1.16
      const RX = circle ? (rx + ry) / 2 : rx
      const RY = circle ? (rx + ry) / 2 : ry
      const t0 = Math.atan2((a.y - cy) / RY, (a.x - cx) / RX)
      const N = 72
      const points: Pt[] = []
      for (let i = 0; i <= N; i++) {
        const t = t0 + (dir * Math.PI * 2 * i) / N
        points.push({ x: cx + Math.cos(t) * RX, y: cy + Math.sin(t) * RY, p })
      }
      return { kind: "ellipse", label: circle ? "circle" : "ellipse", points }
    }
    if (verts.length >= 5 && verts.length <= 8) {
      return { kind: "polygon", label: `${verts.length}-sided shape`, points: [...verts, verts[0]].map((v) => ({ x: v.x, y: v.y, p, corner: true })) }
    }
    return null
  }

  // ---- open curve: same path, wobble removed
  const sim = simplify(flat, diag * 0.035)
  if (sim.length < 3) return null
  return { kind: "curve", label: "smooth curve", points: sim.map((q) => ({ x: q.x, y: q.y, p })) }
}
