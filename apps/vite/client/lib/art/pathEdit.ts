import type { Item, PathItem, PathNode, SubPath } from "./types"

type XY = { x: number; y: number }

const K = 0.5523

/**
 * Convert an editable vector item into a bezier PathItem (same id), so the anchor tools can
 * work on rectangles, ellipses, lines and Mono Liner strokes exactly like pen paths.
 * Returns null for items that can't become a plain path (pencil grain, pressure ink, bitmaps).
 */
export function toPathItem(it: Item): PathItem | null {
  if (it.kind === "path") return it
  if (it.kind === "shape") {
    const p = it.points
    const base = { id: it.id, kind: "path" as const, stroke: it.size > 0 ? it.color : null, size: it.size, fill: it.fill, opacity: it.opacity }
    if (it.shape === "line") return { ...base, fill: null, subpaths: [{ closed: false, nodes: p.map((q) => corner(q.x, q.y)) }] }
    if (it.shape === "rect") return { ...base, subpaths: [{ closed: true, nodes: p.map((q) => corner(q.x, q.y)) }] }
    const c = { x: (p[0].x + p[1].x + p[2].x + p[3].x) / 4, y: (p[0].y + p[1].y + p[2].y + p[3].y) / 4 }
    const nodes: PathNode[] = p.map((P, i) => {
      const next = p[(i + 1) % 4]
      const prev = p[(i + 3) % 4]
      return {
        x: P.x,
        y: P.y,
        ox: P.x + K * (next.x - c.x),
        oy: P.y + K * (next.y - c.y),
        ix: P.x + K * (prev.x - c.x),
        iy: P.y + K * (prev.y - c.y),
      }
    })
    return { ...base, subpaths: [{ closed: true, nodes }] }
  }
  if (it.kind === "stroke" && it.brush === "vector-fixed") {
    // uniform Catmull-Rom (what the liner renders) → exact cubic bezier handles
    const P = it.points
    const nodes: PathNode[] = P.map((p1, i) => {
      const p0 = P[i - 1] ?? p1
      const p2 = P[i + 1] ?? p1
      return { x: p1.x, y: p1.y, ox: p1.x + (p2.x - p0.x) / 6, oy: p1.y + (p2.y - p0.y) / 6, ix: p1.x - (p2.x - p0.x) / 6, iy: p1.y - (p2.y - p0.y) / 6 }
    })
    if (nodes.length) {
      const a = nodes[0]
      a.ix = a.x
      a.iy = a.y
      const z = nodes[nodes.length - 1]
      z.ox = z.x
      z.oy = z.y
    }
    return { id: it.id, kind: "path", stroke: it.color, size: it.size, fill: null, opacity: it.opacity, subpaths: [{ closed: false, nodes }] }
  }
  return null
}

export const canEditAnchors = (it: Item) => toPathItem(it) !== null

const corner = (x: number, y: number): PathNode => ({ x, y, ix: x, iy: y, ox: x, oy: y })

export const isCorner = (n: PathNode) => n.ix === n.x && n.iy === n.y && n.ox === n.x && n.oy === n.y

