import { uid, type Item, type PathItem } from "./types"
import { drawItem, isVectorBrush, mapPath, strokeToBlob, traceMask, unionBounds } from "./render"

/**
 * Pathfinder + Outline Stroke, done on a high-resolution silhouette mask and traced back
 * into smooth bezier paths (same engine as the Live Paint bucket), so any mix of shapes,
 * pen paths and vector brush strokes can be combined.
 */

export type PathfinderOp = "unite" | "minusFront" | "intersect" | "exclude"

type Frame = { x: number; y: number; scale: number; W: number; H: number }

const INK = "#000000"

function frameFor(items: Item[]): Frame | null {
  const u = unionBounds(items)
  if (!u || u.w <= 0 || u.h <= 0) return null
  const pad = 4
  const scale = Math.max(0.5, Math.min(4, 2000 / Math.max(u.w, u.h)))
  return { x: u.x - pad, y: u.y - pad, scale, W: Math.ceil((u.w + pad * 2) * scale), H: Math.ceil((u.h + pad * 2) * scale) }
}

/** Black silhouette of an item: its fill area, its stroke area, or both. */
function silhouette(it: Item, part: "all" | "fill" | "stroke"): Item | null {
  switch (it.kind) {
    case "path": {
      const fill = part !== "stroke" && it.fill ? INK : null
      const stroke = part !== "fill" && it.stroke && it.size > 0 ? INK : null
      if (!fill && !stroke) return null
      return { ...it, hidden: false, opacity: 1, fill, stroke }
    }
    case "shape": {
      const fill = part !== "stroke" && it.fill && it.shape !== "line" ? INK : null
      const size = part !== "fill" ? it.size : 0
      if (!fill && !size) return null
      return { ...it, hidden: false, opacity: 1, fill, color: INK, size }
    }
    case "stroke":
      if (part === "fill" || !isVectorBrush(it.brush)) return null
      return { ...it, hidden: false, opacity: 1, color: INK }
    default:
      return null
  }
}

function maskOf(items: (Item | null)[], f: Frame): Uint8Array {
  const c = document.createElement("canvas")
  c.width = f.W
  c.height = f.H
  const ctx = c.getContext("2d", { willReadFrequently: true })!
  ctx.setTransform(f.scale, 0, 0, f.scale, -f.x * f.scale, -f.y * f.scale)
  for (const it of items) if (it) drawItem(ctx, it)
  const d = ctx.getImageData(0, 0, f.W, f.H).data
  const m = new Uint8Array(f.W * f.H)
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] >= 128 ? 1 : 0
  return m
}

function maskToPath(m: Uint8Array, f: Frame, base: Omit<PathItem, "subpaths">): PathItem | null {
  const { W, H } = f
  let minX = W
  let minY = H
  let maxX = -1
  let maxY = -1
  let count = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue
      count++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (count < 4) return null
  const subs = traceMask({ grown: m, W, H, minX, minY, maxX, maxY })
  if (!subs.length) return null
  return mapPath({ ...base, subpaths: subs, evenOdd: true }, (x, y) => ({ x: x / f.scale + f.x, y: y / f.scale + f.y }))
}

export function colorOf(it: Item): string {
  if (it.kind === "path") return it.fill ?? it.stroke ?? "#141417"
  if (it.kind === "shape") return (it.shape !== "line" && it.fill) || it.color
  if (it.kind === "stroke") return it.color
  return "#141417"
}

/** Items the pathfinder can combine: shapes, pen / fill paths and vector brush strokes. */
export const isPathfinderable = (it: Item) =>
  !it.hidden && (it.kind === "path" || it.kind === "shape" || (it.kind === "stroke" && isVectorBrush(it.brush)))

/** Combine items (ordered back → front). Returns null if the result is empty. */
export function pathfinder(items: Item[], op: PathfinderOp): PathItem | null {
  const f = frameFor(items)
  if (!f || items.length < 2) return null
  const masks = items.map((it) => maskOf([silhouette(it, "all")], f))
  const N = f.W * f.H
  const out = new Uint8Array(N)
  const back = masks[0]
  for (let i = 0; i < N; i++) {
    if (op === "unite") {
      for (const m of masks) if (m[i]) {
        out[i] = 1
        break
      }
    } else if (op === "intersect") {
      let all = 1
      for (const m of masks) if (!m[i]) {
        all = 0
        break
      }
      out[i] = all
    } else if (op === "exclude") {
      let n = 0
      for (const m of masks) n += m[i]
      out[i] = n & 1
    } else {
      if (!back[i]) continue
      let covered = 0
      for (let k = 1; k < masks.length; k++) if (masks[k][i]) {
        covered = 1
        break
      }
      out[i] = covered ? 0 : 1
    }
  }
  const src = op === "minusFront" ? items[0] : items[items.length - 1]
  return maskToPath(out, f, {
    id: uid("pf"),
    kind: "path",
    stroke: null,
    size: 0,
    fill: colorOf(src),
    opacity: "opacity" in src ? src.opacity : 1,
    group: src.group,
  })
}

/**
 * Convert Path to Shape (Illustrator "Outline Stroke"): a stroke becomes a filled shape.
 * An item with both fill and stroke becomes two shapes (fill below, outlined stroke above).
 * Returns null when there is nothing to convert.
 */
export function outlineItem(it: Item): PathItem[] | null {
  if (it.hidden) return null
  if (it.kind === "stroke" && it.brush === "vector-pressure") {
    const b = strokeToBlob(it)
    return b ? [{ ...b, id: uid("pf"), blob: false, group: it.group }] : null
  }
  if (it.kind === "path" && !(it.stroke && it.size > 0)) return null
  if (it.kind === "shape" && !(it.size > 0)) return null
  if (!isPathfinderable(it)) return null
  const f = frameFor([it])
  if (!f) return null
  const opacity = "opacity" in it ? it.opacity : 1
  const out: PathItem[] = []
  const fillSil = silhouette(it, "fill")
  if (fillSil) {
    const fillColor = it.kind === "path" ? it.fill : it.kind === "shape" ? it.fill : null
    const p = maskToPath(maskOf([fillSil], f), f, { id: uid("pf"), kind: "path", stroke: null, size: 0, fill: fillColor ?? "#ffffff", opacity, group: it.group })
    if (p) out.push(p)
  }
  const strokeSil = silhouette(it, "stroke")
  if (strokeSil) {
    const strokeColor = it.kind === "path" ? it.stroke : it.kind === "shape" ? it.color : it.kind === "stroke" ? it.color : null
    const p = maskToPath(maskOf([strokeSil], f), f, { id: uid("pf"), kind: "path", stroke: null, size: 0, fill: strokeColor ?? "#141417", opacity, group: it.group })
    if (p) out.push(p)
  }
  return out.length ? out : null
}
