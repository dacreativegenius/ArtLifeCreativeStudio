import { Capacitor } from "@capacitor/core"

/** True inside the Android APK (Capacitor). False in the browser and in the Electron desktop app. */
export const isNativeApp = Capacitor.isNativePlatform()

/** Folder created inside the phone's shared Documents folder (visible in the Files app). */
export const ANDROID_SAVE_FOLDER = "Art Life Creative Studio"

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result)
      resolve(s.slice(s.indexOf(",") + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * Android save: write straight into Documents/Art Life Creative Studio (shows up in Files).
 * If the device blocks that folder, fall back to the system share sheet (Files, Drive, Gmail…).
 */
export async function saveNative(blob: Blob, filename: string): Promise<"documents" | "shared" | "cancelled"> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem")
  const data = await blobToBase64(blob)
  try {
    await Filesystem.writeFile({ path: `${ANDROID_SAVE_FOLDER}/${filename}`, data, directory: Directory.Documents, recursive: true })
    return "documents"
  } catch {
    const { uri } = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache })
    const { Share } = await import("@capacitor/share")
    try {
      await Share.share({ title: filename, files: [uri], dialogTitle: "Save to…" })
      return "shared"
    } catch {
      return "cancelled"
    }
  }
}

/**
 * Android hardware / gesture back button. `handler` returns true when it consumed the press
 * (e.g. closed a drawer); otherwise the app is minimised instead of closed so no work is lost.
 */
export function onAndroidBack(handler: () => boolean): () => void {
  if (!isNativeApp) return () => {}
  let cancelled = false
  let remove = () => {}
  import("@capacitor/app").then(async ({ App }) => {
    const h = await App.addListener("backButton", () => {
      if (!handler()) App.minimizeApp()
    })
    if (cancelled) h.remove()
    else remove = () => h.remove()
  })
  return () => {
    cancelled = true
    remove()
  }
}
