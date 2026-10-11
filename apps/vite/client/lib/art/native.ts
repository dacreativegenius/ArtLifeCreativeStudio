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

let lastName = ""
/** The file name the last Android save actually used (it can differ when the name was taken). */
export const lastNativeSaveName = () => lastName

/**
 * Android save: write straight into Documents/Art Life Creative Studio (shows up in Files).
 *
 * v1.0.5: Android 11+ refuses to overwrite a file in that folder that was created by an earlier
 * install of the app (e.g. after uninstalling v1.0.2 / v1.0.3). That used to throw re-saves of a
 * .dtm / .png into the share sheet. Now we try to replace the file, otherwise save beside it as
 * "name (2).dtm" — the share sheet is only the very last resort.
 */
export async function saveNative(blob: Blob, filename: string): Promise<"documents" | "shared" | "cancelled"> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem")
  const data = await blobToBase64(blob)
  const pathOf = (name: string) => `${ANDROID_SAVE_FOLDER}/${name}`
  const tryWrite = async (name: string) => {
    try {
      await Filesystem.writeFile({ path: pathOf(name), data, directory: Directory.Documents, recursive: true })
      lastName = name
      return true
    } catch {
      return false
    }
  }

  // 1. normal save (overwrites files this install created)
  if (await tryWrite(filename)) return "documents"

  // 2. the name belongs to a file from an earlier install — try to replace it
  try {
    await Filesystem.deleteFile({ path: pathOf(filename), directory: Directory.Documents })
    if (await tryWrite(filename)) return "documents"
  } catch {
    /* not ours to delete */
  }

  // 3. save next to it under a free name
  const dot = filename.lastIndexOf(".")
  const base = dot > 0 ? filename.slice(0, dot) : filename
  const ext = dot > 0 ? filename.slice(dot) : ""
  for (let n = 2; n <= 50; n++) {
    if (await tryWrite(`${base} (${n})${ext}`)) return "documents"
  }

  // 4. the folder is blocked entirely — hand the file to the share sheet
  const { uri } = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache })
  const { Share } = await import("@capacitor/share")
  try {
    await Share.share({ title: filename, files: [uri], dialogTitle: "Save to…" })
    return "shared"
  } catch {
    return "cancelled"
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
