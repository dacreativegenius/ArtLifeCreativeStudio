export interface HSV {
  h: number
  s: number
  v: number
}

export function normalizeHex(input: string): string | null {
  let h = input.trim().replace(/^#/, "").toLowerCase()
  if (/^[0-9a-f]{3}$/.test(h)) h = h.split("").map((c) => c + c).join("")
  if (!/^[0-9a-f]{6}$/.test(h)) return null
  return `#${h}`
}

export function hexToRgb(hex: string) {
  const h = normalizeHex(hex) ?? "#000000"
  const n = parseInt(h.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToHex(r: number, g: number, b: number) {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
      .join("")
  )
}

export function rgbToHsv(r: number, g: number, b: number): HSV {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const d = max - min
  let h = 0
  if (d) {
    if (max === rr) h = ((gg - bb) / d) % 6
    else if (max === gg) h = (bb - rr) / d + 2
    else h = (rr - gg) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max ? d / max : 0, v: max }
}

export function hsvToRgb({ h, s, v }: HSV) {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

export const hexToHsv = (hex: string) => {
  const { r, g, b } = hexToRgb(hex)
  return rgbToHsv(r, g, b)
}

export const hsvToHex = (hsv: HSV) => {
  const { r, g, b } = hsvToRgb(hsv)
  return rgbToHex(r, g, b)
}

/** Resolve a CSS custom property to a canvas-safe rgb() string. */
export function readCssColor(varName: string, fallback = "#888888") {
  if (typeof document === "undefined") return fallback
  const el = document.createElement("span")
  el.style.color = `var(${varName})`
  el.style.display = "none"
  document.body.appendChild(el)
  const c = getComputedStyle(el).color
  el.remove()
  return c || fallback
}
