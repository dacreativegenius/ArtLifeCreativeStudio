import { useCallback, useEffect, useRef, useState } from "react"
import { BRUSHES, DOC_H, DOC_W, effLayers, isInside, layerTypeFor, normalizeLayers, setDocSize, uid, type BrushId, type BrushSettings, type Item, type Layer, type LayerType, type ToolId } from "../../lib/art/types"
import { drawItem, isVectorBrush, renderDoc, rotateItem, scaleItem, translateItem, unionBounds } from "../../lib/art/render"
import { isPathfinderable, outlineItem, pathfinder, type PathfinderOp } from "../../lib/art/pathfinder"
import type { Rect } from "../../lib/art/types"

/** A unique default project name, so an unnamed save never overwrites an earlier drawing. */
export function freshName() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `Untitled ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export interface BrushPreset {
  id: string
  name: string
  brush: BrushId
  size: number
  opacity: number
  stabilizer: number
}

const PRESET_KEY = "artlife-brush-presets"
const VIEW_KEY = "artlife-view-prefs"

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom"
export type ArrangeMode = "front" | "forward" | "backward" | "back"
import { buildSVG, parseDTM, safeName, saveFile, serializeDTM, type SaveResult } from "../../lib/art/fileio"
import { desktop } from "../../lib/art/desktop"
import { ANDROID_SAVE_FOLDER, lastNativeSaveName } from "../../lib/art/native"

export interface View {
  x: number
  y: number
  zoom: number
  /** Canvas view rotation in radians (touch rotate). Screen = (x, y) + R(rot) · zoom · doc. */
  rot: number
}

const DEFAULT_SWATCHES = [
  "#141417", "#2e2e35", "#55555e", "#8a8882", "#c9c6be", "#f0eee8", "#ffffff",
  "#ff7a1a", "#ffb27a", "#c2410c", "#7c2d12", "#f5b83d", "#fde68a",
  "#3d8bff", "#93c5fd", "#1e40af", "#0f766e", "#34c47c", "#bbf7d0",
  "#d65cd8", "#f0abfc", "#86198f", "#e5484d", "#fda4a1", "#7f1d1d",
  "#a47148", "#e6ccb2", "#4a3728",
]

const DEFAULT_BRUSHES: Record<BrushId, BrushSettings> = {
  "pencil-pressure": { size: 8, opacity: 0.9 },
  "pencil-fixed": { size: 3, opacity: 0.8 },
  "vector-pressure": { size: 12, opacity: 1 },
  "vector-fixed": { size: 6, opacity: 1 },
}

function makeLayer(name: string, type: LayerType, id = uid("L")): Layer {
  return { id, name, type, visible: true, locked: false, opacity: 1, blend: "normal", items: [] }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export type ColorTarget = "stroke" | "fill"

const isVectorStroke = (it: Item) => it.kind === "stroke" && (it.brush === "vector-pressure" || it.brush === "vector-fixed")

export function useStudio() {
  const [layers, setLayers] = useState<Layer[]>(() => [makeLayer("Sketch", "pencil", "layer-sketch"), makeLayer("Ink", "vector", "layer-ink")])
  const [activeLayerId, setActiveLayerId] = useState("layer-ink")
  const [tool, setTool] = useState<ToolId>("brush")
  const [brushId, setBrushId] = useState<BrushId>("pencil-pressure")
  const [brushSettings, setBrushSettings] = useState(DEFAULT_BRUSHES)
  const [eraserSize, setEraserSize] = useState(28)
  const [shapeStroke, setShapeStroke] = useState(4)
  const [shapeFill, setShapeFill] = useState(false)
  const [strokeEnabled, setStrokeEnabled] = useState(true)
  const [colorTarget, setColorTarget] = useState<ColorTarget>("stroke")
  const [fillTolerance, setFillTolerance] = useState(48)
  const [stabilizer, setStabilizer] = useState(0.3)
  const [simulatePressure, setSimulatePressure] = useState(true)
  const [primary, setPrimary] = useState("#141417")
  const [secondary, setSecondary] = useState("#ff7a1a")
  const [swatches, setSwatches] = useState<string[]>(DEFAULT_SWATCHES)
  const [selection, setSelection] = useState<string[]>([])
  /** v1.0.7 touch multi-select: when on, every tap / marquee / lasso adds to (or toggles) the selection. */
  const [multiSelect, setMultiSelect] = useState(false)
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1, rot: 0 })
  const [fitNonce, setFitNonce] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [docSize, setDocSizeState] = useState({ w: DOC_W, h: DOC_H })
  const [docName, setDocName] = useState(freshName)
  // the New project window opens on launch (“Keep current drawing” continues the restored session)
  const [newDialogOpen, setNewDialogOpen] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [histVersion, setHist] = useState(0)

  // grid, snapping + smart guides (remembered between sessions)
  const viewPrefs = useRef(loadJSON(VIEW_KEY, { showGrid: false, gridSize: 25, snapToGrid: false, smartGuides: true }))
  const [showGrid, setShowGrid] = useState<boolean>(viewPrefs.current.showGrid)
  const [gridSize, setGridSizeState] = useState<number>(viewPrefs.current.gridSize)
  const [snapToGrid, setSnapToGrid] = useState<boolean>(viewPrefs.current.snapToGrid)
  const [smartGuides, setSmartGuides] = useState<boolean>(viewPrefs.current.smartGuides)
  const setGridSize = (v: number) => setGridSizeState(clamp(Math.round(v), 2, 1000))
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ showGrid, gridSize, snapToGrid, smartGuides }))
    } catch {
      /* storage unavailable */
    }
  }, [showGrid, gridSize, snapToGrid, smartGuides])

  // saved brush presets
  const [presets, setPresets] = useState<BrushPreset[]>(() => loadJSON<BrushPreset[]>(PRESET_KEY, []))
  useEffect(() => {
    try {
      localStorage.setItem(PRESET_KEY, JSON.stringify(presets))
    } catch {
      /* storage unavailable */
    }
  }, [presets])

  const viewportRef = useRef({ w: 1200, h: 800 })
  const past = useRef<Layer[][]>([])
  const future = useRef<Layer[][]>([])
  const layersRef = useRef(layers)
  layersRef.current = layers
  const layerCount = useRef(3)
  const msgTimer = useRef<number | undefined>(undefined)

  const flash = useCallback((msg: string) => {
    setMessage(msg)
    window.clearTimeout(msgTimer.current)
    msgTimer.current = window.setTimeout(() => setMessage(null), 2200)
  }, [])

  const snapshot = useCallback(() => {
    past.current.push(layersRef.current)
    if (past.current.length > 40) past.current.shift()
    future.current = []
    setHist((h) => h + 1)
  }, [])

  const commit = useCallback(
    (fn: (prev: Layer[]) => Layer[]) => {
      snapshot()
      setLayers((prev) => normalizeLayers(fn(prev)))
    },
    [snapshot],
  )

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(layersRef.current)
    setLayers(prev)
    setSelection([])
    setHist((h) => h + 1)
  }, [])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(layersRef.current)
    setLayers(next)
    setSelection([])
    setHist((h) => h + 1)
  }, [])

  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? layers[layers.length - 1]

  /**
   * Route new artwork to a layer of the right type (pencil strokes → pencil layer,
   * vector strokes / shapes / pen paths / fills → vector layer). Uses the active layer
   * when it matches, else the nearest matching layer, else creates one above.
   */
  const ensureLayer = (type: LayerType): string => {
    const ls = layersRef.current
    if (activeLayer && activeLayer.type === type) return activeLayer.id
    const idx = ls.findIndex((l) => l.id === activeLayer?.id)
    for (let d = 1; d < ls.length; d++) {
      for (const j of [idx + d, idx - d]) {
        const l = ls[j]
        if (l && l.type === type && l.visible && !l.locked) {
          setActiveLayerId(l.id)
          flash(`Drawing on ${type} layer “${l.name}”`)
          return l.id
        }
      }
    }
    const l = makeLayer(`${type === "pencil" ? "Pencil" : "Vector"} ${layerCount.current++}`, type)
    commit((prev) => {
      const i = prev.findIndex((x) => x.id === activeLayer?.id)
      const next = [...prev]
      next.splice(i + 1, 0, l)
      return next
    })
    setActiveLayerId(l.id)
    flash(`New ${type} layer “${l.name}”`)
    return l.id
  }

  const addLayer = (type: LayerType = activeLayer?.type ?? "vector") => {
    const l = makeLayer(`${type === "pencil" ? "Pencil" : "Vector"} ${layerCount.current++}`, type)
    commit((prev) => {
      const idx = prev.findIndex((x) => x.id === activeLayerId)
      const next = [...prev]
      next.splice(idx + 1, 0, l)
      return next
    })
    setActiveLayerId(l.id)
  }

  const deleteLayer = (id: string) => {
    if (layers.length <= 1) return flash("A drawing needs at least one layer")
    const idx = layers.findIndex((l) => l.id === id)
    const gone = layers[idx]
    // sublayers of a deleted layer move up one level instead of disappearing with it
    const remaining = layers.filter((l) => l.id !== id).map((l) => (l.parent === id ? { ...l, parent: gone?.parent } : l))
    commit(() => remaining)
    setActiveLayerId(remaining[Math.max(0, idx - 1)].id)
    setSelection([])
  }

  const duplicateLayer = (id: string) => {
    const src = layers.find((l) => l.id === id)
    if (!src) return
    const copy: Layer = { ...src, id: uid("L"), name: `${src.name} copy`, items: src.items.map((it) => ({ ...it, id: uid() })) }
    commit((prev) => {
      const idx = prev.findIndex((x) => x.id === id)
      const next = [...prev]
      next.splice(idx + 1, 0, copy)
      return next
    })
    setActiveLayerId(copy.id)
  }

  /** Move up / down among the layers at the same nesting level (sublayers travel with their parent). */
  const moveLayer = (id: string, dir: 1 | -1) => {
    const src = layers.find((l) => l.id === id)
    if (!src) return
    const sibs = layers.filter((l) => l.parent === src.parent)
    const t = sibs[sibs.indexOf(src) + dir]
    if (!t) return
    moveLayerTo(id, t.id, dir === 1 ? "above" : "below")
  }

  /** v1.0.7: put layer `id` inside `parentId` as its top sublayer. */
  const nestLayer = (id: string, parentId: string) => {
    const prev = layersRef.current
    const src = prev.find((l) => l.id === id)
    const par = prev.find((l) => l.id === parentId)
    if (!src || !par) return
    if (isInside(prev, parentId, id)) return flash("A layer can't go inside itself")
    const next = prev.filter((l) => l.id !== id)
    next.splice(next.findIndex((l) => l.id === parentId), 0, { ...src, parent: parentId })
    commit(() => next)
    setActiveLayerId(id)
    flash(`“${src.name}” is now inside “${par.name}”`)
  }

  /** Nest into the layer just above it in the panel (stacking order on the canvas doesn't change). */
  const indentLayer = (id: string) => {
    const src = layers.find((l) => l.id === id)
    if (!src) return
    const sibs = layers.filter((l) => l.parent === src.parent)
    const host = sibs[sibs.indexOf(src) + 1]
    if (!host) return flash("No layer above to nest into")
    commit((prev) => prev.map((l) => (l.id === id ? { ...l, parent: host.id } : l)))
    flash(`“${src.name}” is now inside “${host.name}”`)
  }

  /** Move a sublayer out one level. */
  const outdentLayer = (id: string) => {
    const src = layers.find((l) => l.id === id)
    if (!src?.parent) return
    const par = layers.find((l) => l.id === src.parent)
    commit((prev) => prev.map((l) => (l.id === id ? { ...l, parent: par?.parent } : l)))
    flash(`“${src.name}” moved out of “${par?.name ?? "group"}”`)
  }

  /** The pencil layer directly beneath `id` (what Merge Down would merge into), if any. */
  const mergeTarget = (id: string) => {
    const idx = layers.findIndex((l) => l.id === id)
    const src = layers[idx]
    const below = layers[idx - 1]
    return src && src.type === "pencil" && below && below.type === "pencil" ? below : null
  }

  /**
   * v1.0.7 Merge Down: a pencil layer joins the pencil layer below it. Strokes are moved across as-is;
   * if the layer has eraser marks or its own opacity / blend, it is flattened first so it looks the same.
   */
  const mergeDown = (id: string) => {
    const ls = layersRef.current
    const idx = ls.findIndex((l) => l.id === id)
    const src = ls[idx]
    const below = ls[idx - 1]
    if (!src) return
    if (src.type !== "pencil") return flash("Merge Down works on pencil layers")
    if (!below || below.type !== "pencil") return flash("The layer below isn't a pencil layer")
    const eff = effLayers(ls)
    if (eff[idx].locked || eff[idx - 1].locked) return flash("Unlock both layers to merge them")
    let moved: Item[] = src.items.filter((i) => !i.hidden)
    const flatten = moved.some((i) => i.kind === "erase") || src.opacity !== 1 || (src.blend ?? "normal") !== "normal" || !src.visible
    if (!src.visible) moved = []
    else if (flatten && moved.length) {
      const RES = DOC_W * DOC_H <= 2.5e6 ? 2 : 1
      const tmp = document.createElement("canvas")
      tmp.width = DOC_W * RES
      tmp.height = DOC_H * RES
      const t = tmp.getContext("2d")!
      t.setTransform(RES, 0, 0, RES, 0, 0)
      for (const it of moved) drawItem(t, it)
      const cv = document.createElement("canvas")
      cv.width = tmp.width
      cv.height = tmp.height
      const g = cv.getContext("2d")!
      g.globalAlpha = src.opacity
      g.drawImage(tmp, 0, 0)
      tmp.width = 0
      tmp.height = 0
      moved = [{ id: uid("img"), kind: "image", x: 0, y: 0, w: DOC_W, h: DOC_H, canvas: cv }]
    }
    commit((prev) =>
      prev
        .filter((l) => l.id !== id)
        .map((l) => {
          let n = l
          if (n.parent === id) n = { ...n, parent: src.parent }
          if (n.id === below.id) n = { ...n, items: [...n.items, ...moved] }
          return n
        }),
    )
    setActiveLayerId(below.id)
    setSelection([])
    flash(`Merged “${src.name}” into “${below.name}”`)
  }

  /** v1.0.7: select everything on a layer (then Cut or Delete empties it but keeps the layer). */
  const selectLayerContents = (id: string) => {
    const l = layersRef.current.find((x) => x.id === id)
    if (!l) return
    setActiveLayerId(id)
    const e = effLayers(layersRef.current).find((x) => x.id === id)
    if (e?.locked) return flash(`“${l.name}” is locked`)
    if (e && !e.visible) return flash(`“${l.name}” is hidden`)
    const ids = l.items.filter((i) => i.kind !== "erase" && !i.hidden).map((i) => i.id)
    if (!ids.length) {
      setSelection([])
      return flash(`“${l.name}” is empty`)
    }
    setSelection(ids)
    if (!["select", "direct", "move", "transform"].includes(tool)) setTool("select")
    flash(`Selected all ${ids.length} on “${l.name}” · Cut or Delete keeps the layer`)
  }

  /** Drag-reorder: drop layer `id` above or below layer `targetId` (above = higher in the stack). */
  const moveLayerTo = (id: string, targetId: string, place: "above" | "below") => {
    if (id === targetId) return
    const prev = layersRef.current
    const src = prev.find((l) => l.id === id)
    if (!src) return
    if (isInside(prev, targetId, id)) return
    const next = prev.filter((l) => l.id !== id)
    const ti = next.findIndex((l) => l.id === targetId)
    if (ti < 0) return
    // dropping next to a layer puts it at that layer's nesting level
    const tParent = next[ti].parent
    next.splice(place === "above" ? ti + 1 : ti, 0, src.parent === tParent ? src : { ...src, parent: tParent })
    if (next.every((l, i) => l === prev[i])) return
    commit(() => next)
    setActiveLayerId(id)
  }

  /**
   * Drag-reorder a path / shape: drop it above or below another object, in the same layer or
   * a different one (targetItemId null = top of that layer). Grouped objects travel together.
   */
  const moveItemTo = (itemId: string, targetLayerId: string, targetItemId: string | null, place: "above" | "below") => {
    if (itemId === targetItemId) return
    const ls = layersRef.current
    const from = ls.find((l) => l.items.some((i) => i.id === itemId))
    const to = ls.find((l) => l.id === targetLayerId)
    if (!from || !to) return
    if (to.locked || from.locked) return flash(`“${to.locked ? to.name : from.name}” is locked`)
    const it = from.items.find((i) => i.id === itemId)!
    const need = it.kind === "image" ? null : layerTypeFor(it)
    if (need && need !== to.type) return flash(`${need === "pencil" ? "Pencil strokes" : "Vector objects"} can only go on a ${need} layer`)
    const ids = new Set(it.group ? from.items.filter((i) => i.group === it.group).map((i) => i.id) : [itemId])
    const moving = from.items.filter((i) => ids.has(i.id))
    commit((prev) =>
      prev
        .map((l) => (l.id === from.id ? { ...l, items: l.items.filter((i) => !ids.has(i.id)) } : l))
        .map((l) => {
          if (l.id !== targetLayerId) return l
          const items = l.items.slice()
          let at = items.length
          if (targetItemId) {
            const ti = items.findIndex((i) => i.id === targetItemId)
            if (ti >= 0) at = place === "above" ? ti + 1 : ti
          }
          items.splice(at, 0, ...moving)
          return { ...l, items }
        }),
    )
    setActiveLayerId(targetLayerId)
    if (from.id !== targetLayerId) flash(`Moved to “${to.name}”`)
  }

  const updateLayer = (id: string, patch: Partial<Layer>, history = true) => {
    const fn = (prev: Layer[]) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l))
    if (history) commit(fn)
    else setLayers(fn)
  }

  const clearLayer = (id: string) => updateLayer(id, { items: [] })

  const deleteSelection = () => {
    if (!selection.length) return
    const ids = new Set(selection)
    commit((prev) => prev.map((l) => ({ ...l, items: l.items.filter((i) => !ids.has(i.id)) })))
    setSelection([])
  }

  /* ---------- clipboard: cut / copy / paste ---------- */
  const clipboard = useRef<{ layerId: string; items: Item[] } | null>(null)
  const pasteCount = useRef(0)

  const copySelection = (silent = false) => {
    if (!selection.length) return false
    const ids = new Set(selection)
    for (const l of layersRef.current) {
      const items = l.items.filter((i) => ids.has(i.id) && i.kind !== "erase")
      if (items.length) {
        clipboard.current = { layerId: l.id, items }
        pasteCount.current = 0
        if (!silent) flash(`Copied ${items.length} object${items.length > 1 ? "s" : ""}`)
        return true
      }
    }
    return false
  }

  const cutSelection = () => {
    if (!copySelection(true)) return
    const n = clipboard.current?.items.length ?? 0
    deleteSelection()
    flash(`Cut ${n} object${n > 1 ? "s" : ""} · Ctrl V pastes`)
  }

  const paste = () => {
    const clip = clipboard.current
    if (!clip) return flash("Nothing to paste — cut or copy a selection first")
    pasteCount.current++
    const off = 16 * pasteCount.current
    const fresh = clip.items.map((i) => ({ ...translateItem(i, off, off), id: uid() }) as Item)
    const target = layersRef.current.find((l) => l.id === clip.layerId && !l.locked) ?? activeLayer
    if (!target) return
    commit((prev) => prev.map((l) => (l.id === target.id ? { ...l, items: [...l.items, ...fresh] } : l)))
    setActiveLayerId(target.id)
    setSelection(fresh.map((i) => i.id))
    if (!["select", "direct", "move", "transform"].includes(tool)) setTool("select")
  }

  const canPaste = !!clipboard.current

  /* ---------- object tools: transform, align, arrange, group, pathfinder, convert ---------- */

  const selectedList = (): Item[] => {
    const ids = new Set(selection)
    const out: Item[] = []
    for (const l of layersRef.current) for (const it of l.items) if (ids.has(it.id)) out.push(it)
    return out
  }

  const getSelectionBounds = (): Rect | null => unionBounds(selectedList().filter((i) => i.kind !== "erase"))

  /** Apply fn to every selected item (one undo step). */
  const transformSelection = (fn: (it: Item) => Item) => {
    if (!selection.length) return
    const ids = new Set(selection)
    commit((prev) => prev.map((l) => (l.items.some((i) => ids.has(i.id)) ? { ...l, items: l.items.map((i) => (ids.has(i.id) ? fn(i) : i)) } : l)))
  }

  const setSelectionBounds = (patch: Partial<Rect>, lockAspect: boolean) => {
    const b = getSelectionBounds()
    if (!b) return
    let w = patch.w ?? b.w
    let h = patch.h ?? b.h
    if (lockAspect && patch.w !== undefined && b.w > 0) h = b.h * (patch.w / b.w)
    if (lockAspect && patch.h !== undefined && b.h > 0) w = b.w * (patch.h / b.h)
    const x = patch.x ?? b.x
    const y = patch.y ?? b.y
    const sx = b.w > 0 ? Math.max(1, w) / b.w : 1
    const sy = b.h > 0 ? Math.max(1, h) / b.h : 1
    transformSelection((it) => translateItem(sx !== 1 || sy !== 1 ? scaleItem(it, b.x, b.y, sx, sy) : it, x - b.x, y - b.y))
  }

  const flipSelection = (axis: "h" | "v") => {
    const b = getSelectionBounds()
    if (!b) return
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    transformSelection((it) => scaleItem(it, cx, cy, axis === "h" ? -1 : 1, axis === "v" ? -1 : 1))
  }

  const rotateSelection = (deg: number) => {
    const b = getSelectionBounds()
    if (!b || !deg) return
    const a = (deg * Math.PI) / 180
    transformSelection((it) => rotateItem(it, b.x + b.w / 2, b.y + b.h / 2, a))
  }

  /** Selected objects as units: a group, a pencil layer's sketch, or a single item. */
  const selectionUnits = (): Item[][] => {
    const ids = new Set(selection)
    const units: Item[][] = []
    const byKey = new Map<string, Item[]>()
    for (const l of layersRef.current) {
      for (const it of l.items) {
        if (!ids.has(it.id)) continue
        const pencilMark = it.kind === "erase" || (it.kind === "stroke" && !isVectorBrush(it.brush))
        const key = it.group ? `g:${it.group}` : l.type === "pencil" && pencilMark ? `s:${l.id}` : null
        if (!key) {
          if (it.kind !== "erase") units.push([it])
          continue
        }
        let u = byKey.get(key)
        if (!u) {
          u = []
          byKey.set(key, u)
          units.push(u)
        }
        u.push(it)
      }
    }
    return units.filter((u) => u.some((i) => i.kind !== "erase"))
  }

  const moveUnits = (moves: Map<string, { dx: number; dy: number }>) =>
    commit((prev) =>
      prev.map((l) => ({
        ...l,
        items: l.items.map((i) => {
          const m = moves.get(i.id)
          return m && (m.dx || m.dy) ? translateItem(i, m.dx, m.dy) : i
        }),
      })),
    )

  const alignSelection = (mode: AlignMode) => {
    const units = selectionUnits()
    if (!units.length) return flash("Select objects to align")
    const boxes = units.map((u) => unionBounds(u.filter((i) => i.kind !== "erase"))!)
    let ref: Rect
    if (units.length === 1) ref = { x: 0, y: 0, w: DOC_W, h: DOC_H }
    else {
      const x0 = Math.min(...boxes.map((b) => b.x))
      const y0 = Math.min(...boxes.map((b) => b.y))
      const x1 = Math.max(...boxes.map((b) => b.x + b.w))
      const y1 = Math.max(...boxes.map((b) => b.y + b.h))
      ref = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    }
    const moves = new Map<string, { dx: number; dy: number }>()
    units.forEach((u, i) => {
      const b = boxes[i]
      let dx = 0
      let dy = 0
      if (mode === "left") dx = ref.x - b.x
      if (mode === "hcenter") dx = ref.x + ref.w / 2 - (b.x + b.w / 2)
      if (mode === "right") dx = ref.x + ref.w - (b.x + b.w)
      if (mode === "top") dy = ref.y - b.y
      if (mode === "vcenter") dy = ref.y + ref.h / 2 - (b.y + b.h / 2)
      if (mode === "bottom") dy = ref.y + ref.h - (b.y + b.h)
      for (const it of u) moves.set(it.id, { dx, dy })
    })
    moveUnits(moves)
    if (units.length === 1) flash("Aligned to canvas")
  }

  const distributeSelection = (axis: "h" | "v") => {
    const units = selectionUnits()
    if (units.length < 3) return flash("Distribute needs 3 or more objects")
    const rows = units.map((u) => {
      const b = unionBounds(u.filter((i) => i.kind !== "erase"))!
      return { u, c: axis === "h" ? b.x + b.w / 2 : b.y + b.h / 2 }
    })
    rows.sort((a, b) => a.c - b.c)
    const first = rows[0].c
    const step = (rows[rows.length - 1].c - first) / (rows.length - 1)
    const moves = new Map<string, { dx: number; dy: number }>()
    rows.forEach((r, i) => {
      const d = first + step * i - r.c
      for (const it of r.u) moves.set(it.id, axis === "h" ? { dx: d, dy: 0 } : { dx: 0, dy: d })
    })
    moveUnits(moves)
  }

  const arrangeSelection = (mode: ArrangeMode) => {
    if (!selection.length) return
    const ids = new Set(selection)
    commit((prev) =>
      prev.map((l) => {
        if (!l.items.some((i) => ids.has(i.id))) return l
        const sel = l.items.filter((i) => ids.has(i.id))
        const rest = l.items.filter((i) => !ids.has(i.id))
        if (mode === "front") return { ...l, items: [...rest, ...sel] }
        if (mode === "back") return { ...l, items: [...sel, ...rest] }
        const items = l.items.slice()
        if (mode === "forward") {
          for (let i = items.length - 2; i >= 0; i--)
            if (ids.has(items[i].id) && !ids.has(items[i + 1].id)) [items[i], items[i + 1]] = [items[i + 1], items[i]]
        } else {
          for (let i = 1; i < items.length; i++)
            if (ids.has(items[i].id) && !ids.has(items[i - 1].id)) [items[i], items[i - 1]] = [items[i - 1], items[i]]
        }
        return { ...l, items }
      }),
    )
  }

  const selectionGrouped = selectedList().some((i) => !!i.group)

  const groupSelection = () => {
    const items = selectedList().filter((i) => i.kind !== "erase")
    if (items.length < 2) return flash("Select 2 or more objects to group")
    const g = uid("g")
    transformSelection((it) => (it.kind === "erase" ? it : { ...it, group: g }))
    flash(`Grouped ${items.length} objects`)
  }

  const ungroupSelection = () => {
    if (!selectionGrouped) return
    transformSelection((it) => {
      if (!it.group) return it
      const { group: _g, ...rest } = it
      return rest as Item
    })
    flash("Ungrouped")
  }

  const runPathfinder = (op: PathfinderOp) => {
    const ids = new Set(selection)
    const picked: Item[] = []
    for (const l of layersRef.current) {
      if (l.locked || !l.visible) continue
      for (const it of l.items) if (ids.has(it.id) && isPathfinderable(it)) picked.push(it)
    }
    if (picked.length < 2) return flash("Pathfinder needs 2 or more selected vector shapes, paths or ink strokes")
    const result = pathfinder(picked, op)
    if (!result) return flash(op === "intersect" ? "Those shapes don't overlap" : "Nothing would be left — no change made")
    const anchor = op === "minusFront" ? picked[0] : picked[picked.length - 1]
    const src = new Set(picked.map((i) => i.id))
    commit((prev) => prev.map((l) => ({ ...l, items: l.items.flatMap((i) => (i.id === anchor.id ? [result] : src.has(i.id) ? [] : [i])) })))
    setSelection([result.id])
    const names: Record<PathfinderOp, string> = { unite: "Unite", minusFront: "Minus Front", intersect: "Intersect", exclude: "Exclude" }
    flash(`${names[op]} · ${picked.length} objects → 1 shape`)
  }

  const convertToShape = () => {
    const repl = new Map<string, Item[]>()
    for (const it of selectedList()) {
      const out = outlineItem(it)
      if (!out) continue
      if (out.length > 1 && !it.group) {
        const g = uid("g")
        out.forEach((p) => (p.group = g))
      }
      repl.set(it.id, out)
    }
    if (!repl.size) return flash("Select a stroked path, shape or vector brush stroke to convert")
    commit((prev) => prev.map((l) => ({ ...l, items: l.items.flatMap((i) => repl.get(i.id) ?? [i]) })))
    setSelection(Array.from(repl.values()).flat().map((i) => i.id))
    flash(`Converted ${repl.size} object${repl.size > 1 ? "s" : ""} to filled shape${repl.size > 1 ? "s" : ""}`)
  }

  const selectAll = () => {
    if (!activeLayer || activeLayer.locked) return
    setSelection(activeLayer.items.filter((i) => i.kind !== "erase" && !i.hidden).map((i) => i.id))
  }

  const nudge = (dx: number, dy: number) => {
    if (!selection.length) return
    const ids = new Set(selection)
    commit((prev) => prev.map((l) => ({ ...l, items: l.items.map((i) => (ids.has(i.id) ? translateItem(i, dx, dy) : i)) })))
  }

  const applyDocSize = (w: number, h: number) => {
    setDocSize(w, h)
    setDocSizeState({ w: DOC_W, h: DOC_H })
  }

  const resetHistory = () => {
    past.current = []
    future.current = []
    setHist((h) => h + 1)
  }

  const newDocument = (w: number, h: number, name = freshName()) => {
    applyDocSize(w, h)
    const ink = makeLayer("Ink", "vector")
    setLayers([makeLayer("Sketch", "pencil"), ink])
    setActiveLayerId(ink.id)
    layerCount.current = 3
    setSelection([])
    setDocName(name)
    resetHistory()
    setNewDialogOpen(false)
    setFitNonce((n) => n + 1)
    flash(`New canvas · ${DOC_W} × ${DOC_H} px`)
  }

  const deselect = () => {
    if (selection.length) flash("Deselected")
    setSelection([])
  }

  const report = (res: SaveResult, filename: string) => {
    if (res === "saved") flash(`Saved ${filename}`)
    else if (res === "documents") flash(`Saved to Documents/${ANDROID_SAVE_FOLDER}/${lastNativeSaveName() || filename}`)
    else if (res === "shared") flash(`Sent ${filename} to Files`)
    else if (res === "downloaded") flash(`${filename} saved to Downloads`)
  }

  const exportSVG = async () => {
    const filename = `${safeName(docName)}-${DOC_W}x${DOC_H}.svg`
    const res = await saveFile(() => new Blob([buildSVG(layersRef.current, DOC_W, DOC_H)], { type: "image/svg+xml" }), {
      filename,
      description: "SVG vector image",
      mime: "image/svg+xml",
      ext: ".svg",
    })
    report(res, filename)
  }

  const saveDTM = async () => {
    // older sessions were all called “Untitled” — give them a unique name before saving
    let name = docName
    if (/^untitled$/i.test(name.trim())) {
      name = freshName()
      setDocName(name)
    }
    const filename = `${safeName(name)}.dtm`
    const res = await saveFile(
      () =>
        new Blob(
          [
            serializeDTM({
              name,
              width: DOC_W,
              height: DOC_H,
              layers: layersRef.current,
              activeLayerId,
              primary,
              secondary,
              swatches,
            }),
          ],
          { type: "application/octet-stream" },
        ),
      { filename, description: "Art Life Creative Studio project", mime: "application/octet-stream", ext: ".dtm", shareMime: "text/plain" },
    )
    report(res, filename)
  }

  const openFile = () => fileInputRef.current?.click()

  const loadDTM = async (file: File) => {
    if (!/\.dtm$/i.test(file.name)) return flash("Choose an Art Life Creative Studio .dtm file")
    try {
      const doc = await parseDTM(await file.text())
      applyDocSize(doc.width, doc.height)
      setLayers(doc.layers)
      setActiveLayerId(doc.activeLayerId)
      layerCount.current = doc.layers.length + 1
      if (doc.primary) setPrimary(doc.primary)
      if (doc.secondary) setSecondary(doc.secondary)
      if (doc.swatches) setSwatches(doc.swatches)
      setSelection([])
      setDocName(file.name.replace(/\.dtm$/i, "") || doc.name)
      resetHistory()
      setFitNonce((n) => n + 1)
      flash(`Opened ${file.name} · ${doc.width} × ${doc.height} px`)
    } catch (err) {
      flash(err instanceof Error ? err.message : "Could not open file")
    }
  }

  const zoomBy = (f: number) => {
    const { w, h } = viewportRef.current
    setView((v) => {
      const nz = clamp(v.zoom * f, 0.1, 16)
      const cx = w / 2
      const cy = h / 2
      return { ...v, zoom: nz, x: cx - (cx - v.x) * (nz / v.zoom), y: cy - (cy - v.y) * (nz / v.zoom) }
    })
  }

  const requestFit = () => setFitNonce((n) => n + 1)

  const exportPNG = async () => {
    const filename = `${safeName(docName)}-${DOC_W}x${DOC_H}.png`
    const res = await saveFile(
      () =>
        new Promise<Blob>((resolve, reject) =>
          renderDoc(layersRef.current, 1, true).toBlob((b) => (b ? resolve(b) : reject(new Error("PNG failed"))), "image/png"),
        ),
      { filename, description: "PNG image", mime: "image/png", ext: ".png" },
    )
    report(res, filename)
  }

  const swapColors = () => {
    setPrimary(secondary)
    setSecondary(primary)
  }

  const addSwatch = (hex: string) => setSwatches((s) => (s.includes(hex) ? s : [...s, hex]))
  const removeSwatch = (hex: string) => setSwatches((s) => s.filter((x) => x !== hex))

  const savePreset = (name: string) => {
    const b = brushSettings[brushId]
    const p: BrushPreset = { id: uid("bp"), name: name.trim() || BRUSHES.find((x) => x.id === brushId)?.name || "Brush", brush: brushId, size: b.size, opacity: b.opacity, stabilizer }
    setPresets((ps) => [...ps, p])
    flash(`Saved preset “${p.name}”`)
  }
  const applyPreset = (p: BrushPreset) => {
    setBrushId(p.brush)
    setBrushSettings((s) => ({ ...s, [p.brush]: { size: p.size, opacity: p.opacity } }))
    setStabilizer(p.stabilizer)
    setTool("brush")
  }
  const deletePreset = (id: string) => setPresets((ps) => ps.filter((p) => p.id !== id))

  const currentBrush = brushSettings[brushId]
  const updateBrush = (patch: Partial<BrushSettings>) =>
    setBrushSettings((s) => ({ ...s, [brushId]: { ...s[brushId], ...patch } }))

  /* ---------- stroke / fill colour + stroke weight (applies to the selection, like Illustrator) ---------- */

  const patchSelection = (fn: (it: Item) => Item | null, history: boolean) => {
    if (!selection.length) return
    const ids = new Set(selection)
    const apply = (prev: Layer[]) =>
      prev.map((l) =>
        l.items.some((i) => ids.has(i.id)) ? { ...l, items: l.items.map((i) => (ids.has(i.id) ? fn(i) ?? i : i)) } : l,
      )
    if (history) commit(apply)
    else setLayers(apply)
  }

  /** Call on pointer-down of a continuous control (wheel, slider) so a whole drag is one undo step. */
  const beginSelectionEdit = () => {
    if (selection.length) snapshot()
  }

  const colorPatch = (target: ColorTarget, hex: string | null) => (it: Item): Item | null => {
    // Pressure Ink blobs are filled shapes: any colour pick recolours the ink itself
    if (it.kind === "path" && it.blob) return hex ? { ...it, fill: hex } : null
    if (target === "stroke") {
      if (it.kind === "shape") return hex ? { ...it, color: hex, size: it.size || Math.max(1, shapeStroke) } : { ...it, size: 0 }
      if (it.kind === "path") return hex ? { ...it, stroke: hex, size: it.size || Math.max(1, shapeStroke) } : { ...it, stroke: null }
      if (it.kind === "stroke" && hex) return { ...it, color: hex }
      return null
    }
    if (it.kind === "shape" && it.shape !== "line") return { ...it, fill: hex }
    if (it.kind === "path") return { ...it, fill: hex }
    return null
  }

  const setColorFor = (target: ColorTarget, hex: string, history = true) => {
    if (target === "stroke") {
      setPrimary(hex)
      setStrokeEnabled(true)
    } else {
      setSecondary(hex)
      setShapeFill(true)
    }
    patchSelection(colorPatch(target, hex), history)
  }

  const setActiveColor = (hex: string, history = true) => setColorFor(colorTarget, hex, history)

  const setColorNone = (target: ColorTarget) => {
    if (target === "stroke") setStrokeEnabled(false)
    else setShapeFill(false)
    patchSelection(colorPatch(target, null), true)
  }

  const setFillEnabled = (on: boolean) => (on ? setColorFor("fill", secondary) : setColorNone("fill"))

  const setStrokeWidth = (v: number, history = true) => {
    setShapeStroke(v)
    if (v > 0) setStrokeEnabled(true)
    patchSelection((it) => {
      if (it.kind === "shape") return { ...it, size: v }
      if (it.kind === "path" && it.blob) return null
      if (it.kind === "path") return { ...it, size: v, stroke: v > 0 ? it.stroke ?? primary : it.stroke }
      if (isVectorStroke(it)) return { ...it, size: Math.max(1, v) }
      return null
    }, history)
  }

  const toggleItemHidden = (id: string) => {
    commit((prev) => prev.map((l) => (l.items.some((i) => i.id === id) ? { ...l, items: l.items.map((i) => (i.id === id ? { ...i, hidden: !i.hidden } : i)) } : l)))
    setSelection((s) => s.filter((x) => x !== id))
  }

  // selecting a vector object loads its stroke / fill / weight into the colour controls
  useEffect(() => {
    if (!selection.length) return
    const ids = new Set(selection)
    let it: Item | undefined
    for (const l of layersRef.current) {
      it = l.items.find((i) => ids.has(i.id) && (i.kind === "shape" || i.kind === "path" || i.kind === "stroke"))
      if (it) break
    }
    if (!it) return
    if (it.kind === "shape") {
      setPrimary(it.color)
      setStrokeEnabled(it.size > 0)
      if (it.size > 0) setShapeStroke(Math.round(it.size))
      if (it.shape !== "line") {
        setShapeFill(!!it.fill)
        if (it.fill) setSecondary(it.fill)
      }
    } else if (it.kind === "path" && it.blob) {
      if (it.fill) setPrimary(it.fill)
    } else if (it.kind === "path") {
      if (it.stroke) setPrimary(it.stroke)
      setStrokeEnabled(!!it.stroke && it.size > 0)
      if (it.stroke && it.size > 0) setShapeStroke(Math.round(it.size))
      setShapeFill(!!it.fill)
      if (it.fill) setSecondary(it.fill)
    } else if (it.kind === "stroke") {
      setPrimary(it.color)
      if (isVectorStroke(it)) setShapeStroke(Math.round(it.size))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection])

  const api = {
    layers,
    setLayers,
    activeLayerId: activeLayer?.id ?? "",
    activeLayer,
    setActiveLayerId,
    tool,
    setTool,
    brushId,
    setBrushId,
    brushSettings,
    currentBrush,
    updateBrush,
    eraserSize,
    setEraserSize,
    shapeStroke,
    setShapeStroke,
    shapeFill,
    setShapeFill,
    strokeEnabled,
    colorTarget,
    setColorTarget,
    setColorFor,
    setActiveColor,
    setColorNone,
    setFillEnabled,
    setStrokeWidth,
    beginSelectionEdit,
    toggleItemHidden,
    fillTolerance,
    setFillTolerance,
    stabilizer,
    setStabilizer,
    simulatePressure,
    setSimulatePressure,
    primary,
    setPrimary,
    secondary,
    setSecondary,
    swapColors,
    swatches,
    addSwatch,
    removeSwatch,
    selection,
    setSelection,
    deleteSelection,
    copySelection,
    cutSelection,
    paste,
    canPaste,
    getSelectionBounds,
    setSelectionBounds,
    flipSelection,
    rotateSelection,
    alignSelection,
    distributeSelection,
    arrangeSelection,
    selectionGrouped,
    groupSelection,
    ungroupSelection,
    runPathfinder,
    convertToShape,
    selectAll,
    nudge,
    view,
    setView,
    zoomBy,
    fitNonce,
    requestFit,
    viewportRef,
    snapshot,
    commit,
    undo,
    redo,
    canUndo: past.current.length > 0,
    histVersion,
    freshName,
    showGrid,
    setShowGrid,
    gridSize,
    setGridSize,
    snapToGrid,
    setSnapToGrid,
    smartGuides,
    setSmartGuides,
    presets,
    savePreset,
    applyPreset,
    deletePreset,
    canRedo: future.current.length > 0,
    addLayer,
    ensureLayer,
    deleteLayer,
    duplicateLayer,
    moveLayer,
    moveLayerTo,
    nestLayer,
    indentLayer,
    outdentLayer,
    mergeDown,
    mergeTarget,
    selectLayerContents,
    multiSelect,
    setMultiSelect,
    moveItemTo,
    updateLayer,
    clearLayer,
    newDocument,
    newDialogOpen,
    setNewDialogOpen,
    docSize,
    docName,
    setDocName,
    deselect,
    exportPNG,
    exportSVG,
    saveDTM,
    openFile,
    loadDTM,
    fileInputRef,
    message,
    flash,
  }

  const apiRef = useRef(api)
  apiRef.current = api

  useEffect(() => {
    const TOOL_KEYS: Record<string, ToolId> = {
      p: "pen", v: "select", a: "direct", m: "move", t: "transform", q: "lasso", b: "brush", e: "eraser", g: "fill",
      i: "eyedropper", l: "line", u: "rect", o: "ellipse", h: "hand", z: "zoom",
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
      const s = apiRef.current
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === "z") {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (mod && k === "y") {
        e.preventDefault()
        s.redo()
        return
      }
      if (mod && k === "x") {
        e.preventDefault()
        s.cutSelection()
        return
      }
      if (mod && k === "c") {
        e.preventDefault()
        s.copySelection()
        return
      }
      if (mod && k === "v") {
        e.preventDefault()
        s.paste()
        return
      }
      if (mod && (k === "'" || k === '"')) {
        e.preventDefault()
        if (e.shiftKey) {
          s.setSnapToGrid(!s.snapToGrid)
          s.flash(s.snapToGrid ? "Snap to grid off" : "Snap to grid on")
        } else s.setShowGrid(!s.showGrid)
        return
      }
      if (mod && k === "u") {
        e.preventDefault()
        s.setSmartGuides(!s.smartGuides)
        s.flash(s.smartGuides ? "Smart guides off" : "Smart guides on")
        return
      }
      if (mod && k === "g") {
        e.preventDefault()
        if (e.shiftKey) s.ungroupSelection()
        else s.groupSelection()
        return
      }
      if (mod && (k === "]" || k === "}")) {
        e.preventDefault()
        s.arrangeSelection(e.shiftKey ? "front" : "forward")
        return
      }
      if (mod && (k === "[" || k === "{")) {
        e.preventDefault()
        s.arrangeSelection(e.shiftKey ? "back" : "backward")
        return
      }
      if (mod && k === "a") {
        e.preventDefault()
        s.selectAll()
        return
      }
      if (mod && k === "s") {
        e.preventDefault()
        if (e.shiftKey) s.exportSVG()
        else s.saveDTM()
        return
      }
      if (mod && k === "o") {
        e.preventDefault()
        s.openFile()
        return
      }
      if (mod && k === "d") {
        e.preventDefault()
        s.deselect()
        return
      }
      if (mod && e.altKey && k === "n") {
        e.preventDefault()
        s.setNewDialogOpen(true)
        return
      }
      if (mod && k === "0") {
        e.preventDefault()
        s.requestFit()
        return
      }
      if (mod && (k === "=" || k === "+")) {
        e.preventDefault()
        s.zoomBy(1.25)
        return
      }
      if (mod && (k === "-" || k === "_")) {
        e.preventDefault()
        s.zoomBy(0.8)
        return
      }
      if (mod) return
      if (k === "+") return s.setTool("penAdd")
      if (k === "-" || k === "_") return s.setTool("penDelete")
      if (e.shiftKey && k === "c") return s.setTool("penConvert")
      if (k === "delete" || k === "backspace") {
        e.preventDefault()
        s.deleteSelection()
        return
      }
      if (k === "escape") return s.setSelection([])
      const step = e.shiftKey ? 10 : 1
      if (k === "arrowleft") return (e.preventDefault(), s.nudge(-step, 0))
      if (k === "arrowright") return (e.preventDefault(), s.nudge(step, 0))
      if (k === "arrowup") return (e.preventDefault(), s.nudge(0, -step))
      if (k === "arrowdown") return (e.preventDefault(), s.nudge(0, step))
      if (TOOL_KEYS[k]) return s.setTool(TOOL_KEYS[k])
      const bi = ["1", "2", "3", "4"].indexOf(k)
      if (bi >= 0) {
        s.setBrushId(BRUSHES[bi].id)
        s.setTool("brush")
        return
      }
      // Illustrator: X toggles the Stroke/Fill target, Shift+X swaps the two colours
      if (k === "x") return e.shiftKey ? s.swapColors() : s.setColorTarget(s.colorTarget === "stroke" ? "fill" : "stroke")
      if (k === "d") {
        s.setPrimary("#141417")
        s.setSecondary("#ffffff")
        return
      }
      if (k === "[" || k === "]") {
        const f = k === "]" ? 1.15 : 1 / 1.15
        if (s.tool === "eraser") s.setEraserSize(clamp(Math.round(s.eraserSize * f + (k === "]" ? 1 : -1)), 1, 200))
        else s.updateBrush({ size: clamp(Math.round(s.currentBrush.size * f + (k === "]" ? 1 : -1)), 1, 120) })
        return
      }
      if (k === "=") return s.zoomBy(1.25)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Electron: native menu commands + .dtm files opened from Finder / Explorer / File ▸ Open
  useEffect(() => {
    if (!desktop) return
    const offMenu = desktop.onMenu((cmd) => {
      const s = apiRef.current
      const [kind, arg] = cmd.split(":")
      if (kind === "tool") return s.setTool(arg as ToolId)
      if (kind === "brush") {
        s.setBrushId(arg as BrushId)
        s.setTool("brush")
        return
      }
      switch (cmd) {
        case "new": return s.setNewDialogOpen(true)
        case "save": return void s.saveDTM()
        case "exportPNG": return void s.exportPNG()
        case "exportSVG": return void s.exportSVG()
        case "undo": return s.undo()
        case "redo": return s.redo()
        case "selectAll": return s.selectAll()
        case "deselect": return s.deselect()
        case "delete": return s.deleteSelection()
        case "cut": return s.cutSelection()
        case "copy": return void s.copySelection()
        case "paste": return s.paste()
        case "swap": return s.swapColors()
        case "newLayer": return s.addLayer()
        case "newPencilLayer": return s.addLayer("pencil")
        case "newVectorLayer": return s.addLayer("vector")
        case "zoomIn": return s.zoomBy(1.25)
        case "zoomOut": return s.zoomBy(0.8)
        case "fit": return s.requestFit()
      }
    })
    const offOpen = desktop.onOpenFile(({ name, text }) => {
      void apiRef.current.loadDTM(new File([text], name, { type: "application/octet-stream" }))
    })
    return () => {
      offMenu()
      offOpen()
    }
  }, [])

  return api
}

export type Studio = ReturnType<typeof useStudio>
