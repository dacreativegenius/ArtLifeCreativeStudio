import { useEffect, useRef, useState } from "react";
import { Group, Link2, Scissors, Trash2, Ungroup } from "lucide-react";
import { setDrawing } from "../../lib/art/activity";
import { outlineItem } from "../../lib/art/pathfinder";
import type { Studio, View } from "./useStudio";
import {
  DOC_H,
  DOC_W,
  blendOp,
  cornerNode,
  uid,
  type Item,
  type Layer,
  type LayerType,
  type PathItem,
  type Pt,
  type Rect,
  type ShapeItem } from
"../../lib/art/types";
import {
  anchorsOf,
  drawItem,
  drawPencil,
  eraseFromPath,
  floodMask,
  strokeToBlob,
  hitItem,
  isVectorBrush,
  itemBounds,
  outlineOf,
  outlinesOf,
  pointInPoly,
  rectsIntersect,
  renderDoc,
  rotateItem,
  rotPt,
  scaleItem,
  setAnchor,
  simplify,
  simplifyKeepCorners,
  splitPath,
  traceMask,
  translateItem,
  unionBounds,
  type XY } from
"../../lib/art/render";
import { readCssColor, rgbToHex } from "../../lib/art/color";
import {
  cornerWidgets,
  editModel,
  modelDelete,
  radiusFromBisector,
  roundCorner,
  modelDragAnchor,
  modelHalfWidth,
  modelInsert,
  modelNearest,
  modelOutlines,
  modelSubpaths,
  modelToggle,
  asJoinablePath,
  joinEnds,
  openEnds,
  reverseSub,
  type PathEnd,
  type EditModel } from
"../../lib/art/pathEdit";

const ANCHOR_TOOLS = new Set(["direct", "penAdd", "penDelete", "penConvert"]);
const EDIT_TOOLS = new Set(["penAdd", "penDelete", "penConvert"]);

type Drag =
{type: "pan";sx: number;sy: number;vx: number;vy: number;} |
{type: "draw";} |
{type: "shape";x0: number;y0: number;} |
{type: "marquee";x0: number;y0: number;x1: number;y1: number;additive: boolean;base: string[];} |
{type: "lasso";pts: XY[];additive: boolean;base: string[];} |
{type: "move";lx: number;ly: number;ids: Set<string>;moved: boolean;x0?: number;y0?: number;tx?: number;ty?: number;box?: Rect | null;xs?: number[];ys?: number[];} |
{type: "scale";ax: number;ay: number;hx: number;hy: number;orig: Map<string, Item>;moved: boolean;} |
{type: "anchor";id: string;idx: number;orig: Item;moved: boolean;} |
{type: "handle";id: string;sub: number;idx: number;which: "in" | "out";orig: PathItem;moved: boolean;free?: boolean;} |
{type: "convert";id: string;sub: number;idx: number;model: EditModel;sx0: number;sy0: number;moved: boolean;} |
{type: "sample";} |
{type: "corner";id: string;sub: number;idx: number;orig: PathItem;moved: boolean;r: number;} |
{type: "pen";mode: "new" | "out";moved: boolean;hadOut: boolean;} |
{type: "rotate";cx: number;cy: number;a0: number;angle: number;box: Rect;orig: Map<string, Item>;moved: boolean;};

/** origId: continuing an existing open path (replaced on commit). absorb: open paths joined into this one. */
type Pen = {item: PathItem;layerId: string;closing: boolean;origId?: string;absorb: string[];};
type OpenEnd = PathEnd & {x: number;y: number;layerId: string;};
type Gesture = {m0x: number;m0y: number;d0: number;a0: number;v0: View;};

const ROT_OFFSET = 28;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const CORNER_OFFSET = 16; // px inside the corner along the bisector
/** Pencil strokes (and the eraser marks cutting them) act as one sketch element per pencil layer. */
const isPencilMark = (it: Item) => it.kind === "stroke" && !isVectorBrush(it.brush) || it.kind === "erase";

function replaceItems(ls: Layer[], map: Map<string, Item>): Layer[] {
  return ls.map((l) => l.items.some((i) => map.has(i.id)) ? { ...l, items: l.items.map((i) => map.get(i.id) ?? i) } : l);
}

/** Items are immutable, so their bounds can be memoised for viewport culling. */
const boundsCache = new WeakMap<Item, Rect>();
const boundsOf = (it: Item) => {
  let b = boundsCache.get(it);
  if (!b) {
    b = itemBounds(it);
    boundsCache.set(it, b);
  }
  return b;
};

/** Per-layer bitmap of committed artwork — only redrawn when the layer's items or the view change. */
type LayerCache = {canvas: HTMLCanvasElement;items: Item[] | null;key: string;};

function hitTop(layers: Layer[], x: number, y: number, tol: number) {
  for (let li = layers.length - 1; li >= 0; li--) {
    const l = layers[li];
    if (!l.visible || l.locked) continue;
    for (let i = l.items.length - 1; i >= 0; i--) {
      if (hitItem(l.items[i], x, y, tol)) return { layerId: l.id, item: l.items[i] };
    }
  }
  return null;
}

function shapePoints(kind: ShapeItem["shape"], x0: number, y0: number, x1: number, y1: number, shift: boolean): Pt[] {
  if (kind === "line") {
    if (shift) {
      const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(x1 - x0, y1 - y0);
      x1 = x0 + Math.cos(a) * len;
      y1 = y0 + Math.sin(a) * len;
    }
    return [
    { x: x0, y: y0, p: 1 },
    { x: x1, y: y1, p: 1 }];

  }
  let w = x1 - x0;
  let h = y1 - y0;
  if (shift) {
    const m = Math.max(Math.abs(w), Math.abs(h));
    w = (Math.sign(w) || 1) * m;
    h = (Math.sign(h) || 1) * m;
  }
  const ax = Math.min(x0, x0 + w);
  const ay = Math.min(y0, y0 + h);
  const bx = Math.max(x0, x0 + w);
  const by = Math.max(y0, y0 + h);
  if (kind === "rect") {
    return [
    { x: ax, y: ay, p: 1 },
    { x: bx, y: ay, p: 1 },
    { x: bx, y: by, p: 1 },
    { x: ax, y: by, p: 1 }];

  }
  const cx = (ax + bx) / 2;
  const cy = (ay + by) / 2;
  return [
  { x: bx, y: cy, p: 1 },
  { x: cx, y: by, p: 1 },
  { x: ax, y: cy, p: 1 },
  { x: cx, y: ay, p: 1 }];

}

