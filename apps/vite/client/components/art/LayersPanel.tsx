import { Fragment, useEffect, useRef, useState } from "react";
import { Brush, ChevronDown, ChevronRight, ChevronUp, Circle, Copy, Eraser, Eye, EyeOff, Folder, FolderOpen, GripVertical, Image as ImageIcon, IndentDecrease, IndentIncrease, Lock, Merge, MousePointer2, PaintBucket, PenTool, Pencil, Slash, Square, Trash2, Unlock } from "lucide-react";
import type { Studio } from "./useStudio";
import { Panel, iconBtn } from "./Panel";
import { NumInput } from "./NumInput";
import type { Item, Layer } from "../../lib/art/types";
import { BRUSHES } from "../../lib/art/types";
import { DOC_W } from "../../lib/art/types";
import { drawItem } from "../../lib/art/render";
import { DOC_H, layerDepth } from "../../lib/art/types";
import { afterDrawing } from "../../lib/art/activity";

/**
 * v1.0.4: thumbnails are updated incrementally — a new stroke only draws that stroke onto the
 * cached thumbnail instead of re-rendering the whole layer (which grew slower with every stroke).
 */
function LayerThumb({ layer }: {layer: Layer;}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const art = useRef<{canvas: HTMLCanvasElement;items: Item[];w: number;h: number;} | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    return afterDrawing(() => {
      const scale = 88 / DOC_W;
      const w = Math.max(1, Math.round(DOC_W * scale));
      const h = Math.max(1, Math.round(DOC_H * scale));
      let a = art.current;
      const items = layer.items;
      const prev = a && a.w === w && a.h === h ? a.items : null;
      const appended = !!prev && items.length >= prev.length && prev.every((it, i) => items[i] === it);
      if (!a || !appended) {
        const canvas = a?.canvas ?? document.createElement("canvas");
        a = art.current = { canvas, items: [], w, h };
        canvas.width = w;
        canvas.height = h;
      }
      const g = a.canvas.getContext("2d")!;
      g.setTransform(scale, 0, 0, scale, 0, 0);
      for (let i = a.items.length; i < items.length; i++) drawItem(g, items[i]);
      a.items = items;
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = (layer.blend === "multiply" ? "multiply" : layer.blend === "screen" ? "screen" : "source-over");
      ctx.drawImage(a.canvas, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }, 400);
  }, [layer]);
  return <canvas ref={ref} aria-hidden="true" className="h-[28px] w-[44px] shrink-0 rounded-sm border border-border bg-foreground" data-oid="7a0a1ae753" data-oid-component-root="true" />;
}

function itemLabel(it: Item) {
  switch (it.kind) {
    case "path":
      if (it.fill && !it.stroke) return "Fill shape";
      return it.subpaths[0]?.closed ? "Closed path" : "Path";
    case "shape":
      return it.shape === "rect" ? "Rectangle" : it.shape === "ellipse" ? "Ellipse" : "Line";
    case "stroke":
      return BRUSHES.find((b) => b.id === it.brush)?.name ?? "Stroke";
    case "image":
      return "Bitmap fill";
    default:
      return "Eraser mark";
  }
}

function ItemIcon({ it }: {it: Item;}) {
  const cls = "h-3 w-3 shrink-0";
  if (it.kind === "path") return it.fill && !it.stroke ? <PaintBucket className={cls} data-oid="aae69e7f04" data-oid-classname-dynamic="true" /> : <PenTool className={cls} data-oid="aa700be828" data-oid-classname-dynamic="true" />;
  if (it.kind === "shape") return it.shape === "rect" ? <Square className={cls} data-oid="0e2b2e84d4" data-oid-classname-dynamic="true" /> : it.shape === "ellipse" ? <Circle className={cls} data-oid="7990ce4c1c" data-oid-classname-dynamic="true" /> : <Slash className={cls} data-oid="a3ff0daade" data-oid-classname-dynamic="true" />;
  if (it.kind === "image") return <ImageIcon className={cls} data-oid="9d828a0bdc" data-oid-component-root="true" data-oid-classname-dynamic="true" />;
  return <Brush className={cls} data-oid="afbbe0d61c" data-oid-component-root="true" data-oid-classname-dynamic="true" />;
}

