import { Download, FilePlus2, Maximize, Minus, PenTool, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import type { Studio } from "./useStudio";
import { BRUSHES } from "../../lib/art/types";

const barBtn =
"inline-flex h-7 items-center gap-ds-xs rounded-md px-ds-sm text-label text-muted-foreground hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-35";

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange








}: {label: string;value: number;min: number;max: number;step?: number;format: (v: number) => string;onChange: (v: number) => void;}) {
  return (
    <label className="flex items-center gap-ds-sm text-label text-muted-foreground" data-oid="6213878dcc" data-oid-component-root="true" data-oid-text-editable="false" data-oid-text-source="expression:64c65374dbab|element:input|element:output">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-28 cursor-pointer accent-primary" data-oid="0e4ba497ec" />
      
      <output className="w-10 type-caption text-foreground" data-oid="f47c6f1e4a">{format(value)}</output>
    </label>);

}

function ToolOptions({ studio }: {studio: Studio;}) {
  const t = studio.tool;
  if (t === "brush") {
    const b = BRUSHES.find((x) => x.id === studio.brushId)!;
    return (
      <div className="flex items-center gap-ds-lg" data-oid="8d7add58d4" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true">
        <p className="text-label font-semibold text-foreground" data-oid="2d7bf79e54" data-oid-text-editable="false" data-oid-text-source="expression:8e5a40619b22|element:span">
          {b.name} <span className="type-caption font-normal text-muted-foreground" data-oid="dee38a1a9c" data-oid-text-editable="false" data-oid-text-source="expression:54f0250715f9|expression:cabdbe004262">{b.family.toUpperCase()}{b.pressure ? " · PRESSURE" : " · FIXED"}</span>
        </p>
        <Range label="Size" value={studio.currentBrush.size} min={1} max={120} format={(v) => `${v}px`} onChange={(v) => studio.updateBrush({ size: v })} />
        <Range
          label="Opacity"
          value={Math.round(studio.currentBrush.opacity * 100)}
          min={5}
          max={100}
          format={(v) => `${v}%`}
          onChange={(v) => studio.updateBrush({ opacity: v / 100 })} />
        
      </div>);

  }
  if (t === "eraser") {
    return <Range label="Eraser size" value={studio.eraserSize} min={1} max={200} format={(v) => `${v}px`} onChange={studio.setEraserSize} />;
  }
  if (t === "line" || t === "rect" || t === "ellipse") {
    return (
      <div className="flex items-center gap-ds-lg" data-oid="537405d26c" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true" data-oid-text-editable="false">
        <Range label="Stroke" value={studio.shapeStroke} min={0} max={60} format={(v) => `${v}px`} onChange={studio.setShapeStroke} />
        {t !== "line" &&
        <label className="flex items-center gap-ds-xs text-label text-muted-foreground" data-oid="ef164641b7">
            <input type="checkbox" checked={studio.shapeFill} onChange={(e) => studio.setShapeFill(e.target.checked)} className="accent-primary" data-oid="4e8387f698" />
            Fill with secondary colour
          </label>
        }
        <p className="type-caption text-muted-foreground" data-oid="4f56fef441">SHIFT constrains</p>
      </div>);

  }
  if (t === "fill") {
    return <Range label="Tolerance" value={studio.fillTolerance} min={0} max={255} format={(v) => `${v}`} onChange={studio.setFillTolerance} />;
  }
  if (t === "select" || t === "direct" || t === "move" || t === "lasso") {
    return (
      <div className="flex items-center gap-ds-sm" data-oid="ea401170a0" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true">
        <p className="type-caption text-muted-foreground" data-oid="6b20576528">
          <output className="text-accent" data-oid="f0e5a67eba">{studio.selection.length}</output> SELECTED
        </p>
        <button type="button" className={barBtn} onClick={studio.selectAll} data-oid="b053a94375" data-oid-classname-dynamic="true">
          Select all
        </button>
        <button type="button" className={barBtn} disabled={!studio.selection.length} onClick={() => studio.setSelection([])} data-oid="c65149f025" data-oid-classname-dynamic="true">
          Deselect
        </button>
        <button type="button" className={barBtn} disabled={!studio.selection.length} onClick={studio.deleteSelection} data-oid="4b67f11f1b" data-oid-classname-dynamic="true">
          <Trash2 className="h-3.5 w-3.5" data-oid="82d232198f" /> Delete
        </button>
        <p className="type-caption text-muted-foreground" data-oid="f1f71b57d4">
          {t === "direct" ? "DRAG ANCHORS TO RESHAPE VECTORS" : t === "select" ? "DRAG CORNERS TO SCALE" : t === "move" ? "NO SELECTION MOVES WHOLE LAYER" : "DRAW A LOOP · SHIFT ADDS"}
        </p>
      </div>);

  }
  return (
    <p className="type-caption text-muted-foreground" data-oid="d383281115" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true">
      {t === "eyedropper" ? "CLICK TO SAMPLE · ALT+CLICK WITH BRUSH" : t === "zoom" ? "CLICK ZOOM IN · ALT+CLICK ZOOM OUT" : "DRAG TO PAN · HOLD SPACE ANYWHERE"}
    </p>);

}

