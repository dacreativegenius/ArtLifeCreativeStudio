import {
  ArrowLeftRight,
  Brush,
  Circle,
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
    <nav aria-label="Tools" className="relative z-20 flex w-[92px] shrink-0 flex-col max-md:overflow-y-auto items-center gap-ds-sm border-r border-border bg-card px-ds-xs py-ds-sm" data-oid="6d62bae305" data-oid-component-root="true" data-oid-text-editable="false" data-oid-text-source="expression:887ce70c0f4a|element:div|element:div">
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
          <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-ds-sm hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-ds-sm py-ds-xs text-label text-popover-foreground shadow-lg group-hover:block" data-oid="51ab39cfe9">
            Delete selection <kbd className="ml-ds-xs type-caption text-primary" data-oid="76362c3f03">Del</kbd>
          </span>
        </div>
      </div>

      <div className="mt-auto flex items-end gap-ds-xs pb-ds-xs" data-oid="92379abf13">
        <div className="relative h-11 w-11" data-oid="29909a795a">
          <button
            type="button"
            aria-label="Fill colour — click to edit fill"
            title="Fill"
            aria-pressed={studio.colorTarget === "fill"}
            onClick={() => studio.setColorTarget("fill")}
            className="absolute left-0 top-0 h-7 w-7 rounded-sm border border-border shadow aria-pressed:z-10 aria-pressed:ring-2 aria-pressed:ring-primary"
            style={{ backgroundColor: studio.shapeFill ? studio.secondary : "transparent" }} data-oid="8218fd7f23" data-oid-style-dynamic="backgroundColor" />
          
          <button
            type="button"
            aria-label="Stroke colour — click to edit stroke"
            title="Stroke"
            aria-pressed={studio.colorTarget === "stroke"}
            onClick={() => studio.setColorTarget("stroke")}
            className="absolute bottom-0 right-0 h-7 w-7 rounded-sm border-[5px] bg-card shadow-md aria-pressed:z-10 aria-pressed:ring-2 aria-pressed:ring-primary"
            style={{ borderColor: studio.strokeEnabled ? studio.primary : "var(--border)" }} data-oid="8ef14169f7" data-oid-style-dynamic="borderColor" />
          
        </div>
        <button
          type="button"
          aria-label="Swap stroke and fill (Shift+X)"
          title="Swap (Shift+X)"
          onClick={studio.swapColors}
          className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground" data-oid="9c55aaef4f">
          <ArrowLeftRight className="h-3.5 w-3.5" data-oid="c93f919b83" />
        </button>
      </div>
    </nav>);

}