export function LayersPanel({ studio }: {studio: Studio;}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (id: string) =>
  setExpanded((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);else
    n.add(id);
    return n;
  });
  const selectItem = (layerId: string, id: string, additive: boolean) => {
    studio.setActiveLayerId(layerId);
    studio.setSelection(additive ? studio.selection.includes(id) ? studio.selection.filter((x) => x !== id) : [...studio.selection, id] : [id]);
    if (!["select", "direct", "move", "transform", "lasso", "penAdd", "penDelete", "penConvert"].includes(studio.tool)) studio.setTool("select");
  };
  const [editing, setEditing] = useState<string | null>(null);

  /* ---------- drag handles: reorder layers, and paths / shapes within or between layers ---------- */
  type Drop = {key: string;place: "above" | "below" | "inside";};
  const [drop, setDropState] = useState<Drop | null>(null);
  const dropRef = useRef<Drop | null>(null);
  const dragRef = useRef<{kind: "layer" | "item";id: string;} | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const setDrop = (d: Drop | null) => {
    const p = dropRef.current;
    if (p?.key === d?.key && p?.place === d?.place) return;
    dropRef.current = d;
    setDropState(d);
  };
  const startDrag = (e: React.PointerEvent<HTMLButtonElement>, kind: "layer" | "item", id: string) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { kind, id };
    setDraggingId(id);
  };
  const moveDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-drop-key]");
    const key = el?.dataset.dropKey;
    if (!el || !key || d.kind === "layer" && !key.startsWith("L:")) return setDrop(null);
    const r = el.getBoundingClientRect();
    const f = (e.clientY - r.top) / Math.max(1, r.height);
    // v1.0.7: dragging a layer onto the middle of another layer nests it inside that layer
    if (d.kind === "layer" && key.startsWith("L:") && key.slice(2) !== d.id) {
      setDrop({ key, place: f < 0.28 ? "above" : f > 0.72 ? "below" : "inside" });
      return;
    }
    setDrop({ key, place: f < 0.5 ? "above" : "below" });
  };
  const endDrag = () => {
    const d = dragRef.current;
    const t = dropRef.current;
    dragRef.current = null;
    setDraggingId(null);
    setDrop(null);
    if (!d || !t) return;
    if (t.key.startsWith("L:")) {
      const layerId = t.key.slice(2);
      if (d.kind === "layer") {
        if (t.place === "inside") studio.nestLayer(d.id, layerId);else
        studio.moveLayerTo(d.id, layerId, t.place);
      } else
      studio.moveItemTo(d.id, layerId, null, "above");
    } else {
      const [, layerId, itemId] = t.key.split("|");
      studio.moveItemTo(d.id, layerId, itemId, t.place === "below" ? "below" : "above");
    }
  };
  const dropAt = (key: string) => drop?.key === key ? drop.place : undefined;

  const active = studio.activeLayer;
  // v1.0.7 nested layers: the flat stack reversed is already the tree (parent row, then its sublayers)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleCollapsed = (id: string) =>
  setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);else
    n.add(id);
    return n;
  });
  const childCount = new Map<string, number>();
  for (const l of studio.layers) if (l.parent) childCount.set(l.parent, (childCount.get(l.parent) ?? 0) + 1);
  const hiddenByCollapse = (l: Layer) => {
    let p = l.parent;
    let guard = 0;
    while (p && guard++ < 64) {
      if (collapsed.has(p)) return true;
      p = studio.layers.find((x) => x.id === p)?.parent;
    }
    return false;
  };
  const ordered = [...studio.layers].reverse().filter((l) => !hiddenByCollapse(l));
  const siblings = active ? studio.layers.filter((l) => l.parent === active.parent) : [];
  const activeIndex = active ? siblings.findIndex((l) => l.id === active.id) : -1;
  const mergeInto = active ? studio.mergeTarget(active.id) : null;

  return (
    <Panel
      title="Layers"
      actions={
      <div className="flex items-center" data-oid="3a27a3af81" data-oid-component-root="true">
          <button type="button" aria-label="New pencil layer" title="New pencil layer — holds pencil strokes" className={iconBtn} onClick={() => studio.addLayer("pencil")} data-oid="ceb86af31c" data-oid-classname-dynamic="true">
            <Pencil className="h-3.5 w-3.5" data-oid="3af61da8c8" />
          </button>
          <button type="button" aria-label="New vector layer" title="New vector layer — holds vector strokes, shapes, pen paths and fills" className={iconBtn} onClick={() => studio.addLayer("vector")} data-oid="b5e2b69138" data-oid-classname-dynamic="true">
            <PenTool className="h-3.5 w-3.5" data-oid="0cdb2a51af" />
          </button>
          <button type="button" aria-label="Duplicate layer" className={iconBtn} onClick={() => active && studio.duplicateLayer(active.id)} data-oid="593de826ad" data-oid-classname-dynamic="true">
            <Copy className="h-3.5 w-3.5" data-oid="13e32bff74" />
          </button>
          <button type="button" aria-label="Move layer up" className={iconBtn} disabled={activeIndex >= siblings.length - 1} onClick={() => active && studio.moveLayer(active.id, 1)} data-oid="244468e319" data-oid-classname-dynamic="true">
            <ChevronUp className="h-3.5 w-3.5" data-oid="3c7dc04db4" />
          </button>
          <button type="button" aria-label="Move layer down" className={iconBtn} disabled={activeIndex <= 0} onClick={() => active && studio.moveLayer(active.id, -1)} data-oid="c00f092846" data-oid-classname-dynamic="true">
            <ChevronDown className="h-3.5 w-3.5" data-oid="a7b8a146b9" />
          </button>
          <button type="button" aria-label="Delete layer" className={iconBtn} disabled={studio.layers.length <= 1} onClick={() => active && studio.deleteLayer(active.id)} data-oid="6c92987ca5" data-oid-classname-dynamic="true">
            <Trash2 className="h-3.5 w-3.5" data-oid="0ceda53918" />
          </button>
        </div>
      }>
      
      {active &&
      <div className="mb-ds-sm flex items-center gap-ds-sm" data-oid="9a8bfd1996">
          <div className="flex flex-1 items-center gap-ds-sm text-label text-muted-foreground" data-oid="b327b2b2b4">
            <span data-oid="08bda14904">Opacity</span>
            <input
            type="range"
            aria-label="Layer opacity"
            min={0}
            max={100}
            value={Math.round(active.opacity * 100)}
            onPointerDown={studio.snapshot}
            onChange={(e) => studio.updateLayer(active.id, { opacity: Number(e.target.value) / 100 }, false)}
            className="flex-1 accent-primary" data-oid="106562dcac" />
          
            <NumInput label="Layer opacity" value={Math.round(active.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => studio.updateLayer(active.id, { opacity: v / 100 })} />
          </div>
          <button type="button" aria-label="Clear layer" title="Clear layer" className={iconBtn} onClick={() => studio.clearLayer(active.id)} data-oid="16e66ae1dd" data-oid-classname-dynamic="true">
            <Eraser className="h-3.5 w-3.5" data-oid="cd3daf42cf" />
          </button>
        </div>
      }

      {active &&
      <div className="mb-ds-sm flex items-center gap-ds-sm" data-oid="f30b5d36ef">
          <p className="w-[46px] text-label text-muted-foreground" data-oid="d131471244">Blend</p>
          <div role="group" aria-label="Layer blend mode" className="grid flex-1 grid-cols-3 gap-[2px] rounded-md border border-border bg-background p-[2px]" data-oid="facf864f8b">
            <button
            type="button"
            aria-pressed={(active.blend ?? "normal") === "normal"}
            onClick={() => studio.updateLayer(active.id, { blend: "normal" })}
            className="h-6 rounded-sm text-label text-muted-foreground hover:bg-secondary hover:text-foreground aria-pressed:bg-secondary aria-pressed:text-foreground" data-oid="b782e1eb99">
              Normal
            </button>
            <button
            type="button"
            aria-pressed={active.blend === "multiply"}
            onClick={() => studio.updateLayer(active.id, { blend: "multiply" })}
            className="h-6 rounded-sm text-label text-muted-foreground hover:bg-secondary hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground" data-oid="d8c3435653">
              Multiply
            </button>
            <button
            type="button"
            aria-pressed={active.blend === "screen"}
            onClick={() => studio.updateLayer(active.id, { blend: "screen" })}
            className="h-6 rounded-sm text-label text-muted-foreground hover:bg-secondary hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground" data-oid="9f101a44b3">
              Screen
            </button>
          </div>
        </div>
      }

      {active &&
      <div role="group" aria-label="Layer actions" className="mb-ds-sm grid grid-cols-4 gap-[2px] rounded-md border border-border bg-background p-[2px]" data-oid="f4f65346aa">
          <button
          type="button"
          title="Put this layer inside the layer above it"
          disabled={activeIndex >= siblings.length - 1}
          onClick={() => studio.indentLayer(active.id)}
          className="flex h-9 flex-col items-center justify-center gap-[1px] rounded-sm text-label text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-35" data-oid="2ef90395ee">
            <IndentIncrease className="h-3.5 w-3.5" data-oid="d5fc80c198" />
            <span className="type-caption" data-oid="268d36380d">Nest</span>
          </button>
          <button
          type="button"
          title="Move this layer out of its parent layer"
          disabled={!active.parent}
          onClick={() => studio.outdentLayer(active.id)}
          className="flex h-9 flex-col items-center justify-center gap-[1px] rounded-sm text-label text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-35" data-oid="3548280d78">
            <IndentDecrease className="h-3.5 w-3.5" data-oid="ad0e840e3a" />
            <span className="type-caption" data-oid="030733fead">Unnest</span>
          </button>
          <button
          type="button"
          title={mergeInto ? `Merge into “${mergeInto.name}”` : "Merge Down needs a pencil layer directly below"}
          disabled={!mergeInto}
          onClick={() => studio.mergeDown(active.id)}
          className="flex h-9 flex-col items-center justify-center gap-[1px] rounded-sm text-label text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-35" data-oid="af33bab726">
            <Merge className="h-3.5 w-3.5 rotate-180" data-oid="f57fdae589" />
            <span className="type-caption" data-oid="23b4d5f2de">Merge ↓</span>
          </button>
          <button
          type="button"
          title="Select everything on this layer — then Cut or Delete keeps the layer"
          onClick={() => studio.selectLayerContents(active.id)}
          className="flex h-9 flex-col items-center justify-center gap-[1px] rounded-sm text-label text-muted-foreground hover:bg-secondary hover:text-foreground" data-oid="d83cb89c15">
            <MousePointer2 className="h-3.5 w-3.5" data-oid="947c1ef8c6" />
            <span className="type-caption" data-oid="6f92402eaf">Select all</span>
          </button>
        </div>
      }

      <ul role="listbox" aria-label="Layers" className="flex flex-col gap-[3px] rounded-md border border-border bg-background p-ds-xs" data-oid="0a9070211d">
        {ordered.map((layer, index) =>
        <Fragment key={layer.id}>
        <li
            role="option"
            aria-selected={layer.id === active?.id}
            data-hidden={!layer.visible}
            data-drop-key={`L:${layer.id}`}
            data-drop={dropAt(`L:${layer.id}`)}
            data-dragging={draggingId === layer.id}
            onClick={() => studio.setActiveLayerId(layer.id)}
            style={{ marginLeft: layerDepth(studio.layers, layer) * 14 }}
            className="flex cursor-pointer items-center gap-ds-xs rounded-sm border border-transparent px-ds-xs py-ds-xs hover:bg-secondary aria-selected:border-accent aria-selected:bg-secondary data-[hidden=true]:opacity-50 data-[dragging=true]:opacity-40 data-[drop=above]:shadow-[inset_0_2px_0_0_var(--primary)] data-[drop=below]:shadow-[inset_0_-2px_0_0_var(--primary)] data-[drop=inside]:border-primary data-[drop=inside]:bg-primary/15" data-oid="dc0fbf6c91" data-oid-shared="true" data-oid-text-editable="false" data-oid-text-source="element:button|expression:64e6e506d3c6|expression:365984e73157|element:button|element:button|element:div|element:button" data-oid-style-dynamic="marginLeft">
          
            <button
              type="button"
              aria-label={`Drag to reorder ${layer.name}`}
              title="Drag to reorder"
              onPointerDown={(e) => startDrag(e, "layer", layer.id)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onClick={(e) => e.stopPropagation()}
              className="-ml-[2px] grid h-8 w-5 shrink-0 cursor-grab touch-none place-items-center rounded-sm text-muted-foreground hover:bg-card hover:text-foreground active:cursor-grabbing" data-oid="f458720506" data-oid-shared="true">
              <GripVertical className="h-3.5 w-3.5" data-oid="feda166974" data-oid-shared="true" />
            </button>
            {layer.type === "vector" ?
            <button
              type="button"
              aria-label={expanded.has(layer.id) ? `Collapse ${layer.name} contents` : `Show paths and shapes in ${layer.name}`}
              aria-expanded={expanded.has(layer.id)}
              title="Show paths and shapes"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(layer.id);
              }}
              className="-mr-ds-xs grid h-6 w-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:text-foreground aria-expanded:text-accent" data-oid="46293b8fdb" data-oid-shared="true">
                <ChevronRight className="h-3.5 w-3.5 transition-transform aria-[expanded=true]:rotate-90" aria-expanded={expanded.has(layer.id)} data-oid="029c543c09" data-oid-shared="true" />
              </button> :

            <span aria-hidden="true" className="-mr-ds-xs w-4 shrink-0" data-oid="b338148a6d" data-oid-shared="true" />
            }
            {childCount.has(layer.id) &&
            <button
              type="button"
              aria-label={collapsed.has(layer.id) ? `Show sublayers of ${layer.name}` : `Hide sublayers of ${layer.name}`}
              aria-expanded={!collapsed.has(layer.id)}
              title={collapsed.has(layer.id) ? "Show sublayers" : "Hide sublayers"}
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapsed(layer.id);
              }}
              className="grid h-6 w-5 shrink-0 place-items-center rounded-sm text-primary hover:bg-card" data-oid="b38b36f056" data-oid-shared="true">
                {collapsed.has(layer.id) ? <Folder className="h-3.5 w-3.5" data-oid="8cddbdbed7" data-oid-shared="true" /> : <FolderOpen className="h-3.5 w-3.5" data-oid="0a6b0064b5" data-oid-shared="true" />}
              </button>
            }
            <button
              type="button"
              aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
              className={iconBtn}
              onClick={(e) => {
                e.stopPropagation();
                studio.updateLayer(layer.id, { visible: !layer.visible });
              }} data-oid="b92b2c75a4" data-oid-shared="true" data-oid-classname-dynamic="true">
            
              {layer.visible ? <Eye className="h-3.5 w-3.5" data-oid="72364899a2" data-oid-shared="true" /> : <EyeOff className="h-3.5 w-3.5" data-oid="4beee333ef" data-oid-shared="true" />}
            </button>
            <button
              type="button"
              aria-label={`Select everything on ${layer.name}`}
              title="Tap to select everything on this layer"
              onClick={(e) => {
                e.stopPropagation();
                studio.selectLayerContents(layer.id);
              }}
              className="shrink-0 rounded-sm hover:ring-1 hover:ring-accent" data-oid="1a340e54d5" data-oid-shared="true">
              <LayerThumb layer={layer} />
            </button>
            <div className="min-w-0 flex-1" data-index={index} data-oid="9701a3e47e" data-oid-shared="true" data-oid-text-editable="false" data-oid-text-source="expression:cf11757b6ec2|element:p">
              {editing === layer.id ?
              <input
                autoFocus
                defaultValue={layer.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== layer.name) studio.updateLayer(layer.id, { name: v });
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditing(null);
                }}
                className="h-6 w-full rounded-sm border border-primary bg-card px-ds-xs text-label text-foreground outline-none" data-oid="978b569084" data-oid-shared="true" /> :


              <p className="truncate text-label text-foreground" onDoubleClick={() => setEditing(layer.id)} title="Double-click to rename" data-oid="c3b9a984d4" data-oid-shared="true">
                  {layer.name}
                </p>
              }
              <p className="type-caption text-muted-foreground" data-oid="58f576afbc" data-oid-shared="true" data-oid-text-editable="false" data-oid-text-source="expression:5332937ed06d|text|expression:5b9c7a56383a|text|expression:b5c88ed02142|text|expression:4900173db67f|text|expression:f3269a005485">
                {layer.type === "pencil" ? "PENCIL" : "VECTOR"} · {layer.items.length} OBJ{childCount.has(layer.id) ? ` · ${childCount.get(layer.id)} SUB` : ""} · {Math.round(layer.opacity * 100)}%{layer.blend === "multiply" ? " · MULT" : layer.blend === "screen" ? " · SCRN" : ""}
              </p>
            </div>
            <button
              type="button"
              aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
              aria-pressed={layer.locked}
              className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground hover:bg-card hover:text-foreground aria-pressed:text-primary"
              onClick={(e) => {
                e.stopPropagation();
                studio.updateLayer(layer.id, { locked: !layer.locked });
              }} data-oid="e217988ca6" data-oid-shared="true">
            
              {layer.locked ? <Lock className="h-3.5 w-3.5" data-oid="c71cab3537" data-oid-shared="true" /> : <Unlock className="h-3.5 w-3.5" data-oid="a43bf87258" data-oid-shared="true" />}
            </button>
          </li>
          {layer.type === "vector" && expanded.has(layer.id) &&
          <li role="presentation" className="-mt-[2px] mb-[2px] ml-ds-lg border-l border-border pl-ds-xs" data-oid="d3c4918c79" data-oid-shared="true">
              {layer.items.filter((it) => it.kind !== "erase").length === 0 ?
            <p className="px-ds-xs py-ds-xs type-caption text-muted-foreground" data-oid="13d57e2007" data-oid-shared="true">EMPTY — DRAW WITH PEN, SHAPES, VECTOR BRUSHES OR BUCKET</p> :

            <ul role="group" aria-label={`Contents of ${layer.name}`} className="flex max-h-48 flex-col gap-px overflow-y-auto" data-oid="46fc7bbdc2" data-oid-shared="true">
                  {[...layer.items].reverse().filter((it) => it.kind !== "erase").map((it, itemIndex) =>
              <li
                key={it.id}
                role="option"
                data-index={itemIndex}
                aria-selected={studio.selection.includes(it.id)}
                data-hidden={!!it.hidden}
                data-drop-key={`I|${layer.id}|${it.id}`}
                data-drop={dropAt(`I|${layer.id}|${it.id}`)}
                data-dragging={draggingId === it.id}
                onClick={(e) => !it.hidden && selectItem(layer.id, it.id, e.shiftKey || studio.multiSelect)}
                className="flex cursor-pointer items-center gap-ds-xs rounded-sm px-ds-xs py-[3px] text-label text-muted-foreground hover:bg-secondary hover:text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground data-[hidden=true]:opacity-50 data-[dragging=true]:opacity-40 data-[drop=above]:shadow-[inset_0_2px_0_0_var(--primary)] data-[drop=below]:shadow-[inset_0_-2px_0_0_var(--primary)]" data-oid="83534bb0e9" data-oid-shared="true" data-oid-text-editable="false">
                      <button
                  type="button"
                  aria-label={`Drag to reorder ${itemLabel(it)}`}
                  title="Drag to reorder — drop on another layer to move it there"
                  onPointerDown={(e) => startDrag(e, "item", it.id)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onClick={(e) => e.stopPropagation()}
                  className="-ml-[2px] grid h-6 w-5 shrink-0 cursor-grab touch-none place-items-center rounded-sm hover:bg-card hover:text-foreground active:cursor-grabbing" data-oid="726afff6a1" data-oid-shared="true">
                        <GripVertical className="h-3 w-3" data-oid="4ef8cf6781" data-oid-shared="true" />
                      </button>
                      <button
                  type="button"
                  aria-label={it.hidden ? `Show ${itemLabel(it)}` : `Hide ${itemLabel(it)}`}
                  aria-pressed={!it.hidden}
                  title={it.hidden ? "Show" : "Hide"}
                  onClick={(e) => {
                    e.stopPropagation();
                    studio.toggleItemHidden(it.id);
                  }}
                  className="-ml-[2px] grid h-5 w-5 shrink-0 place-items-center rounded-sm hover:bg-card hover:text-foreground" data-oid="dff98d1453" data-oid-shared="true">
                        {it.hidden ? <EyeOff className="h-3 w-3" data-oid="3d97550ee5" data-oid-shared="true" /> : <Eye className="h-3 w-3" data-oid="8535742422" data-oid-shared="true" />}
                      </button>
                      <ItemIcon it={it} />
                      <span className="min-w-0 flex-1 truncate" data-oid="86ad755909" data-oid-shared="true">{itemLabel(it)}</span>
                      {(it.kind === "path" || it.kind === "shape") && (it.fill || (it.kind === "path" ? it.stroke : it.color)) &&
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[2px] border border-border" style={{ backgroundColor: it.fill ?? (it.kind === "path" ? it.stroke! : it.color) }} data-oid="4d7b0eaa2f" data-oid-shared="true" data-oid-style-dynamic="backgroundColor" />
                }
                      {it.kind === "stroke" && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full border border-border" style={{ backgroundColor: it.color }} data-oid="5fe39268d0" data-oid-shared="true" data-oid-style-dynamic="backgroundColor" />}
                    </li>
              )}
                </ul>
            }
            </li>
          }
        </Fragment>
        )}
      </ul>
    </Panel>);

}