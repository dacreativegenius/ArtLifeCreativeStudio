import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Studio } from "./useStudio";

type Preset = {w: number;h: number;label: string;};

const SQUARE: Preset = { w: 1200, h: 1200, label: "Square" };
const TABLOID: Preset = { w: 3300, h: 5100, label: "11 × 17 in" };
const PORTRAIT: Preset = { w: 1080, h: 1920, label: "Portrait HD" };
const LANDSCAPE: Preset = { w: 1920, h: 1080, label: "Landscape HD" };

export function NewProjectDialog({ studio }: {studio: Studio;}) {
  const [preset, setPreset] = useState<Preset>(SQUARE);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background/70 p-ds-xl backdrop-blur-sm" onPointerDown={() => studio.setNewDialogOpen(false)} data-oid="ec4a46e9ab" data-oid-component-root="true">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          studio.newDocument(preset.w, preset.h, name.trim() || "Untitled");
        }}
        className="w-[520px] shrink-0 rounded-xl border border-border bg-card p-ds-xl shadow-2xl" data-oid="3126af39cd">
        
        <div className="flex items-start justify-between gap-ds-md" data-oid="5f355cfe45">
          <div data-oid="7313dcf6a1">
            <h2 id="new-project-title" className="type-display text-foreground" data-oid="30c8d6e5f1">New project</h2>
            <p className="mt-ds-xs type-body text-muted-foreground" data-oid="d2a8609b56">Choose a canvas size. The current drawing is replaced — save it as .dtm first to keep it.</p>
          </div>
          <button type="button" aria-label="Close" onClick={() => studio.setNewDialogOpen(false)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" data-oid="76e68af970">
            <X className="h-4 w-4" data-oid="10e1e843c7" />
          </button>
        </div>

        <div className="ds-field mt-ds-lg" data-oid="2e653789b9">
          <label htmlFor="project-name" className="ds-field-label" data-oid="8fbb049c7f">Project name</label>
          <input id="project-name" className="ds-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus data-oid="e1d5180192" />
        </div>

        <p className="mt-ds-lg mb-ds-sm type-label text-foreground" data-oid="5bca5ef9a8">Canvas size</p>
        <div role="radiogroup" aria-label="Canvas size" className="grid grid-cols-2 gap-ds-sm" data-oid="d4c595f624">
          <button
            type="button"
            role="radio"
            aria-checked={preset === SQUARE}
            onClick={() => setPreset(SQUARE)}
            className="flex items-center gap-ds-md rounded-lg border border-border bg-background px-ds-md py-ds-md text-left hover:border-muted-foreground aria-checked:border-primary aria-checked:bg-secondary" data-oid="1cb0dac857">
            
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-card" data-oid="36862fe764">
              <span className="h-[34px] w-[34px] rounded-[2px] bg-foreground" data-oid="eb8eec9dc7" />
            </span>
            <span className="flex flex-col" data-oid="27c8d3f03b">
              <span className="text-label font-semibold text-foreground" data-oid="f48304f666">Square</span>
              <span className="type-caption text-muted-foreground" data-oid="f97afd2335">1200 × 1200 px</span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={preset === TABLOID}
            onClick={() => setPreset(TABLOID)}
            className="flex items-center gap-ds-md rounded-lg border border-border bg-background px-ds-md py-ds-md text-left hover:border-muted-foreground aria-checked:border-primary aria-checked:bg-secondary" data-oid="14e4de40dd">
            
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-card" data-oid="2fe7f1b20e">
              <span className="h-[34px] w-[22px] rounded-[2px] bg-foreground" data-oid="04419a5ea5" />
            </span>
            <span className="flex flex-col" data-oid="5411cc77c9">
              <span className="text-label font-semibold text-foreground" data-oid="7f8596b84c">Tabloid 11 × 17 in</span>
              <span className="type-caption text-muted-foreground" data-oid="d7bcd60030">300 dpi · 3300 × 5100 px</span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={preset === PORTRAIT}
            onClick={() => setPreset(PORTRAIT)}
            className="flex items-center gap-ds-md rounded-lg border border-border bg-background px-ds-md py-ds-md text-left hover:border-muted-foreground aria-checked:border-primary aria-checked:bg-secondary" data-oid="c01a434e14">
            
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-card" data-oid="cfb1ad6daf">
              <span className="h-[34px] w-[19px] rounded-[2px] bg-foreground" data-oid="50062a5dd4" />
            </span>
            <span className="flex flex-col" data-oid="75cde3255b">
              <span className="text-label font-semibold text-foreground" data-oid="e8c141e807">Portrait HD</span>
              <span className="type-caption text-muted-foreground" data-oid="e96e24973e">1080 × 1920 px</span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={preset === LANDSCAPE}
            onClick={() => setPreset(LANDSCAPE)}
            className="flex items-center gap-ds-md rounded-lg border border-border bg-background px-ds-md py-ds-md text-left hover:border-muted-foreground aria-checked:border-primary aria-checked:bg-secondary" data-oid="48292677e6">
            
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-card" data-oid="df999a822e">
              <span className="h-[19px] w-[34px] rounded-[2px] bg-foreground" data-oid="709029a636" />
            </span>
            <span className="flex flex-col" data-oid="3dcb66fd9e">
              <span className="text-label font-semibold text-foreground" data-oid="df5e977114">Landscape HD</span>
              <span className="type-caption text-muted-foreground" data-oid="d6b8f7d712">1920 × 1080 px</span>
            </span>
          </button>
        </div>

        <div className="mt-ds-xl flex items-center justify-end gap-ds-sm" data-oid="8a94d0c473">
          <button type="button" className="ds-button ds-button-secondary" onClick={() => studio.setNewDialogOpen(false)} data-oid="07215b5ef9">
            Cancel
          </button>
          <button type="submit" className="ds-button ds-button-primary" data-oid="bdf150575c" data-oid-text-editable="false" data-oid-text-source="text|expression:73dbe0b7a2c3|text|expression:9a99b3ce7785|text|expression:7cabd0661ed7">
            Create {preset.label} · {preset.w} × {preset.h}
          </button>
        </div>
      </form>
    </div>);

}