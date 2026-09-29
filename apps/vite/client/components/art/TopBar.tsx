import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileImage, FilePlus2, FolderOpen, Maximize, Minus, Plus, Redo2, Save, Shapes, Trash2, Undo2 } from "lucide-react";
import type { Studio } from "./useStudio";
import { BRUSHES } from "../../lib/art/types";
import { desktop } from "../../lib/art/desktop";
import { ArtLifeLogo } from "./ArtLifeLogo";

const barBtn =
"inline-flex h-7 items-center gap-ds-xs rounded-md px-ds-sm text-label text-muted-foreground hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-35";

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
  onPointerDown
}: {label: string;value: number;min: number;max: number;step?: number;format: (v: number) => string;onChange: (v: number) => void;onPointerDown?: () => void;}) {
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
        onPointerDown={onPointerDown}
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
  if (t === "line" || t === "rect" || t === "ellipse" || t === "pen") {
    return (
      <div className="flex items-center gap-ds-lg" data-oid="537405d26c" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true" data-oid-text-editable="false">
        <Range label="Stroke" value={studio.strokeEnabled ? studio.shapeStroke : 0} min={0} max={120} format={(v) => `${v}px`} onPointerDown={studio.beginSelectionEdit} onChange={(v) => studio.setStrokeWidth(v, false)} />
        {t !== "line" &&
        <label className="flex items-center gap-ds-xs text-label text-muted-foreground" data-oid="ef164641b7">
            <input type="checkbox" checked={studio.shapeFill} onChange={(e) => studio.setFillEnabled(e.target.checked)} className="accent-primary" data-oid="4e8387f698" />
            Fill
          </label>
        }
        <p className="type-caption text-muted-foreground" data-oid="4f56fef441">{t === "pen" ? "CLICK CORNER · DRAG CURVE · CLICK START TO CLOSE · ENTER FINISHES · ⌫ UNDOES POINT" : "SHIFT constrains"}</p>
      </div>);

  }
  if (t === "fill") {
    return (
      <div className="flex items-center gap-ds-lg" data-oid="44fb5545d4" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true">
        <Range label="Tolerance" value={studio.fillTolerance} min={0} max={255} format={(v) => `${v}`} onChange={studio.setFillTolerance} />
        <p className="type-caption text-muted-foreground" data-oid="6b20576528">LIVE PAINT · EACH CLICK MAKES A VECTOR SHAPE ON A VECTOR LAYER</p>
      </div>);

  }
  if (t === "select" || t === "direct" || t === "move" || t === "lasso" || t === "transform") {
    return (
      <div className="flex items-center gap-ds-sm" data-oid="ea401170a0" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true" data-oid-text-editable="false" data-oid-text-source="element:p|expression:a2c8264db307|element:button|element:button|element:button|element:p">
        <p className="type-caption text-muted-foreground" data-oid="d702681c17">
          <output className="text-accent" data-oid="f0e5a67eba">{studio.selection.length}</output> SELECTED
        </p>
        {studio.selection.length > 0 &&
        <Range label="Stroke" value={studio.strokeEnabled ? studio.shapeStroke : 0} min={0} max={120} format={(v) => `${v}px`} onPointerDown={studio.beginSelectionEdit} onChange={(v) => studio.setStrokeWidth(v, false)} />
        }
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
          {t === "transform" ? "CORNERS SCALE · TOP HANDLE ROTATES · SHIFT SNAPS 15°" : t === "direct" ? "DRAG ANCHORS TO RESHAPE VECTORS" : t === "select" ? "CORNERS SCALE · TOP HANDLE ROTATES" : t === "move" ? "CORNERS SCALE · TOP HANDLE ROTATES · NO SELECTION MOVES LAYER" : "DRAW A LOOP · SHIFT ADDS"}
        </p>
      </div>);

  }
  return (
    <p className="type-caption text-muted-foreground" data-oid="d383281115" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true">
      {t === "penAdd" ? "CLICK A PATH OR SHAPE TO ADD AN ANCHOR · CURVE SHAPE IS KEPT" : t === "penDelete" ? "CLICK AN ANCHOR TO REMOVE IT" : t === "penConvert" ? "CLICK ANCHOR: SMOOTH ⇄ CORNER · DRAG ANCHOR: PULL OUT CURVE · DRAG HANDLE: BREAK IT" : t === "eyedropper" ? "CLICK TO SAMPLE · ALT+CLICK WITH BRUSH" : t === "zoom" ? "CLICK ZOOM IN · ALT+CLICK ZOOM OUT" : "DRAG TO PAN · HOLD SPACE ANYWHERE"}
    </p>);

}

