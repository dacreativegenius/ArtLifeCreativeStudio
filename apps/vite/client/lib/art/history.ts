import { BRUSHES, type Item, type Layer } from "./types"

function itemName(it: Item): string {
  switch (it.kind) {
    case "stroke":
      return BRUSHES.find((b) => b.id === it.brush)?.name ?? "Stroke"
    case "erase":
      return "Eraser"
    case "shape":
      return it.shape === "rect" ? "Rectangle" : it.shape === "ellipse" ? "Ellipse" : "Line"
    case "path":
      if (it.blob) return "Ink shape"
      if (it.fill && !it.stroke) return "Fill shape"
      return "Path"
    case "image":
      return "Bitmap"
  }
}

/** Human label for the change between two document states (used by the History panel). */
export function describeChange(a: Layer[], b: Layer[]): string {
  if (b.length > a.length) return "New layer"
  if (b.length < a.length) return "Delete layer"
  const idsA = new Set<string>()
  let ca = 0
  for (const l of a) for (const it of l.items) {
    idsA.add(it.id)
    ca++
  }
  const added: Item[] = []
  let cb = 0
  const idsB = new Set<string>()
  for (const l of b) for (const it of l.items) {
    idsB.add(it.id)
    cb++
    if (!idsA.has(it.id)) added.push(it)
  }
  let removed = 0
  idsA.forEach((id) => {
    if (!idsB.has(id)) removed++
  })
  if (added.length && removed) return added.length === 1 && removed > 1 ? "Combine shapes" : removed === 1 && added.length === 1 ? `Reshape · ${itemName(added[0])}` : "Convert objects"
  if (added.length === 1) return itemName(added[0])
  if (added.length > 1) return `Paste ${added.length} objects`
  if (removed) return removed === 1 ? "Delete object" : `Delete ${removed} objects`
  for (let i = 0; i < a.length; i++) {
    const la = a[i]
    const lb = b[i]
    if (la.id !== lb.id) return "Move layer"
    if (la.name !== lb.name) return "Rename layer"
    if (la.visible !== lb.visible) return lb.visible ? "Show layer" : "Hide layer"
    if (la.locked !== lb.locked) return lb.locked ? "Lock layer" : "Unlock layer"
    if (la.opacity !== lb.opacity) return "Layer opacity"
    if (la.blend !== lb.blend) return "Blend mode"
    if (la.items.length && la.items.some((it, k) => lb.items[k]?.id !== it.id)) return "Arrange"
  }
  if (ca === cb) {
    for (let i = 0; i < a.length; i++) {
      const lb = b[i]
      const changed = a[i].items.filter((it, k) => lb.items[k] !== it)
      if (changed.length) {
        const g = changed[0].group
        if (changed.length > 1 && g !== changed[1].group) return `Edit ${changed.length} objects`
        return `Edit · ${itemName(changed[0])}`
      }
    }
  }
  return "Edit"
}
