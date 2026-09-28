import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Studio } from "./useStudio";
import { CANVAS_PRESETS } from "../../lib/art/types";

function PresetGlyph({ w, h }: {w: number;h: number;}) {
  const max = 34;
  const s = max / Math.max(w, h);
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-background" data-oid="9f510984dd" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-editable="true">
      <span className="rounded-[2px] border border-muted-foreground bg-foreground" style={{ width: Math.round(w * s), height: Math.round(h * s) }} data-oid="97978fff89" data-oid-callsite-deletable="true" data-oid-callsite-editable="true" data-oid-style-dynamic="width,height" />
    </span>);

}

export function NewProjectDialog({ studio }: {studio: Studio;}) {
  const [presetId, setPresetId] = useState(CANVAS_PRESETS[0].id);
  const [name, setName] = useState("Untitled");
  const open = studio.newDialogOpen;

  useEffect(() => {
    if (!open) return;
    setName("Untitled");
    const esc = (e: KeyboardEvent) => e.key === "Escape" && studio.setNewDialogOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const preset = CANVAS_PRESETS.find((p) => p.id === presetId) ?? CANVAS_PRESETS[0];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm" onPointerDown={() => studio.setNewDialogOpen(false)} data-oid="2872371e5e" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          studio.newDocument(preset.w, preset.h, name.trim() || "Untitled");
        }}
        className="w-[440px] rounded-xl border border-border bg-card p-ds-xl shadow-2xl" data-oid="516d837e8d">
        
        <div className="flex items-start justify-between gap-ds-md" data-oid="66e3c097cc">
          <div data-oid="3de7474b23">
            <h2 id="new-project-title" className="type-display text-foreground" data-oid="3321add9d5">New project</h2>
            <p className="mt-ds-xs type-body text-muted-foreground" data-oid="938aa6e400">Pick a canvas size. The current drawing is replaced — save it as .dtm first if you want to keep it.</p>
          </div>
          <button type="button" aria-label="Close" onClick={() => studio.setNewDialogOpen(false)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" data-oid="0581807a73">
            <X className="h-4 w-4" data-oid="91e23ba663" />
          </button>
        </div>

        <div className="ds-field mt-ds-lg" data-oid="5bca5ef9a8">
          <label htmlFor="project-name" className="ds-field-label" data-oid="31f6289081">Project name</label>
          <input id="project-name" className="ds-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus data-oid="1cb0dac857" />
        </div>

        <fieldset className="ds-radio-group mt-ds-lg" data-oid="7ac051ba97" data-oid-text-editable="false" data-oid-text-source="element:legend|expression:77b9666577e5">
          <legend className="mb-ds-xs type-label text-foreground" data-oid="33a414f74a">Canvas</legend>
          {CANVAS_PRESETS.map((p, index) =>
          <label
            key={p.id}
            data-index={index}
            className="ds-radio gap-ds-md rounded-lg border border-border bg-background/40 px-ds-md py-ds-sm hover:border-muted-foreground has-[:checked]:border-primary has-[:checked]:bg-secondary" data-oid="777af22229" data-oid-shared="true" data-oid-instance-targetable="true">
            
              <input type="radio" name="canvas-preset" value={p.id} checked={presetId === p.id} onChange={() => setPresetId(p.id)} data-oid="f48304f666" data-oid-shared="true" data-oid-instance-targetable="true" />
              <PresetGlyph w={p.w} h={p.h} />
              <span className="flex flex-1 flex-col" data-oid="afdfbc44b4" data-oid-shared="true" data-oid-instance-targetable="true">
                <span className="text-label font-semibold text-foreground" data-oid="3a4ed54822" data-oid-shared="true" data-oid-instance-targetable="true">{p.name}</span>
                <span className="type-caption text-muted-foreground" data-oid="e7f330fb93" data-oid-shared="true" data-oid-instance-targetable="true">{p.detail}</span>
              </span>
            </label>
          )}
        </fieldset>

        <div className="mt-ds-xl flex items-center justify-end gap-ds-sm" data-oid="34bb56c2d6">
          <button type="button" className="ds-button ds-button-secondary" onClick={() => studio.setNewDialogOpen(false)} data-oid="d027e52646">
            Cancel
          </button>
          <button type="submit" className="ds-button ds-button-primary" data-oid="3982a27b01" data-oid-text-editable="false" data-oid-text-source="text|expression:9a99b3ce7785|text|expression:7cabd0661ed7">
            Create {preset.w} × {preset.h}
          </button>
        </div>
      </form>
    </div>);

}