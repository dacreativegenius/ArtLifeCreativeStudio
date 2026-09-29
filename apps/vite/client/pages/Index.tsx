import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useStudio } from "../components/art/useStudio";
import { TopBar } from "../components/art/TopBar";
import { Toolbar } from "../components/art/Toolbar";
import { CanvasStage } from "../components/art/CanvasStage";
import { ColorPanel } from "../components/art/ColorPanel";
import { SwatchesPanel } from "../components/art/SwatchesPanel";
import { BrushPanel } from "../components/art/BrushPanel";
import { LayersPanel } from "../components/art/LayersPanel";
import { NewProjectDialog } from "../components/art/NewProjectDialog";
import { onAndroidBack } from "../lib/art/native";

export default function Index() {
  const studio = useStudio();
  // Phones: the colour / brush / layer panels live in a slide-out drawer. Desktop + tablets: always docked.
  const [panelsOpen, setPanelsOpen] = useState(false);
  const stateRef = useRef({ panelsOpen, newDialogOpen: studio.newDialogOpen, setNewDialogOpen: studio.setNewDialogOpen });
  stateRef.current = { panelsOpen, newDialogOpen: studio.newDialogOpen, setNewDialogOpen: studio.setNewDialogOpen };

  useEffect(
    () =>
    onAndroidBack(() => {
      const s = stateRef.current;
      if (s.newDialogOpen) {
        s.setNewDialogOpen(false);
        return true;
      }
      if (s.panelsOpen) {
        setPanelsOpen(false);
        return true;
      }
      return false;
    }),
    []
  );

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] type-body text-foreground" data-oid="02f6af567e" data-oid-component-root="true">
      <TopBar studio={studio} panelsOpen={panelsOpen} onTogglePanels={() => setPanelsOpen((o) => !o)} />
      <div className="relative flex min-h-0 flex-1" data-oid="981cf0b93e" data-oid-text-editable="false">
        <Toolbar studio={studio} />
        <CanvasStage studio={studio} />
        {panelsOpen &&
        <button
          type="button"
          aria-label="Close panels"
          onClick={() => setPanelsOpen(false)}
          className="absolute inset-0 z-30 bg-background/60 md:hidden" data-oid="87fe4692a1" />
        }
        <aside
          aria-label="Panels"
          data-open={panelsOpen}
          className="absolute inset-y-0 right-0 z-40 flex w-[304px] max-w-[88vw] translate-x-full flex-col overflow-y-auto border-l border-border bg-card shadow-2xl transition-transform duration-200 data-[open=true]:translate-x-0 md:static md:z-auto md:w-[296px] md:max-w-none md:shrink-0 md:translate-x-0 md:shadow-none md:transition-none" data-oid="0ac3bbee39">
          <div className="flex items-center justify-between border-b border-border px-ds-md py-ds-sm md:hidden" data-oid="3606e637fe">
            <h2 className="type-heading text-foreground" data-oid="5af6a35f0c">Panels</h2>
            <button
              type="button"
              aria-label="Close panels"
              onClick={() => setPanelsOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" data-oid="fe3d8d7850">
              <X className="h-4 w-4" data-oid="315e094968" />
            </button>
          </div>
          <ColorPanel studio={studio} />
          <SwatchesPanel studio={studio} />
          <BrushPanel studio={studio} />
          <LayersPanel studio={studio} />
        </aside>
      </div>
      <NewProjectDialog studio={studio} />
    </main>);

}