function lerp(a: XY, b: XY, t: number): XY {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function bez(a: PathNode, b: PathNode, t: number): XY {
  const u = 1 - t
  return {
    x: u * u * u * a.x + 3 * u * u * t * a.ox + 3 * u * t * t * b.ix + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * a.oy + 3 * u * t * t * b.iy + t * t * t * b.y,
  }
}

/** Closest point on any segment: returns sub-path, segment index and bezier parameter. */
export function nearestSegment(it: PathItem, x: number, y: number) {
  let best = { sub: -1, seg: -1, t: 0, dist: Infinity, pt: { x: 0, y: 0 } }
  it.subpaths.forEach((sp, si) => {
    const n = sp.nodes.length
    const segs = sp.closed ? n : n - 1
    for (let i = 0; i < segs; i++) {
      const a = sp.nodes[i]
      const b = sp.nodes[(i + 1) % n]
      let prev = { x: a.x, y: a.y }
      const steps = 40
      for (let s = 1; s <= steps; s++) {
        const t = s / steps
        const q = bez(a, b, t)
        // project onto the tiny chord for a smoother t
        const dx = q.x - prev.x
        const dy = q.y - prev.y
        const l2 = dx * dx + dy * dy
        let f = l2 ? ((x - prev.x) * dx + (y - prev.y) * dy) / l2 : 0
        f = Math.max(0, Math.min(1, f))
        const px = prev.x + dx * f
        const py = prev.y + dy * f
        const d = Math.hypot(x - px, y - py)
        if (d < best.dist) best = { sub: si, seg: i, t: (s - 1 + f) / steps, dist: d, pt: { x: px, y: py } }
        prev = q
      }
    }
  })
  return best
}

function mapSub(it: PathItem, sub: number, fn: (sp: SubPath) => SubPath | null): PathItem | null {
  const subpaths: SubPath[] = []
  it.subpaths.forEach((sp, i) => {
    const r = i === sub ? fn(sp) : sp
    if (r) subpaths.push(r)
  })
  return subpaths.length ? { ...it, subpaths } : null
}

/** Add Anchor Point: split the segment at t (de Casteljau) so the curve shape is preserved. */
export function insertAnchor(it: PathItem, sub: number, seg: number, t: number): PathItem {
  return (
    mapSub(it, sub, (sp) => {
      const n = sp.nodes.length
      const nodes = sp.nodes.map((q) => ({ ...q }))
      const a = nodes[seg]
      const b = nodes[(seg + 1) % n]
      const p0 = { x: a.x, y: a.y }
      const p1 = { x: a.ox, y: a.oy }
      const p2 = { x: b.ix, y: b.iy }
      const p3 = { x: b.x, y: b.y }
      const straight = p1.x === p0.x && p1.y === p0.y && p2.x === p3.x && p2.y === p3.y
      if (straight) {
        const m = lerp(p0, p3, t)
        nodes.splice(seg + 1, 0, corner(m.x, m.y))
        return { ...sp, nodes }
      }
      const q0 = lerp(p0, p1, t)
      const q1 = lerp(p1, p2, t)
      const q2 = lerp(p2, p3, t)
      const r0 = lerp(q0, q1, t)
      const r1 = lerp(q1, q2, t)
      const m = lerp(r0, r1, t)
      a.ox = q0.x
      a.oy = q0.y
      b.ix = q2.x
      b.iy = q2.y
      nodes.splice(seg + 1, 0, { x: m.x, y: m.y, ix: r0.x, iy: r0.y, ox: r1.x, oy: r1.y })
      return { ...sp, nodes }
    }) ?? it
  )
}

/** Delete Anchor Point. Returns null when the whole item should be removed. */
export function deleteAnchor(it: PathItem, sub: number, idx: number): PathItem | null {
  return mapSub(it, sub, (sp) => {
    const nodes = sp.nodes.filter((_, i) => i !== idx)
    if (nodes.length < 2 || (sp.closed && nodes.length < 3 && nodes.every(isCorner))) return null
    return { ...sp, nodes }
  })
}

function setNode(it: PathItem, sub: number, idx: number, fn: (n: PathNode, sp: SubPath) => PathNode): PathItem {
  return mapSub(it, sub, (sp) => ({ ...sp, nodes: sp.nodes.map((n, i) => (i === idx ? fn(n, sp) : n)) })) ?? it
}

/** Anchor Point tool: retract both handles → hard corner. */
export const makeCorner = (it: PathItem, sub: number, idx: number) =>
  setNode(it, sub, idx, (n) => ({ ...n, ix: n.x, iy: n.y, ox: n.x, oy: n.y }))

/** Anchor Point tool drag: pull out symmetric handles with the out-handle at (hx, hy). */
export const makeSmoothTo = (it: PathItem, sub: number, idx: number, hx: number, hy: number) =>
  setNode(it, sub, idx, (n) => ({ ...n, ox: hx, oy: hy, ix: 2 * n.x - hx, iy: 2 * n.y - hy }))

/** Anchor Point tool click on a corner: auto-smooth using the neighbouring anchors. */
export const makeSmoothAuto = (it: PathItem, sub: number, idx: number) =>
  setNode(it, sub, idx, (n, sp) => {
    const len = sp.nodes.length
    const prev = sp.nodes[idx - 1] ?? (sp.closed ? sp.nodes[len - 1] : null)
    const next = sp.nodes[idx + 1] ?? (sp.closed ? sp.nodes[0] : null)
    const a = prev ?? n
    const b = next ?? n
    let tx = b.x - a.x
    let ty = b.y - a.y
    const tl = Math.hypot(tx, ty)
    if (!tl) return n
    tx /= tl
    ty /= tl
    const li = prev ? Math.hypot(n.x - prev.x, n.y - prev.y) / 3 : 0
    const lo = next ? Math.hypot(next.x - n.x, next.y - n.y) / 3 : 0
    return { ...n, ix: n.x - tx * li, iy: n.y - ty * li, ox: n.x + tx * lo, oy: n.y + ty * lo }
  })