export function TopBar({ studio }: {studio: Studio;}) {
  return (
    <header className="relative z-30 flex h-11 shrink-0 items-center gap-ds-md border-b border-border bg-card px-ds-md" data-oid="a2f4138c72" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true">
      <div className="flex w-[200px] items-center gap-ds-sm" data-oid="1c35455b9f">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground" data-oid="cdfad74185">
          <PenTool className="h-4 w-4" strokeWidth={2.25} data-oid="2121999639" />
        </span>
        <h1 className="text-heading font-bold tracking-[-0.02em] text-foreground" data-oid="13a9d052e2">
          Art Life
        </h1>
        <span className="type-caption text-muted-foreground" data-oid="484fbb7b69">v0.1</span>
      </div>

      <div className="flex items-center gap-ds-xs border-l border-border pl-ds-md" data-oid="04ea314637">
        <button type="button" className={barBtn} onClick={studio.newDocument} data-oid="58a6bc99c3" data-oid-classname-dynamic="true">
          <FilePlus2 className="h-3.5 w-3.5" data-oid="10c1d7820a" /> New
        </button>
        <button type="button" className={barBtn} onClick={studio.exportPNG} data-oid="a050b4d38b" data-oid-classname-dynamic="true">
          <Download className="h-3.5 w-3.5" data-oid="fc0a3ad25a" /> Export PNG
        </button>
        <button type="button" aria-label="Undo (Ctrl+Z)" className={barBtn} disabled={!studio.canUndo} onClick={studio.undo} data-oid="72597542c3" data-oid-classname-dynamic="true">
          <Undo2 className="h-3.5 w-3.5" data-oid="a1e5fc13a5" />
        </button>
        <button type="button" aria-label="Redo (Ctrl+Shift+Z)" className={barBtn} disabled={!studio.canRedo} onClick={studio.redo} data-oid="af0434ccfd" data-oid-classname-dynamic="true">
          <Redo2 className="h-3.5 w-3.5" data-oid="e36fe7fad9" />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 items-center border-l border-border pl-ds-md" data-oid="b9de1a1872">
        <ToolOptions studio={studio} />
      </div>

      <div className="flex items-center gap-ds-xs" data-oid="20df5d0044">
        <button type="button" aria-label="Zoom out" className={barBtn} onClick={() => studio.zoomBy(0.8)} data-oid="4fa5a48533" data-oid-classname-dynamic="true">
          <Minus className="h-3.5 w-3.5" data-oid="9f39e4485f" />
        </button>
        <output className="w-12 text-center type-caption text-foreground" data-oid="1bff655e18" data-oid-text-editable="false" data-oid-text-source="expression:1b6678dec838|text">{Math.round(studio.view.zoom * 100)}%</output>
        <button type="button" aria-label="Zoom in" className={barBtn} onClick={() => studio.zoomBy(1.25)} data-oid="e4b7498cd4" data-oid-classname-dynamic="true">
          <Plus className="h-3.5 w-3.5" data-oid="fa69b86c35" />
        </button>
        <button type="button" className={barBtn} onClick={studio.requestFit} data-oid="0ddf8ab4ec" data-oid-classname-dynamic="true">
          <Maximize className="h-3.5 w-3.5" data-oid="d7769140d7" /> Fit
        </button>
      </div>
    </header>);

}