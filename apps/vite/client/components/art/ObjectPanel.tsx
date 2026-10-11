import { useState } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowUp,
  BringToFront,
  FlipHorizontal2,
  FlipVertical2,
  Group,
  Link,
  RotateCcw,
  RotateCw,
  SendToBack,
  Shapes,
  Ungroup,
  Unlink } from
"lucide-react";
import type { Studio } from "./useStudio";
import { Panel } from "./Panel";
import { NumInput } from "./NumInput";

const tile =
"grid h-9 place-items-center rounded-md border border-border bg-background text-muted-foreground hover:border-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-35";

/* Pathfinder glyphs: two overlapping squares, the kept area filled. */
function PfUnite() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" aria-hidden="true" data-oid="0f1e8670d0" data-oid-component-root="true">
      <path d="M2 2h10v6h6v10H8v-6H2z" fill="currentColor" />
    </svg>);
}
function PfMinus() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" aria-hidden="true" data-oid="f8fbf1f55d" data-oid-component-root="true">
      <path d="M2 2h10v6H8v4H2z" fill="currentColor" />
      <rect x="8.5" y="8.5" width="9" height="9" fill="none" stroke="currentColor" strokeDasharray="2 1.5" />
    </svg>);
}
function PfIntersect() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" aria-hidden="true" data-oid="6e83ce97ec" data-oid-component-root="true">
      <rect x="2.5" y="2.5" width="9" height="9" fill="none" stroke="currentColor" strokeDasharray="2 1.5" />
      <rect x="8.5" y="8.5" width="9" height="9" fill="none" stroke="currentColor" strokeDasharray="2 1.5" />
      <rect x="8" y="8" width="4" height="4" fill="currentColor" />
    </svg>);
}
function PfExclude() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" aria-hidden="true" data-oid="32dc8c7774" data-oid-component-root="true">
      <path d="M2 2h10v6H8v4H2zM12 8h6v10H8v-6h4z" fill="currentColor" />
      <rect x="8.5" y="8.5" width="3" height="3" fill="none" stroke="currentColor" />
    </svg>);
}

