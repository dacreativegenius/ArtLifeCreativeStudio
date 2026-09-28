import type { BlendMode, Item, Layer, ShapeItem, StrokeItem } from "./types"
import { catmull, drawItem, ellipseSamples, itemBounds, pressureGeometry } from "./render"
import { desktop } from "./desktop"

/* ---------------- download helper ---------------- */

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1500)
}

export type SaveResult = "saved" | "shared" | "downloaded" | "cancelled"

interface SaveOpts {
  filename: string
  description: string
  mime: string
  ext: string
  /** MIME used when handing the file to the OS share sheet (Android / iOS “Save to Files”). */
  shareMime?: string
}

const isMobile = () =>
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))

/**
 * Save to the user's file system:
 * - Chrome / Edge desktop (macOS Finder, Windows File Explorer): native “Save As” dialog via the File System Access API.
 * - Android / iOS: the system share sheet, which offers “Save to Files” / Drive / Downloads.
 * - Everything else (Safari, Firefox, sandboxed iframes): a regular download to the Downloads folder.
 * The picker is opened BEFORE the file is generated so the click still counts as a user gesture.
 */
export async function saveFile(make: () => Blob | Promise<Blob>, o: SaveOpts): Promise<SaveResult> {
  // Electron desktop app: native Save dialog via the preload bridge.
  if (desktop) {
    const blob = await make()
    const saved = await desktop.saveFile(new Uint8Array(await blob.arrayBuffer()), {
      filename: o.filename,
      description: o.description,
      ext: o.ext,
    })
    return saved ? "saved" : "cancelled"
  }
  const w = window as unknown as {
    showSaveFilePicker?: (opts: unknown) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>
  }
  if (typeof w.showSaveFilePicker === "function" && !isMobile()) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: o.filename,
        types: [{ description: o.description, accept: { [o.mime]: [o.ext] } }],
      })
      const blob = await make()
      const ws = await handle.createWritable()
      await ws.write(blob)
      await ws.close()
      return "saved"
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return "cancelled"
      // SecurityError (e.g. inside a cross-origin preview iframe) → fall through to download
    }
  }
  const blob = await make()
  if (isMobile() && typeof navigator.canShare === "function") {
    const file = new File([blob], o.filename, { type: o.shareMime ?? o.mime })
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: o.filename })
        return "shared"
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return "cancelled"
      }
    }
  }
  downloadBlob(blob, o.filename)
  return "downloaded"
}

export const safeName = (name: string) => name.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-") || "untitled"

/* ---------------- SVG export ---------------- */

const f = (n: number) => (Math.round(n * 100) / 100).toString()
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c] ?? c)

function polyD(pts: { x: number; y: number }[], closed: boolean) {
  if (!pts.length) return ""
  return pts.map((p, i) => `${i ? "L" : "M"}${f(p.x)} ${f(p.y)}`).join("") + (closed ? "Z" : "")
}

/** Rasterise a single item (pencil grain) into a cropped PNG <image>. */
function rasterItem(it: Item) {
  const b = itemBounds(it)
  const pad = 2
  const w = Math.max(1, Math.ceil(b.w + pad * 2))
  const h = Math.max(1, Math.ceil(b.h + pad * 2))
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const ctx = c.getContext("2d")!
  ctx.translate(-b.x + pad, -b.y + pad)
  drawItem(ctx, it)
  return `<image x="${f(b.x - pad)}" y="${f(b.y - pad)}" width="${w}" height="${h}" href="${c.toDataURL("image/png")}"/>`
}

function strokeSVG(s: StrokeItem) {
  if (s.brush === "vector-fixed") {
    const pts = catmull(s.points)
    if (pts.length === 1) pts.push({ ...pts[0], x: pts[0].x + 0.01 })
    return `<path d="${polyD(pts, false)}" fill="none" stroke="${s.color}" stroke-width="${f(s.size)}" stroke-linecap="round" stroke-linejoin="round" opacity="${s.opacity}"/>`
  }
  if (s.brush === "vector-pressure") {
    const g = pressureGeometry(s)
    if (!g) return ""
    if (g.dot) return `<circle cx="${f(g.dot.x)}" cy="${f(g.dot.y)}" r="${f(g.dot.r)}" fill="${s.color}" opacity="${s.opacity}"/>`
    const n = g.pts.length
    const outline = polyD([...g.left, ...g.right.slice().reverse()], true)
    const a = g.pts[0]
    const z = g.pts[n - 1]
    return (
      `<g fill="${s.color}" opacity="${s.opacity}"><path d="${outline}"/>` +
      `<circle cx="${f(a.x)}" cy="${f(a.y)}" r="${f(g.widths[0])}"/>` +
      `<circle cx="${f(z.x)}" cy="${f(z.y)}" r="${f(g.widths[n - 1])}"/></g>`
    )
  }
  return rasterItem(s)
}

function shapeSVG(s: ShapeItem) {
  const p = s.points
  const stroke = s.size > 0 ? `stroke="${s.color}" stroke-width="${f(s.size)}"` : `stroke="none"`
  const fill = s.fill && s.shape !== "line" ? `fill="${s.fill}"` : `fill="none"`
  if (s.shape === "line") {
    return `<line x1="${f(p[0].x)}" y1="${f(p[0].y)}" x2="${f(p[1].x)}" y2="${f(p[1].y)}" ${stroke} stroke-linecap="round" opacity="${s.opacity}"/>`
  }
  if (s.shape === "rect") {
    return `<path d="${polyD(p, true)}" ${fill} ${stroke} stroke-linejoin="miter" opacity="${s.opacity}"/>`
  }
  return `<path d="${polyD(ellipseSamples(p, 24), true)}" ${fill} ${stroke} stroke-linejoin="round" opacity="${s.opacity}"/>`
}