function SaveExportMenu({ studio }: {studio: Studio;}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  return (
    <div ref={ref} className="ds-menu" data-oid="3b1957eb9f" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true" data-oid-text-editable="false" data-oid-text-source="element:button|expression:3db052496be3">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex h-7 items-center gap-ds-xs rounded-md px-ds-sm text-label text-muted-foreground hover:bg-secondary hover:text-foreground aria-expanded:bg-secondary aria-expanded:text-foreground" data-oid="2315e790c4">
        <Download className="h-3.5 w-3.5" data-oid="6413f089d1" /> Save / Export <ChevronDown className="h-3 w-3" data-oid="8d5267fcda" />
      </button>
      {open &&
      <div role="menu" className="ds-menu-popover w-[248px]" data-oid="379d2e6e08">
          <p className="px-ds-sm pt-ds-xs type-caption text-muted-foreground" data-oid="e36e90f721">SAVE</p>
          <button type="button" role="menuitem" className="ds-menu-item flex items-center gap-ds-sm" onClick={() => run(studio.saveDTM)} data-oid="7fc7ec1a17">
            <Save className="h-3.5 w-3.5" data-oid="50b43c213a" />
            <span className="flex-1" data-oid="b2938a6ab1">Save project (.dtm)</span>
            <kbd className="type-caption opacity-70" data-oid="da7027e7fe">Ctrl S</kbd>
          </button>
          <div className="my-[2px] h-px bg-border" data-oid="9f39e4485f" />
          <p className="px-ds-sm pt-ds-xs type-caption text-muted-foreground" data-oid="7c3e81cfd8">EXPORT</p>
          <button type="button" role="menuitem" className="ds-menu-item flex items-center gap-ds-sm" onClick={() => run(studio.exportPNG)} data-oid="098842f88a">
            <FileImage className="h-3.5 w-3.5" data-oid="72658d356a" />
            <span className="flex-1" data-oid="2abe30d56b">Export PNG</span>
            <kbd className="type-caption opacity-70" data-oid="52327e011c">RASTER</kbd>
          </button>
          <button type="button" role="menuitem" className="ds-menu-item flex items-center gap-ds-sm" onClick={() => run(studio.exportSVG)} data-oid="d7769140d7">
            <Shapes className="h-3.5 w-3.5" data-oid="8db0b1dedc" />
            <span className="flex-1" data-oid="7be764d659">Export SVG</span>
            <kbd className="type-caption opacity-70" data-oid="755e0e8932">Ctrl ⇧ S</kbd>
          </button>
        </div>
      }
    </div>);

}

export function TopBar({ studio }: {studio: Studio;}) {
  return (
    <header className="relative z-30 flex h-11 shrink-0 items-center gap-ds-md border-b border-border bg-card px-ds-md" data-oid="a2f4138c72" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true">
      <div className="flex w-[268px] items-center gap-ds-sm" data-oid="1c35455b9f">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground" data-oid="cdfad74185">
          <ArtLifeLogo className="h-[18px] w-[18px]" />
        </span>
        <div className="flex min-w-0 flex-col" data-oid="a99936dc9a">
          <h1 className="whitespace-nowrap text-heading font-bold leading-[1.1] tracking-[-0.02em] text-foreground" data-oid="13a9d052e2">
            Art Life <span className="font-medium text-muted-foreground" data-oid="9509dd1f61">Creative Studio</span>
          </h1>
          <span className="type-caption leading-[1.2] text-muted-foreground" data-oid="484fbb7b69" data-oid-text-editable="false" data-oid-text-source="expression:22fd92977b0f|text">{desktop ? "DESKTOP" : "WEB"} v1.0</span>
        </div>
      </div>

      <div className="flex items-center gap-ds-xs border-l border-border pl-ds-md" data-oid="04ea314637">
        <button type="button" className={barBtn} onClick={() => studio.setNewDialogOpen(true)} data-oid="58a6bc99c3" data-oid-classname-dynamic="true">
          <FilePlus2 className="h-3.5 w-3.5" data-oid="10c1d7820a" /> New
        </button>
        <button type="button" className={barBtn} onClick={studio.openFile} data-oid="854880934f" data-oid-classname-dynamic="true">
          <FolderOpen className="h-3.5 w-3.5" data-oid="c62051a445" /> Open
        </button>
        <input
          ref={studio.fileInputRef}
          type="file"
          accept=".dtm"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) studio.loadDTM(file);
            e.target.value = "";
          }} data-oid="fc3d75f830" />
        <SaveExportMenu studio={studio} />
        <button type="button" aria-label="Undo (Ctrl+Z)" className={barBtn} disabled={!studio.canUndo} onClick={studio.undo} data-oid="72597542c3" data-oid-classname-dynamic="true">
          <Undo2 className="h-3.5 w-3.5" data-oid="a1e5fc13a5" />
        </button>
        <button type="button" aria-label="Redo (Ctrl+Shift+Z)" className={barBtn} disabled={!studio.canRedo} onClick={studio.redo} data-oid="af0434ccfd" data-oid-classname-dynamic="true">
          <Redo2 className="h-3.5 w-3.5" data-oid="e36fe7fad9" />
        </button>
      </div>

      <p className="max-w-[160px] truncate border-l border-border pl-ds-md type-caption text-foreground" title={`${studio.docName}.dtm`} data-oid="79f4256f29" data-oid-text-editable="false" data-oid-text-source="expression:9d9f7d6e6a4b|element:span">
        {studio.docName}<span className="text-muted-foreground" data-oid="8e09a1a12e">.dtm</span>
      </p>

      <div className="flex min-w-0 flex-1 items-center border-l border-border pl-ds-md" data-oid="b9de1a1872">
        <ToolOptions studio={studio} />
      </div>

      <div className="flex items-center gap-ds-xs" data-oid="20df5d0044">
        <button type="button" aria-label="Zoom out" className={barBtn} onClick={() => studio.zoomBy(0.8)} data-oid="4fa5a48533" data-oid-classname-dynamic="true">
          <Minus className="h-3.5 w-3.5" data-oid="f2cc8474c4" />
        </button>
        <output className="w-12 text-center type-caption text-foreground" data-oid="1bff655e18" data-oid-text-editable="false" data-oid-text-source="expression:1b6678dec838|text">{Math.round(studio.view.zoom * 100)}%</output>
        <button type="button" aria-label="Zoom in" className={barBtn} onClick={() => studio.zoomBy(1.25)} data-oid="e4b7498cd4" data-oid-classname-dynamic="true">
          <Plus className="h-3.5 w-3.5" data-oid="fa69b86c35" />
        </button>
        <button type="button" className={barBtn} onClick={studio.requestFit} data-oid="0ddf8ab4ec" data-oid-classname-dynamic="true">
          <Maximize className="h-3.5 w-3.5" data-oid="814e355a4e" /> Fit
        </button>
      </div>
    </header>);

}