export function ObjectPanel({ studio }: {studio: Studio;}) {
  const [lock, setLock] = useState(true);
  const has = studio.selection.length > 0;
  const b = has ? studio.getSelectionBounds() : null;

  return (
    <>
      {!has &&
      <p className="border-b border-border px-ds-md py-ds-md type-caption text-muted-foreground" data-oid="b7d7f1bef3">
          SELECT OBJECTS (V) TO TRANSFORM, ALIGN, COMBINE OR CONVERT THEM
        </p>
      }

      <Panel title="Group">
        <div className="grid grid-cols-2 gap-ds-sm" data-oid="751aae971f">
          <button type="button" disabled={studio.selection.length < 2} onClick={studio.groupSelection} className="inline-flex h-12 items-center justify-center gap-ds-sm rounded-lg border border-border bg-background text-label font-semibold text-foreground hover:border-primary hover:text-primary active:bg-secondary disabled:opacity-35" data-oid="21c037b627">
            <Group className="h-5 w-5" data-oid="0ab8f77882" /> Group
          </button>
          <button type="button" disabled={!studio.selectionGrouped} onClick={studio.ungroupSelection} className="inline-flex h-12 items-center justify-center gap-ds-sm rounded-lg border border-border bg-background text-label font-semibold text-foreground hover:border-primary hover:text-primary active:bg-secondary disabled:opacity-35" data-oid="bc49d4a0bb">
            <Ungroup className="h-5 w-5" data-oid="dd3f502641" /> Ungroup
          </button>
        </div>
        <p className="mt-ds-xs type-caption text-muted-foreground" data-oid="b2ea63d7da">SELECT 2+ OBJECTS TO GROUP · CTRL G / CTRL ⇧ G ON A KEYBOARD</p>
      </Panel>

      <Panel title="Grid & guides">
        <div className="flex items-center gap-ds-sm" data-oid="d3550e55d0">
          <span className="flex-1 text-label text-muted-foreground" data-oid="6e10f522c5">Grid size</span>
          <NumInput label="Grid size" value={studio.gridSize} min={2} max={1000} suffix="px" onChange={studio.setGridSize} className="w-16 border-border bg-background" />
        </div>
        <div className="mt-ds-sm flex flex-col gap-ds-xs" data-oid="1a14b41c48">
          <label className="flex items-center gap-ds-sm text-label text-muted-foreground" data-oid="da9cbb10e7">
            <input type="checkbox" checked={studio.showGrid} onChange={(e) => studio.setShowGrid(e.target.checked)} className="accent-primary" data-oid="363fe7f6de" />
            Show grid <kbd className="ml-auto type-caption opacity-70" data-oid="acd6987f6e">Ctrl '</kbd>
          </label>
          <label className="flex items-center gap-ds-sm text-label text-muted-foreground" data-oid="c73ac96153">
            <input type="checkbox" checked={studio.snapToGrid} onChange={(e) => studio.setSnapToGrid(e.target.checked)} className="accent-primary" data-oid="bd4e2cea5c" />
            Snap to grid <kbd className="ml-auto type-caption opacity-70" data-oid="f5be04c4d5">Ctrl ⇧ '</kbd>
          </label>
          <label className="flex items-center gap-ds-sm text-label text-muted-foreground" data-oid="d40ca04b21">
            <input type="checkbox" checked={studio.smartGuides} onChange={(e) => studio.setSmartGuides(e.target.checked)} className="accent-primary" data-oid="698730a2e5" />
            Smart guides <kbd className="ml-auto type-caption opacity-70" data-oid="d601d86f83">Ctrl U</kbd>
          </label>
        </div>
        <p className="mt-ds-xs type-caption text-muted-foreground" data-oid="6c1c5e0705">SNAPS MOVES, SHAPES, PEN + ANCHORS · HOLD ALT TO DRAG FREELY</p>
      </Panel>

      <Panel title="Transform">
        <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-ds-sm gap-y-ds-xs" data-oid="5e68abcee9">
          <label className="type-caption text-muted-foreground" data-oid="d446e0dae3">X</label>
          <NumInput label="X position" value={Math.round(b?.x ?? 0)} min={-99999} max={99999} onChange={(v) => studio.setSelectionBounds({ x: v }, lock)} className="w-full border-border bg-background" />
          <label className="type-caption text-muted-foreground" data-oid="866c9ab8ee">Y</label>
          <NumInput label="Y position" value={Math.round(b?.y ?? 0)} min={-99999} max={99999} onChange={(v) => studio.setSelectionBounds({ y: v }, lock)} className="w-full border-border bg-background" />
          <label className="type-caption text-muted-foreground" data-oid="86d98fad5d">W</label>
          <NumInput label="Width" value={Math.round(b?.w ?? 0)} min={1} max={99999} onChange={(v) => studio.setSelectionBounds({ w: v }, lock)} className="w-full border-border bg-background" />
          <label className="type-caption text-muted-foreground" data-oid="6b8bbb048e">H</label>
          <NumInput label="Height" value={Math.round(b?.h ?? 0)} min={1} max={99999} onChange={(v) => studio.setSelectionBounds({ h: v }, lock)} className="w-full border-border bg-background" />
        </div>
        <div className="mt-ds-sm flex items-center gap-ds-xs" data-oid="9630155267">
          <button type="button" aria-pressed={lock} aria-label="Lock proportions" title="Lock proportions" onClick={() => setLock((l) => !l)} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground aria-pressed:text-primary" data-oid="472dbe0cde">
            {lock ? <Link className="h-4 w-4" data-oid="656d1bc5cd" /> : <Unlink className="h-4 w-4" data-oid="c213205cd5" />}
          </button>
          <button type="button" disabled={!has} aria-label="Rotate 90° left" title="Rotate 90° left" onClick={() => studio.rotateSelection(-90)} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-35" data-oid="c6cf8c6ea3">
            <RotateCcw className="h-4 w-4" data-oid="f733fa54a5" />
          </button>
          <button type="button" disabled={!has} aria-label="Rotate 90° right" title="Rotate 90° right" onClick={() => studio.rotateSelection(90)} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-35" data-oid="9c96b24558">
            <RotateCw className="h-4 w-4" data-oid="4e261cbb80" />
          </button>
          <button type="button" disabled={!has} aria-label="Flip horizontal" title="Flip horizontal" onClick={() => studio.flipSelection("h")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-35" data-oid="e5d56661f5">
            <FlipHorizontal2 className="h-4 w-4" data-oid="a5bb2d29c1" />
          </button>
          <button type="button" disabled={!has} aria-label="Flip vertical" title="Flip vertical" onClick={() => studio.flipSelection("v")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-35" data-oid="2f71a76201">
            <FlipVertical2 className="h-4 w-4" data-oid="105ced0abc" />
          </button>
          <div className="ml-auto flex items-center gap-ds-xs" data-oid="9f0d330d95">
            <span className="type-caption text-muted-foreground" data-oid="b2bbfa4991">ROT</span>
            <NumInput label="Rotate by degrees" value={0} min={-360} max={360} suffix="°" onChange={(v) => studio.rotateSelection(v)} className="w-12 border-border bg-background" />
          </div>
        </div>
      </Panel>

      <Panel title="Align">
        <div className="grid grid-cols-6 gap-ds-xs" data-oid="465f1f1066">
          <button type="button" disabled={!has} aria-label="Align left" title="Align left" onClick={() => studio.alignSelection("left")} className={tile} data-oid="1e31a1fb37" data-oid-classname-dynamic="true">
            <AlignStartVertical className="h-4 w-4" data-oid="1f55fbd9fe" />
          </button>
          <button type="button" disabled={!has} aria-label="Align horizontal centres" title="Align horizontal centres" onClick={() => studio.alignSelection("hcenter")} className={tile} data-oid="1e041c4cbd" data-oid-classname-dynamic="true">
            <AlignCenterVertical className="h-4 w-4" data-oid="9bae510a39" />
          </button>
          <button type="button" disabled={!has} aria-label="Align right" title="Align right" onClick={() => studio.alignSelection("right")} className={tile} data-oid="00965f90b6" data-oid-classname-dynamic="true">
            <AlignEndVertical className="h-4 w-4" data-oid="e91d946eba" />
          </button>
          <button type="button" disabled={!has} aria-label="Align top" title="Align top" onClick={() => studio.alignSelection("top")} className={tile} data-oid="6d0ac7e695" data-oid-classname-dynamic="true">
            <AlignStartHorizontal className="h-4 w-4" data-oid="58891b83e4" />
          </button>
          <button type="button" disabled={!has} aria-label="Align vertical centres" title="Align vertical centres" onClick={() => studio.alignSelection("vcenter")} className={tile} data-oid="bab3421d66" data-oid-classname-dynamic="true">
            <AlignCenterHorizontal className="h-4 w-4" data-oid="0731671d38" />
          </button>
          <button type="button" disabled={!has} aria-label="Align bottom" title="Align bottom" onClick={() => studio.alignSelection("bottom")} className={tile} data-oid="0b8890cc9f" data-oid-classname-dynamic="true">
            <AlignEndHorizontal className="h-4 w-4" data-oid="26dff74e30" />
          </button>
        </div>
        <div className="mt-ds-xs grid grid-cols-2 gap-ds-xs" data-oid="fa812395cf">
          <button type="button" disabled={!has} onClick={() => studio.distributeSelection("h")} className="inline-flex h-9 items-center justify-center gap-ds-xs rounded-md border border-border bg-background text-label text-muted-foreground hover:border-muted-foreground hover:text-foreground disabled:opacity-35" data-oid="9d45b4c426">
            <AlignHorizontalDistributeCenter className="h-4 w-4" data-oid="ce0953a47f" /> Distribute ↔
          </button>
          <button type="button" disabled={!has} onClick={() => studio.distributeSelection("v")} className="inline-flex h-9 items-center justify-center gap-ds-xs rounded-md border border-border bg-background text-label text-muted-foreground hover:border-muted-foreground hover:text-foreground disabled:opacity-35" data-oid="32e7a1279d">
            <AlignVerticalDistributeCenter className="h-4 w-4" data-oid="93ce94bde8" /> Distribute ↕
          </button>
        </div>
        <p className="mt-ds-xs type-caption text-muted-foreground" data-oid="10388751d7">ONE OBJECT ALIGNS TO THE CANVAS · 2+ ALIGN TO EACH OTHER</p>
      </Panel>

      <Panel title="Pathfinder">
        <div className="grid grid-cols-4 gap-ds-xs" data-oid="822005cef0">
          <button type="button" disabled={!has} onClick={() => studio.runPathfinder("unite")} className="flex h-14 flex-col items-center justify-center gap-[2px] rounded-md border border-border bg-background text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-35" data-oid="2f2abe00f7">
            <PfUnite />
            <span className="type-caption" data-oid="7f31c8bc18">Unite</span>
          </button>
          <button type="button" disabled={!has} onClick={() => studio.runPathfinder("minusFront")} className="flex h-14 flex-col items-center justify-center gap-[2px] rounded-md border border-border bg-background text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-35" data-oid="ea13a45dc8">
            <PfMinus />
            <span className="type-caption" data-oid="1ca132f6b5">Minus</span>
          </button>
          <button type="button" disabled={!has} onClick={() => studio.runPathfinder("intersect")} className="flex h-14 flex-col items-center justify-center gap-[2px] rounded-md border border-border bg-background text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-35" data-oid="2f4775bfdd">
            <PfIntersect />
            <span className="type-caption" data-oid="9945cc7ff7">Intersect</span>
          </button>
          <button type="button" disabled={!has} onClick={() => studio.runPathfinder("exclude")} className="flex h-14 flex-col items-center justify-center gap-[2px] rounded-md border border-border bg-background text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-35" data-oid="615f5dcfe0">
            <PfExclude />
            <span className="type-caption" data-oid="bd0681d5a5">Exclude</span>
          </button>
        </div>
        <p className="mt-ds-xs type-caption text-muted-foreground" data-oid="97169c7f85">MINUS CUTS FRONT SHAPES OUT OF THE BACK ONE</p>
      </Panel>

      <Panel title="Convert">
        <button type="button" disabled={!has} onClick={studio.convertToShape} className="ds-button ds-button-secondary inline-flex w-full items-center justify-center gap-ds-sm disabled:opacity-35" data-oid="252bef4153">
          <Shapes className="h-4 w-4" data-oid="5f1257e2e5" /> Convert path to shape
        </button>
        <p className="mt-ds-xs type-caption text-muted-foreground" data-oid="5dc29102e6">STROKES BECOME FILLED SHAPES · THE ERASER THEN CUTS THEM</p>
      </Panel>

      <Panel title="Arrange">
        <div className="grid grid-cols-4 gap-ds-xs" data-oid="50c2a70602">
          <button type="button" disabled={!has} aria-label="Bring to front (Ctrl+Shift+])" title="Bring to front · Ctrl ⇧ ]" onClick={() => studio.arrangeSelection("front")} className={tile} data-oid="5c069b5cf5" data-oid-classname-dynamic="true">
            <BringToFront className="h-4 w-4" data-oid="fbddd83264" />
          </button>
          <button type="button" disabled={!has} aria-label="Bring forward (Ctrl+])" title="Bring forward · Ctrl ]" onClick={() => studio.arrangeSelection("forward")} className={tile} data-oid="71fae96f95" data-oid-classname-dynamic="true">
            <ArrowUp className="h-4 w-4" data-oid="02c7017dce" />
          </button>
          <button type="button" disabled={!has} aria-label="Send backward (Ctrl+[)" title="Send backward · Ctrl [" onClick={() => studio.arrangeSelection("backward")} className={tile} data-oid="fc2c369951" data-oid-classname-dynamic="true">
            <ArrowDown className="h-4 w-4" data-oid="a389734837" />
          </button>
          <button type="button" disabled={!has} aria-label="Send to back (Ctrl+Shift+[)" title="Send to back · Ctrl ⇧ [" onClick={() => studio.arrangeSelection("back")} className={tile} data-oid="be110dff79" data-oid-classname-dynamic="true">
            <SendToBack className="h-4 w-4" data-oid="a9ceedb3ad" />
          </button>
        </div>
        <p className="mt-ds-xs type-caption text-muted-foreground" data-oid="ac3282e354">OR DRAG THE ⠇ HANDLES IN THE LAYERS TAB</p>
      </Panel>
    </>);

}