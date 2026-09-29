import { Plus } from "lucide-react";
import type { Studio } from "./useStudio";
import { Panel, iconBtn } from "./Panel";

export function SwatchesPanel({ studio }: {studio: Studio;}) {
  return (
    <Panel
      title="Swatches"
      actions={
      <button type="button" aria-label="Add current colour to swatches" className={iconBtn} onClick={() => studio.addSwatch(studio.colorTarget === "stroke" ? studio.primary : studio.secondary)} data-oid="f30ef3ece8" data-oid-component-root="true" data-oid-classname-dynamic="true">
          <Plus className="h-3.5 w-3.5" data-oid="7e60a341ed" />
        </button>
      }>
      
      <ul className="grid grid-cols-10 gap-[5px]" data-oid="54e1185625">
        {studio.swatches.map((hex, index) =>
        <li key={hex + index} data-oid="7dc62c4f6e" data-oid-shared="true">
            <button
            type="button"
            title={`${hex.toUpperCase()} · Alt+click to remove`}
            aria-label={`Swatch ${hex}`}
            aria-selected={hex.toLowerCase() === (studio.colorTarget === "stroke" ? studio.primary : studio.secondary).toLowerCase()}
            onClick={(e) => e.altKey ? studio.removeSwatch(hex) : studio.setActiveColor(hex)}
            onContextMenu={(e) => {
              e.preventDefault();
              studio.setColorFor(studio.colorTarget === "stroke" ? "fill" : "stroke", hex);
            }}
            className="block aspect-square w-full rounded-sm border border-border transition-transform hover:scale-110 aria-selected:ring-2 aria-selected:ring-primary aria-selected:ring-offset-1 aria-selected:ring-offset-card"
            style={{ backgroundColor: hex }} data-oid="1d6de5e8cb" data-oid-shared="true" data-oid-style-dynamic="backgroundColor" />
          
          </li>
        )}
      </ul>
      <p className="mt-ds-sm type-caption text-muted-foreground" data-oid="9e16d453d3" data-oid-text-editable="false" data-oid-text-source="text|expression:625c088de97e|text|expression:bacc9fa6ece7|text">CLICK {studio.colorTarget === "stroke" ? "STROKE" : "FILL"} · RIGHT-CLICK {studio.colorTarget === "stroke" ? "FILL" : "STROKE"} · ALT REMOVE</p>
    </Panel>);

}