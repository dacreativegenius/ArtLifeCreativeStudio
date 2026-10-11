import { useEffect, useRef } from "react"
import type { Studio } from "./useStudio"
import { desktop } from "../../lib/art/desktop"
import { DOC_H, DOC_W } from "../../lib/art/types"
import { serializeDTM } from "../../lib/art/fileio"
import { readAutosave, requestPersistentStorage, writeAutosave } from "../../lib/art/pwa"
import { afterDrawing } from "../../lib/art/activity"

/**
 * Browser / phone version: keeps the current drawing in the device's storage so closing the tab,
 * switching apps or a phone reboot never loses work. Restores it automatically on the next launch.
 * (The Windows .exe keeps its existing behaviour.)
 */
export function useAutosave(studio: Studio) {
  const ready = useRef(false)
  const studioRef = useRef(studio)
  studioRef.current = studio

  useEffect(() => {
    if (desktop) return
    let alive = true
    requestPersistentStorage()
    readAutosave().then(async (rec) => {
      if (!alive) return
      if (rec?.text) {
        await studioRef.current.loadDTM(new File([rec.text], `${rec.name}.dtm`, { type: "application/octet-stream" }))
        studioRef.current.flash(`Restored “${rec.name}” from your last session`)
      }
      ready.current = true
    })
    return () => {
      alive = false
    }
  }, [])

  const { layers, docName, activeLayerId, primary, secondary, swatches } = studio
  useEffect(() => {
    if (desktop || !ready.current) return
    const save = () =>
      writeAutosave({
        name: docName,
        savedAt: Date.now(),
        text: serializeDTM({ name: docName, width: DOC_W, height: DOC_H, layers, activeLayerId, primary, secondary, swatches }),
      })
    // v1.0.4: serialising a big drawing is expensive — wait until the pen is lifted and the
    // device is idle, so autosave never interrupts the next stroke.
    const cancel = afterDrawing(() => void save(), 2500)
    // iOS / Android may freeze the page as soon as it is hidden — save immediately then.
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        cancel()
        void save()
      }
    }
    document.addEventListener("visibilitychange", onHide)
    return () => {
      cancel()
      document.removeEventListener("visibilitychange", onHide)
    }
  }, [layers, docName, activeLayerId, primary, secondary, swatches])
}
