import type { Item, PathItem, PathNode, Pt, StrokeItem, SubPath } from "./types"
import { catmull, outlinesOf, simplify } from "./render"

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
  return null
}

/* ---------------- unified anchor-editing model (paths, shapes AND brush strokes) ---------------- */

export type EditModel =
{kind: "path";item: PathItem;} |
{kind: "stroke";item: StrokeItem;nodes: Pt[];};

/** Editable anchors of a brush stroke. Vector strokes are already simplified; pencil strokes are simplified on demand. */
export function strokeNodes(s: StrokeItem): Pt[] {
  if (s.brush === "vector-pressure" || s.brush === "vector-fixed" || s.points.length <= 3) return s.points
  return simplify(s.points, 1)
}

export function editModel(it: Item): EditModel | null {
  if (it.hidden) return null
  if (it.kind === "stroke") return { kind: "stroke", item: it, nodes: strokeNodes(it) }
  const p = toPathItem(it)
  return p ? { kind: "path", item: p } : null
}

export const canEditAnchors = (it: Item) => editModel(it) !== null

/** Exact bezier equivalent of the Catmull-Rom curve strokes render with (honours corner anchors). */
function strokeAsPath(nodes: Pt[]): PathItem {
  const n = nodes.length
  const out: PathNode[] = nodes.map((P, i) => {
    const prev = nodes[i - 1]
    const next = nodes[i + 1]
    // outgoing segment i: p0 = corner ? self : prev
    const p0 = P.corner || !prev ? P : prev
    const o = next ? { x: P.x + (next.x - p0.x) / 6, y: P.y + (next.y - p0.y) / 6 } : { x: P.x, y: P.y }
    // incoming segment i-1: p3 = corner ? self : next
    const p3 = P.corner || !next ? P : next
    const inn = prev ? { x: P.x - (p3.x - prev.x) / 6, y: P.y - (p3.y - prev.y) / 6 } : { x: P.x, y: P.y }
    return { x: P.x, y: P.y, ix: inn.x, iy: inn.y, ox: o.x, oy: o.y }
  })
  if (n < 3) out.forEach((q) => Object.assign(q, { ix: q.x, iy: q.y, ox: q.x, oy: q.y }))
  return { id: "tmp", kind: "path", stroke: "#000", size: 1, fill: null, opacity: 1, subpaths: [{ closed: false, nodes: out }] }
}

export function modelSubpaths(m: EditModel): {closed: boolean;nodes: {x: number;y: number;corner: boolean;}[];}[] {
  if (m.kind === "path") return m.item.subpaths.map((sp) => ({ closed: sp.closed, nodes: sp.nodes.map((n) => ({ x: n.x, y: n.y, corner: isCorner(n) })) }))
  return [{ closed: false, nodes: m.nodes.map((n) => ({ x: n.x, y: n.y, corner: !!n.corner })) }]
}

export function modelOutlines(m: EditModel) {
  if (m.kind === "path") return outlinesOf(m.item)
  return [{ pts: catmull(m.nodes) as XY[], closed: false }]
}

export const modelHalfWidth = (m: EditModel) => m.kind === "path" ? m.item.stroke ? m.item.size / 2 : 0 : m.item.size / 2

export function modelNearest(m: EditModel, x: number, y: number) {
  return nearestSegment(m.kind === "path" ? m.item : strokeAsPath(m.nodes), x, y)
}

/** Add Anchor Point. */
export function modelInsert(m: EditModel, sub: number, seg: number, t: number): Item {
  if (m.kind === "path") return insertAnchor(m.item, sub, seg, t)
  const bp = strokeAsPath(m.nodes).subpaths[0].nodes
  const a = bp[seg]
  const b = bp[seg + 1]
  if (!a || !b) return m.item
  const q = bez(a, b, t)
  const p = m.nodes[seg].p + (m.nodes[seg + 1].p - m.nodes[seg].p) * t
  const points = m.nodes.slice()
  points.splice(seg + 1, 0, { x: q.x, y: q.y, p })
  return { ...m.item, points }
}

/** Delete Anchor Point. Returns null when the object should be removed. */
export function modelDelete(m: EditModel, sub: number, idx: number): Item | null {
  if (m.kind === "path") return deleteAnchor(m.item, sub, idx)
  const points = m.nodes.filter((_, i) => i !== idx)
  return points.length < 2 ? null : { ...m.item, points }
}

/* ---------------- Live corners: round a sharp anchor into a curve ---------------- */

