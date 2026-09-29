import { useCallback, useEffect, useRef, useState } from "react"
import { BRUSHES, DOC_H, DOC_W, setDocSize, uid, type BrushId, type BrushSettings, type Item, type Layer, type LayerType, type ToolId } from "../../lib/art/types"
import { renderDoc, translateItem } from "../../lib/art/render"
import { buildSVG, parseDTM, safeName, saveFile, serializeDTM, type SaveResult } from "../../lib/art/fileio"
import { desktop } from "../../lib/art/desktop"

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
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1, rot: 0 })
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

  const newDocument = (w: number, h: number, name = "Untitled") => {
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
    const filename = `${safeName(docName)}.dtm`
    const res = await saveFile(
      () =>
        new Blob(
          [
            serializeDTM({
              name: docName,
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
    ensureLayer,
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
