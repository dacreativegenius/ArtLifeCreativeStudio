import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Ban, Pipette } from "lucide-react";
import type { Studio } from "./useStudio";
import { Panel } from "./Panel";
import { hexToHsv, hexToRgb, hsvToHex, normalizeHex, type HSV } from "../../lib/art/color";

const SIZE = 216;
const C = SIZE / 2;
const RO = C - 2;
const RI = C - 20;
const HALF = Math.floor((RI - 8) / Math.SQRT2);
const SIDE = HALF * 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function ColorPanel({ studio }: {studio: Studio;}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const target = studio.colorTarget;
  const current = target === "stroke" ? studio.primary : studio.secondary;
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(current));
  const [hexText, setHexText] = useState(current);
  const mode = useRef<"ring" | "sv" | null>(null);

  useEffect(() => {
    setHexText(current);
    setHsv((prev) => {
      if (hsvToHex(prev) === current.toLowerCase()) return prev;
      const n = hexToHsv(current);
      if (n.s === 0 || n.v === 0) n.h = prev.h;
      return n;
    });
  }, [current]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = SIZE * dpr;
    c.height = SIZE * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.lineWidth = RO - RI;
    for (let a = 0; a < 360; a++) {
      ctx.beginPath();
      ctx.strokeStyle = `hsl(${a}, 100%, 50%)`;
      ctx.arc(C, C, (RO + RI) / 2, (a - 0.8) * Math.PI / 180, (a + 0.8) * Math.PI / 180);
      ctx.stroke();
    }
    const x0 = C - HALF;
    ctx.fillStyle = `hsl(${hsv.h}, 100%, 50%)`;
    ctx.fillRect(x0, x0, SIDE, SIDE);
    const gw = ctx.createLinearGradient(x0, 0, x0 + SIDE, 0);
    gw.addColorStop(0, "rgba(255,255,255,1)");
    gw.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gw;
    ctx.fillRect(x0, x0, SIDE, SIDE);
    const gb = ctx.createLinearGradient(0, x0, 0, x0 + SIDE);
    gb.addColorStop(0, "rgba(0,0,0,0)");
    gb.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = gb;
    ctx.fillRect(x0, x0, SIDE, SIDE);
  }, [hsv.h]);

  const apply = (n: HSV) => {
    setHsv(n);
    studio.setActiveColor(hsvToHex(n), false);
  };

  const handle = (e: React.PointerEvent<HTMLCanvasElement>, start: boolean) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - r.left) * (SIZE / r.width) - C;
    const dy = (e.clientY - r.top) * (SIZE / r.height) - C;
    const dist = Math.hypot(dx, dy);
    if (start) {
      mode.current = dist >= RI - 4 && dist <= RO + 4 ? "ring" : Math.abs(dx) <= HALF + 4 && Math.abs(dy) <= HALF + 4 ? "sv" : null;
      if (mode.current) {
        e.currentTarget.setPointerCapture(e.pointerId);
        studio.beginSelectionEdit();
      }
    }
    if (mode.current === "ring") {
      apply({ ...hsv, h: (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360 });
    } else if (mode.current === "sv") {
      apply({ ...hsv, s: clamp01((dx + HALF) / SIDE), v: clamp01(1 - (dy + HALF) / SIDE) });
    }
  };

  const commitHex = () => {
    const n = normalizeHex(hexText);
    if (n) studio.setActiveColor(n);else
    setHexText(current);
  };

  const pickColour = async () => {
    const ED = (window as unknown as {EyeDropper?: new () => {open: () => Promise<{sRGBHex: string;}>;};}).EyeDropper;
    if (!ED) {
      studio.setTool("eyedropper");
      studio.flash("Eyedropper — click or drag on the canvas");
      return;
    }
    try {
      const res = await new ED().open();
      const n = normalizeHex(res.sRGBHex);
      if (n) studio.setActiveColor(n);
    } catch {

      /* cancelled */}
  };

  const { r, g, b } = hexToRgb(current);
  const ringAngle = hsv.h * Math.PI / 180;
  const ringR = (RO + RI) / 2;
  const hasSelection = studio.selection.length > 0;

  return (
    <Panel title="Colour">
      <div className="flex flex-col items-center gap-ds-md" data-oid="d538ad3655" data-oid-text-editable="false" data-oid-text-source="element:div|element:div|element:label|expression:4cdb1b027ba1|element:div|element:dl">
        <div className="relative h-[216px] w-[216px]" data-oid="7ac676baf5">
          <canvas
            ref={canvasRef}
            className="h-[216px] w-[216px] cursor-crosshair touch-none"
            onPointerDown={(e) => handle(e, true)}
            onPointerMove={(e) => mode.current && handle(e, false)}
            onPointerUp={() => mode.current = null} data-oid="82083d390b" />
          
          <span
            className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
            style={{ left: C + Math.cos(ringAngle) * ringR, top: C + Math.sin(ringAngle) * ringR, backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }} data-oid="bcd9d7531c" data-oid-style-dynamic="left,top,backgroundColor" />
          
          <span
            className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
            style={{ left: C - HALF + hsv.s * SIDE, top: C - HALF + (1 - hsv.v) * SIDE, backgroundColor: current }} data-oid="932a6ca4b6" data-oid-style-dynamic="left,top,backgroundColor" />
          
        </div>

        {/* Stroke / Fill targets */}
        <div role="radiogroup" aria-label="Colour target" className="grid w-full grid-cols-[1fr_1fr_auto] items-stretch gap-ds-xs" data-oid="8525d0a8ea">
          <div className="flex items-stretch overflow-hidden rounded-md border border-border bg-background has-[[aria-checked=true]]:border-primary" data-oid="6ce27dff1d">
            <button
              type="button"
              role="radio"
              aria-checked={target === "stroke"}
              onClick={() => studio.setColorTarget("stroke")}
              title="Stroke colour (X toggles)"
              className="flex flex-1 items-center gap-ds-sm px-ds-sm py-ds-xs text-left hover:bg-secondary aria-checked:bg-secondary" data-oid="3563198232" data-oid-text-editable="false" data-oid-text-source="expression:689ab39198ce|element:span">
              {studio.strokeEnabled ?
              <span aria-hidden="true" className="h-6 w-6 shrink-0 rounded-sm border-[5px] shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" style={{ borderColor: studio.primary }} data-oid="dbca84a1a1" data-oid-style-dynamic="borderColor" /> :

              <span aria-hidden="true" className="relative h-6 w-6 shrink-0 overflow-hidden rounded-sm border border-border bg-foreground" data-oid="5092dc80cc">
                  <span className="absolute left-1/2 top-[-4px] h-8 w-[2px] -translate-x-1/2 rotate-45 bg-destructive" data-oid="0ced6c657f" />
                </span>
              }
              <span className="flex min-w-0 flex-col" data-oid="c3ff34b0f1">
                <span className="text-label font-semibold text-foreground" data-oid="c5f890d533">Stroke</span>
                <span className="type-caption text-muted-foreground" data-oid="a32d12a5e3">{studio.strokeEnabled ? studio.primary.toUpperCase() : "NONE"}</span>
              </span>
            </button>
            <button
              type="button"
              aria-label="No stroke"
              title="No stroke"
              aria-pressed={!studio.strokeEnabled}
              onClick={() => studio.setColorNone("stroke")}
              className="grid w-6 place-items-center border-l border-border text-muted-foreground hover:bg-secondary hover:text-foreground aria-pressed:text-destructive" data-oid="74d930724d">
              <Ban className="h-3 w-3" data-oid="c64030b17f" />
            </button>
          </div>

          <div className="flex items-stretch overflow-hidden rounded-md border border-border bg-background has-[[aria-checked=true]]:border-primary" data-oid="a771607470">
            <button
              type="button"
              role="radio"
              aria-checked={target === "fill"}
              onClick={() => studio.setColorTarget("fill")}
              title="Fill colour (X toggles)"
              className="flex flex-1 items-center gap-ds-sm px-ds-sm py-ds-xs text-left hover:bg-secondary aria-checked:bg-secondary" data-oid="32a2c0f5fc" data-oid-text-editable="false" data-oid-text-source="expression:70263f61c81d|element:span">
              {studio.shapeFill ?
              <span aria-hidden="true" className="h-6 w-6 shrink-0 rounded-sm border border-border" style={{ backgroundColor: studio.secondary }} data-oid="965ecae71e" data-oid-style-dynamic="backgroundColor" /> :

              <span aria-hidden="true" className="relative h-6 w-6 shrink-0 overflow-hidden rounded-sm border border-border bg-foreground" data-oid="1937335e09">
                  <span className="absolute left-1/2 top-[-4px] h-8 w-[2px] -translate-x-1/2 rotate-45 bg-destructive" data-oid="dfc68a4e55" />
                </span>
              }
              <span className="flex min-w-0 flex-col" data-oid="fdc31faa0f">
                <span className="text-label font-semibold text-foreground" data-oid="7db11b00c0">Fill</span>
                <span className="type-caption text-muted-foreground" data-oid="c10b97130e">{studio.shapeFill ? studio.secondary.toUpperCase() : "NONE"}</span>
              </span>
            </button>
            <button
              type="button"
              aria-label="No fill"
              title="No fill"
              aria-pressed={!studio.shapeFill}
              onClick={() => studio.setColorNone("fill")}
              className="grid w-6 place-items-center border-l border-border text-muted-foreground hover:bg-secondary hover:text-foreground aria-pressed:text-destructive" data-oid="b9b7c9a760">
              <Ban className="h-3 w-3" data-oid="0872eee8ba" />
            </button>
          </div>

          <button
            type="button"
            aria-label="Swap stroke and fill colours (Shift+X)"
            title="Swap stroke and fill (Shift+X)"
            onClick={studio.swapColors}
            className="grid w-7 place-items-center rounded-md border border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground" data-oid="88c1c4623c">
            <ArrowLeftRight className="h-3.5 w-3.5" data-oid="6719f8d443" />
          </button>
        </div>

        {/* Stroke weight */}
        <label className="flex w-full items-center gap-ds-sm text-label text-muted-foreground" data-oid="395f8afd61">
          <span className="w-[74px] shrink-0" data-oid="b50dac3e31">Stroke weight</span>
          <input
            type="range"
            min={0}
            max={120}
            value={studio.strokeEnabled ? studio.shapeStroke : 0}
            onPointerDown={studio.beginSelectionEdit}
            onChange={(e) => studio.setStrokeWidth(Number(e.target.value), false)}
            className="h-1 min-w-0 flex-1 cursor-pointer accent-primary" data-oid="3b43485597" />
          
          <output className="w-10 text-right type-caption text-foreground" data-oid="bfdf65cce5" data-oid-text-editable="false" data-oid-text-source="expression:b692506620af|text">{studio.strokeEnabled ? studio.shapeStroke : 0}px</output>
        </label>
        {hasSelection &&
        <p className="-mt-ds-sm w-full type-caption text-accent" data-oid="6e6199f99e" data-oid-text-editable="false" data-oid-text-source="text|expression:a9de39460c7e|text|expression:b0271ec5f9e3">EDITING {studio.selection.length} SELECTED · {target === "stroke" ? "STROKE" : "FILL"}</p>
        }

        <div className="flex w-full items-center gap-ds-sm" data-oid="f4d0194272">
          <label className="flex flex-1 items-center gap-ds-xs rounded-md border border-input bg-background px-ds-sm focus-within:border-primary" data-oid="6ab599e0f6">
            <span className="type-caption text-muted-foreground" data-oid="fda4b695b4">HEX</span>
            <input
              value={hexText.toUpperCase()}
              onChange={(e) => setHexText(e.target.value)}
              onBlur={commitHex}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
              spellCheck={false}
              maxLength={7}
              className="h-8 w-full bg-transparent type-caption text-foreground outline-none" data-oid="cbfda482bc" />
            
          </label>
          <button
            type="button"
            aria-label="Eyedropper — pick a colour from anywhere on screen (I)"
            title="Eyedropper (I)"
            aria-pressed={studio.tool === "eyedropper"}
            onClick={pickColour}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-input bg-background text-muted-foreground hover:bg-secondary hover:text-foreground aria-pressed:border-primary aria-pressed:text-primary" data-oid="eb48fd534e">
            <Pipette className="h-4 w-4" data-oid="d072e2ca24" />
          </button>
        </div>

        <dl className="grid w-full grid-cols-6 gap-ds-xs type-caption" data-oid="a7745831ab">
          <dt className="text-muted-foreground" data-oid="efbf4d3e74">R</dt>
          <dd className="text-foreground" data-oid="80da92405d">{r}</dd>
          <dt className="text-muted-foreground" data-oid="aa4afe5c5f">G</dt>
          <dd className="text-foreground" data-oid="5de1ed7b42">{g}</dd>
          <dt className="text-muted-foreground" data-oid="7f30b200fd">B</dt>
          <dd className="text-foreground" data-oid="cfe07bc70b">{b}</dd>
          <dt className="text-muted-foreground" data-oid="c489fbc953">H</dt>
          <dd className="text-foreground" data-oid="851d73fa2b" data-oid-text-editable="false" data-oid-text-source="expression:9303d6dcf1d1|text">{Math.round(hsv.h)}°</dd>
          <dt className="text-muted-foreground" data-oid="9b8c24af40">S</dt>
          <dd className="text-foreground" data-oid="47066fbbe1" data-oid-text-editable="false" data-oid-text-source="expression:572cc6bd8e83|text">{Math.round(hsv.s * 100)}%</dd>
          <dt className="text-muted-foreground" data-oid="7fa5dc4757">V</dt>
          <dd className="text-foreground" data-oid="9632ede705" data-oid-text-editable="false" data-oid-text-source="expression:a927e099b37e|text">{Math.round(hsv.v * 100)}%</dd>
        </dl>
      </div>
    </Panel>);

}