export function cornerInfo(p: PathItem, sub: number, idx: number) {
  const sp = p.subpaths[sub]
  if (!sp) return null
  const n = sp.nodes.length
  const P = sp.nodes[idx]
  if (!P || !isCorner(P) || n < 2) return null
  if (!sp.closed && (idx === 0 || idx === n - 1)) return null
  if (sp.closed && n < 3) return null
  const A = sp.nodes[(idx - 1 + n) % n]
  const B = sp.nodes[(idx + 1) % n]
  const aC = A.ox !== A.x || A.oy !== A.y ? { x: A.ox, y: A.oy } : { x: A.x, y: A.y }
  const bC = B.ix !== B.x || B.iy !== B.y ? { x: B.ix, y: B.iy } : { x: B.x, y: B.y }
  const l1 = Math.hypot(aC.x - P.x, aC.y - P.y)
  const l2 = Math.hypot(bC.x - P.x, bC.y - P.y)
  if (l1 < 1e-6 || l2 < 1e-6) return null
  const d1 = { x: (aC.x - P.x) / l1, y: (aC.y - P.y) / l1 }
  const d2 = { x: (bC.x - P.x) / l2, y: (bC.y - P.y) / l2 }
  const theta = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y)))
  if (theta < 0.05 || theta > Math.PI - 0.05) return null
  const bx = d1.x + d2.x
  const by = d1.y + d2.y
  const bl = Math.hypot(bx, by) || 1
  const maxT = 0.5 * Math.min(Math.hypot(A.x - P.x, A.y - P.y), Math.hypot(B.x - P.x, B.y - P.y))
  return { P, d1, d2, theta, maxT, b: { x: bx / bl, y: by / bl } }
}

/** All corner anchors that can be rounded, with their inward bisector direction. */
export function cornerWidgets(p: PathItem) {
  const out: {sub: number;idx: number;x: number;y: number;b: XY;}[] = []
  p.subpaths.forEach((sp, s) =>
    sp.nodes.forEach((n, i) => {
      const c = cornerInfo(p, s, i)
      if (c) out.push({ sub: s, idx: i, x: n.x, y: n.y, b: c.b })
    }),
  )
  return out
}

/** Largest usable radius for a corner (limited by the neighbouring segments). */
export function maxCornerRadius(p: PathItem, sub: number, idx: number) {
  const c = cornerInfo(p, sub, idx)
  return c ? c.maxT * Math.tan(c.theta / 2) : 0
}

/** Radius that puts the arc's midpoint where the pointer is (distance `m` along the bisector). */
export function radiusFromBisector(p: PathItem, sub: number, idx: number, x: number, y: number) {
  const c = cornerInfo(p, sub, idx)
  if (!c) return 0
  const m = Math.max(0, (x - c.P.x) * c.b.x + (y - c.P.y) * c.b.y)
  const s = Math.sin(c.theta / 2)
  return (m * s) / Math.max(1e-6, 1 - s)
}

/** Replace a sharp corner with a circular fillet of radius r (two bezier anchors). */
export function roundCorner(p: PathItem, sub: number, idx: number, r: number): PathItem {
  const c = cornerInfo(p, sub, idx)
  if (!c || r <= 0.01) return p
  const { P, d1, d2, theta, maxT } = c
  let t = r / Math.tan(theta / 2)
  if (t > maxT) {
    t = maxT
    r = t * Math.tan(theta / 2)
  }
  const T1 = { x: P.x + d1.x * t, y: P.y + d1.y * t }
  const T2 = { x: P.x + d2.x * t, y: P.y + d2.y * t }
  const k = (4 / 3) * Math.tan((Math.PI - theta) / 4) * r
  const n1: PathNode = { x: T1.x, y: T1.y, ix: T1.x, iy: T1.y, ox: T1.x - d1.x * k, oy: T1.y - d1.y * k }
  const n2: PathNode = { x: T2.x, y: T2.y, ix: T2.x - d2.x * k, iy: T2.y - d2.y * k, ox: T2.x, oy: T2.y }
  return {
    ...p,
    subpaths: p.subpaths.map((sp, s) => {
      if (s !== sub) return sp
      const nodes = sp.nodes.slice()
      nodes.splice(idx, 1, n1, n2)
      return { ...sp, nodes }
    }),
  }
}

/** Anchor Point click: smooth ⇄ corner. */
export function modelToggle(m: EditModel, sub: number, idx: number): {item: Item;corner: boolean;} {
  if (m.kind === "path") {
    const n = m.item.subpaths[sub].nodes[idx]
    return isCorner(n) ? { item: makeSmoothAuto(m.item, sub, idx), corner: false } : { item: makeCorner(m.item, sub, idx), corner: true }
  }
  const corner = !m.nodes[idx].corner
  const points = m.nodes.map((n, i) => i === idx ? { ...n, corner } : n)
  return { item: { ...m.item, points }, corner }
}

