import { desktop } from "./desktop"
import { isNativeApp } from "./native"

/** Browser mobile app (PWA) helpers: install prompt, offline service worker, iPhone home-screen icon, autosave. */

export const isIOS =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)))

export const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)

export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  window.matchMedia?.("(display-mode: fullscreen)").matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true

/** Only the plain browser version offers “Install” (not Electron, not the APK). */
export const canOfferInstall = () => !desktop && !isNativeApp && !isStandalone()

/* ---------------- Android / Chrome install prompt ---------------- */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    notify()
  })
  window.addEventListener("appinstalled", () => {
    deferred = null
    notify()
  })
}

export const hasInstallPrompt = () => deferred !== null
export const onInstallChange = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Shows Chrome's native “Install app” dialog. Returns false when the browser has no prompt available. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const e = deferred
  deferred = null
  notify()
  await e.prompt()
  await e.userChoice.catch(() => null)
  return true
}

/* ---------------- service worker (offline) ---------------- */

export function registerServiceWorker() {
  if (!import.meta.env.PROD || desktop || isNativeApp) return
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return
  if (window.self !== window.top) return // never inside preview iframes
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}

/* ---------------- iPhone / iPad home-screen icon ---------------- */

const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#FF7A1A"/>' +
  '<g transform="translate(72 72) scale(0.72)" fill="none" stroke="#141416" stroke-width="40" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M256 84C298 160 338 236 348 316H164C174 236 214 160 256 84Z"/><path d="M256 84V206"/><circle cx="256" cy="238" r="24"/>' +
  '<path d="M178 316 150 424"/><path d="M334 316 362 424"/></g></svg>'

/** iOS ignores SVG touch icons, so the logo is rendered to a 180 px PNG at start-up. */
export function installAppleTouchIcon() {
  if (desktop || isNativeApp || document.querySelector('link[rel="apple-touch-icon"]')) return
  const img = new Image()
  img.onload = () => {
    const c = document.createElement("canvas")
    c.width = c.height = 180
    const ctx = c.getContext("2d")
    if (!ctx) return
    ctx.drawImage(img, 0, 0, 180, 180)
    const link = document.createElement("link")
    link.rel = "apple-touch-icon"
    link.setAttribute("sizes", "180x180")
    link.href = c.toDataURL("image/png")
    document.head.appendChild(link)
  }
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ICON_SVG)}`
}

/* ---------------- autosave (IndexedDB) ---------------- */

const DB = "art-life-creative-studio"
const STORE = "autosave"

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export interface AutosaveRecord {
  name: string
  text: string
  savedAt: number
}

export async function writeAutosave(rec: AutosaveRecord) {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).put(rec, "current")
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    /* private mode / storage full — drawing still works, just not restored */
  }
}

export async function readAutosave(): Promise<AutosaveRecord | null> {
  try {
    const db = await openDB()
    const rec = await new Promise<AutosaveRecord | null>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get("current")
      req.onsuccess = () => resolve((req.result as AutosaveRecord) ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return rec
  } catch {
    return null
  }
}

/** Ask the browser not to evict saved drawings (Safari clears unused site data otherwise). */
export function requestPersistentStorage() {
  navigator.storage?.persist?.().catch(() => {})
}
