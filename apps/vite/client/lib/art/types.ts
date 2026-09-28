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
  | "hand"
  | "zoom"

export interface Pt {
  x: number
  y: number
  p: number
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
}

export interface EraseItem {
  id: string
  kind: "erase"
  size: number
  points: Pt[]
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
}

export type Item = StrokeItem | EraseItem | ShapeItem | ImageItem

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
  items: Item[]
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
