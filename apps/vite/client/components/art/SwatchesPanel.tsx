import { Plus } from "lucide-react";
import type { Studio } from "./useStudio";
import { Panel, iconBtn } from "./Panel";

export function SwatchesPanel({ studio }: {studio: Studio;}) {
  return (
    <Panel
      title="Swatches"
      actions={
      <button type="button" aria-label="Add current colour to swatches" className={iconBtn} onClick={() => studio.addSwatch(studio.primary)} data-oid="f30ef3ece8" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true" data-oid-classname-dynamic="true">
          <Plus className="h-3.5 w-3.5" data-oid="7e60a341ed" />
        </button>
      }>
      
      <ul className="grid grid-cols-10 gap-[5px]" data-oid="54e1185625">
        {studio.swatches.map((hex, index) =>
        <li key={hex + index} data-oid="7dc62c4f6e" data-oid-shared="true" data-oid-instance-targetable="true">
            <button
            type="button"
            title={`${hex.toUpperCase()} · Alt+click to remove`}
            aria-label={`Swatch ${hex}`}
            aria-selected={hex.toLowerCase() === studio.primary.toLowerCase()}
            onClick={(e) => e.altKey ? studio.removeSwatch(hex) : studio.setPrimary(hex)}
            onContextMenu={(e) => {
              e.preventDefault();
              studio.setSecondary(hex);
            }}
            className="block aspect-square w-full rounded-sm border border-border transition-transform hover:scale-110 aria-selected:ring-2 aria-selected:ring-primary aria-selected:ring-offset-1 aria-selected:ring-offset-card"
            style={{ backgroundColor: hex }} data-oid="1d6de5e8cb" data-oid-shared="true" data-oid-instance-targetable="true" data-oid-style-dynamic="backgroundColor" />
          
          </li>
        )}
      </ul>
      <p className="mt-ds-sm type-caption text-muted-foreground" data-oid="9e16d453d3">CLICK PRIMARY · RIGHT-CLICK SECONDARY · ALT REMOVE</p>
    </Panel>);

}