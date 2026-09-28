export type BrushId = "pencil-pressure" | "pencil-fixed" | "vector-pressure" | "vector-fixed"

export type ToolId =
  | "select"
  | "direct"
  | "move"
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
  canvas: HTMLCanvasElement
}

export type Item = StrokeItem | EraseItem | ShapeItem | ImageItem

export interface Layer {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
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

export const DOC_W = 1600
export const DOC_H = 1000

let counter = 0
export const uid = (prefix = "i") => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`

export const BRUSHES: { id: BrushId; name: string; family: "Pencil" | "Vector"; pressure: boolean; key: string }[] = [
  { id: "pencil-pressure", name: "Sketch Pencil", family: "Pencil", pressure: true, key: "1" },
  { id: "pencil-fixed", name: "Tech Pencil", family: "Pencil", pressure: false, key: "2" },
  { id: "vector-pressure", name: "Pressure Ink", family: "Vector", pressure: true, key: "3" },
  { id: "vector-fixed", name: "Mono Liner", family: "Vector", pressure: false, key: "4" },
]
