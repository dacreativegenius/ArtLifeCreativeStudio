import { useEffect, useRef, useState } from "react";
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
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(studio.primary));
  const [hexText, setHexText] = useState(studio.primary);
  const mode = useRef<"ring" | "sv" | null>(null);

  useEffect(() => {
    setHexText(studio.primary);
    setHsv((prev) => {
      if (hsvToHex(prev) === studio.primary.toLowerCase()) return prev;
      const n = hexToHsv(studio.primary);
      if (n.s === 0 || n.v === 0) n.h = prev.h;
      return n;
    });
  }, [studio.primary]);

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
    studio.setPrimary(hsvToHex(n));
  };

  const handle = (e: React.PointerEvent<HTMLCanvasElement>, start: boolean) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - r.left) * (SIZE / r.width) - C;
    const dy = (e.clientY - r.top) * (SIZE / r.height) - C;
    const dist = Math.hypot(dx, dy);
    if (start) {
      mode.current = dist >= RI - 4 && dist <= RO + 4 ? "ring" : Math.abs(dx) <= HALF + 4 && Math.abs(dy) <= HALF + 4 ? "sv" : null;
      if (mode.current) e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (mode.current === "ring") {
      apply({ ...hsv, h: (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360 });
    } else if (mode.current === "sv") {
      apply({ ...hsv, s: clamp01((dx + HALF) / SIDE), v: clamp01(1 - (dy + HALF) / SIDE) });
    }
  };

  const commitHex = () => {
    const n = normalizeHex(hexText);
    if (n) studio.setPrimary(n);else
    setHexText(studio.primary);
  };

  const { r, g, b } = hexToRgb(studio.primary);
  const ringAngle = hsv.h * Math.PI / 180;
  const ringR = (RO + RI) / 2;

  return (
    <Panel title="Colour">
      <div className="flex flex-col items-center gap-ds-md" data-oid="6327f8cfad">
        <div className="relative h-[216px] w-[216px]" data-oid="84b3fca62d">
          <canvas
            ref={canvasRef}
            className="h-[216px] w-[216px] cursor-crosshair touch-none"
            onPointerDown={(e) => handle(e, true)}
            onPointerMove={(e) => mode.current && handle(e, false)}
            onPointerUp={() => mode.current = null} data-oid="c3b9b9cf99" />
          
          <span
            className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
            style={{ left: C + Math.cos(ringAngle) * ringR, top: C + Math.sin(ringAngle) * ringR, backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }} data-oid="d7718727d5" data-oid-style-dynamic="left,top,backgroundColor" />
          
          <span
            className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
            style={{ left: C - HALF + hsv.s * SIDE, top: C - HALF + (1 - hsv.v) * SIDE, backgroundColor: studio.primary }} data-oid="4816843248" data-oid-style-dynamic="left,top,backgroundColor" />
          
        </div>

        <div className="flex w-full items-center gap-ds-sm" data-oid="326039d321">
          <div className="relative h-9 w-12 shrink-0" data-oid="44f4b033fc">
            <button
              type="button"
              aria-label="Swap with secondary colour"
              onClick={studio.swapColors}
              className="absolute bottom-0 right-0 h-6 w-8 rounded-sm border border-border"
              style={{ backgroundColor: studio.secondary }} data-oid="fe2ad560ee" data-oid-style-dynamic="backgroundColor" />
            
            <span className="absolute left-0 top-0 h-6 w-8 rounded-sm border-2 border-foreground" style={{ backgroundColor: studio.primary }} data-oid="0b3c2aae18" data-oid-style-dynamic="backgroundColor" />
          </div>
          <label className="flex flex-1 items-center gap-ds-xs rounded-md border border-input bg-background px-ds-sm focus-within:border-primary" data-oid="8c41bc35c0">
            <span className="type-caption text-muted-foreground" data-oid="2f398e7df9">HEX</span>
            <input
              value={hexText.toUpperCase()}
              onChange={(e) => setHexText(e.target.value)}
              onBlur={commitHex}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
              spellCheck={false}
              maxLength={7}
              className="h-8 w-full bg-transparent type-caption text-foreground outline-none" data-oid="677db62d01" />
            
          </label>
        </div>

        <dl className="grid w-full grid-cols-6 gap-ds-xs type-caption" data-oid="5d2dce1b53">
          <dt className="text-muted-foreground" data-oid="8253623dc1">R</dt>
          <dd className="text-foreground" data-oid="3de49e0b78">{r}</dd>
          <dt className="text-muted-foreground" data-oid="55a7f9a867">G</dt>
          <dd className="text-foreground" data-oid="e77d5ead99">{g}</dd>
          <dt className="text-muted-foreground" data-oid="fee28e66bd">B</dt>
          <dd className="text-foreground" data-oid="66d740c596">{b}</dd>
          <dt className="text-muted-foreground" data-oid="d26d202885">H</dt>
          <dd className="text-foreground" data-oid="31f554cbd0" data-oid-text-editable="false" data-oid-text-source="expression:9303d6dcf1d1|text">{Math.round(hsv.h)}°</dd>
          <dt className="text-muted-foreground" data-oid="ea84aa4dec">S</dt>
          <dd className="text-foreground" data-oid="a507b31dff" data-oid-text-editable="false" data-oid-text-source="expression:572cc6bd8e83|text">{Math.round(hsv.s * 100)}%</dd>
          <dt className="text-muted-foreground" data-oid="ad1fa0b7b9">V</dt>
          <dd className="text-foreground" data-oid="e71386594a" data-oid-text-editable="false" data-oid-text-source="expression:a927e099b37e|text">{Math.round(hsv.v * 100)}%</dd>
        </dl>
      </div>
    </Panel>);

}