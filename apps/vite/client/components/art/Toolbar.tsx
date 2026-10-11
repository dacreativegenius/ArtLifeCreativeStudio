import {
  Brush,
  ClipboardPaste,
  Scissors,
  Circle,
  CopyPlus,
  Layers,
  Eraser,
  Hand,
  Lasso,
  MousePointer,
  MousePointer2,
  Move,
  PaintBucket,
  PenTool,
  Pipette,
  RotateCw,
  SquareDashed,
  Trash2,
  Slash,
  Square,
  ZoomIn } from
"lucide-react";
import type { ComponentType } from "react";
import { AnchorConvertIcon, PenMinusIcon, PenPlusIcon } from "./AnchorIcons";
import type { Studio } from "./useStudio";
import type { ToolId } from "../../lib/art/types";

type ToolIcon = ComponentType<{className?: string;strokeWidth?: number;}>;
type ToolDef = {id: ToolId;label: string;key: string;icon: ToolIcon;};

/** Tools grouped into sections; each section is laid out two per row. */
const GROUPS: ToolDef[][] = [
[
{ id: "select", label: "Selection", key: "V", icon: MousePointer2 },
{ id: "direct", label: "Direct Selection", key: "A", icon: MousePointer },
{ id: "move", label: "Move", key: "M", icon: Move },
{ id: "transform", label: "Transform · scale + rotate", key: "T", icon: RotateCw },
{ id: "lasso", label: "Freeform Select", key: "Q", icon: Lasso }],

[
{ id: "brush", label: "Brush", key: "B", icon: Brush },
{ id: "eraser", label: "Eraser", key: "E", icon: Eraser },
{ id: "fill", label: "Live Paint Bucket · vector fill", key: "G", icon: PaintBucket },
{ id: "eyedropper", label: "Eyedropper", key: "I", icon: Pipette }],

[
{ id: "pen", label: "Pen · bezier paths", key: "P", icon: PenTool },
{ id: "penAdd", label: "Add Anchor Point", key: "+", icon: PenPlusIcon },
{ id: "penDelete", label: "Delete Anchor Point", key: "−", icon: PenMinusIcon },
{ id: "penConvert", label: "Anchor Point · smooth ⇄ corner", key: "⇧C", icon: AnchorConvertIcon }],

[
{ id: "line", label: "Line", key: "L", icon: Slash },
{ id: "rect", label: "Rectangle", key: "U", icon: Square },
{ id: "ellipse", label: "Ellipse", key: "O", icon: Circle }],

[
{ id: "hand", label: "Hand", key: "H", icon: Hand },
{ id: "zoom", label: "Zoom", key: "Z", icon: ZoomIn }]];



