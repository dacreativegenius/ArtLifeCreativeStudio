import { useCallback, useEffect, useRef, useState } from "react"
import { BRUSHES, DOC_H, DOC_W, setDocSize, uid, type BrushId, type BrushSettings, type Layer, type ToolId } from "../../lib/art/types"
import { renderDoc, translateItem } from "../../lib/art/render"
import { buildSVG, downloadBlob, parseDTM, safeName, serializeDTM } from "../../lib/art/fileio"

export interface View {
  x: number
  y: number
  zoom: number
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

function makeLayer(name: string, id = uid("L")): Layer {
  return { id, name, visible: true, locked: false, opacity: 1, items: [] }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export function useStudio() {
  const [layers, setLayers] = useState<Layer[]>(() => [makeLayer("Sketch", "layer-sketch"), makeLayer("Ink", "layer-ink")])
  const [activeLayerId, setActiveLayerId] = useState("layer-ink")
  const [tool, setTool] = useState<ToolId>("brush")
  const [brushId, setBrushId] = useState<BrushId>("pencil-pressure")
  const [brushSettings, setBrushSettings] = useState(DEFAULT_BRUSHES)
  const [eraserSize, setEraserSize] = useState(28)
  const [shapeStroke, setShapeStroke] = useState(4)
  const [shapeFill, setShapeFill] = useState(false)
  const [fillTolerance, setFillTolerance] = useState(48)
  const [stabilizer, setStabilizer] = useState(0.3)
  const [simulatePressure, setSimulatePressure] = useState(true)
  const [primary, setPrimary] = useState("#141417")
  const [secondary, setSecondary] = useState("#ff7a1a")
  const [swatches, setSwatches] = useState<string[]>(DEFAULT_SWATCHES)
  const [selection, setSelection] = useState<string[]>([])
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 })
  const [fitNonce, setFitNonce] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [docSize, setDocSizeState] = useState({ w: DOC_W, h: DOC_H })
  const [docName, setDocName] = useState("Untitled")
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [, setHist] = useState(0)

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
    if (past.current.length > 150) past.current.shift()
    future.current = []
    setHist((h) => h + 1)
  }, [])

  const commit = useCallback(
    (fn: (prev: Layer[]) => Layer[]) => {
      snapshot()
      setLayers(fn)
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

  const addLayer = () => {
    const l = makeLayer(`Layer ${layerCount.current++}`)
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
    const remaining = layers.filter((l) => l.id !== id)
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

  const moveLayer = (id: string, dir: 1 | -1) => {
    const idx = layers.findIndex((l) => l.id === id)
    const to = idx + dir
    if (idx < 0 || to < 0 || to >= layers.length) return
    commit((prev) => {
      const next = [...prev]
      ;[next[idx], next[to]] = [next[to], next[idx]]
      return next
    })
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

  const selectAll = () => {
    if (!activeLayer || activeLayer.locked) return
    setSelection(activeLayer.items.filter((i) => i.kind !== "erase").map((i) => i.id))
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

  const newDocument = (w: number, h: number, name = "Untitled") => {
    applyDocSize(w, h)
    const ink = makeLayer("Ink")
    setLayers([makeLayer("Sketch"), ink])
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

  const exportSVG = () => {
    const svg = buildSVG(layersRef.current, DOC_W, DOC_H)
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${safeName(docName)}-${DOC_W}x${DOC_H}.svg`)
    flash("Exported SVG")
  }

  const saveDTM = () => {
    const json = serializeDTM({
      name: docName,
      width: DOC_W,
      height: DOC_H,
      layers: layersRef.current,
      activeLayerId,
      primary,
      secondary,
      swatches,
    })
    downloadBlob(new Blob([json], { type: "application/x-art-life-dtm+json" }), `${safeName(docName)}.dtm`)
    flash(`Saved ${safeName(docName)}.dtm`)
  }

  const openFile = () => fileInputRef.current?.click()

  const loadDTM = async (file: File) => {
    if (!/\.dtm$/i.test(file.name)) return flash("Choose an Art Life .dtm file")
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
      return { zoom: nz, x: cx - (cx - v.x) * (nz / v.zoom), y: cy - (cy - v.y) * (nz / v.zoom) }
    })
  }

  const requestFit = () => setFitNonce((n) => n + 1)

  const exportPNG = () => {
    const c = renderDoc(layersRef.current, 1, true)
    c.toBlob((b) => {
      if (!b) return
      const a = document.createElement("a")
      a.href = URL.createObjectURL(b)
      a.download = `${safeName(docName)}-${DOC_W}x${DOC_H}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    })
    flash("Exported PNG")
  }

  const swapColors = () => {
    setPrimary(secondary)
    setSecondary(primary)
  }

  const addSwatch = (hex: string) => setSwatches((s) => (s.includes(hex) ? s : [...s, hex]))
  const removeSwatch = (hex: string) => setSwatches((s) => s.filter((x) => x !== hex))

  const currentBrush = brushSettings[brushId]
  const updateBrush = (patch: Partial<BrushSettings>) =>
    setBrushSettings((s) => ({ ...s, [brushId]: { ...s[brushId], ...patch } }))

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
    canRedo: future.current.length > 0,
    addLayer,
    deleteLayer,
    duplicateLayer,
    moveLayer,
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
      v: "select", a: "direct", m: "move", t: "transform", q: "lasso", b: "brush", e: "eraser", g: "fill",
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
      if (mod) return
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
      if (k === "x") return s.swapColors()
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
      if (k === "=" || k === "+") return s.zoomBy(1.25)
      if (k === "-") return s.zoomBy(0.8)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return api
}

export type Studio = ReturnType<typeof useStudio>
