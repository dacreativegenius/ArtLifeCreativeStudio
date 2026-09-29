import { useEffect, useRef } from "react";
import type { Studio } from "./useStudio";
import { Panel } from "./Panel";
import type { BrushId, Pt } from "../../lib/art/types";
import { drawItem, isVectorBrush, simplify } from "../../lib/art/render";
import { readCssColor } from "../../lib/art/color";

const PW = 248;
const PH = 34;

function BrushPreview({ brush, size, opacity }: {brush: BrushId;size: number;opacity: number;}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = PW * dpr;
    c.height = PH * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PW, PH);
    const pts: Pt[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      pts.push({ x: 14 + t * (PW - 28), y: PH / 2 + Math.sin(t * Math.PI * 2) * (PH * 0.22), p: 0.12 + 0.88 * Math.sin(t * Math.PI) });
    }
    drawItem(ctx, {
      id: "preview",
      kind: "stroke",
      brush,
      color: readCssColor("--foreground", "#eeeeee"),
      size: Math.min(size, 16),
      opacity,
      points: isVectorBrush(brush) ? simplify(pts, 0.4) : pts,
      seed: 11
    });
  }, [brush, size, opacity]);
  return <canvas ref={ref} aria-hidden="true" className="h-[34px] w-full" data-oid="be4803aba4" data-oid-instance-targetable="true" data-oid-component-root="true" />;
}