export function Toolbar({ studio }: {studio: Studio;}) {
  return (
    <nav aria-label="Tools" className="relative z-20 flex w-[92px] shrink-0 flex-col max-md:overflow-y-auto items-center gap-ds-sm border-r border-border bg-card px-ds-xs py-ds-sm" data-oid="6d62bae305" data-oid-component-root="true" data-oid-text-editable="false" data-oid-text-source="expression:887ce70c0f4a|element:div">
      {GROUPS.map((group, gi) =>
      <div key={gi} data-index={gi} className="grid w-full grid-cols-2 justify-items-center gap-ds-xs border-t border-border pt-ds-sm first:border-t-0 first:pt-0" data-oid="93f87d87c4" data-oid-shared="true">
          {group.map((t, index) => {
          const Icon = t.icon;
          return (
            <div key={t.id} data-index={index} className="group relative" data-oid="800e1cc060" data-oid-shared="true">
                <button
                type="button"
                aria-label={`${t.label} (${t.key})`}
                aria-pressed={studio.tool === t.id}
                onClick={() => studio.setTool(t.id)}
                className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground" data-oid="491b3d35da" data-oid-shared="true">
                  <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </button>
                <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-ds-sm hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-ds-sm py-ds-xs text-label text-popover-foreground shadow-lg group-hover:block" data-oid="e160155dab" data-oid-shared="true" data-oid-text-editable="false" data-oid-text-source="expression:d75e9a4a124f|element:kbd">
                  {t.label} <kbd className="ml-ds-xs type-caption text-primary" data-oid="9101b06e17" data-oid-shared="true">{t.key}</kbd>
                </span>
              </div>);

        })}
        </div>
      )}

      <div className="grid w-full grid-cols-2 justify-items-center gap-ds-xs border-t border-border pt-ds-sm" data-oid="c69fd07d9b">
        <div className="group relative" data-oid="9d5ff1b1d1">
          <button
            type="button"
            aria-label="Multi-select · every tap adds to the selection"
            aria-pressed={studio.multiSelect}
            onClick={() => {
              const on = !studio.multiSelect;
              studio.setMultiSelect(on);
              if (on && !["select", "direct", "move", "transform", "lasso"].includes(studio.tool)) studio.setTool("select");
              studio.flash(on ? "Multi-select on · tap objects to add or remove them" : "Multi-select off");
            }}
            className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-accent aria-pressed:bg-accent aria-pressed:text-accent-foreground" data-oid="8013cfeb16">
            <CopyPlus className="h-[18px] w-[18px]" strokeWidth={1.75} data-oid="744a427f90" />
          </button>
          <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-ds-sm hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-ds-sm py-ds-xs text-label text-popover-foreground shadow-lg group-hover:block" data-oid="8538e18540">
            Multi-select <kbd className="ml-ds-xs type-caption text-primary" data-oid="d42179e927">Shift</kbd>
          </span>
        </div>
        <div className="group relative" data-oid="a8393b53f2">
          <button
            type="button"
            aria-label="Select everything on the active layer"
            onClick={() => studio.activeLayer && studio.selectLayerContents(studio.activeLayer.id)}
            className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-accent" data-oid="51ab39cfe9">
            <Layers className="h-[18px] w-[18px]" strokeWidth={1.75} data-oid="9aea1d62af" />
          </button>
          <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-ds-sm hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-ds-sm py-ds-xs text-label text-popover-foreground shadow-lg group-hover:block" data-oid="bcdd11a641">
            Select all on layer <kbd className="ml-ds-xs type-caption text-primary" data-oid="97646aa9d9">Ctrl A</kbd>
          </span>
        </div>
        <div className="group relative" data-oid="69f1799c29">
          <button
            type="button"
            aria-label="Deselect (Ctrl+D)"
            disabled={!studio.selection.length}
            onClick={studio.deselect}
            className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-accent disabled:opacity-35" data-oid="02dac10c98">
            <SquareDashed className="h-[18px] w-[18px]" strokeWidth={1.75} data-oid="0ca67912bc" />
          </button>
          <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-ds-sm hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-ds-sm py-ds-xs text-label text-popover-foreground shadow-lg group-hover:block" data-oid="737220095c">
            Deselect <kbd className="ml-ds-xs type-caption text-primary" data-oid="98ee69e2c6">Ctrl D</kbd>
          </span>
        </div>
        <div className="group relative" data-oid="9c50efefb7">
          <button
            type="button"
            aria-label="Delete selection (Delete)"
            disabled={!studio.selection.length}
            onClick={studio.deleteSelection}
            className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-35" data-oid="e8b4f7a490">
            <Trash2 className="h-[18px] w-[18px]" strokeWidth={1.75} data-oid="eb306bdacf" />
          </button>
          <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-ds-sm hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-ds-sm py-ds-xs text-label text-popover-foreground shadow-lg group-hover:block" data-oid="dfc0207aef">
            Delete selection <kbd className="ml-ds-xs type-caption text-primary" data-oid="76362c3f03">Del</kbd>
          </span>
        </div>
        <div className="group relative" data-oid="fa0467257c">
          <button
            type="button"
            aria-label="Cut selection (Ctrl+X)"
            disabled={!studio.selection.length}
            onClick={studio.cutSelection}
            className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-primary disabled:opacity-35" data-oid="3c83ec2570">
            <Scissors className="h-[18px] w-[18px]" strokeWidth={1.75} data-oid="b97eaccded" />
          </button>
          <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-ds-sm hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-ds-sm py-ds-xs text-label text-popover-foreground shadow-lg group-hover:block" data-oid="a2316d26b3">
            Cut <kbd className="ml-ds-xs type-caption text-primary" data-oid="f0ce1921b5">Ctrl X</kbd>
          </span>
        </div>
        <div className="group relative" data-oid="ecd55565da">
          <button
            type="button"
            aria-label="Paste (Ctrl+V)"
            disabled={!studio.canPaste}
            onClick={studio.paste}
            className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-primary disabled:opacity-35" data-oid="ea25099821">
            <ClipboardPaste className="h-[18px] w-[18px]" strokeWidth={1.75} data-oid="48a03fe502" />
          </button>
          <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-ds-sm hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-ds-sm py-ds-xs text-label text-popover-foreground shadow-lg group-hover:block" data-oid="a2dabd6de1">
            Paste <kbd className="ml-ds-xs type-caption text-primary" data-oid="cb7cb36456">Ctrl V</kbd>
          </span>
        </div>
      </div>

    </nav>);

}