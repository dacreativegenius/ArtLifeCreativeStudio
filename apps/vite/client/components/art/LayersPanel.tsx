import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Eraser, Eye, EyeOff, Lock, Plus, Trash2, Unlock } from "lucide-react";
import type { Studio } from "./useStudio";
import { Panel, iconBtn } from "./Panel";
import type { Layer } from "../../lib/art/types";
import { DOC_W } from "../../lib/art/types";
import { renderDoc } from "../../lib/art/render";

function LayerThumb({ layer }: {layer: Layer;}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const id = window.setTimeout(() => {
      const img = renderDoc([{ ...layer, visible: true, opacity: 1 }], 88 / DOC_W, true);
      c.width = img.width;
      c.height = img.height;
      c.getContext("2d")!.drawImage(img, 0, 0);
    }, 120);
    return () => window.clearTimeout(id);
  }, [layer]);
  return <canvas ref={ref} aria-hidden="true" className="h-[28px] w-[44px] shrink-0 rounded-sm border border-border bg-foreground" data-oid="7a0a1ae753" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-editable="true" />;
}

export function LayersPanel({ studio }: {studio: Studio;}) {
  const [editing, setEditing] = useState<string | null>(null);
  const active = studio.activeLayer;
  const ordered = [...studio.layers].reverse();
  const activeIndex = studio.layers.findIndex((l) => l.id === active?.id);

  return (
    <Panel
      title="Layers"
      actions={
      <div className="flex items-center" data-oid="3a27a3af81" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true">
          <button type="button" aria-label="New layer" className={iconBtn} onClick={studio.addLayer} data-oid="ceb86af31c" data-oid-classname-dynamic="true">
            <Plus className="h-3.5 w-3.5" data-oid="3af61da8c8" />
          </button>
          <button type="button" aria-label="Duplicate layer" className={iconBtn} onClick={() => active && studio.duplicateLayer(active.id)} data-oid="b5e2b69138" data-oid-classname-dynamic="true">
            <Copy className="h-3.5 w-3.5" data-oid="0cdb2a51af" />
          </button>
          <button type="button" aria-label="Move layer up" className={iconBtn} disabled={activeIndex >= studio.layers.length - 1} onClick={() => active && studio.moveLayer(active.id, 1)} data-oid="593de826ad" data-oid-classname-dynamic="true">
            <ChevronUp className="h-3.5 w-3.5" data-oid="13e32bff74" />
          </button>
          <button type="button" aria-label="Move layer down" className={iconBtn} disabled={activeIndex <= 0} onClick={() => active && studio.moveLayer(active.id, -1)} data-oid="244468e319" data-oid-classname-dynamic="true">
            <ChevronDown className="h-3.5 w-3.5" data-oid="3c7dc04db4" />
          </button>
          <button type="button" aria-label="Delete layer" className={iconBtn} disabled={studio.layers.length <= 1} onClick={() => active && studio.deleteLayer(active.id)} data-oid="c00f092846" data-oid-classname-dynamic="true">
            <Trash2 className="h-3.5 w-3.5" data-oid="a7b8a146b9" />
          </button>
        </div>
      }>
      
      {active &&
      <div className="mb-ds-sm flex items-center gap-ds-sm" data-oid="9a8bfd1996">
          <label className="flex flex-1 items-center gap-ds-sm text-label text-muted-foreground" data-oid="b327b2b2b4">
            Opacity
            <input
            type="range"
            min={0}
            max={100}
            value={Math.round(active.opacity * 100)}
            onPointerDown={studio.snapshot}
            onChange={(e) => studio.updateLayer(active.id, { opacity: Number(e.target.value) / 100 }, false)}
            className="flex-1 accent-primary" data-oid="106562dcac" />
          
            <output className="w-9 text-right type-caption text-foreground" data-oid="f40f5317fe" data-oid-text-editable="false" data-oid-text-source="expression:14e8080d7e0e|text">{Math.round(active.opacity * 100)}%</output>
          </label>
          <button type="button" aria-label="Clear layer" title="Clear layer" className={iconBtn} onClick={() => studio.clearLayer(active.id)} data-oid="16e66ae1dd" data-oid-classname-dynamic="true">
            <Eraser className="h-3.5 w-3.5" data-oid="cd3daf42cf" />
          </button>
        </div>
      }

      <ul role="listbox" aria-label="Layers" className="flex flex-col gap-[3px] rounded-md border border-border bg-background p-ds-xs" data-oid="0a9070211d">
        {ordered.map((layer, index) =>
        <li
          key={layer.id}
          role="option"
          aria-selected={layer.id === active?.id}
          data-hidden={!layer.visible}
          onClick={() => studio.setActiveLayerId(layer.id)}
          className="flex cursor-pointer items-center gap-ds-xs rounded-sm border border-transparent px-ds-xs py-ds-xs hover:bg-secondary aria-selected:border-accent aria-selected:bg-secondary data-[hidden=true]:opacity-50" data-oid="d131471244" data-oid-shared="true" data-oid-instance-targetable="true">
          
            <button
            type="button"
            aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
            className={iconBtn}
            onClick={(e) => {
              e.stopPropagation();
              studio.updateLayer(layer.id, { visible: !layer.visible });
            }} data-oid="b92b2c75a4" data-oid-shared="true" data-oid-instance-targetable="true" data-oid-classname-dynamic="true">
            
              {layer.visible ? <Eye className="h-3.5 w-3.5" data-oid="72364899a2" data-oid-shared="true" /> : <EyeOff className="h-3.5 w-3.5" data-oid="4beee333ef" data-oid-shared="true" />}
            </button>
            <LayerThumb layer={layer} />
            <div className="min-w-0 flex-1" data-index={index} data-oid="9701a3e47e" data-oid-shared="true" data-oid-instance-targetable="true" data-oid-text-editable="false" data-oid-text-source="expression:a3230297f8fa|element:p">
              {editing === layer.id ?
            <input
              autoFocus
              defaultValue={layer.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== layer.name) studio.updateLayer(layer.id, { name: v });
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditing(null);
              }}
              className="h-6 w-full rounded-sm border border-primary bg-card px-ds-xs text-label text-foreground outline-none" data-oid="978b569084" data-oid-shared="true" /> :


            <p className="truncate text-label text-foreground" onDoubleClick={() => setEditing(layer.id)} title="Double-click to rename" data-oid="c3b9a984d4" data-oid-shared="true">
                  {layer.name}
                </p>
            }
              <p className="type-caption text-muted-foreground" data-oid="58f576afbc" data-oid-shared="true" data-oid-instance-targetable="true" data-oid-text-editable="false" data-oid-text-source="expression:5b9c7a56383a|text|expression:4900173db67f|text">
                {layer.items.length} OBJ · {Math.round(layer.opacity * 100)}%
              </p>
            </div>
            <button
            type="button"
            aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
            aria-pressed={layer.locked}
            className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground hover:bg-card hover:text-foreground aria-pressed:text-primary"
            onClick={(e) => {
              e.stopPropagation();
              studio.updateLayer(layer.id, { locked: !layer.locked });
            }} data-oid="e217988ca6" data-oid-shared="true" data-oid-instance-targetable="true">
            
              {layer.locked ? <Lock className="h-3.5 w-3.5" data-oid="c71cab3537" data-oid-shared="true" /> : <Unlock className="h-3.5 w-3.5" data-oid="a43bf87258" data-oid-shared="true" />}
            </button>
          </li>
        )}
      </ul>
    </Panel>);

}