export function buildSVG(layers: Layer[], W: number, H: number) {
  const defs: string[] = []
  let maskN = 0
  const groups: string[] = []
  for (const l of layers) {
    if (!l.visible) continue
    let content = ""
    for (const it of l.items) {
      if (it.kind === "erase") {
        if (!content) continue
        const id = `erase-${maskN++}`
        const pts = it.points.length === 1 ? [it.points[0], { ...it.points[0], x: it.points[0].x + 0.01 }] : it.points
        defs.push(
          `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>` +
            `<path d="${polyD(pts, false)}" fill="none" stroke="#000" stroke-width="${f(it.size)}" stroke-linecap="round" stroke-linejoin="round"/></mask>`,
        )
        content = `<g mask="url(#${id})">${content}</g>`
        continue
      }
      if (it.kind === "stroke") content += strokeSVG(it)
      else if (it.kind === "shape") content += shapeSVG(it)
      else if (it.kind === "image") {
        const t = it.rot ? ` transform="rotate(${f((it.rot * 180) / Math.PI)} ${f(it.x + it.w / 2)} ${f(it.y + it.h / 2)})"` : ""
        content += `<image x="${f(it.x)}" y="${f(it.y)}" width="${f(it.w)}" height="${f(it.h)}" preserveAspectRatio="none" href="${it.canvas.toDataURL("image/png")}"${t}/>`
      }
    }
    const blend = l.blend && l.blend !== "normal" ? ` style="mix-blend-mode:${l.blend}"` : ""
    groups.push(`<g id="${esc(l.id)}" data-name="${esc(l.name)}" opacity="${l.opacity}"${blend}>${content}</g>`)
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs><clipPath id="page"><rect width="${W}" height="${H}"/></clipPath>${defs.join("")}</defs>` +
    `<g clip-path="url(#page)" style="isolation:isolate"><rect width="${W}" height="${H}" fill="#ffffff"/>${groups.join("")}</g></svg>`
  )
}

/* ---------------- .dtm (Art Life document) ---------------- */

export const DTM_FORMAT = "art-life-dtm"
export const DTM_VERSION = 1

type SerialItem = Exclude<Item, { kind: "image" }> | (Omit<Extract<Item, { kind: "image" }>, "canvas"> & { src: string })

export interface DtmDocument {
  format: typeof DTM_FORMAT
  version: number
  app: "Art Life"
  name: string
  created: string
  width: number
  height: number
  activeLayerId: string
  primary: string
  secondary: string
  swatches: string[]
  layers: (Omit<Layer, "items"> & { items: SerialItem[] })[]
}

export function serializeDTM(opts: {
  name: string
  width: number
  height: number
  layers: Layer[]
  activeLayerId: string
  primary: string
  secondary: string
  swatches: string[]
}): string {
  const doc: DtmDocument = {
    format: DTM_FORMAT,
    version: DTM_VERSION,
    app: "Art Life",
    name: opts.name,
    created: new Date().toISOString(),
    width: opts.width,
    height: opts.height,
    activeLayerId: opts.activeLayerId,
    primary: opts.primary,
    secondary: opts.secondary,
    swatches: opts.swatches,
    layers: opts.layers.map((l) => ({
      ...l,
      items: l.items.map((it) => {
        if (it.kind !== "image") return it
        const { canvas, ...rest } = it
        return { ...rest, src: canvas.toDataURL("image/png") }
      }),
    })),
  }
  return JSON.stringify(doc)
}

function loadCanvas(src: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement("canvas")
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      c.getContext("2d", { willReadFrequently: true })!.drawImage(img, 0, 0)
      resolve(c)
    }
    img.onerror = () => reject(new Error("Bad bitmap in file"))
    img.src = src
  })
}

const BLENDS: BlendMode[] = ["normal", "multiply", "screen"]

export async function parseDTM(text: string) {
  let raw: DtmDocument
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error("Not a valid .dtm file")
  }
  if (!raw || raw.format !== DTM_FORMAT || !Array.isArray(raw.layers)) throw new Error("Not an Art Life .dtm file")
  if (raw.version > DTM_VERSION) throw new Error("This .dtm was saved by a newer Art Life")
  const layers: Layer[] = await Promise.all(
    raw.layers.map(async (l) => ({
      id: String(l.id),
      name: String(l.name ?? "Layer"),
      visible: l.visible !== false,
      locked: !!l.locked,
      opacity: typeof l.opacity === "number" ? l.opacity : 1,
      blend: BLENDS.includes(l.blend as BlendMode) ? l.blend : "normal",
      items: await Promise.all(
        (l.items ?? []).map(async (it): Promise<Item> => {
          if (it.kind === "image") {
            const { src, ...rest } = it as Extract<SerialItem, { src: string }>
            return { ...rest, canvas: await loadCanvas(src) }
          }
          return it as Item
        }),
      ),
    })),
  )
  if (!layers.length) throw new Error("File has no layers")
  return {
    name: raw.name || "Untitled",
    width: Number(raw.width) || 1600,
    height: Number(raw.height) || 1000,
    layers,
    activeLayerId: layers.some((l) => l.id === raw.activeLayerId) ? raw.activeLayerId : layers[layers.length - 1].id,
    primary: raw.primary,
    secondary: raw.secondary,
    swatches: Array.isArray(raw.swatches) ? raw.swatches : null,
  }
}