export function BrushPanel({ studio }: {studio: Studio;}) {
  const pick = (id: BrushId) => {
    studio.setBrushId(id);
    studio.setTool("brush");
  };
  const s = studio.brushSettings;
  const cur = studio.currentBrush;
  return (
    <Panel title="Brushes">
      <div role="listbox" aria-label="Brushes" className="flex flex-col gap-ds-xs" data-oid="40aea46599">
        <button
          type="button"
          role="option"
          aria-selected={studio.brushId === "pencil-pressure"}
          onClick={() => pick("pencil-pressure")}
          className="flex flex-col gap-ds-xs rounded-md border border-transparent bg-background px-ds-sm py-ds-xs text-left hover:border-border aria-selected:border-primary aria-selected:bg-secondary" data-oid="95d1986f43">
          
          <span className="flex items-baseline justify-between" data-oid="522ade94a9">
            <span className="text-label font-semibold text-foreground" data-oid="83ac4cde0b">Sketch Pencil</span>
            <span className="type-caption text-primary" data-oid="3528b044b6">1 · PRESSURE</span>
          </span>
          <BrushPreview brush="pencil-pressure" size={s["pencil-pressure"].size} opacity={s["pencil-pressure"].opacity} />
          <span className="type-caption text-muted-foreground" data-oid="873c635c21">Graphite · tapered weight + opacity</span>
        </button>

        <button
          type="button"
          role="option"
          aria-selected={studio.brushId === "pencil-fixed"}
          onClick={() => pick("pencil-fixed")}
          className="flex flex-col gap-ds-xs rounded-md border border-transparent bg-background px-ds-sm py-ds-xs text-left hover:border-border aria-selected:border-primary aria-selected:bg-secondary" data-oid="10e9069922">
          
          <span className="flex items-baseline justify-between" data-oid="e4c6ad36a0">
            <span className="text-label font-semibold text-foreground" data-oid="da5b9ccf10">Tech Pencil</span>
            <span className="type-caption text-muted-foreground" data-oid="b5f1983449">2 · FIXED</span>
          </span>
          <BrushPreview brush="pencil-fixed" size={s["pencil-fixed"].size} opacity={s["pencil-fixed"].opacity} />
          <span className="type-caption text-muted-foreground" data-oid="078a0feb91">Graphite · constant width</span>
        </button>

        <button
          type="button"
          role="option"
          aria-selected={studio.brushId === "vector-pressure"}
          onClick={() => pick("vector-pressure")}
          className="flex flex-col gap-ds-xs rounded-md border border-transparent bg-background px-ds-sm py-ds-xs text-left hover:border-border aria-selected:border-accent aria-selected:bg-secondary" data-oid="fe475dc7f7">
          
          <span className="flex items-baseline justify-between" data-oid="43063d8167">
            <span className="text-label font-semibold text-foreground" data-oid="a325dd2490">Pressure Ink</span>
            <span className="type-caption text-accent" data-oid="04d9d54c1a">3 · PRESSURE</span>
          </span>
          <BrushPreview brush="vector-pressure" size={s["vector-pressure"].size} opacity={s["vector-pressure"].opacity} />
          <span className="type-caption text-muted-foreground" data-oid="4126cc804a">Vector · weight follows pressure</span>
        </button>

        <button
          type="button"
          role="option"
          aria-selected={studio.brushId === "vector-fixed"}
          onClick={() => pick("vector-fixed")}
          className="flex flex-col gap-ds-xs rounded-md border border-transparent bg-background px-ds-sm py-ds-xs text-left hover:border-border aria-selected:border-accent aria-selected:bg-secondary" data-oid="ce2f3435dd">
          
          <span className="flex items-baseline justify-between" data-oid="6c7e8eecfd">
            <span className="text-label font-semibold text-foreground" data-oid="63c07ad521">Mono Liner</span>
            <span className="type-caption text-muted-foreground" data-oid="bacc5ea5f9">4 · FIXED</span>
          </span>
          <BrushPreview brush="vector-fixed" size={s["vector-fixed"].size} opacity={s["vector-fixed"].opacity} />
          <span className="type-caption text-muted-foreground" data-oid="9177913b3e">Vector · uniform width, round caps</span>
        </button>
      </div>

      <div className="mt-ds-md flex flex-col gap-ds-sm" data-oid="3972e47a59">
        <label className="grid grid-cols-[64px_1fr_44px] items-center gap-ds-sm text-label text-muted-foreground" data-oid="7409c14eb1">
          Size
          <input type="range" min={1} max={120} value={cur.size} onChange={(e) => studio.updateBrush({ size: Number(e.target.value) })} className="accent-primary" data-oid="581e147c09" />
          <output className="text-right type-caption text-foreground" data-oid="87f78ce56c" data-oid-text-editable="false" data-oid-text-source="expression:90710e42688a|text">{cur.size}px</output>
        </label>
        <label className="grid grid-cols-[64px_1fr_44px] items-center gap-ds-sm text-label text-muted-foreground" data-oid="0edc012754">
          Opacity
          <input
            type="range"
            min={5}
            max={100}
            value={Math.round(cur.opacity * 100)}
            onChange={(e) => studio.updateBrush({ opacity: Number(e.target.value) / 100 })}
            className="accent-primary" data-oid="898fef3884" />
          
          <output className="text-right type-caption text-foreground" data-oid="645c5961ca" data-oid-text-editable="false" data-oid-text-source="expression:17fd892d30f8|text">{Math.round(cur.opacity * 100)}%</output>
        </label>
        <label className="grid grid-cols-[64px_1fr_44px] items-center gap-ds-sm text-label text-muted-foreground" data-oid="e572911bb5">
          Stabilizer
          <input
            type="range"
            min={0}
            max={90}
            value={Math.round(studio.stabilizer * 100)}
            onChange={(e) => studio.setStabilizer(Number(e.target.value) / 100)}
            className="accent-primary" data-oid="292d3da16a" />
          
          <output className="text-right type-caption text-foreground" data-oid="bf8f9bad08" data-oid-text-editable="false" data-oid-text-source="expression:4d15515b5b0d|text">{Math.round(studio.stabilizer * 100)}%</output>
        </label>
        <label className="flex items-center gap-ds-sm text-label text-muted-foreground" data-oid="159985f482">
          <input type="checkbox" checked={studio.simulatePressure} onChange={(e) => studio.setSimulatePressure(e.target.checked)} className="accent-primary" data-oid="e56bf177a4" />
          Simulate pressure from mouse speed
        </label>
        <p className="type-caption text-muted-foreground" data-oid="34703ca212">STYLUS PRESSURE IS READ AUTOMATICALLY · [ ] RESIZE</p>
      </div>
    </Panel>);

}