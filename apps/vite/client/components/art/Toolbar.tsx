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
  Slash,
  Square,
  ZoomIn,
  type LucideIcon } from
"lucide-react";
import type { Studio } from "./useStudio";
import type { ToolId } from "../../lib/art/types";

const TOOLS: {id: ToolId;label: string;key: string;icon: LucideIcon;group: number;}[] = [
{ id: "select", label: "Selection", key: "V", icon: MousePointer2, group: 0 },
{ id: "direct", label: "Direct Selection", key: "A", icon: MousePointer, group: 0 },
{ id: "move", label: "Move", key: "M", icon: Move, group: 0 },
{ id: "transform", label: "Transform · scale + rotate", key: "T", icon: RotateCw, group: 0 },
{ id: "lasso", label: "Freeform Select", key: "Q", icon: Lasso, group: 0 },
{ id: "brush", label: "Brush", key: "B", icon: Brush, group: 1 },
{ id: "eraser", label: "Eraser", key: "E", icon: Eraser, group: 1 },
{ id: "fill", label: "Live Paint Bucket · vector fill", key: "G", icon: PaintBucket, group: 1 },
{ id: "eyedropper", label: "Eyedropper", key: "I", icon: Pipette, group: 1 },
{ id: "line", label: "Line", key: "L", icon: Slash, group: 2 },
{ id: "rect", label: "Rectangle", key: "U", icon: Square, group: 2 },
{ id: "ellipse", label: "Ellipse", key: "O", icon: Circle, group: 2 },
{ id: "pen", label: "Pen · bezier paths", key: "P", icon: PenTool, group: 2 },
{ id: "hand", label: "Hand", key: "H", icon: Hand, group: 3 },
{ id: "zoom", label: "Zoom", key: "Z", icon: ZoomIn, group: 3 }];


export function Toolbar({ studio }: {studio: Studio;}) {
  return (
    <nav aria-label="Tools" className="relative z-20 flex w-14 shrink-0 flex-col items-center gap-ds-xs border-r border-border bg-card py-ds-sm" data-oid="2686ed8674" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true" data-oid-text-editable="false" data-oid-text-source="expression:03949e318273|element:div|element:div">
      {TOOLS.map((t, index) => {
        const Icon = t.icon;
        const newGroup = index > 0 && TOOLS[index - 1].group !== t.group;
        return (
          <div key={t.id} className="flex flex-col items-center" data-oid="2e4fdeb1b1" data-oid-shared="true" data-oid-instance-targetable="true" data-oid-text-editable="false" data-oid-text-source="expression:202897fbe581|element:div">
            {newGroup && <div className="mb-ds-xs h-px w-7 bg-border" data-oid="e4183407ae" data-oid-shared="true" />}
            <div className="group relative" data-oid="e6d1d7f301" data-oid-shared="true" data-oid-instance-targetable="true">
              <button
                type="button"
                aria-label={`${t.label} (${t.key})`}
                aria-pressed={studio.tool === t.id}
                onClick={() => studio.setTool(t.id)}
                className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground" data-oid="376516ad96" data-oid-shared="true" data-oid-instance-targetable="true">
                
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </button>
              <span className="pointer-events-none absolute left-full top-1/2 ml-ds-sm hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-ds-sm py-ds-xs text-label text-popover-foreground shadow-lg group-hover:block" data-oid="6cb4cbf6bf" data-oid-shared="true" data-oid-instance-targetable="true" data-oid-text-editable="false" data-oid-text-source="expression:d75e9a4a124f|element:kbd">
                {t.label} <kbd className="ml-ds-xs type-caption text-primary" data-oid="a0b192d962" data-oid-shared="true" data-oid-instance-targetable="true">{t.key}</kbd>
              </span>
            </div>
          </div>);

      })}

      <div className="mt-ds-xs flex flex-col items-center border-t border-border pt-ds-sm" data-oid="d3d6f14530">
        <div className="group relative" data-oid="396194f7f6">
          <button
            type="button"
            aria-label="Deselect (Ctrl+D)"
            disabled={!studio.selection.length}
            onClick={studio.deselect}
            className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-accent disabled:opacity-35" data-oid="26465a2c45">
            <SquareDashed className="h-[18px] w-[18px]" strokeWidth={1.75} data-oid="8e95eb8e06" />
          </button>
          <span className="pointer-events-none absolute left-full top-1/2 ml-ds-sm hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-ds-sm py-ds-xs text-label text-popover-foreground shadow-lg group-hover:block" data-oid="99ff1616a1">
            Deselect <kbd className="ml-ds-xs type-caption text-primary" data-oid="1dad661d87">Ctrl D</kbd>
          </span>
        </div>
      </div>

      <div className="mt-auto flex flex-col items-center gap-ds-sm pb-ds-xs" data-oid="93f87d87c4">
        <div className="relative h-11 w-11" data-oid="500812a644">
          <button
            type="button"
            aria-label="Secondary colour — click to swap"
            onClick={studio.swapColors}
            className="absolute bottom-0 right-0 h-7 w-7 rounded-sm border border-border shadow"
            style={{ backgroundColor: studio.secondary }} data-oid="b148d05ae0" data-oid-style-dynamic="backgroundColor" />
          
          <button
            type="button"
            aria-label="Primary colour"
            className="absolute left-0 top-0 h-7 w-7 rounded-sm border-2 border-foreground shadow-md"
            style={{ backgroundColor: studio.primary }} data-oid="7bf2518dba" data-oid-style-dynamic="backgroundColor" />
          
        </div>
        <button
          type="button"
          aria-label="Swap colours (X)"
          onClick={studio.swapColors}
          className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground" data-oid="c7349c1212">
          
          <ArrowLeftRight className="h-3.5 w-3.5" data-oid="20c86b141f" />
        </button>
      </div>
    </nav>);

}