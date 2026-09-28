import { useEffect, useRef, useState } from "react";
import type { Studio } from "./useStudio";
import { DOC_H, DOC_W, uid, type Item, type Layer, type Pt, type ShapeItem } from "../../lib/art/types";
import {
  anchorsOf,
  drawItem,
  floodFill,
  hitItem,
  isVectorBrush,
  itemBounds,
  outlineOf,
  pointInPoly,
  rectsIntersect,
  renderDoc,
  scaleItem,
  setAnchor,
  simplify,
  translateItem,
  unionBounds,
  type XY } from
"../../lib/art/render";
import { readCssColor, rgbToHex } from "../../lib/art/color";

type Drag =
{type: "pan";sx: number;sy: number;vx: number;vy: number;} |
{type: "draw";} |
{type: "shape";x0: number;y0: number;} |
{type: "marquee";x0: number;y0: number;x1: number;y1: number;additive: boolean;base: string[];} |
{type: "lasso";pts: XY[];additive: boolean;base: string[];} |
{type: "move";lx: number;ly: number;ids: Set<string>;moved: boolean;} |
{type: "scale";ax: number;ay: number;hx: number;hy: number;orig: Map<string, Item>;moved: boolean;} |
{type: "anchor";id: string;idx: number;orig: Item;moved: boolean;};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function replaceItems(ls: Layer[], map: Map<string, Item>): Layer[] {
  return ls.map((l) => l.items.some((i) => map.has(i.id)) ? { ...l, items: l.items.map((i) => map.get(i.id) ?? i) } : l);
}

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
  const layerCanvases = useRef(new Map<string, HTMLCanvasElement>());
  const live = useRef<Item | null>(null);
  const drag = useRef<Drag | null>(null);
  const pointer = useRef({ sx: 0, sy: 0, inside: false });
  const space = useRef(false);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const dirty = useRef(true);
  const colors = useRef({ accent: "#3d8bff", primary: "#ff7a1a" });
  const pressureState = useRef({ p: 0.5, lastT: 0, lastX: 0, lastY: 0 });
  const hoverAnchor = useRef<{id: string;idx: number;} | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [readout, setReadout] = useState({ x: 0, y: 0, p: 0 });

  dirty.current = true;

  const fit = () => {
    const { w, h } = size.current;
    if (!w || !h) return;
    const zoom = Math.min((w - 96) / DOC_W, (h - 96) / DOC_H);
    S.current.setView({ zoom, x: (w - DOC_W * zoom) / 2, y: (h - DOC_H * zoom) / 2 });
  };

  const zoomAt = (sx: number, sy: number, f: number) => {
    S.current.setView((v) => {
      const nz = clamp(v.zoom * f, 0.1, 16);
      return { zoom: nz, x: sx - (sx - v.x) * (nz / v.zoom), y: sy - (sy - v.y) * (nz / v.zoom) };
    });
  };

  const locate = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    const v = S.current.view;
    return { sx, sy, x: (sx - v.x) / v.zoom, y: (sy - v.y) / v.zoom };
  };

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

  /* ---------- wheel + space ---------- */
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
      if (e.code === "Space" && !isField(e.target)) {
        e.preventDefault();
        if (!space.current) {
          space.current = true;
          setSpaceDown(true);
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
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", down);
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
    const { x: px, y: py, zoom } = st.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);

    // paper
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(px, py, DOC_W * zoom, DOC_H * zoom);
    ctx.restore();

    // layers
    for (const layer of st.layers) {
      if (!layer.visible) continue;
      let lc = layerCanvases.current.get(layer.id);
      if (!lc) {
        lc = document.createElement("canvas");
        layerCanvases.current.set(layer.id, lc);
      }
      if (lc.width !== c.width || lc.height !== c.height) {
        lc.width = c.width;
        lc.height = c.height;
      }
      const l = lc.getContext("2d")!;
      l.setTransform(1, 0, 0, 1, 0, 0);
      l.clearRect(0, 0, lc.width, lc.height);
      l.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * px, dpr * py);
      l.save();
      l.beginPath();
      l.rect(0, 0, DOC_W, DOC_H);
      l.clip();
      for (const it of layer.items) drawItem(l, it);
      if (live.current && layer.id === st.activeLayerId) drawItem(l, live.current);
      l.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(lc, 0, 0);
      ctx.globalAlpha = 1;
    }

    // overlay
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const acc = colors.current.accent;
    const X = (x: number) => px + x * zoom;
    const Y = (y: number) => py + y * zoom;
    const selIds = new Set(st.selection);
    if (selIds.size) {
      const sel: Item[] = [];
      for (const l of st.layers) for (const it of l.items) if (selIds.has(it.id)) sel.push(it);
      ctx.strokeStyle = acc;
      ctx.lineWidth = 1;
      for (const it of sel) {
        const anchors = st.tool === "direct" ? anchorsOf(it) : [];
        if (anchors.length) {
          const { pts, closed } = outlineOf(it);
          ctx.beginPath();
          pts.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y)));
          if (closed) ctx.closePath();
          ctx.stroke();
          anchors.forEach((a, i) => {
            const active = hoverAnchor.current?.id === it.id && hoverAnchor.current.idx === i;
            ctx.fillStyle = active ? acc : "#ffffff";
            ctx.fillRect(X(a.x) - 3.5, Y(a.y) - 3.5, 7, 7);
            ctx.strokeRect(X(a.x) - 3.5, Y(a.y) - 3.5, 7, 7);
          });
        } else {
          const b = itemBounds(it);
          ctx.setLineDash(sel.length > 1 ? [3, 3] : []);
          ctx.strokeRect(Math.round(X(b.x)) + 0.5, Math.round(Y(b.y)) + 0.5, b.w * zoom, b.h * zoom);
          ctx.setLineDash([]);
        }
      }
      const u = unionBounds(sel);
      if (u && (st.tool === "select" || st.tool === "move")) {
        ctx.strokeRect(Math.round(X(u.x)) + 0.5, Math.round(Y(u.y)) + 0.5, u.w * zoom, u.h * zoom);
        if (st.tool === "select") {
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
        }
      }
    }

    const d = drag.current;
    if (d?.type === "marquee") {
      const x = Math.min(d.x0, d.x1);
      const y = Math.min(d.y0, d.y1);
      ctx.fillStyle = "rgba(61,139,255,0.08)";
      ctx.fillRect(X(x), Y(y), Math.abs(d.x1 - d.x0) * zoom, Math.abs(d.y1 - d.y0) * zoom);
      ctx.strokeStyle = acc;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(X(x) + 0.5, Y(y) + 0.5, Math.abs(d.x1 - d.x0) * zoom, Math.abs(d.y1 - d.y0) * zoom);
      ctx.setLineDash([]);
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

    // brush cursor
    const pt = pointer.current;
    if (pt.inside && !space.current && (st.tool === "brush" || st.tool === "eraser")) {
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
    const k = 1 - S.current.stabilizer * 0.85;
    const nx = last.x + (x - last.x) * k;
    const ny = last.y + (y - last.y) * k;
    if (Math.hypot(nx - last.x, ny - last.y) < 0.35 / S.current.view.zoom) return;
    it.points.push({ x: nx, y: ny, p });
  };

  const selectedItems = () => {
    const ids = new Set(S.current.selection);
    const out: Item[] = [];
    for (const l of S.current.layers) for (const it of l.items) if (ids.has(it.id)) out.push(it);
    return out;
  };

  const handleHit = (sx: number, sy: number) => {
    const u = unionBounds(selectedItems());
    if (!u) return null;
    const { x: px, y: py, zoom } = S.current.view;
    const corners = [
    [u.x, u.y],
    [u.x + u.w, u.y],
    [u.x + u.w, u.y + u.h],
    [u.x, u.y + u.h]];

    for (let i = 0; i < 4; i++) {
      const [cx, cy] = corners[i];
      if (Math.hypot(px + cx * zoom - sx, py + cy * zoom - sy) <= 7) {
        const [ax, ay] = corners[(i + 2) % 4];
        return { hx: cx, hy: cy, ax, ay };
      }
    }
    return null;
  };

  const anchorHit = (sx: number, sy: number) => {
    const { x: px, y: py, zoom } = S.current.view;
    for (const it of selectedItems()) {
      const anchors = anchorsOf(it);
      for (let i = 0; i < anchors.length; i++) {
        if (Math.hypot(px + anchors[i].x * zoom - sx, py + anchors[i].y * zoom - sy) <= 6) return { id: it.id, idx: i, orig: it };
      }
    }
    return null;
  };

  const doFill = (x: number, y: number) => {
    const st = S.current;
    const doc = renderDoc(st.layers, 1, true);
    const img = doc.getContext("2d")!.getImageData(0, 0, DOC_W, DOC_H);
    const res = floodFill(img, Math.floor(x), Math.floor(y), st.primary, st.fillTolerance);
    if (!res) return;
    const item: Item = { id: uid("f"), kind: "image", ...res };
    const layerId = st.activeLayerId;
    st.commit((ls) => ls.map((l) => l.id === layerId ? { ...l, items: [...l.items, item] } : l));
  };

  const sample = (sx: number, sy: number) => {
    const c = canvasRef.current!;
    const { dpr } = size.current;
    const d = c.getContext("2d")!.getImageData(Math.floor(sx * dpr), Math.floor(sy * dpr), 1, 1).data;
    if (d[3] < 10) return;
    S.current.setPrimary(rgbToHex(d[0], d[1], d[2]));
  };

  /* ---------- pointer handlers ---------- */
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 2) return;
    const st = S.current;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { sx, sy, x, y } = locate(e.clientX, e.clientY);
    const zoom = st.view.zoom;
    if (e.button === 1 || space.current || st.tool === "hand") {
      drag.current = { type: "pan", sx, sy, vx: st.view.x, vy: st.view.y };
      setPanning(true);
      return;
    }
    let tool = st.tool;
    if (e.altKey && (tool === "brush" || tool === "fill")) tool = "eyedropper";
    const layer = st.layers.find((l) => l.id === st.activeLayerId);
    const editable = () => {
      if (!layer) return false;
      if (layer.locked) return st.flash(`“${layer.name}” is locked`), false;
      if (!layer.visible) return st.flash(`“${layer.name}” is hidden`), false;
      return true;
    };
    const tol = 5 / zoom;
    const startMarquee = () => {
      if (!e.shiftKey) st.setSelection([]);
      drag.current = { type: "marquee", x0: x, y0: y, x1: x, y1: y, additive: e.shiftKey, base: e.shiftKey ? st.selection : [] };
    };

    switch (tool) {
      case "brush":{
          if (!editable()) return;
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
          drag.current = { type: "draw" };
          break;
        }
      case "eraser":{
          if (!editable()) return;
          live.current = { id: uid("e"), kind: "erase", size: st.eraserSize, points: [{ x, y, p: 1 }] };
          drag.current = { type: "draw" };
          break;
        }
      case "line":
      case "rect":
      case "ellipse":{
          if (!editable()) return;
          live.current = {
            id: uid("sh"),
            kind: "shape",
            shape: tool,
            points: shapePoints(tool, x, y, x, y, false),
            color: st.primary,
            size: st.shapeStroke,
            opacity: 1,
            fill: st.shapeFill && tool !== "line" ? st.secondary : null
          };
          drag.current = { type: "shape", x0: x, y0: y };
          break;
        }
      case "fill":
        if (editable()) doFill(x, y);
        break;
      case "eyedropper":
        sample(sx, sy);
        break;
      case "zoom":
        zoomAt(sx, sy, e.altKey ? 0.8 : 1.25);
        break;
      case "lasso":
        if (!e.shiftKey) st.setSelection([]);
        drag.current = { type: "lasso", pts: [{ x, y }], additive: e.shiftKey, base: e.shiftKey ? st.selection : [] };
        break;
      case "move":{
          if (st.selection.length) {
            drag.current = { type: "move", lx: x, ly: y, ids: new Set(st.selection), moved: false };
          } else {
            if (!editable()) return;
            drag.current = { type: "move", lx: x, ly: y, ids: new Set(layer!.items.map((i) => i.id)), moved: false };
          }
          break;
        }
      case "select":{
          const h = st.selection.length ? handleHit(sx, sy) : null;
          if (h) {
            const orig = new Map<string, Item>();
            for (const it of selectedItems()) orig.set(it.id, it);
            drag.current = { type: "scale", ...h, orig, moved: false };
            break;
          }
          const hit = hitTop(st.layers, x, y, tol);
          if (hit) {
            let sel = st.selection;
            const id = hit.item.id;
            if (e.shiftKey) sel = sel.includes(id) ? sel.filter((i) => i !== id) : [...sel, id];else
            if (!sel.includes(id)) sel = [id];
            st.setSelection(sel);
            st.setActiveLayerId(hit.layerId);
            if (sel.includes(id)) drag.current = { type: "move", lx: x, ly: y, ids: new Set(sel), moved: false };
          } else startMarquee();
          break;
        }
      case "direct":{
          const a = anchorHit(sx, sy);
          if (a) {
            drag.current = { type: "anchor", ...a, moved: false };
            hoverAnchor.current = { id: a.id, idx: a.idx };
            break;
          }
          const hit = hitTop(st.layers, x, y, tol);
          if (hit) {
            const id = hit.item.id;
            const sel = e.shiftKey ? Array.from(new Set([...st.selection, id])) : [id];
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
    const d = drag.current;
    dirty.current = true;
    let p = readout.p;
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
            break;
          }
        case "shape":{
            const it = live.current;
            if (it && it.kind === "shape") it.points = shapePoints(it.shape, d.x0, d.y0, x, y, e.shiftKey);
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
            const dx = x - d.lx;
            const dy = y - d.ly;
            if (!dx && !dy) break;
            if (!d.moved) {
              st.snapshot();
              d.moved = true;
            }
            d.lx = x;
            d.ly = y;
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
        case "anchor":{
            if (!d.moved) {
              st.snapshot();
              d.moved = true;
            }
            const next = setAnchor(d.orig, d.idx, x, y);
            st.setLayers((ls) => replaceItems(ls, new Map([[d.id, next]])));
            break;
          }
      }
    } else if (st.tool === "direct") {
      const a = anchorHit(sx, sy);
      hoverAnchor.current = a ? { id: a.id, idx: a.idx } : null;
    }
    setReadout({ x: Math.round(x), y: Math.round(y), p });
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    const st = S.current;
    dirty.current = true;
    if (!d) return;
    if (d.type === "draw" || d.type === "shape") {
      const it = live.current;
      live.current = null;
      if (!it) return;
      if (it.kind === "stroke" && isVectorBrush(it.brush)) it.points = simplify(it.points, 0.9);
      if (it.kind === "shape") {
        const b = itemBounds(it);
        if (b.w - it.size < 2 && b.h - it.size < 2) return;
      }
      const layerId = st.activeLayerId;
      st.commit((ls) => ls.map((l) => l.id === layerId ? { ...l, items: [...l.items, it] } : l));
      return;
    }
    const selectable = (fn: (it: Item) => boolean) => {
      const ids: string[] = [];
      for (const l of st.layers) {
        if (!l.visible || l.locked) continue;
        for (const it of l.items) if (it.kind !== "erase" && fn(it)) ids.push(it.id);
      }
      return ids;
    };
    if (d.type === "marquee") {
      const r = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
      if (r.w * st.view.zoom < 3 && r.h * st.view.zoom < 3) return;
      const ids = selectable((it) => rectsIntersect(itemBounds(it), r));
      st.setSelection(d.additive ? Array.from(new Set([...d.base, ...ids])) : ids);
    }
    if (d.type === "lasso") {
      if (d.pts.length < 3) return;
      const ids = selectable((it) => outlineOf(it).pts.some((p) => pointInPoly(p.x, p.y, d.pts)));
      st.setSelection(d.additive ? Array.from(new Set([...d.base, ...ids])) : ids);
    }
    if (d.type === "anchor") hoverAnchor.current = null;
  };

  const tool = studio.tool;
  const cursor =
  spaceDown || tool === "hand" ?
  panning ?
  "grabbing" :
  "grab" :
  tool === "zoom" ?
  "zoom-in" :
  tool === "brush" || tool === "eraser" ?
  "none" :
  tool === "move" ?
  "move" :
  tool === "select" || tool === "direct" ?
  "default" :
  "crosshair";

  const zoomPct = Math.round(studio.view.zoom * 100);

  return (
    <section className="relative flex min-w-0 flex-1 flex-col" data-oid="3b8427b834" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true">
      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-background bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] bg-[length:22px_22px]" data-oid="96ba0125af" data-oid-text-editable="false" data-oid-text-source="element:canvas|element:div|expression:2ca8832980f0">
        
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
            dirty.current = true;
          }}
          onContextMenu={(e) => e.preventDefault()} data-oid="28c3e7ab9e" data-oid-style-dynamic="cursor" />
        
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.35)_100%)]" data-oid="83ba38ec53" />
        {studio.message &&
        <p className="pointer-events-none absolute left-1/2 top-ds-lg -translate-x-1/2 rounded-md border border-border bg-popover px-ds-md py-ds-xs text-label text-popover-foreground shadow-lg" data-oid="abb6119c62">
            {studio.message}
          </p>
        }
      </div>
      <footer className="flex h-7 items-center gap-ds-lg border-t border-border bg-card px-ds-md type-caption text-muted-foreground" data-oid="617bc6b1a2">
        <span data-oid="e0f2cc6e49">
          X <output className="text-foreground" data-oid="b704c8c307">{readout.x}</output>
        </span>
        <span data-oid="0082dce1f2">
          Y <output className="text-foreground" data-oid="e1506abc96">{readout.y}</output>
        </span>
        <span className="flex items-center gap-ds-xs" data-oid="304d5fdaf6">
          PRESSURE
          <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-secondary" data-oid="b9ed847aeb">
            <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${Math.round(readout.p * 100)}%` }} data-oid="b2039cd2d1" data-oid-style-dynamic="width" />
          </span>
          <output className="w-8 text-foreground" data-oid="21dc520657">{readout.p.toFixed(2)}</output>
        </span>
        <span className="ml-auto" data-oid="c7e476513e" data-oid-text-editable="false" data-oid-text-source="expression:0293cd9deb92|text|expression:0c22207fd581|text">
          {DOC_W} × {DOC_H} px
        </span>
        <span data-oid="31b74773bc">
          LAYER <output className="text-foreground" data-oid="0c877c525d">{studio.activeLayer?.name}</output>
        </span>
        <span data-oid="baeb092fd6">
          ZOOM <output className="text-primary" data-oid="5541489a7d" data-oid-text-editable="false" data-oid-text-source="expression:f6620f99d3e1|text">{zoomPct}%</output>
        </span>
      </footer>
    </section>);

}