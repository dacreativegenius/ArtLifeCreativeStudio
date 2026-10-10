/**
 * Shared "pen is down" flag. Background work (autosave, layer thumbnails) waits until the
 * stroke is finished so it never steals frames from drawing — the main cause of brushes
 * getting slower as a drawing grows.
 */
let drawing = false
const waiters = new Set<() => void>()

export const isDrawing = () => drawing

export function setDrawing(v: boolean) {
  drawing = v
  if (!v && waiters.size) {
    const list = Array.from(waiters)
    waiters.clear()
    for (const fn of list) fn()
  }
}

type IdleWin = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }

/**
 * Run `fn` after `delay` ms once the pen is lifted and the browser is idle.
 * Returns a cancel function.
 */
export function afterDrawing(fn: () => void, delay: number) {
  let cancelled = false
  let timer = 0
  let idle = 0
  const w = window as IdleWin
  const run = () => {
    if (cancelled) return
    if (drawing) {
      waiters.add(arm)
      return
    }
    if (w.requestIdleCallback) idle = w.requestIdleCallback(() => !cancelled && !drawing ? fn() : arm(), { timeout: 2000 })
    else fn()
  }
  function arm() {
    if (cancelled) return
    window.clearTimeout(timer)
    timer = window.setTimeout(run, delay)
  }
  arm()
  return () => {
    cancelled = true
    window.clearTimeout(timer)
    waiters.delete(arm)
    if (idle && w.cancelIdleCallback) w.cancelIdleCallback(idle)
  }
}