export function CanvasStage({ studio }: {studio: Studio;}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const S = useRef(studio);
  S.current = studio;
  const layerCanvases = useRef(new Map<string, LayerCache>());
  const scratch = useRef<HTMLCanvasElement | null>(null);
  const paperCache = useRef<{canvas: HTMLCanvasElement;key: string;} | null>(null);
  const predicted = useRef<Pt[]>([]);
  const readoutT = useRef(0);
  const live = useRef<Item | null>(null);
  const liveLayer = useRef<string>("");
  const pen = useRef<Pen | null>(null);
  const penEndHover = useRef<OpenEnd | null>(null);
  const liveCache = useRef<{canvas: HTMLCanvasElement;id: string;key: string;frozen: number;} | null>(null);
  const rawLast = useRef<Pt | null>(null);
  const endsCache = useRef<{layers: Layer[];list: OpenEnd[];} | null>(null);
  const [ends, setEndsState] = useState<PathEnd[]>([]);
  const endsRef = useRef<PathEnd[]>([]);
  const setEnds = (v: PathEnd[]) => {
    endsRef.current = v;
    setEndsState(v);
    dirty.current = true;
  };
  const penHover = useRef<XY | null>(null);
  const drag = useRef<Drag | null>(null);
  const touches = useRef(new Map<number, XY>());
  const gesture = useRef<Gesture | null>(null);
  const pointer = useRef({ sx: 0, sy: 0, inside: false });
  const space = useRef(false);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const dirty = useRef(true);
  const colors = useRef({ accent: "#3d8bff", primary: "#ff7a1a" });
  const pressureState = useRef({ p: 0.5, lastT: 0, lastX: 0, lastY: 0 });
  const hoverAnchor = useRef<{id: string;idx: number;} | null>(null);
  const sampleReq = useRef<{sx: number;sy: number;} | null>(null);
  const hoverEdit = useRef<{id: string;add: XY | null;node: {sub: number;idx: number;} | null;} | null>(null);
  const guides = useRef<{v: number[];h: number[];} | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [readout, setReadout] = useState({ x: 0, y: 0, p: 0 });

  dirty.current = true;

  /* ---------- view transform: screen = (x, y) + R(rot) · zoom · doc ---------- */
  const toScreen = (x: number, y: number) => {
    const v = S.current.view;
    const c = Math.cos(v.rot);
    const s = Math.sin(v.rot);
    const X = x * v.zoom;
    const Y = y * v.zoom;
    return { x: v.x + X * c - Y * s, y: v.y + X * s + Y * c };
  };

  const toDoc = (sx: number, sy: number) => {
    const v = S.current.view;
    const c = Math.cos(v.rot);
    const s = Math.sin(v.rot);
    const dx = sx - v.x;
    const dy = sy - v.y;
    return { x: (dx * c + dy * s) / v.zoom, y: (-dx * s + dy * c) / v.zoom };
  };

  const fit = () => {
    const { w, h } = size.current;
    if (!w || !h) return;
    const zoom = Math.min((w - 96) / DOC_W, (h - 96) / DOC_H);
    S.current.setView({ zoom, x: (w - DOC_W * zoom) / 2, y: (h - DOC_H * zoom) / 2, rot: 0 });
  };

  const zoomAt = (sx: number, sy: number, f: number) => {
    S.current.setView((v) => {
      const nz = clamp(v.zoom * f, 0.1, 16);
      return { ...v, zoom: nz, x: sx - (sx - v.x) * (nz / v.zoom), y: sy - (sy - v.y) * (nz / v.zoom) };
    });
  };

  const resetRotation = () => {
    const { w, h } = size.current;
    const cx = w / 2;
    const cy = h / 2;
    S.current.setView((v) => {
      const d = -v.rot;
      const c = Math.cos(d);
      const s = Math.sin(d);
      const tx = v.x - cx;
      const ty = v.y - cy;
      return { ...v, rot: 0, x: cx + tx * c - ty * s, y: cy + tx * s + ty * c };
    });
  };

  const locate = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    const d = toDoc(sx, sy);
    return { sx, sy, x: d.x, y: d.y };
  };

  /** Snap a document point to the grid when Snap to Grid is on. */
  const snapPt = (x: number, y: number) => {
    const st = S.current;
    if (!st.snapToGrid) return { x, y };
    const g = st.gridSize;
    return { x: Math.round(x / g) * g, y: Math.round(y / g) * g };
  };

  /* ---------- pen tool ---------- */
  const penNodes = () => pen.current?.item.subpaths[0].nodes ?? [];

  const commitPen = () => {
    const p = pen.current;
    pen.current = null;
    penHover.current = null;
    penEndHover.current = null;
    dirty.current = true;
    if (!p || p.item.subpaths[0].nodes.length < 2) return;
    if (!p.origId && !p.item.subpaths[0].closed) p.item.fill = null;
    const item: PathItem = { ...p.item, subpaths: p.item.subpaths.map((sp) => ({ closed: sp.closed, nodes: sp.nodes.map((n) => ({ ...n })) })) };
    const gone = new Set(p.absorb);
    S.current.commit((ls) =>
    ls.map((l) => {
      if (l.id !== p.layerId && !l.items.some((i) => gone.has(i.id) || i.id === p.origId)) return l;
      let items = l.items.filter((i) => !gone.has(i.id));
      if (p.origId && items.some((i) => i.id === p.origId)) items = items.map((i) => i.id === p.origId ? item : i);else
      if (l.id === p.layerId) items = [...items, item];
      return { ...l, items };
    })
    );
  };

  useEffect(() => {
    if (studio.tool !== "pen" && pen.current) commitPen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio.tool]);

  // picked end anchors only live while Direct Selection is active and their paths stay selected
  useEffect(() => {
    const cur = endsRef.current;
    if (!cur.length) return;
    const sel = new Set(studio.selection);
    const next = studio.tool === "direct" ? cur.filter((pe) => sel.has(pe.id)) : [];
    if (next.length !== cur.length) setEnds(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio.selection, studio.tool]);

  /* ---------- sizing ---------- */
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    colors.current = { accent: readCssColor("--accent", "#3d8bff"), primary: readCssColor("--primary", "#ff7a1a") };
    let first = true;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.current = { w: r.width, h: r.height, dpr };
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      S.current.viewportRef.current = { w: r.width, h: r.height };
      if (first && r.width > 0) {
        first = false;
        fit();
      }
      dirty.current = true;
    });
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (studio.fitNonce) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio.fitNonce]);

  /* ---------- wheel + keys ---------- */
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0022));
      } else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        S.current.setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
      }
    };
    const isField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
    };
    const down = (e: KeyboardEvent) => {
      if (isField(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!space.current) {
          space.current = true;
          setSpaceDown(true);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        joinRef.current();
        return;
      }
      if (pen.current) {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          commitPen();
        } else if (e.key === "Backspace" || e.key === "Delete") {
          e.preventDefault();
          e.stopImmediatePropagation();
          const nodes = penNodes();
          nodes.pop();
          if (!nodes.length) pen.current = null;
          dirty.current = true;
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        space.current = false;
        setSpaceDown(false);
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- render loop ---------- */
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!dirty.current || document.visibilityState === "hidden") return;
      dirty.current = false;
      draw();
    };
    loop();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const { dpr } = size.current;
    const st = S.current;
    const { x: px, y: py, zoom, rot } = st.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);

    const viewKey = `${px}|${py}|${zoom}|${rot}|${c.width}|${c.height}|${dpr}|${DOC_W}|${DOC_H}`;

    // paper — its soft drop shadow is expensive on tablets, so it is cached per view
    let paper = paperCache.current;
    if (!paper) paper = paperCache.current = { canvas: document.createElement("canvas"), key: "" };
    if (paper.key !== viewKey) {
      const pc = paper.canvas;
      pc.width = c.width;
      pc.height = c.height;
      const p2 = pc.getContext("2d")!;
      p2.setTransform(dpr, 0, 0, dpr, 0, 0);
      p2.translate(px, py);
      p2.rotate(rot);
      p2.shadowColor = "rgba(0,0,0,0.5)";
      p2.shadowBlur = 32;
      p2.shadowOffsetY = 10;
      p2.fillStyle = "#ffffff";
      p2.fillRect(0, 0, DOC_W * zoom, DOC_H * zoom);
      paper.key = viewKey;
    }
    ctx.drawImage(paper.canvas, 0, 0);

    // visible part of the document (viewport culling: off-screen objects are skipped)
    const vw = size.current.w;
    const vh = size.current.h;
    const vc = [toDoc(0, 0), toDoc(vw, 0), toDoc(0, vh), toDoc(vw, vh)];
    const vx0 = Math.min(...vc.map((q) => q.x));
    const vy0 = Math.min(...vc.map((q) => q.y));
    const vx1 = Math.max(...vc.map((q) => q.x));
    const vy1 = Math.max(...vc.map((q) => q.y));
    const vis = { x: vx0 - 4, y: vy0 - 4, w: vx1 - vx0 + 8, h: vy1 - vy0 + 8 };

    const prep = (l: CanvasRenderingContext2D, clear: boolean) => {
      l.setTransform(1, 0, 0, 1, 0, 0);
      if (clear) l.clearRect(0, 0, l.canvas.width, l.canvas.height);
      l.setTransform(dpr, 0, 0, dpr, 0, 0);
      l.translate(px, py);
      l.rotate(rot);
      l.scale(zoom, zoom);
      l.save();
      l.beginPath();
      l.rect(0, 0, DOC_W, DOC_H);
      l.clip();
    };

    // pen continuing / joining existing paths: those originals are hidden while the pen edits them
    const pn0 = pen.current;
    const skipIds = pn0 ? [pn0.origId, ...pn0.absorb].filter((v): v is string => !!v) : [];
    const skipKey = skipIds.join(",");

    // layers — committed artwork comes from each layer's cache; only the live stroke is redrawn per frame
    for (const layer of st.layers) {
      if (!layer.visible) continue;
      let cache = layerCanvases.current.get(layer.id);
      if (!cache) {
        cache = { canvas: document.createElement("canvas"), items: null, key: "" };
        layerCanvases.current.set(layer.id, cache);
      }
      const lc = cache.canvas;
      if (lc.width !== c.width || lc.height !== c.height) {
        lc.width = c.width;
        lc.height = c.height;
        cache.key = "";
      }
      const ckey = skipKey ? `${viewKey}#${skipKey}` : viewKey;
      if (cache.items !== layer.items || cache.key !== ckey) {
        const l = lc.getContext("2d")!;
        const prev = cache.items;
        const items = layer.items;
        // v1.0.4: a finished stroke only draws itself onto the cached layer — no full re-render,
        // so committing stays instant no matter how many strokes the drawing already has
        const appended = cache.key === ckey && !!prev && items.length > prev.length && prev.every((it, i) => items[i] === it);
        prep(l, !appended);
        for (let i = appended && prev ? prev.length : 0; i < items.length; i++) {
          const it = items[i];
          if (!it.hidden && !(skipKey && skipIds.includes(it.id)) && rectsIntersect(boundsOf(it), vis)) drawItem(l, it);
        }
        l.restore();
        cache.items = items;
        cache.key = ckey;
      }
      let out = lc;
      const liveHere = live.current && layer.id === liveLayer.current ? live.current : null;
      const penHere = pen.current && layer.id === pen.current.layerId ? pen.current.item : null;
      if (liveHere || penHere) {
        let sc = scratch.current;
        if (!sc) sc = scratch.current = document.createElement("canvas");
        if (sc.width !== c.width || sc.height !== c.height) {
          sc.width = c.width;
          sc.height = c.height;
        }
        const s2 = sc.getContext("2d")!;
        s2.setTransform(1, 0, 0, 1, 0, 0);
        s2.clearRect(0, 0, sc.width, sc.height);
        s2.drawImage(lc, 0, 0);
        prep(s2, false);
        if (liveHere) {
          // stroke prediction: draw slightly ahead of the pen so the line keeps up with the nib
          const pr = predicted.current;
          const withPred = pr.length && (liveHere.kind === "stroke" || liveHere.kind === "erase") ? { ...liveHere, points: [...liveHere.points, ...pr] } as Item : liveHere;
          if (liveHere.kind === "stroke" && !isVectorBrush(liveHere.brush) && withPred.kind === "stroke") {
            // v1.0.4: incremental pencil — settled grain is stamped once into a cache and only the
            // tip is redrawn, so long strokes cost the same per frame as short ones
            let lv = liveCache.current;
            if (!lv) lv = liveCache.current = { canvas: document.createElement("canvas"), id: "", key: "", frozen: 0 };
            if (lv.canvas.width !== c.width || lv.canvas.height !== c.height) {
              lv.canvas.width = c.width;
              lv.canvas.height = c.height;
              lv.id = "";
            }
            const g = lv.canvas.getContext("2d")!;
            if (lv.id !== liveHere.id || lv.key !== viewKey) {
              g.setTransform(1, 0, 0, 1, 0, 0);
              g.clearRect(0, 0, lv.canvas.width, lv.canvas.height);
              lv.id = liveHere.id;
              lv.key = viewKey;
              lv.frozen = 0;
            }
            prep(g, false);
            const stable = drawPencil(g, liveHere, { from: lv.frozen, to: "stable", core: false });
            g.restore();
            if (stable > lv.frozen) lv.frozen = stable;
            s2.save();
            s2.setTransform(1, 0, 0, 1, 0, 0);
            s2.drawImage(lv.canvas, 0, 0);
            s2.restore();
            s2.save();
            drawPencil(s2, withPred, { from: lv.frozen });
            s2.restore();
          } else drawItem(s2, withPred);
        }
        if (penHere) drawItem(s2, penHere);
        s2.restore();
        out = sc;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = blendOp(layer.blend);
      ctx.drawImage(out, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
    if (layerCanvases.current.size > st.layers.length + 4) {
      for (const id of Array.from(layerCanvases.current.keys())) if (!st.layers.some((l) => l.id === id)) layerCanvases.current.delete(id);
    }

    // eyedropper: read the composited artwork before any overlay is drawn
    const req = sampleReq.current;
    if (req) {
      sampleReq.current = null;
      const px2 = Math.floor(req.sx * dpr);
      const py2 = Math.floor(req.sy * dpr);
      if (px2 >= 0 && py2 >= 0 && px2 < c.width && py2 < c.height) {
        const d = ctx.getImageData(px2, py2, 1, 1).data;
        if (d[3] >= 10) {
          const hex = rgbToHex(d[0], d[1], d[2]);
          if (hex !== (st.colorTarget === "stroke" ? st.primary : st.secondary)) {
            if (st.colorTarget === "stroke") st.setPrimary(hex);else
            st.setSecondary(hex);
          }
        }
      }
    }

    // overlay — drawn in the rotated view frame; X/Y map doc units to zoomed pixels
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(px, py);
    ctx.rotate(rot);
    const acc = colors.current.accent;
    const X = (x: number) => x * zoom;
    const Y = (y: number) => y * zoom;
    if (st.showGrid) {
      const g = st.gridSize;
      if (g * zoom >= 4) {
        ctx.save();
        ctx.lineWidth = 1;
        const n = Math.floor(DOC_W / g);
        const m = Math.floor(DOC_H / g);
        for (const major of [false, true]) {
          ctx.strokeStyle = major ? "rgba(61,139,255,0.38)" : "rgba(61,139,255,0.15)";
          ctx.beginPath();
          for (let i = 1; i <= n; i++) {
            if (i % 4 === 0 !== major) continue;
            const xx = X(i * g);
            ctx.moveTo(xx, 0);
            ctx.lineTo(xx, Y(DOC_H));
          }
          for (let j = 1; j <= m; j++) {
            if (j % 4 === 0 !== major) continue;
            const yy = Y(j * g);
            ctx.moveTo(0, yy);
            ctx.lineTo(X(DOC_W), yy);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    const selIds = new Set(st.selection);
    ctx.lineWidth = 1;
    if (selIds.size) {
      const sel: Item[] = [];
      for (const l of st.layers) for (const it of l.items) if (selIds.has(it.id)) sel.push(it);
      ctx.strokeStyle = acc;
      for (const it of sel) {
        const em = EDIT_TOOLS.has(st.tool) ? editModel(it) : null;
        const anchors = em ? modelSubpaths(em).flatMap((s) => s.nodes) : ANCHOR_TOOLS.has(st.tool) ? anchorsOf(it) : [];
        if (anchors.length) {
          for (const { pts, closed } of outlinesOf(it)) {
            ctx.beginPath();
            pts.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)));
            if (closed) ctx.closePath();
            ctx.stroke();
          }
          if (it.kind === "path") {
            for (const sp of it.subpaths) {
              for (const n of sp.nodes) {
                for (const [hx, hy] of [
                [n.ix, n.iy],
                [n.ox, n.oy]])
                {
                  if (hx === n.x && hy === n.y) continue;
                  ctx.beginPath();
                  ctx.moveTo(X(n.x), Y(n.y));
                  ctx.lineTo(X(hx), Y(hy));
                  ctx.stroke();
                  ctx.beginPath();
                  ctx.arc(X(hx), Y(hy), 3.5, 0, Math.PI * 2);
                  ctx.fillStyle = acc;
                  ctx.fill();
                }
              }
            }
          }
          anchors.forEach((a, i) => {
            const active = hoverAnchor.current?.id === it.id && hoverAnchor.current.idx === i;
            ctx.fillStyle = active ? acc : "#ffffff";
            ctx.fillRect(X(a.x) - 3.5, Y(a.y) - 3.5, 7, 7);
            ctx.strokeRect(X(a.x) - 3.5, Y(a.y) - 3.5, 7, 7);
          });
        } else if (!(sel.length > 1 && isPencilMark(it))) {
          const b = itemBounds(it);
          ctx.setLineDash(sel.length > 1 ? [3, 3] : []);
          ctx.strokeRect(X(b.x), Y(b.y), b.w * zoom, b.h * zoom);
          ctx.setLineDash([]);
        }
      }
      // one box around a pencil layer's sketch group
      const pencilSel = sel.filter((it) => it.kind === "stroke" && isPencilMark(it));
      if (pencilSel.length > 1 && !(st.tool === "transform" || st.tool === "select" || st.tool === "move")) {
        const pb = unionBounds(pencilSel)!;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(X(pb.x), Y(pb.y), pb.w * zoom, pb.h * zoom);
        ctx.setLineDash([]);
      }
      // live-corner widgets: drag the little circle to round a sharp corner
      if (st.tool === "direct" || st.tool === "penConvert") {
        for (const it of sel) {
          const cm = editModel(it);
          if (!cm || cm.kind !== "path") continue;
          for (const w of cornerWidgets(cm.item)) {
            const cx = X(w.x) + w.b.x * CORNER_OFFSET;
            const cy = Y(w.y) + w.b.y * CORNER_OFFSET;
            ctx.beginPath();
            ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = "#ffffff";
            ctx.fill();
            ctx.strokeStyle = acc;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(cx, cy, 1.6, 0, Math.PI * 2);
            ctx.fillStyle = acc;
            ctx.fill();
          }
        }
      }
      const u = unionBounds(sel);
      const dr = drag.current;
      if (dr?.type === "corner" && dr.moved) {
        const label = `R ${Math.round(dr.r)} px`;
        const lp = toDoc(pointer.current.sx, pointer.current.sy);
        ctx.font = "11px 'JetBrains Mono', monospace";
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = acc;
        ctx.fillRect(X(lp.x) + 12, Y(lp.y) - 22, tw + 10, 18);
        ctx.fillStyle = "#0f0f12";
        ctx.fillText(label, X(lp.x) + 17, Y(lp.y) - 9);
      }
      if (dr?.type === "rotate") {
        const b = dr.box;
        const corners = [
        [b.x, b.y],
        [b.x + b.w, b.y],
        [b.x + b.w, b.y + b.h],
        [b.x, b.y + b.h]].
        map(([x, y]) => rotPt(x, y, dr.cx, dr.cy, dr.angle));
        ctx.beginPath();
        corners.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)));
        ctx.closePath();
        ctx.stroke();
        const top = rotPt(b.x + b.w / 2, b.y, dr.cx, dr.cy, dr.angle);
        const ux = Math.sin(dr.angle);
        const uy = -Math.cos(dr.angle);
        const hx = X(top.x) + ux * ROT_OFFSET;
        const hy = Y(top.y) + uy * ROT_OFFSET;
        ctx.beginPath();
        ctx.moveTo(X(top.x), Y(top.y));
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hx, hy, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = acc;
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(X(dr.cx), Y(dr.cy), 3, 0, Math.PI * 2);
        ctx.stroke();
        let deg = Math.round(dr.angle * 180 / Math.PI) % 360;
        if (deg > 180) deg -= 360;
        if (deg < -180) deg += 360;
        const label = `${deg}°`;
        ctx.font = "11px 'JetBrains Mono', monospace";
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = acc;
        ctx.fillRect(hx + 10, hy - 9, tw + 10, 18);
        ctx.fillStyle = "#0f0f12";
        ctx.fillText(label, hx + 15, hy + 4);
      } else if (u && (st.tool === "transform" || st.tool === "select" || st.tool === "move")) {
        ctx.strokeRect(X(u.x), Y(u.y), u.w * zoom, u.h * zoom);
        const tx = X(u.x + u.w / 2);
        const ty = Y(u.y);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx, ty - ROT_OFFSET);
        ctx.stroke();
        for (const [hx, hy] of [
        [u.x, u.y],
        [u.x + u.w, u.y],
        [u.x + u.w, u.y + u.h],
        [u.x, u.y + u.h]])
        {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(X(hx) - 4, Y(hy) - 4, 8, 8);
          ctx.strokeRect(X(hx) - 4, Y(hy) - 4, 8, 8);
        }
        ctx.beginPath();
        ctx.arc(tx, ty - ROT_OFFSET, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tx, ty - ROT_OFFSET, 2, 0, Math.PI * 2);
        ctx.fillStyle = acc;
        ctx.fill();
      }
    }

    // anchor tools: hover preview (outline, anchors, add point, target anchor)
    const he = hoverEdit.current;
    if (he && EDIT_TOOLS.has(st.tool) && !drag.current) {
      let hit: Item | undefined;
      for (const l of st.layers) {
        hit = l.items.find((i) => i.id === he.id);
        if (hit) break;
      }
      const hm = hit ? editModel(hit) : null;
      if (hit && hm) {
        ctx.strokeStyle = acc;
        ctx.lineWidth = 1;
        if (!selIds.has(hit.id)) {
          for (const { pts, closed } of modelOutlines(hm)) {
            ctx.beginPath();
            pts.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)));
            if (closed) ctx.closePath();
            ctx.stroke();
          }
          for (const sp of modelSubpaths(hm)) {
            for (const n of sp.nodes) {
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(X(n.x) - 3.5, Y(n.y) - 3.5, 7, 7);
              ctx.strokeRect(X(n.x) - 3.5, Y(n.y) - 3.5, 7, 7);
            }
          }
        }
        if (he.node) {
          const n = modelSubpaths(hm)[he.node.sub]?.nodes[he.node.idx];
          if (n) {
            ctx.fillStyle = st.tool === "penDelete" ? colors.current.primary : acc;
            ctx.fillRect(X(n.x) - 5, Y(n.y) - 5, 10, 10);
            ctx.strokeStyle = "#ffffff";
            ctx.strokeRect(X(n.x) - 5, Y(n.y) - 5, 10, 10);
          }
        } else if (he.add) {
          const ax = X(he.add.x);
          const ay = Y(he.add.y);
          ctx.beginPath();
          ctx.arc(ax, ay, 6, 0, Math.PI * 2);
          ctx.fillStyle = acc;
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.beginPath();
          ctx.moveTo(ax - 3, ay);
          ctx.lineTo(ax + 3, ay);
          ctx.moveTo(ax, ay - 3);
          ctx.lineTo(ax, ay + 3);
          ctx.stroke();
        }
      }
    }

    // pen: anchors, handles and rubber-band preview
    const pn = pen.current;
    if (pn) {
      const nodes = pn.item.subpaths[0].nodes;
      ctx.strokeStyle = acc;
      ctx.lineWidth = 1;
      const last = nodes[nodes.length - 1];
      const hov = penHover.current;
      if (hov && last && drag.current?.type !== "pen") {
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(X(last.x), Y(last.y));
        ctx.bezierCurveTo(X(last.ox), Y(last.oy), X(hov.x), Y(hov.y), X(hov.x), Y(hov.y));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      tracePathScaled(ctx, nodes, pn.item.subpaths[0].closed, zoom);
      ctx.stroke();
      const shown = pn.closing ? [nodes[0], last] : [last];
      for (const n of shown) {
        if (!n) continue;
        for (const [hx, hy] of [
        [n.ix, n.iy],
        [n.ox, n.oy]])
        {
          if (hx === n.x && hy === n.y) continue;
          ctx.beginPath();
          ctx.moveTo(X(n.x), Y(n.y));
          ctx.lineTo(X(hx), Y(hy));
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(X(hx), Y(hy), 3.5, 0, Math.PI * 2);
          ctx.fillStyle = acc;
          ctx.fill();
        }
      }
      nodes.forEach((n, i) => {
        const isLast = i === nodes.length - 1;
        ctx.fillStyle = isLast ? acc : "#ffffff";
        ctx.fillRect(X(n.x) - 3.5, Y(n.y) - 3.5, 7, 7);
        ctx.strokeRect(X(n.x) - 3.5, Y(n.y) - 3.5, 7, 7);
      });
      if (hov && nodes.length >= 2) {
        const f = toScreen(nodes[0].x, nodes[0].y);
        const h = toScreen(hov.x, hov.y);
        if (Math.hypot(f.x - h.x, f.y - h.y) <= 9) {
          ctx.beginPath();
          ctx.arc(X(nodes[0].x), Y(nodes[0].y), 7, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // v1.0.4 Join: picked end anchors (orange) and the other open ends you can tap (rings)
    const picks = endsRef.current;
    if (picks.length && st.tool === "direct") {
      if (picks.length === 1) {
        ctx.strokeStyle = acc;
        for (const oe of allOpenEnds()) {
          if (sameEnd(oe, picks[0])) continue;
          ctx.beginPath();
          ctx.arc(X(oe.x), Y(oe.y), 5, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
          ctx.stroke();
        }
      }
      for (const pe of picks) {
        const q = endPoint(pe);
        if (!q) continue;
        ctx.fillStyle = colors.current.primary;
        ctx.fillRect(X(q.x) - 5, Y(q.y) - 5, 10, 10);
        ctx.strokeStyle = "#ffffff";
        ctx.strokeRect(X(q.x) - 5, Y(q.y) - 5, 10, 10);
      }
    }
    // pen hovering an open end: click to continue (or join) that path
    const peh = penEndHover.current;
    if (peh && st.tool === "pen" && !drag.current) {
      ctx.strokeStyle = acc;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(X(peh.x), Y(peh.y), 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = acc;
      ctx.fillRect(X(peh.x) - 3, Y(peh.y) - 3, 6, 6);
      ctx.lineWidth = 1;
    }

    const d = drag.current;
    if (d?.type === "marquee") {
      const x = Math.min(d.x0, d.x1);
      const y = Math.min(d.y0, d.y1);
      ctx.fillStyle = "rgba(61,139,255,0.08)";
      ctx.fillRect(X(x), Y(y), Math.abs(d.x1 - d.x0) * zoom, Math.abs(d.y1 - d.y0) * zoom);
      ctx.strokeStyle = acc;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(X(x), Y(y), Math.abs(d.x1 - d.x0) * zoom, Math.abs(d.y1 - d.y0) * zoom);
      ctx.setLineDash([]);
    }
    const gd = guides.current;
    if (gd && d?.type === "move") {
      ctx.save();
      ctx.strokeStyle = "#d65cd8";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const gx of gd.v) {
        ctx.moveTo(X(gx), Y(-40 / zoom));
        ctx.lineTo(X(gx), Y(DOC_H + 40 / zoom));
      }
      for (const gy of gd.h) {
        ctx.moveTo(X(-40 / zoom), Y(gy));
        ctx.lineTo(X(DOC_W + 40 / zoom), Y(gy));
      }
      ctx.stroke();
      ctx.restore();
    }
    if (d?.type === "lasso" && d.pts.length > 1) {
      ctx.beginPath();
      d.pts.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)));
      ctx.closePath();
      ctx.fillStyle = "rgba(61,139,255,0.08)";
      ctx.fill();
      ctx.strokeStyle = acc;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // cursors (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pt = pointer.current;
    if (pt.inside && !space.current && !gesture.current && st.tool === "eyedropper") {
      ctx.beginPath();
      ctx.arc(pt.sx, pt.sy, 16, 0, Math.PI * 2);
      ctx.lineWidth = 8;
      ctx.strokeStyle = st.primary;
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath();
      ctx.arc(pt.sx, pt.sy, 20.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(pt.sx, pt.sy, 11.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.moveTo(pt.sx - 5, pt.sy);
      ctx.lineTo(pt.sx + 5, pt.sy);
      ctx.moveTo(pt.sx, pt.sy - 5);
      ctx.lineTo(pt.sx, pt.sy + 5);
      ctx.stroke();
    }
    if (pt.inside && !space.current && !gesture.current && (st.tool === "brush" || st.tool === "eraser")) {
      const sz = st.tool === "eraser" ? st.eraserSize : st.currentBrush.size;
      const r = Math.max(1.5, sz * zoom / 2);
      ctx.beginPath();
      ctx.arc(pt.sx, pt.sy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.strokeStyle = st.tool === "eraser" ? colors.current.primary : "rgba(255,255,255,0.95)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillRect(pt.sx - 1, pt.sy - 1, 2, 2);
    }
  };

  /* ---------- pressure ---------- */
  const pressureFor = (ev: PointerEvent, sx: number, sy: number) => {
    const ps = pressureState.current;
    if (ev.pointerType === "pen") return clamp(ev.pressure || 0.02, 0.02, 1);
    if (ev.pointerType === "touch" && ev.pressure > 0 && ev.pressure !== 0.5) return clamp(ev.pressure, 0.02, 1);
    if (!S.current.simulatePressure) return 0.7;
    const dt = Math.max(1, ev.timeStamp - ps.lastT);
    const v = Math.hypot(sx - ps.lastX, sy - ps.lastY) / dt;
    ps.lastT = ev.timeStamp;
    ps.lastX = sx;
    ps.lastY = sy;
    const target = clamp(1.05 - v * 0.32, 0.15, 1);
    ps.p += (target - ps.p) * 0.18;
    return ps.p;
  };

  const addPoint = (ev: PointerEvent) => {
    const it = live.current;
    if (!it || it.kind !== "stroke" && it.kind !== "erase") return;
    const { sx, sy, x, y } = locate(ev.clientX, ev.clientY);
    const p = it.kind === "stroke" ? pressureFor(ev, sx, sy) : 1;
    const last = it.points[it.points.length - 1];
    rawLast.current = { x, y, p };
    // v1.0.4: Mono Liner follows the pen closely — light smoothing only, so drawn corners stay corners
    const sb = it.kind === "stroke" && it.brush === "vector-fixed" ? S.current.stabilizer * 0.3 : S.current.stabilizer;
    const k = 1 - sb * 0.85;
    const nx = last.x + (x - last.x) * k;
    const ny = last.y + (y - last.y) * k;
    if (Math.hypot(nx - last.x, ny - last.y) < 0.35 / S.current.view.zoom) return;
    it.points.push({ x: nx, y: ny, p });
  };

  /** Ids of the element an item belongs to: a pencil stroke selects its whole layer's sketch. */
  const groupOf = (id: string, layerId?: string) => {
    for (const l of S.current.layers) {
      if (layerId && l.id !== layerId) continue;
      const it = l.items.find((i) => i.id === id);
      if (!it) continue;
      if (it.group) {
        const g = it.group;
        const out: string[] = [];
        for (const ll of S.current.layers) for (const i of ll.items) if (i.group === g && !i.hidden) out.push(i.id);
        return out;
      }
      if (l.type === "pencil" && it.kind === "stroke" && isPencilMark(it)) return l.items.filter((i) => isPencilMark(i) && !i.hidden).map((i) => i.id);
      return [id];
    }
    return [id];
  };

  const expandGroups = (ids: string[]) => {
    const out = new Set(ids);
    const groups = new Set<string>();
    for (const l of S.current.layers) for (const i of l.items) if (out.has(i.id) && i.group) groups.add(i.group);
    if (groups.size) for (const l of S.current.layers) for (const i of l.items) if (i.group && groups.has(i.group) && !i.hidden) out.add(i.id);
    for (const l of S.current.layers) {
      if (l.type !== "pencil") continue;
      if (!l.items.some((i) => out.has(i.id) && i.kind === "stroke" && isPencilMark(i))) continue;
      for (const i of l.items) if (isPencilMark(i) && !i.hidden) out.add(i.id);
    }
    return Array.from(out);
  };

  const cornerHit = (sx: number, sy: number) => {
    const zoom = S.current.view.zoom;
    for (const it of selectedItems()) {
      const cm = editModel(it);
      if (!cm || cm.kind !== "path") continue;
      for (const w of cornerWidgets(cm.item)) {
        if (near(w.x + w.b.x * CORNER_OFFSET / zoom, w.y + w.b.y * CORNER_OFFSET / zoom, sx, sy, 8)) return { id: it.id, sub: w.sub, idx: w.idx, orig: cm.item };
      }
    }
    return null;
  };

  const selectedItems = () => {
    const ids = new Set(S.current.selection);
    const out: Item[] = [];
    for (const l of S.current.layers) for (const it of l.items) if (ids.has(it.id)) out.push(it);
    return out;
  };

  const near = (x: number, y: number, sx: number, sy: number, r: number) => {
    const p = toScreen(x, y);
    return Math.hypot(p.x - sx, p.y - sy) <= r;
  };

  const handleHit = (sx: number, sy: number) => {
    const u = unionBounds(selectedItems());
    if (!u) return null;
    const corners = [
    [u.x, u.y],
    [u.x + u.w, u.y],
    [u.x + u.w, u.y + u.h],
    [u.x, u.y + u.h]];

    for (let i = 0; i < 4; i++) {
      const [cx, cy] = corners[i];
      if (near(cx, cy, sx, sy, 7)) {
        const [ax, ay] = corners[(i + 2) % 4];
        return { hx: cx, hy: cy, ax, ay };
      }
    }
    return null;
  };

  const rotHit = (sx: number, sy: number) => {
    const u = unionBounds(selectedItems());
    if (!u) return null;
    const top = toScreen(u.x + u.w / 2, u.y);
    const r = S.current.view.rot;
    const hx = top.x + Math.sin(r) * ROT_OFFSET;
    const hy = top.y - Math.cos(r) * ROT_OFFSET;
    if (Math.hypot(hx - sx, hy - sy) <= 9) return u;
    return null;
  };

  const anchorHit = (sx: number, sy: number) => {
    for (const it of selectedItems()) {
      const anchors = anchorsOf(it);
      for (let i = 0; i < anchors.length; i++) {
        if (near(anchors[i].x, anchors[i].y, sx, sy, 6)) return { id: it.id, idx: i, orig: it };
      }
    }
    return null;
  };

  const bezierHandleHit = (sx: number, sy: number) => {
    for (const it of selectedItems()) {
      if (it.kind !== "path") continue;
      for (let s = 0; s < it.subpaths.length; s++) {
        const nodes = it.subpaths[s].nodes;
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if ((n.ox !== n.x || n.oy !== n.y) && near(n.ox, n.oy, sx, sy, 6)) return { id: it.id, sub: s, idx: i, which: "out" as const, orig: it };
          if ((n.ix !== n.x || n.iy !== n.y) && near(n.ix, n.iy, sx, sy, 6)) return { id: it.id, sub: s, idx: i, which: "in" as const, orig: it };
        }
      }
    }
    return null;
  };

  /** Topmost editable vector item under the cursor (selected items win). */
  const findEditable = (x: number, y: number, tol: number) => {
    const st = S.current;
    const sel = new Set(st.selection);
    let fallback: {item: Item;layerId: string;} | null = null;
    for (let li = st.layers.length - 1; li >= 0; li--) {
      const l = st.layers[li];
      if (!l.visible || l.locked) continue;
      for (let i = l.items.length - 1; i >= 0; i--) {
        const it = l.items[i];
        const m = editModel(it);
        if (!m) continue;
        const onAnchor = modelSubpaths(m).some((sp) => sp.nodes.some((n) => Math.hypot(n.x - x, n.y - y) <= tol * 1.6));
        const onLine = modelNearest(m, x, y).dist <= tol + modelHalfWidth(m);
        if (!onAnchor && !onLine && !(m.kind === "path" && m.item.fill && hitItem(m.item, x, y, 0))) continue;
        if (sel.has(it.id)) return { item: it, layerId: l.id };
        if (!fallback) fallback = { item: it, layerId: l.id };
      }
    }
    return fallback;
  };

  const nodeAtScreen = (m: EditModel, sx: number, sy: number) => {
    const subs = modelSubpaths(m);
    for (let s = 0; s < subs.length; s++) {
      const nodes = subs[s].nodes;
      for (let i = 0; i < nodes.length; i++) if (near(nodes[i].x, nodes[i].y, sx, sy, 7)) return { sub: s, idx: i };
    }
    return null;
  };

  const handleAtScreen = (p: PathItem, sx: number, sy: number) => {
    for (let s = 0; s < p.subpaths.length; s++) {
      const nodes = p.subpaths[s].nodes;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if ((n.ox !== n.x || n.oy !== n.y) && near(n.ox, n.oy, sx, sy, 6)) return { sub: s, idx: i, which: "out" as const };
        if ((n.ix !== n.x || n.iy !== n.y) && near(n.ix, n.iy, sx, sy, 6)) return { sub: s, idx: i, which: "in" as const };
      }
    }
    return null;
  };

  /* ---------- v1.0.4: open-path ends (pen continue + Join) ---------- */
  const findItem = (id: string) => {
    for (const l of S.current.layers) {
      const item = l.items.find((i) => i.id === id);
      if (item) return { item, layerId: l.id };
    }
    return null;
  };

  /** Open-path end anchors on visible, unlocked vector layers (cached per document state). */
  const allOpenEnds = (): OpenEnd[] => {
    const ls = S.current.layers;
    const cached = endsCache.current;
    if (cached && cached.layers === ls) return cached.list;
    const list: OpenEnd[] = [];
    for (const l of ls) {
      if (!l.visible || l.locked || l.type !== "vector") continue;
      for (const it of l.items) {
        const p = asJoinablePath(it);
        if (p) for (const oe of openEnds(p)) list.push({ ...oe, layerId: l.id });
      }
    }
    endsCache.current = { layers: ls, list };
    return list;
  };

  const openEndAt = (sx: number, sy: number, skip: Set<string> | null) => {
    let best: OpenEnd | null = null;
    let bd = 10;
    for (const oe of allOpenEnds()) {
      if (skip?.has(oe.id)) continue;
      const p = toScreen(oe.x, oe.y);
      const dd = Math.hypot(p.x - sx, p.y - sy);
      if (dd < bd) {
        bd = dd;
        best = oe;
      }
    }
    return best;
  };

  const endPoint = (pe: PathEnd) => {
    const f = findItem(pe.id);
    const p = f ? asJoinablePath(f.item) : null;
    const sp = p?.subpaths[pe.sub];
    if (!sp || sp.closed || !sp.nodes.length) return null;
    return pe.end === 0 ? sp.nodes[0] : sp.nodes[sp.nodes.length - 1];
  };

  const sameEnd = (a: PathEnd, b: PathEnd) => a.id === b.id && a.sub === b.sub && a.end === b.end;

  const pickEnd = (pe: PathEnd) => {
    const cur = endsRef.current;
    const next = cur.some((c) => sameEnd(c, pe)) ? cur.filter((c) => !sameEnd(c, pe)) : [...cur, pe].slice(-2);
    setEnds(next);
    const st = S.current;
    if (!st.selection.includes(pe.id)) st.setSelection([...st.selection, pe.id]);
    st.flash(next.length === 2 ? "2 end anchors picked · tap Join (Ctrl J)" : next.length === 1 ? "End anchor picked · tap a second end anchor, then Join" : "End anchor un-picked");
  };

  /** Map a flat anchor index (anchorsOf) to an open end, if it is one. */
  const flatToEnd = (it: Item, flat: number): PathEnd | null => {
    const p = asJoinablePath(it);
    if (!p) return null;
    let k = flat;
    for (let s = 0; s < p.subpaths.length; s++) {
      const sp = p.subpaths[s];
      const n = sp.nodes.length;
      if (k < n) return sp.closed ? null : k === 0 ? { id: it.id, sub: s, end: 0 } : k === n - 1 ? { id: it.id, sub: s, end: 1 } : null;
      k -= n;
    }
    return null;
  };

  /** What Join acts on: the two picked end anchors, else the selection (1 open path closes, 2 paths meet at their nearest ends). */
  const joinPair = (): [PathEnd, PathEnd] | null => {
    const picks = endsRef.current;
    if (picks.length === 2) return [picks[0], picks[1]];
    const st = S.current;
    if (!st.selection.length || st.selection.length > 2) return null;
    const sel = new Set(st.selection);
    const paths: PathItem[] = [];
    for (const l of st.layers) for (const it of l.items) {
      if (!sel.has(it.id) || it.kind === "erase") continue;
      const p = asJoinablePath(it);
      if (!p) return null;
      paths.push(p);
    }
    if (paths.length === 1) {
      const s = paths[0].subpaths.findIndex((sp) => !sp.closed && sp.nodes.length >= 3);
      return s >= 0 ? [{ id: paths[0].id, sub: s, end: 0 }, { id: paths[0].id, sub: s, end: 1 }] : null;
    }
    if (paths.length === 2) {
      let best: [PathEnd, PathEnd] | null = null;
      let bd = Infinity;
      for (const a of openEnds(paths[0])) for (const b of openEnds(paths[1])) {
        const dd = Math.hypot(a.x - b.x, a.y - b.y);
        if (dd < bd) {
          bd = dd;
          best = [{ id: a.id, sub: a.sub, end: a.end }, { id: b.id, sub: b.sub, end: b.end }];
        }
      }
      return best;
    }
    return null;
  };

  const joinSelection = () => {
    const st = S.current;
    const pair = joinPair();
    if (!pair) return st.flash("Join: tap two end anchors with Direct Selection (A), or select 1–2 open paths");
    const [a, b] = pair;
    const fa = findItem(a.id);
    const fb = findItem(b.id);
    if (!fa || !fb) return setEnds([]);
    if (!editableId(fa.layerId) || !editableId(fb.layerId)) return;
    const pa = asJoinablePath(fa.item);
    const pb = a.id === b.id ? pa : asJoinablePath(fb.item);
    if (!pa || !pb) return st.flash("Those anchors can't be joined");
    const res = joinEnds(pa, a, pb, b);
    if (!res) return st.flash("Pick two different open end anchors");
    st.commit((ls) =>
    ls.map((l) =>
    l.items.some((i) => i.id === pa.id || i.id === res.removeId) ?
    { ...l, items: l.items.filter((i) => i.id !== res.removeId).map((i) => i.id === pa.id ? res.item : i) } :
    l
    )
    );
    setEnds([]);
    st.setSelection([res.item.id]);
    st.flash(res.removeId ? "Joined into one path" : a.id === b.id && a.sub === b.sub ? "Path closed" : "Joined");
  };
  const joinRef = useRef(joinSelection);
  joinRef.current = joinSelection;

  const replaceWith = (id: string, next: Item | null) => {
    const st = S.current;
    st.commit((ls) =>
    ls.map((l) =>
    l.items.some((i) => i.id === id) ?
    { ...l, items: next ? l.items.map((i) => i.id === id ? next : i) : l.items.filter((i) => i.id !== id) } :
    l
    )
    );
    if (!next) st.setSelection(st.selection.filter((s) => s !== id));
  };

  const updateHoverEdit = (sx: number, sy: number, x: number, y: number) => {
    const st = S.current;
    const found = findEditable(x, y, 6 / st.view.zoom);
    if (!found) return hoverEdit.current = null;
    const m = editModel(found.item)!;
    const node = st.tool === "penAdd" ? null : nodeAtScreen(m, sx, sy);
    let add: XY | null = null;
    if (st.tool === "penAdd" && !nodeAtScreen(m, sx, sy)) {
      const seg = modelNearest(m, x, y);
      if (seg.sub >= 0 && seg.dist * st.view.zoom <= 8 + modelHalfWidth(m) * st.view.zoom) add = seg.pt;
    }
    hoverEdit.current = { id: found.item.id, add, node };
  };

  const editableId = (id: string) => {
    const st = S.current;
    const layer = st.layers.find((l) => l.id === id);
    if (!layer) return true; // just created by ensureLayer
    if (layer.locked) return st.flash(`“${layer.name}” is locked`), false;
    if (!layer.visible) return st.flash(`“${layer.name}” is hidden`), false;
    return true;
  };

  const target = (type: LayerType | null) => {
    const st = S.current;
    const id = type ? st.ensureLayer(type) : st.activeLayerId;
    return editableId(id) ? id : null;
  };

  const doFill = (x: number, y: number) => {
    const st = S.current;
    const layerId = target("vector");
    if (!layerId) return;
    const doc = renderDoc(st.layers, 1, true);
    const img = doc.getContext("2d")!.getImageData(0, 0, DOC_W, DOC_H);
    const mask = floodMask(img, Math.floor(x), Math.floor(y), st.fillTolerance);
    if (!mask) return;
    const subpaths = traceMask(mask);
    if (!subpaths.length) return;
    const item: PathItem = { id: uid("f"), kind: "path", subpaths, stroke: null, size: 0, fill: st.primary, opacity: 1, evenOdd: true };
    st.commit((ls) => ls.map((l) => l.id === layerId ? { ...l, items: [...l.items, item] } : l));
    st.flash(`Live paint · filled shape with ${subpaths.length} path${subpaths.length === 1 ? "" : "s"}`);
  };

  const sample = (sx: number, sy: number) => {
    sampleReq.current = { sx, sy };
    dirty.current = true;
  };

  /* ---------- touch gestures: two fingers pinch-zoom + rotate + pan ---------- */
  const gestureMetrics = () => {
    const [a, b] = Array.from(touches.current.values());
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), ang: Math.atan2(b.y - a.y, b.x - a.x) };
  };

  const startGesture = () => {
    // a second finger cancels whatever the first finger started
    setDrawing(false);
    if (drag.current?.type === "draw" || drag.current?.type === "shape") live.current = null;
    if (drag.current?.type === "pen" && drag.current.mode === "new" && pen.current) {
      const nodes = penNodes();
      if (!pen.current.closing) nodes.pop();
      pen.current.closing = false;
      pen.current.item.subpaths[0].closed = false;
      if (!nodes.length) pen.current = null;
    }
    drag.current = null;
    setPanning(false);
    predicted.current = [];
    const m = gestureMetrics();
    gesture.current = { m0x: m.mx, m0y: m.my, d0: m.d, a0: m.ang, v0: { ...S.current.view } };
    dirty.current = true;
  };

  const updateGesture = () => {
    const g = gesture.current;
    if (!g || touches.current.size < 2) return;
    const m = gestureMetrics();
    const zoom = clamp(g.v0.zoom * (m.d / g.d0), 0.1, 16);
    const k = zoom / g.v0.zoom;
    let rot = g.v0.rot + (m.ang - g.a0);
    const snap = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(rot - snap) < 0.07) rot = snap;
    const delta = rot - g.v0.rot;
    const c = Math.cos(delta);
    const s = Math.sin(delta);
    const tx = g.v0.x - g.m0x;
    const ty = g.v0.y - g.m0y;
    S.current.setView({ zoom, rot, x: m.mx + k * (tx * c - ty * s), y: m.my + k * (tx * s + ty * c) });
  };

  /* ---------- pointer handlers ---------- */
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 2) return;
    const st = S.current;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { sx, sy, x, y } = locate(e.clientX, e.clientY);

    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, { x: sx, y: sy });
      if (touches.current.size === 2) return startGesture();
      if (touches.current.size > 2 || gesture.current) return;
    }

    const zoom = st.view.zoom;
    if (e.button === 1 || space.current || st.tool === "hand") {
      drag.current = { type: "pan", sx, sy, vx: st.view.x, vy: st.view.y };
      setPanning(true);
      return;
    }
    let tool = st.tool;
    if (e.altKey && (tool === "brush" || tool === "fill")) tool = "eyedropper";
    const tol = 5 / zoom;
    const tryHandles = () => {
      if (!st.selection.length) return false;
      const rb = rotHit(sx, sy);
      if (rb) {
        const orig = new Map<string, Item>();
        for (const it of selectedItems()) orig.set(it.id, it);
        const cx = rb.x + rb.w / 2;
        const cy = rb.y + rb.h / 2;
        drag.current = { type: "rotate", cx, cy, a0: Math.atan2(y - cy, x - cx), angle: 0, box: rb, orig, moved: false };
        return true;
      }
      const h = handleHit(sx, sy);
      if (h) {
        const orig = new Map<string, Item>();
        for (const it of selectedItems()) orig.set(it.id, it);
        drag.current = { type: "scale", ...h, orig, moved: false };
        return true;
      }
      return false;
    };
    const startMarquee = () => {
      if (!e.shiftKey) st.setSelection([]);
      drag.current = { type: "marquee", x0: x, y0: y, x1: x, y1: y, additive: e.shiftKey, base: e.shiftKey ? st.selection : [] };
    };
    const pickOrMarquee = () => {
      const hit = hitTop(st.layers, x, y, tol);
      if (hit) {
        let sel = st.selection;
        const id = hit.item.id;
        const g = groupOf(id, hit.layerId);
        if (e.shiftKey) sel = sel.includes(id) ? sel.filter((i) => !g.includes(i)) : Array.from(new Set([...sel, ...g]));else
        if (!sel.includes(id)) sel = g;
        st.setSelection(sel);
        st.setActiveLayerId(hit.layerId);
        if (sel.includes(id)) drag.current = { type: "move", lx: x, ly: y, ids: new Set(sel), moved: false };
      } else startMarquee();
    };

    switch (tool) {
      case "brush":{
          const layerId = target(isVectorBrush(st.brushId) ? "vector" : "pencil");
          if (!layerId) return;
          liveLayer.current = layerId;
          Object.assign(pressureState.current, { p: 0.3, lastT: e.timeStamp, lastX: sx, lastY: sy });
          const p = pressureFor(e.nativeEvent, sx, sy);
          const b = st.currentBrush;
          live.current = {
            id: uid("s"),
            kind: "stroke",
            brush: st.brushId,
            color: st.primary,
            size: b.size,
            opacity: b.opacity,
            points: [{ x, y, p }],
            seed: Math.floor(Math.random() * 1e9)
          };
          rawLast.current = { x, y, p };
          setDrawing(true);
          drag.current = { type: "draw" };
          break;
        }
      case "eraser":{
          const layerId = target(null);
          if (!layerId) return;
          liveLayer.current = layerId;
          live.current = { id: uid("e"), kind: "erase", size: st.eraserSize, points: [{ x, y, p: 1 }] };
          setDrawing(true);
          drag.current = { type: "draw" };
          break;
        }
      case "line":
      case "rect":
      case "ellipse":{
          const layerId = target("vector");
          if (!layerId) return;
          liveLayer.current = layerId;
          live.current = {
            id: uid("sh"),
            kind: "shape",
            shape: tool,
            points: shapePoints(tool, x, y, x, y, false),
            color: st.primary,
            size: st.strokeEnabled ? st.shapeStroke : 0,
            opacity: 1,
            fill: st.shapeFill && tool !== "line" ? st.secondary : null
          };
          drag.current = { type: "shape", x0: snapPt(x, y).x, y0: snapPt(x, y).y };
          break;
        }
      case "pen":{
          const pn = pen.current;
          if (!pn) {
            // v1.0.4: starting on the end of an open path keeps drawing that same path
            const oe = openEndAt(sx, sy, null);
            const src = oe ? findItem(oe.id) : null;
            const sp0 = src ? asJoinablePath(src.item) : null;
            if (oe && src && sp0 && editableId(src.layerId)) {
              const run = oe.end === 0 ? reverseSub(sp0.subpaths[oe.sub]) : sp0.subpaths[oe.sub];
              const subpaths = [{ closed: false, nodes: run.nodes.map((n) => ({ ...n })) }, ...sp0.subpaths.filter((_, i) => i !== oe.sub)];
              pen.current = { layerId: src.layerId, closing: false, origId: sp0.id, absorb: [], item: { ...sp0, subpaths } };
              penEndHover.current = null;
              st.setSelection([]);
              st.setActiveLayerId(src.layerId);
              st.flash("Continuing the path · click to add anchors · Enter finishes");
              drag.current = { type: "pen", mode: "out", moved: false, hadOut: true };
              break;
            }
            const layerId = target("vector");
            if (!layerId) return;
            pen.current = {
              layerId,
              closing: false,
              absorb: [],
              item: {
                id: uid("p"),
                kind: "path",
                subpaths: [{ closed: false, nodes: [cornerNode(snapPt(x, y).x, snapPt(x, y).y)] }],
                stroke: st.strokeEnabled && st.shapeStroke > 0 ? st.primary : null,
                size: st.shapeStroke,
                fill: st.shapeFill ? st.secondary : null,
                opacity: 1
              }
            };
            if (!pen.current.item.stroke && !pen.current.item.fill) pen.current.item.stroke = st.primary, pen.current.item.size = 1;
            drag.current = { type: "pen", mode: "new", moved: false, hadOut: false };
            break;
          }
          const nodes = pn.item.subpaths[0].nodes;
          const first = nodes[0];
          const last = nodes[nodes.length - 1];
          if (nodes.length >= 2 && near(first.x, first.y, sx, sy, 9)) {
            pn.item.subpaths[0].closed = true;
            pn.closing = true;
            drag.current = { type: "pen", mode: "new", moved: false, hadOut: false };
            break;
          }
          if (near(last.x, last.y, sx, sy, 9)) {
            // v1.0.4: clicking the last anchor cuts its outgoing handle (the incoming curve stays) and the
            // path keeps going; dragging from it pulls a new one-sided handle. Click a corner end to finish.
            const hadOut = last.ox !== last.x || last.oy !== last.y;
            last.ox = last.x;
            last.oy = last.y;
            if (hadOut) st.flash("Handle cut · keep clicking to continue the path · drag the anchor for a new handle");
            drag.current = { type: "pen", mode: "out", moved: false, hadOut };
            break;
          }
          // v1.0.4: clicking the end of another open path joins it onto this one
          const oe = openEndAt(sx, sy, new Set([pn.item.id, ...pn.absorb]));
          const src = oe ? findItem(oe.id) : null;
          const other = src ? asJoinablePath(src.item) : null;
          if (oe && src && other && editableId(src.layerId)) {
            const run = oe.end === 1 ? reverseSub(other.subpaths[oe.sub]) : other.subpaths[oe.sub];
            const add = run.nodes.map((n) => ({ ...n }));
            if (Math.hypot(add[0].x - last.x, add[0].y - last.y) < 0.75) {
              last.ox = add[0].ox;
              last.oy = add[0].oy;
              add.shift();
            }
            nodes.push(...add);
            pn.item.subpaths.push(...other.subpaths.filter((_, i) => i !== oe.sub));
            pn.absorb.push(other.id);
            penEndHover.current = null;
            st.flash("Joined to that path · keep drawing or press Enter");
            break;
          }
          nodes.push(cornerNode(snapPt(x, y).x, snapPt(x, y).y));
          drag.current = { type: "pen", mode: "new", moved: false, hadOut: false };
          break;
        }
      case "penAdd":
      case "penDelete":
      case "penConvert":{
          if (tool === "penConvert") {
            const ch = cornerHit(sx, sy);
            if (ch) {
              drag.current = { type: "corner", ...ch, moved: false, r: 0 };
              break;
            }
          }
          if (tool === "penConvert") {
            // handles can sit away from the path, so check the selected paths' handles first
            let grabbed = false;
            for (const it of selectedItems()) {
              const em = editModel(it);
              const sp = em?.kind === "path" ? em.item : null;
              const h = sp && handleAtScreen(sp, sx, sy);
              if (sp && h) {
                drag.current = { type: "handle", id: it.id, ...h, orig: sp, moved: false, free: true };
                grabbed = true;
                break;
              }
            }
            if (grabbed) break;
          }
          const found = findEditable(x, y, tol);
          if (!found) {
            if (!e.shiftKey) st.setSelection([]);
            break;
          }
          const { item, layerId } = found;
          const m = editModel(item)!;
          st.setSelection([item.id]);
          st.setActiveLayerId(layerId);
          if (tool === "penAdd") {
            if (nodeAtScreen(m, sx, sy)) break;
            const seg = modelNearest(m, x, y);
            if (seg.sub < 0 || seg.dist * zoom > 8 + modelHalfWidth(m) * zoom) break;
            replaceWith(item.id, modelInsert(m, seg.sub, seg.seg, seg.t));
          } else if (tool === "penDelete") {
            const nd = nodeAtScreen(m, sx, sy);
            if (!nd) break;
            const next = modelDelete(m, nd.sub, nd.idx);
            replaceWith(item.id, next);
            if (!next) st.flash("Path removed — it had too few anchors left");
          } else {
            const h = m.kind === "path" ? handleAtScreen(m.item, sx, sy) : null;
            if (h && m.kind === "path") {
              drag.current = { type: "handle", id: item.id, ...h, orig: m.item, moved: false, free: true };
              break;
            }
            const nd = nodeAtScreen(m, sx, sy);
            if (!nd) break;
            drag.current = { type: "convert", id: item.id, ...nd, model: m, sx0: sx, sy0: sy, moved: false };
          }
          hoverEdit.current = null;
          break;
        }
      case "fill":
        doFill(x, y);
        break;
      case "eyedropper":
        sample(sx, sy);
        drag.current = { type: "sample" };
        break;
      case "zoom":
        zoomAt(sx, sy, e.altKey ? 0.8 : 1.25);
        break;
      case "lasso":
        if (!e.shiftKey) st.setSelection([]);
        drag.current = { type: "lasso", pts: [{ x, y }], additive: e.shiftKey, base: e.shiftKey ? st.selection : [] };
        break;
      case "move":{
          if (tryHandles()) break;
          if (st.selection.length) {
            drag.current = { type: "move", lx: x, ly: y, ids: new Set(st.selection), moved: false };
          } else {
            const layerId = target(null);
            const layer = st.layers.find((l) => l.id === layerId);
            if (!layer) return;
            drag.current = { type: "move", lx: x, ly: y, ids: new Set(layer.items.map((i) => i.id)), moved: false };
          }
          break;
        }
      case "transform":{
          if (tryHandles()) break;
          const u = unionBounds(selectedItems());
          if (u && !e.shiftKey && x >= u.x && x <= u.x + u.w && y >= u.y && y <= u.y + u.h) {
            drag.current = { type: "move", lx: x, ly: y, ids: new Set(st.selection), moved: false };
            break;
          }
          pickOrMarquee();
          break;
        }
      case "select":{
          if (tryHandles()) break;
          pickOrMarquee();
          break;
        }
      case "direct":{
          const ch = cornerHit(sx, sy);
          if (ch) {
            drag.current = { type: "corner", ...ch, moved: false, r: 0 };
            break;
          }
          // v1.0.4 Join: with one end anchor picked, the open end of any other path can be tapped next
          if (endsRef.current.length === 1) {
            const oe = openEndAt(sx, sy, null);
            if (oe && !st.selection.includes(oe.id)) {
              pickEnd({ id: oe.id, sub: oe.sub, end: oe.end });
              break;
            }
          }
          const a = anchorHit(sx, sy);
          if (a) {
            drag.current = { type: "anchor", ...a, moved: false };
            hoverAnchor.current = { id: a.id, idx: a.idx };
            break;
          }
          const bh = bezierHandleHit(sx, sy);
          if (bh) {
            drag.current = { type: "handle", ...bh, moved: false };
            break;
          }
          const hit = hitTop(st.layers, x, y, tol);
          if (hit) {
            const id = hit.item.id;
            const g = groupOf(id, hit.layerId);
            const sel = e.shiftKey ? Array.from(new Set([...st.selection, ...g])) : g;
            st.setSelection(sel);
            st.setActiveLayerId(hit.layerId);
            drag.current = { type: "move", lx: x, ly: y, ids: new Set(sel), moved: false };
          } else startMarquee();
          break;
        }
    }
    dirty.current = true;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = S.current;
    const { sx, sy, x, y } = locate(e.clientX, e.clientY);
    pointer.current = { sx, sy, inside: true };
    dirty.current = true;
    if (e.pointerType === "touch" && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: sx, y: sy });
      if (gesture.current) return updateGesture();
    }
    const d = drag.current;
    let p = readout.p;
    if (st.tool === "pen") penHover.current = { x, y };
    if (d) {
      switch (d.type) {
        case "pan":
          st.setView((v) => ({ ...v, x: d.vx + (sx - d.sx), y: d.vy + (sy - d.sy) }));
          break;
        case "draw":{
            const evs = e.nativeEvent.getCoalescedEvents?.() ?? [];
            if (evs.length) evs.forEach(addPoint);else
            addPoint(e.nativeEvent);
            const it = live.current;
            if (it && it.kind === "stroke") p = it.points[it.points.length - 1].p;
            // browser-predicted pen positions (Chrome / Android WebView) — drawn but never committed
            const pev = e.nativeEvent.getPredictedEvents?.() ?? [];
            const lastPt = it && (it.kind === "stroke" || it.kind === "erase") ? it.points[it.points.length - 1] : null;
            predicted.current = [];
            if (lastPt) {
              for (const ev of pev.slice(-2)) {
                const q = locate(ev.clientX, ev.clientY);
                const far = Math.hypot(q.x - lastPt.x, q.y - lastPt.y) * st.view.zoom;
                if (far < 48) predicted.current.push({ x: q.x, y: q.y, p: lastPt.p });
              }
            }
            break;
          }
        case "shape":{
            const it = live.current;
            const q = snapPt(x, y);
            if (it && it.kind === "shape") it.points = shapePoints(it.shape, d.x0, d.y0, q.x, q.y, e.shiftKey);
            break;
          }
        case "pen":{
            const pn = pen.current;
            if (!pn) break;
            const nodes = pn.item.subpaths[0].nodes;
            if (d.mode === "out") {
              // one-sided handle: only the outgoing side follows the pen
              const n = nodes[nodes.length - 1];
              if (near(n.x, n.y, sx, sy, 3)) {
                n.ox = n.x;
                n.oy = n.y;
              } else {
                n.ox = x;
                n.oy = y;
                d.moved = true;
              }
              break;
            }
            const n = pn.closing ? nodes[0] : nodes[nodes.length - 1];
            if (near(n.x, n.y, sx, sy, 2)) {
              n.ox = n.x;
              n.oy = n.y;
              n.ix = n.x;
              n.iy = n.y;
            } else {
              n.ox = x;
              n.oy = y;
              n.ix = 2 * n.x - x;
              n.iy = 2 * n.y - y;
            }
            break;
          }
        case "sample":
          sample(sx, sy);
          break;
        case "convert":{
            if (!d.moved) {
              if (Math.hypot(sx - d.sx0, sy - d.sy0) < 3) break;
              st.snapshot();
              d.moved = true;
            }
            const next = modelDragAnchor(d.model, d.sub, d.idx, x, y);
            st.setLayers((ls) => replaceItems(ls, new Map([[d.id, next]])));
            break;
          }
        case "rotate":{
            if (!d.moved) {
              st.snapshot();
              d.moved = true;
            }
            let a = Math.atan2(y - d.cy, x - d.cx) - d.a0;
            if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
            d.angle = a;
            const map = new Map<string, Item>();
            d.orig.forEach((it, id) => map.set(id, rotateItem(it, d.cx, d.cy, a)));
            st.setLayers((ls) => replaceItems(ls, map));
            break;
          }
        case "marquee":
          d.x1 = x;
          d.y1 = y;
          break;
        case "lasso":{
            const last = d.pts[d.pts.length - 1];
            if (Math.hypot(last.x - x, last.y - y) > 2 / st.view.zoom) d.pts.push({ x, y });
            break;
          }
        case "move":{
            if (d.x0 === undefined) {
              d.x0 = d.lx;
              d.y0 = d.ly;
              d.tx = 0;
              d.ty = 0;
              const inSel: Item[] = [];
              const xs: number[] = [0, DOC_W / 2, DOC_W];
              const ys: number[] = [0, DOC_H / 2, DOC_H];
              for (const l of st.layers) {
                if (!l.visible) continue;
                for (const it of l.items) {
                  if (it.kind === "erase" || it.hidden) continue;
                  if (d.ids.has(it.id)) inSel.push(it);else
                  if (st.smartGuides) {
                    const ib = itemBounds(it);
                    xs.push(ib.x, ib.x + ib.w / 2, ib.x + ib.w);
                    ys.push(ib.y, ib.y + ib.h / 2, ib.y + ib.h);
                  }
                }
              }
              d.box = unionBounds(inSel);
              d.xs = xs;
              d.ys = ys;
            }
            if (!d.moved && Math.hypot(x - d.x0, y - d.y0!) * st.view.zoom < 3) break;
            let tdx = x - d.x0;
            let tdy = y - d.y0!;
            let gv: number[] = [];
            let gh: number[] = [];
            const bx0 = d.box;
            // Alt drags freely; otherwise snap to the grid and to other objects' edges / centres
            if (bx0 && !e.altKey) {
              if (st.snapToGrid) {
                const g = st.gridSize;
                tdx = Math.round((bx0.x + tdx) / g) * g - bx0.x;
                tdy = Math.round((bx0.y + tdy) / g) * g - bx0.y;
              }
              if (st.smartGuides) {
                const thr = 6 / st.view.zoom;
                const best = (cands: number[], targets: number[]) => {
                  let bd = thr;
                  let off = 0;
                  let hit: number | null = null;
                  for (const c of cands) for (const t of targets) {
                    const dd = Math.abs(t - c);
                    if (dd < bd) {
                      bd = dd;
                      off = t - c;
                      hit = t;
                    }
                  }
                  return { off, hit };
                };
                const sx2 = best([bx0.x + tdx, bx0.x + bx0.w / 2 + tdx, bx0.x + bx0.w + tdx], d.xs!);
                const sy2 = best([bx0.y + tdy, bx0.y + bx0.h / 2 + tdy, bx0.y + bx0.h + tdy], d.ys!);
                if (sx2.hit !== null) {
                  tdx += sx2.off;
                  gv = [sx2.hit];
                }
                if (sy2.hit !== null) {
                  tdy += sy2.off;
                  gh = [sy2.hit];
                }
              }
            }
            guides.current = gv.length || gh.length ? { v: gv, h: gh } : null;
            const dx = tdx - d.tx!;
            const dy = tdy - d.ty!;
            if (!dx && !dy) break;
            if (!d.moved) {
              st.snapshot();
              d.moved = true;
            }
            d.tx = tdx;
            d.ty = tdy;
            st.setLayers((ls) =>
            ls.map((l) =>
            l.items.some((i) => d.ids.has(i.id)) ?
            { ...l, items: l.items.map((i) => d.ids.has(i.id) ? translateItem(i, dx, dy) : i) } :
            l
            )
            );
            break;
          }
        case "scale":{
            if (!d.moved) {
              st.snapshot();
              d.moved = true;
            }
            let fx = (x - d.ax) / (d.hx - d.ax || 1);
            let fy = (y - d.ay) / (d.hy - d.ay || 1);
            if (e.shiftKey) {
              const s = Math.max(Math.abs(fx), Math.abs(fy));
              fx = (Math.sign(fx) || 1) * s;
              fy = (Math.sign(fy) || 1) * s;
            }
            if (Math.abs(fx) < 0.01) fx = 0.01;
            if (Math.abs(fy) < 0.01) fy = 0.01;
            const map = new Map<string, Item>();
            d.orig.forEach((it, id) => map.set(id, scaleItem(it, d.ax, d.ay, fx, fy)));
            st.setLayers((ls) => replaceItems(ls, map));
            break;
          }
        case "corner":{
            if (!d.moved) {
              st.snapshot();
              d.moved = true;
            }
            d.r = radiusFromBisector(d.orig, d.sub, d.idx, x, y);
            const next = roundCorner(d.orig, d.sub, d.idx, d.r);
            st.setLayers((ls) => replaceItems(ls, new Map([[d.id, next]])));
            break;
          }
        case "anchor":{
            if (!d.moved) {
              // finger / nib jitter on a tap shouldn't count as a drag (a tap picks the end for Join)
              const a0 = anchorsOf(d.orig)[d.idx];
              if (a0 && near(a0.x, a0.y, sx, sy, 7)) break;
              st.snapshot();
              d.moved = true;
            }
            const q = snapPt(x, y);
            const next = setAnchor(d.orig, d.idx, q.x, q.y);
            st.setLayers((ls) => replaceItems(ls, new Map([[d.id, next]])));
            break;
          }
        case "handle":{
            if (!d.moved) {
              st.snapshot();
              d.moved = true;
            }
            const subpaths = d.orig.subpaths.map((sp, si) => {
              if (si !== d.sub) return sp;
              const nodes = sp.nodes.slice();
              const n = { ...nodes[d.idx] };
              const otherX = d.which === "out" ? n.ix : n.ox;
              const otherY = d.which === "out" ? n.iy : n.oy;
              const otherLen = Math.hypot(otherX - n.x, otherY - n.y);
              if (d.which === "out") {
                n.ox = x;
                n.oy = y;
              } else {
                n.ix = x;
                n.iy = y;
              }
              // keep smooth anchors smooth (Alt breaks the handles apart, like Illustrator)
              if (!e.altKey && !d.free && otherLen > 0) {
                const vx = n.x - x;
                const vy = n.y - y;
                const vl = Math.hypot(vx, vy) || 1;
                const mx = n.x + vx / vl * otherLen;
                const my = n.y + vy / vl * otherLen;
                if (d.which === "out") {
                  n.ix = mx;
                  n.iy = my;
                } else {
                  n.ox = mx;
                  n.oy = my;
                }
              }
              nodes[d.idx] = n;
              return { ...sp, nodes };
            });
            st.setLayers((ls) => replaceItems(ls, new Map([[d.id, { ...d.orig, subpaths }]])));
            break;
          }
      }
    } else if (st.tool === "direct") {
      const a = anchorHit(sx, sy);
      hoverAnchor.current = a ? { id: a.id, idx: a.idx } : null;
    } else if (st.tool === "pen") {
      const pn = pen.current;
      penEndHover.current = openEndAt(sx, sy, pn ? new Set([pn.item.id, ...pn.absorb]) : null);
    } else if (EDIT_TOOLS.has(st.tool)) {
      updateHoverEdit(sx, sy, x, y);
    }
    // the status bar re-renders React — throttle it so it never competes with the stroke
    const now = performance.now();
    if (now - readoutT.current > 90) {
      readoutT.current = now;
      setReadout({ x: Math.round(x), y: Math.round(y), p });
    }
  };

  /**
   * Freeform Select on a pencil layer lifts just the enclosed part of the sketch into its own
   * piece (the rest of the layer stays untouched) so it can be moved, scaled or rotated.
   */
  const cutPencilSelection = (poly: XY[]) => {
    const st = S.current;
    const layer = st.activeLayer;
    if (!layer || layer.type !== "pencil" || layer.locked || !layer.visible) return false;
    const marks = layer.items.filter((i) => !i.hidden && i.kind !== "erase");
    if (!marks.some((it) => outlineOf(it).pts.some((q) => pointInPoly(q.x, q.y, poly)))) return false;
    const px0 = Math.max(0, Math.floor(Math.min(...poly.map((q) => q.x))));
    const py0 = Math.max(0, Math.floor(Math.min(...poly.map((q) => q.y))));
    const px1 = Math.min(DOC_W, Math.ceil(Math.max(...poly.map((q) => q.x))));
    const py1 = Math.min(DOC_H, Math.ceil(Math.max(...poly.map((q) => q.y))));
    const bw = px1 - px0;
    const bh = py1 - py0;
    if (bw < 2 || bh < 2) return false;
    const RES = 2; // lift at 2× so the piece stays crisp when zoomed in
    const cv = document.createElement("canvas");
    cv.width = bw * RES;
    cv.height = bh * RES;
    const g = cv.getContext("2d");
    if (!g) return false;
    g.setTransform(RES, 0, 0, RES, -px0 * RES, -py0 * RES);
    for (const it of layer.items) drawItem(g, it);
    g.globalCompositeOperation = "destination-in";
    g.fillStyle = "#000000";
    g.beginPath();
    poly.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y));
    g.closePath();
    g.fill();
    g.globalCompositeOperation = "source-over";
    const cut: Item = { id: uid("e"), kind: "erase", size: 0, poly: true, points: poly.map((q) => ({ x: q.x, y: q.y, p: 1 })) };
    const piece: Item = { id: uid("img"), kind: "image", x: px0, y: py0, w: bw, h: bh, canvas: cv };
    st.commit((ls) => ls.map((l) => l.id === layer.id ? { ...l, items: [...l.items, cut, piece] } : l));
    st.setSelection([piece.id]);
    st.setTool("transform");
    st.flash("Lifted part of the sketch · drag to move · corners scale · top handle rotates");
    return true;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch") {
      touches.current.delete(e.pointerId);
      if (gesture.current) {
        if (touches.current.size < 2) {
          gesture.current = null;
          dirty.current = true;
        }
        return;
      }
    }
    const d = drag.current;
    drag.current = null;
    guides.current = null;
    predicted.current = [];
    setDrawing(false);
    setPanning(false);
    const st = S.current;
    dirty.current = true;
    if (!d) return;
    if (d.type === "pen") {
      if (pen.current?.closing) commitPen();else
      if (d.mode === "out" && !d.moved && !d.hadOut && penNodes().length >= 2) commitPen();
      return;
    }
    if (d.type === "convert") {
      if (!d.moved) {
        const res = modelToggle(d.model, d.sub, d.idx);
        replaceWith(d.id, res.item);
        st.flash(res.corner ? "Corner anchor" : "Smooth anchor");
      }
      return;
    }
    if (d.type === "draw" || d.type === "shape") {
      const it = live.current;
      live.current = null;
      if (!it) return;
      // fewer anchors: Mono Liner gets a looser fit, Pressure Ink is slimmed again when it becomes a blob
      if (it.kind === "stroke" && it.brush === "vector-fixed") {
        // v1.0.4 Mono Liner: end exactly where the pen lifted and keep the corners you drew
        const rl = rawLast.current;
        const lp = it.points[it.points.length - 1];
        if (rl && Math.hypot(rl.x - lp.x, rl.y - lp.y) > 0.2 / st.view.zoom) it.points.push({ x: rl.x, y: rl.y, p: lp.p });
        it.points = simplifyKeepCorners(it.points, 1.2, 7 / st.view.zoom);
      } else if (it.kind === "stroke" && isVectorBrush(it.brush)) it.points = simplify(it.points, 0.9);
      if (it.kind === "shape") {
        const b = itemBounds(it);
        if (b.w - it.size < 2 && b.h - it.size < 2) return;
      }
      const layerId = liveLayer.current;
      // Pressure Ink = blob brush: the finished stroke becomes a filled, tapered vector shape
      if (it.kind === "stroke" && it.brush === "vector-pressure") {
        const blob = strokeToBlob(it);
        if (blob) {
          st.commit((ls) => ls.map((l) => l.id === layerId ? { ...l, items: [...l.items, blob] } : l));
          return;
        }
      }
      // Eraser on a vector layer cuts vector objects for real and breaks them into separate pieces
      if (it.kind === "erase") {
        const layer = st.layers.find((l) => l.id === layerId);
        if (layer && layer.type === "vector") {
          const eb = itemBounds(it);
          let keepMark = false;
          let most = 0;
          const items: Item[] = [];
          for (const x of layer.items) {
            if (x.hidden || x.kind === "erase" || !rectsIntersect(itemBounds(x), eb)) {
              items.push(x);
              continue;
            }
            if (x.kind === "image") {
              items.push(x);
              keepMark = true;
              continue;
            }
            // filled shapes are cut directly; strokes, lines and outlined shapes are expanded first
            const srcs = x.kind === "path" && x.fill && !x.stroke ? [x] : outlineItem(x);
            if (!srcs || !srcs.length) {
              items.push(x);
              keepMark = true;
              continue;
            }
            let touched = false;
            const res: Item[] = [];
            for (const s of srcs) {
              const r = eraseFromPath(s, it);
              if (r === undefined) res.push(s);else
              {
                touched = true;
                if (r) res.push(...splitPath(r));
              }
            }
            if (!touched) {
              items.push(x);
              continue;
            }
            if (x.group) for (const r of res) r.group = x.group;
            most = Math.max(most, res.length);
            items.push(...res);
          }
          if (keepMark) items.push(it);
          st.commit((ls) => ls.map((l) => l.id === layerId ? { ...l, items } : l));
          const alive = new Set(items.map((i) => i.id));
          st.setSelection((s) => s.filter((id) => alive.has(id)));
          if (most > 1) st.flash(`Eraser split the shape into ${most} pieces`);
          return;
        }
      }
      st.commit((ls) => ls.map((l) => l.id === layerId ? { ...l, items: [...l.items, it] } : l));
      return;
    }
    const selectable = (fn: (it: Item) => boolean) => {
      const ids: string[] = [];
      for (const l of st.layers) {
        if (!l.visible || l.locked) continue;
        for (const it of l.items) if (it.kind !== "erase" && !it.hidden && fn(it)) ids.push(it.id);
      }
      return ids;
    };
    if (d.type === "marquee") {
      const r = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
      if (r.w * st.view.zoom < 3 && r.h * st.view.zoom < 3) return;
      const ids = selectable((it) => rectsIntersect(itemBounds(it), r));
      st.setSelection(expandGroups(d.additive ? [...d.base, ...ids] : ids));
    }
    if (d.type === "lasso") {
      if (d.pts.length < 3) return;
      if (!d.additive && cutPencilSelection(d.pts)) return;
      const ids = selectable((it) => outlineOf(it).pts.some((p) => pointInPoly(p.x, p.y, d.pts)));
      st.setSelection(expandGroups(d.additive ? [...d.base, ...ids] : ids));
    }
    if (d.type === "anchor") {
      hoverAnchor.current = null;
      // a tap (no drag) on an open end anchor picks it for Join
      if (!d.moved) {
        const pe = flatToEnd(d.orig, d.idx);
        if (pe) pickEnd(pe);
      }
    }
  };

  const tool = studio.tool;
  const cursor =
  spaceDown || tool === "hand" ?
  panning ?
  "grabbing" :
  "grab" :
  tool === "zoom" ?
  "zoom-in" :
  tool === "brush" || tool === "eraser" || tool === "eyedropper" ?
  "none" :
  tool === "move" ?
  "move" :
  tool === "select" || tool === "direct" || tool === "transform" || EDIT_TOOLS.has(tool) ?
  "default" :
  "crosshair";

  const zoomPct = Math.round(studio.view.zoom * 100);
  // a pencil layer's sketch counts as one element
  let selectionCount = 0;
  if (studio.selection.length) {
    const ids = new Set(studio.selection);
    for (const l of studio.layers) {
      let sketch = false;
      for (const it of l.items) {
        if (!ids.has(it.id) || it.kind === "erase") continue;
        if (l.type === "pencil" && isPencilMark(it)) sketch = true;else
        selectionCount++;
      }
      if (sketch) selectionCount++;
    }
  }
  const canJoin = studio.selection.length > 0 && joinPair() !== null;
  let rotDeg = Math.round(studio.view.rot * 180 / Math.PI) % 360;
  if (rotDeg > 180) rotDeg -= 360;
  if (rotDeg <= -180) rotDeg += 360;

  return (
    <section className="relative flex min-w-0 flex-1 flex-col" data-oid="b1527df8cb" data-oid-component-root="true">
      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-background bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] bg-[length:22px_22px]" data-oid="52895534ae" data-oid-text-editable="false" data-oid-text-source="element:canvas|expression:2d3ea7d0df4e|expression:5b2555ce2926">
        
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none select-none"
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerEnter={() => {
            pointer.current.inside = true;
          }}
          onPointerLeave={() => {
            pointer.current.inside = false;
            penHover.current = null;
            hoverEdit.current = null;
            dirty.current = true;
          }}
          onContextMenu={(e) => e.preventDefault()} data-oid="105a2c9a38" data-oid-style-dynamic="cursor" />
        
        {studio.message &&
        <p className="pointer-events-none absolute left-1/2 top-ds-lg -translate-x-1/2 rounded-md border border-border bg-popover px-ds-md py-ds-xs text-label text-popover-foreground shadow-lg" data-oid="70f59d95b1">
            {studio.message}
          </p>
        }
        {studio.selection.length > 0 &&
        <div className="absolute bottom-ds-md left-1/2 z-10 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-ds-xs overflow-x-auto rounded-lg border border-border bg-popover p-ds-xs shadow-xl" data-oid="2ce754afae">
            <p className="px-ds-sm type-caption text-muted-foreground" data-oid="e77d04719e">
              <output className="text-accent" data-oid="d7f47ddfcd">{selectionCount}</output> SELECTED
            </p>
            <button type="button" onClick={studio.deselect} className="h-9 rounded-md px-ds-md text-label text-foreground hover:bg-secondary" data-oid="0509e56131">
              Deselect
            </button>
            <button type="button" onClick={studio.cutSelection} className="inline-flex h-9 items-center gap-ds-xs rounded-md px-ds-md text-label text-foreground hover:bg-secondary" data-oid="0c4848ffbf">
              <Scissors className="h-4 w-4" data-oid="e83bf1e8aa" /> Cut
            </button>
            <button type="button" disabled={studio.selection.length < 2} onClick={studio.groupSelection} className="inline-flex h-9 shrink-0 items-center gap-ds-xs rounded-md px-ds-md text-label text-foreground hover:bg-secondary disabled:opacity-35" data-oid="50075270ed">
              <Group className="h-4 w-4" data-oid="eb820fbc0d" /> Group
            </button>
            <button type="button" disabled={!studio.selectionGrouped} onClick={studio.ungroupSelection} className="inline-flex h-9 shrink-0 items-center gap-ds-xs rounded-md px-ds-md text-label text-foreground hover:bg-secondary disabled:opacity-35" data-oid="628ed51504">
              <Ungroup className="h-4 w-4" data-oid="6ea5ef98b0" /> Ungroup
            </button>
            <button type="button" disabled={!canJoin} onClick={joinSelection} title="Join end anchors · Ctrl J" className="inline-flex h-9 shrink-0 items-center gap-ds-xs rounded-md px-ds-md text-label text-foreground hover:bg-secondary disabled:opacity-35" data-oid="c6cdd64984" data-oid-text-editable="false">
              <Link2 className="h-4 w-4" data-oid="b8e627ce72" /> Join
              {ends.length > 0 && <output className="type-caption text-primary" data-oid="b378d4f450" data-oid-text-editable="false" data-oid-text-source="expression:a3337e79f202|text">{ends.length}/2</output>}
            </button>
            <button type="button" onClick={studio.deleteSelection} className="inline-flex h-9 items-center gap-ds-xs rounded-md bg-destructive px-ds-md text-label font-semibold text-destructive-foreground hover:opacity-90" data-oid="28c3865609">
              <Trash2 className="h-4 w-4" data-oid="16d8e1c405" /> Delete
            </button>
          </div>
        }
      </div>
      <footer className="flex h-7 items-center gap-ds-lg border-t border-border bg-card px-ds-md type-caption text-muted-foreground" data-oid="9c10260a07">
        <span data-oid="88ce772826">
          X <output className="text-foreground" data-oid="c52ba3516b">{readout.x}</output>
        </span>
        <span data-oid="0a3907a55e">
          Y <output className="text-foreground" data-oid="c49dd29b6e">{readout.y}</output>
        </span>
        <span className="flex items-center gap-ds-xs" data-oid="c046d7b826">
          PRESSURE
          <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-secondary" data-oid="3f4be740d7">
            <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${Math.round(readout.p * 100)}%` }} data-oid="1740ceadac" data-oid-style-dynamic="width" />
          </span>
          <output className="w-8 text-foreground" data-oid="b16abc867e">{readout.p.toFixed(2)}</output>
        </span>
        <span className="ml-auto" data-oid="223d254a31" data-oid-text-editable="false" data-oid-text-source="expression:84185c51aefc|text|expression:4a498f96c710|text">
          {studio.docSize.w} × {studio.docSize.h} px
        </span>
        <span data-oid="685574e29d">
          LAYER <output className="text-foreground" data-oid="9adbb5749d">{studio.activeLayer?.name}</output>{" "}
          <output className="text-accent" data-oid="73ac3e42cf">{studio.activeLayer?.type === "pencil" ? "PENCIL" : "VECTOR"}</output>
        </span>
        <button
          type="button"
          title="Reset canvas rotation"
          disabled={rotDeg === 0}
          onClick={resetRotation}
          className="rounded-sm px-ds-xs hover:bg-secondary hover:text-foreground disabled:pointer-events-none" data-oid="43284909c5">
          ROT <output className="text-foreground" data-oid="3d5f141eb3" data-oid-text-editable="false" data-oid-text-source="expression:0668200a5b50|text">{rotDeg}°</output>
        </button>
        <span data-oid="690de1081a">
          ZOOM <output className="text-primary" data-oid="aa2c636cab" data-oid-text-editable="false" data-oid-text-source="expression:f6620f99d3e1|text">{zoomPct}%</output>
        </span>
      </footer>
    </section>);

}

/** Draw pen-in-progress outline in the zoomed (overlay) frame. */
function tracePathScaled(ctx: CanvasRenderingContext2D, nodes: PathItem["subpaths"][number]["nodes"], closed: boolean, z: number) {
  const n = nodes.length;
  if (!n) return;
  ctx.moveTo(nodes[0].x * z, nodes[0].y * z);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % n];
    ctx.bezierCurveTo(a.ox * z, a.oy * z, b.ix * z, b.iy * z, b.x * z, b.y * z);
  }
  if (closed) ctx.closePath();
}