import { useEffect, useState } from "react";
import { ArrowLeftRight, X } from "lucide-react";
import type { Studio } from "./useStudio";

const MIN = 16;
const MAX = 8000;

const toNum = (s: string) => {
  const n = Math.round(Number(s));
  return Number.isFinite(n) ? n : NaN;
};

export function NewProjectDialog({ studio }: {studio: Studio;}) {
  const [name, setName] = useState("Untitled");
  const [w, setW] = useState("1920");
  const [h, setH] = useState("1080");
  const open = studio.newDialogOpen;

  useEffect(() => {
    if (!open) return;
    setName(studio.freshName());
    setW(String(studio.docSize.w));
    setH(String(studio.docSize.h));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && studio.setNewDialogOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const wn = toNum(w);
  const hn = toNum(h);
  const wOk = wn >= MIN && wn <= MAX;
  const hOk = hn >= MIN && hn <= MAX;
  const valid = wOk && hOk;
  // proportional preview box (max 72px on the long side)
  const ratio = valid ? wn / hn : 1;
  const pw = ratio >= 1 ? 72 : Math.max(8, 72 * ratio);
  const ph = ratio >= 1 ? Math.max(8, 72 / ratio) : 72;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background/70 p-ds-lg backdrop-blur-sm" onPointerDown={() => studio.setNewDialogOpen(false)} data-oid="7db1979644" data-oid-component-root="true">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) studio.newDocument(wn, hn, name.trim() || studio.freshName());
        }}
        className="w-full max-w-[440px] shrink-0 rounded-xl border border-border bg-card p-ds-xl shadow-2xl" data-oid="d2ec69e3d8">
        
        <div className="flex items-start justify-between gap-ds-md" data-oid="44b13bde67">
          <div data-oid="41996b50da">
            <h2 id="new-project-title" className="type-display text-foreground" data-oid="b183eb77a0">New project</h2>
            <p className="mt-ds-xs type-body text-muted-foreground" data-oid="2a2cd9b1d9">Type any canvas size in pixels. Each new project gets its own name, so saving never overwrites an earlier drawing.</p>
          </div>
          <button type="button" aria-label="Close" onClick={() => studio.setNewDialogOpen(false)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" data-oid="3e973aa088">
            <X className="h-4 w-4" data-oid="01cd0980b1" />
          </button>
        </div>

        <div className="ds-field mt-ds-lg" data-oid="649344f639">
          <label htmlFor="project-name" className="ds-field-label" data-oid="2748f43c03">Project name</label>
          <input id="project-name" className="ds-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus data-oid="f9ca7c344d" />
        </div>

        <div className="mt-ds-lg flex items-end gap-ds-md" data-oid="b80c7bc2e0">
          <div className="grid h-[84px] w-[84px] shrink-0 place-items-center rounded-lg border border-border bg-background" data-oid="7a47778185">
            <span className="rounded-[2px] bg-foreground" style={{ width: pw, height: ph }} data-oid="688cbde84b" data-oid-style-dynamic="width,height" />
          </div>
          <div className="flex min-w-0 flex-1 items-end gap-ds-sm" data-oid="da33368848">
            <div className="ds-field min-w-0 flex-1" data-oid="98ce76adb2">
              <label htmlFor="canvas-w" className="ds-field-label" data-oid="d694795553">Width (px)</label>
              <input
                id="canvas-w"
                className="ds-input font-caption aria-[invalid=true]:border-destructive"
                inputMode="numeric"
                aria-invalid={!wOk}
                value={w}
                onChange={(e) => setW(e.target.value.replace(/[^\d]/g, ""))} data-oid="7ccb6bda16" />
            </div>
            <button
              type="button"
              aria-label="Swap width and height"
              title="Swap width and height"
              onClick={() => {
                setW(h);
                setH(w);
              }}
              className="mb-[2px] grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground" data-oid="0abb16ad06">
              <ArrowLeftRight className="h-4 w-4" data-oid="77cc7c7f52" />
            </button>
            <div className="ds-field min-w-0 flex-1" data-oid="ca5cc4c5e5">
              <label htmlFor="canvas-h" className="ds-field-label" data-oid="68f71ac3f2">Height (px)</label>
              <input
                id="canvas-h"
                className="ds-input font-caption aria-[invalid=true]:border-destructive"
                inputMode="numeric"
                aria-invalid={!hOk}
                value={h}
                onChange={(e) => setH(e.target.value.replace(/[^\d]/g, ""))} data-oid="57eb9e0075" />
            </div>
          </div>
        </div>
        <p className="mt-ds-sm type-caption text-muted-foreground aria-[invalid=true]:text-destructive" aria-invalid={!valid} data-oid="b94495255a">
          {valid ? `${wn} × ${hn} PX · ${(wn * hn / 1e6).toFixed(1)} MP` : `USE ${MIN}–${MAX} PX FOR EACH SIDE`}
        </p>

        <div className="mt-ds-xl flex items-center justify-end gap-ds-sm" data-oid="d11fe27af7">
          <button type="button" className="ds-button ds-button-secondary" onClick={() => studio.setNewDialogOpen(false)} data-oid="c87a2bbefd">
            Keep current drawing
          </button>
          <button type="submit" disabled={!valid} className="ds-button ds-button-primary disabled:opacity-40" data-oid="3ab39fae6b">
            Create canvas
          </button>
        </div>
      </form>
    </div>);

}