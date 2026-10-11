export type BrushId = "pencil-pressure" | "pencil-fixed" | "vector-pressure" | "vector-fixed"

export type ToolId =
  | "select"
  | "direct"
  | "move"
  | "transform"
  | "lasso"
  | "brush"
  | "eraser"
  | "fill"
  | "eyedropper"
  | "line"
  | "rect"
  | "ellipse"
  | "pen"
  | "penAdd"
  | "penDelete"
  | "penConvert"
  | "hand"
  | "zoom"

export interface Pt {
  x: number
  y: number
  p: number
  /** Anchor Point tool: a sharp corner instead of a smooth curve through this point. */
  corner?: boolean
}

export interface StrokeItem {
  id: string
  kind: "stroke"
  brush: BrushId
  color: string
  size: number
  opacity: number
  points: Pt[]
  seed: number
  hidden?: boolean
  /** Group id — grouped objects select, move and transform together. */
  group?: string
}

export interface EraseItem {
  id: string
  kind: "erase"
  size: number
  points: Pt[]
  /** Lasso cut-out: the points form a closed polygon that is removed (pencil part-selection). */
  poly?: boolean
  hidden?: boolean
  /** Group id — grouped objects select, move and transform together. */
  group?: string
}

export interface ShapeItem {
  id: string
  kind: "shape"
  shape: "rect" | "ellipse" | "line"
  points: Pt[]
  color: string
  size: number
  opacity: number
  fill: string | null
  hidden?: boolean
  /** Group id — grouped objects select, move and transform together. */
  group?: string
}

export interface ImageItem {
  id: string
  kind: "image"
  x: number
  y: number
  w: number
  h: number
  rot?: number
  canvas: HTMLCanvasElement
  hidden?: boolean
  /** Group id — grouped objects select, move and transform together. */
  group?: string
}

/** Bezier anchor with absolute in/out handle positions (handle === anchor means a corner). */
export interface PathNode {
  x: number
  y: number
  ix: number
  iy: number
  ox: number
  oy: number
}

export interface SubPath {
  nodes: PathNode[]
  closed: boolean
}

/** Illustrator-style vector path: pen-tool paths and live-paint bucket fills. */
export interface PathItem {
  id: string
  kind: "path"
  subpaths: SubPath[]
  stroke: string | null
  size: number
  fill: string | null
  opacity: number
  evenOdd?: boolean
  /** Pressure Ink blob shape: a filled, tapered stroke — colour edits recolour its fill. */
  blob?: boolean
  hidden?: boolean
  /** Group id — grouped objects select, move and transform together. */
  group?: string
}

export type Item = StrokeItem | EraseItem | ShapeItem | ImageItem | PathItem

export type LayerType = "pencil" | "vector"

/** Which layer type a new item belongs on. Eraser marks go on whatever layer is active. */
export function layerTypeFor(it: Item): LayerType | null {
  if (it.kind === "erase") return null
  if (it.kind === "stroke") return it.brush === "pencil-pressure" || it.brush === "pencil-fixed" ? "pencil" : "vector"
  return "vector"
}

export const cornerNode = (x: number, y: number): PathNode => ({ x, y, ix: x, iy: y, ox: x, oy: y })

export type BlendMode = "normal" | "multiply" | "screen"

export const blendOp = (b?: BlendMode): GlobalCompositeOperation =>
  b === "multiply" ? "multiply" : b === "screen" ? "screen" : "source-over"

export interface Layer {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  blend?: BlendMode
  type: LayerType
  items: Item[]
  /** v1.0.7 nested layers: id of the layer this one sits inside (undefined = top level). */
  parent?: string
}

/**
 * v1.0.7 nested layers. Layers stay one flat array (bottom → top render order); a nested layer and
 * all its descendants always sit directly beneath their parent, so the parent's own artwork draws
 * above its sublayers and the panel tree matches what you see on the canvas.
 */