/** Anchor Point drag: paths pull out symmetric handles; brush strokes reshape through the dragged point. */
export function modelDragAnchor(m: EditModel, sub: number, idx: number, x: number, y: number): Item {
  if (m.kind === "path") return makeSmoothTo(m.item, sub, idx, x, y)
  const points = m.nodes.map((n, i) => i === idx ? { ...n, x, y, corner: false } : n)
  return { ...m.item, points }
}

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

/* ---------------- v1.0.4: continue open paths + join end anchors ---------------- */

/** An end anchor of an open sub-path: end 0 = first anchor, 1 = last anchor. */
export type PathEnd = { id: string; sub: number; end: 0 | 1 }

/**
 * Items whose open ends can be continued with the Pen or joined: pen paths, lines and
 * Mono Liner strokes (converted to an equivalent bezier path with the same id and style).
 */
export function asJoinablePath(it: Item): PathItem | null {
  if (it.hidden) return null
  if (it.kind === "path") return it.blob ? null : it
  if (it.kind === "shape" && it.shape === "line") return toPathItem(it)
  if (it.kind === "stroke" && it.brush === "vector-fixed" && it.points.length >= 2) {
    const p = strokeAsPath(it.points)
    return { ...p, id: it.id, stroke: it.color, size: it.size, opacity: it.opacity, group: it.group }
  }
  return null
}

/** All open-path end anchors of an item. */
export function openEnds(p: PathItem): (PathEnd & { x: number; y: number })[] {
  const out: (PathEnd & { x: number; y: number })[] = []
  p.subpaths.forEach((sp, s) => {
    if (sp.closed || sp.nodes.length < 1) return
    const a = sp.nodes[0]
    const b = sp.nodes[sp.nodes.length - 1]
    out.push({ id: p.id, sub: s, end: 0, x: a.x, y: a.y })
    if (sp.nodes.length > 1) out.push({ id: p.id, sub: s, end: 1, x: b.x, y: b.y })
  })
  return out
}

/** Reverse a sub-path's direction (handles swap sides). */
export function reverseSub(sp: SubPath): SubPath {
  return { closed: sp.closed, nodes: sp.nodes.slice().reverse().map((n) => ({ x: n.x, y: n.y, ix: n.ox, iy: n.oy, ox: n.ix, oy: n.iy })) }
}

const SAME = 0.75

/**
 * Join two end anchors. Same sub-path → it closes. Otherwise the two runs become one path; if
 * the anchors sit on top of each other they merge into a single anchor, else a segment joins them.
 * Returns the joined item (keeps A's id + style) and the id of B when B was absorbed.
 */
export function joinEnds(A: PathItem, ea: PathEnd, B: PathItem, eb: PathEnd): { item: PathItem; removeId: string | null } | null {
  const spA = A.subpaths[ea.sub]
  const spB = B.subpaths[eb.sub]
  if (!spA || !spB || spA.closed || spB.closed) return null
  if (A.id === B.id && ea.sub === eb.sub) {
    if (ea.end === eb.end || spA.nodes.length < 2) return null
    const nodes = spA.nodes.map((n) => ({ ...n }))
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (nodes.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < SAME) {
      first.ix = last.ix
      first.iy = last.iy
      nodes.pop()
    }
    return { item: { ...A, subpaths: A.subpaths.map((sp, i) => (i === ea.sub ? { closed: true, nodes } : sp)) }, removeId: null }
  }
  const a = ea.end === 1 ? spA : reverseSub(spA)
  const b = eb.end === 0 ? spB : reverseSub(spB)
  const an = a.nodes.map((n) => ({ ...n }))
  const bn = b.nodes.map((n) => ({ ...n }))
  const tail = an[an.length - 1]
  const head = bn[0]
  if (Math.hypot(tail.x - head.x, tail.y - head.y) < SAME) {
    tail.ox = head.ox
    tail.oy = head.oy
    bn.shift()
  }
  const merged: SubPath = { closed: false, nodes: [...an, ...bn] }
  if (A.id === B.id) {
    const lo = Math.min(ea.sub, eb.sub)
    const subpaths: SubPath[] = []
    A.subpaths.forEach((sp, i) => {
      if (i === lo) subpaths.push(merged)
      else if (i !== ea.sub && i !== eb.sub) subpaths.push(sp)
    })
    return { item: { ...A, subpaths }, removeId: null }
  }
  const subpaths = A.subpaths.map((sp, i) => (i === ea.sub ? merged : sp))
  B.subpaths.forEach((sp, i) => i !== eb.sub && subpaths.push(sp))
  const stroke = A.stroke ?? B.stroke
  return { item: { ...A, stroke, size: A.stroke ? A.size : B.size, subpaths }, removeId: B.id }
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