export function normalizeLayers(ls: Layer[]): Layer[] {
  const byId = new Map(ls.map((l) => [l.id, l]))
  const fixed = ls.map((l) => {
    if (!l.parent) return l
    let p: string | undefined = l.parent
    let bad = !byId.has(p)
    let guard = 0
    while (!bad && p) {
      if (p === l.id || guard++ > 64) bad = true
      else p = byId.get(p)?.parent
    }
    return bad ? { ...l, parent: undefined } : l
  })
  const kids = new Map<string, Layer[]>()
  const roots: Layer[] = []
  for (const l of fixed) {
    if (!l.parent) roots.push(l)
    else {
      const list = kids.get(l.parent) ?? []
      list.push(l)
      kids.set(l.parent, list)
    }
  }
  const out: Layer[] = []
  const emit = (l: Layer) => {
    for (const c of kids.get(l.id) ?? []) emit(c)
    out.push(l)
  }
  for (const r of roots) emit(r)
  return out.length === ls.length && out.every((l, i) => l === ls[i]) ? ls : out
}

/** Nesting depth (0 = top level). */
export function layerDepth(ls: Layer[], l: Layer): number {
  let d = 0
  let p = l.parent
  while (p && d < 64) {
    d++
    p = ls.find((x) => x.id === p)?.parent
  }
  return d
}

/** True when `id` is `ancestorId` or sits somewhere inside it. */
export function isInside(ls: Layer[], id: string, ancestorId: string): boolean {
  let cur: string | undefined = id
  let guard = 0
  while (cur && guard++ < 64) {
    if (cur === ancestorId) return true
    cur = ls.find((x) => x.id === cur)?.parent
  }
  return false
}

const effCache = new WeakMap<Layer[], Layer[]>()
/**
 * Layers as they actually render: a hidden / locked parent hides / locks everything inside it, and
 * opacities multiply down the tree. Item arrays keep their identity, so layer caches stay valid.
 */
export function effLayers(ls: Layer[]): Layer[] {
  if (!ls.some((l) => l.parent)) return ls
  const hit = effCache.get(ls)
  if (hit) return hit
  const byId = new Map(ls.map((l) => [l.id, l]))
  const out = ls.map((l) => {
    if (!l.parent) return l
    let visible = l.visible
    let locked = l.locked
    let opacity = l.opacity
    let p = byId.get(l.parent)
    let guard = 0
    while (p && guard++ < 64) {
      visible = visible && p.visible
      locked = locked || p.locked
      opacity *= p.opacity
      p = p.parent ? byId.get(p.parent) : undefined
    }
    return visible === l.visible && locked === l.locked && opacity === l.opacity ? l : { ...l, visible, locked, opacity }
  })
  effCache.set(ls, out)
  return out
}

export interface BrushSettings {
  size: number
  opacity: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Live document size — ES module live bindings, updated via setDocSize(). */
export let DOC_W = 1600
export let DOC_H = 1000
export function setDocSize(w: number, h: number) {
  DOC_W = Math.max(1, Math.round(w))
  DOC_H = Math.max(1, Math.round(h))
}

export const CANVAS_PRESETS: { id: string; name: string; detail: string; w: number; h: number }[] = [
  { id: "square", name: "Square", detail: "1200 × 1200 px", w: 1200, h: 1200 },
  { id: "tabloid", name: "Tabloid 11 × 17 in", detail: "300 dpi · 3300 × 5100 px", w: 3300, h: 5100 },
  { id: "portrait", name: "Story / Portrait HD", detail: "1080 × 1920 px", w: 1080, h: 1920 },
  { id: "landscape", name: "Full HD Landscape", detail: "1920 × 1080 px", w: 1920, h: 1080 },
]

let counter = 0
export const uid = (prefix = "i") => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`

export const BRUSHES: { id: BrushId; name: string; family: "Pencil" | "Vector"; pressure: boolean; key: string }[] = [
  { id: "pencil-pressure", name: "Sketch Pencil", family: "Pencil", pressure: true, key: "1" },
  { id: "pencil-fixed", name: "Tech Pencil", family: "Pencil", pressure: false, key: "2" },
  { id: "vector-pressure", name: "Pressure Ink", family: "Vector", pressure: true, key: "3" },
  { id: "vector-fixed", name: "Mono Liner", family: "Vector", pressure: false, key: "4" },
]
