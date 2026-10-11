import { useEffect, useRef, useState } from "react";
import { Boxes, Brush, Layers, Palette, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { useStudio } from "../components/art/useStudio";
import { TopBar } from "../components/art/TopBar";
import { Toolbar } from "../components/art/Toolbar";
import { CanvasStage } from "../components/art/CanvasStage";
import { ColorPanel } from "../components/art/ColorPanel";
import { SwatchesPanel } from "../components/art/SwatchesPanel";
import { BrushPanel } from "../components/art/BrushPanel";
import { LayersPanel } from "../components/art/LayersPanel";
import { ObjectPanel } from "../components/art/ObjectPanel";
import { NewProjectDialog } from "../components/art/NewProjectDialog";
import { onAndroidBack } from "../lib/art/native";
import { useAutosave } from "../components/art/useAutosave";

export default function Index() {
  const studio = useStudio();
  useAutosave(studio);
  // Phones: the colour / brush / layer panels live in a slide-out drawer. Desktop + tablets: always docked.
  const [panelsOpen, setPanelsOpen] = useState(false);
  // Right-side panel tabs + desktop collapse
  const [tab, setTab] = useState<"color" | "brushes" | "layers" | "object">("color");
  const [collapsed, setCollapsed] = useState(false);
  const openTab = (t: "color" | "brushes" | "layers" | "object") => {
    setTab(t);
    setCollapsed(false);
  };
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
    <main className="flex h-dvh flex-col overflow-hidden print:hidden overscroll-none bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] type-body text-foreground" data-oid="02f6af567e" data-oid-component-root="true">
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
        {collapsed &&
        <nav aria-label="Collapsed panels" className="hidden w-11 shrink-0 flex-col items-center gap-ds-xs border-l border-border bg-card py-ds-sm md:flex" data-oid="23440c3c63">
            <button type="button" aria-label="Expand panels" title="Expand panels" onClick={() => setCollapsed(false)} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" data-oid="a3b070039e">
              <PanelRightOpen className="h-4 w-4" data-oid="b46ae522c1" />
            </button>
            <div className="my-ds-xs h-px w-6 bg-border" data-oid="7c38f7db70" />
            <button type="button" aria-label="Colour panel" title="Colour" onClick={() => openTab("color")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-primary" data-oid="5df78fcc3f">
              <Palette className="h-4 w-4" data-oid="92f31820f7" />
            </button>
            <button type="button" aria-label="Brushes panel" title="Brushes" onClick={() => openTab("brushes")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-primary" data-oid="13cfc035a1">
              <Brush className="h-4 w-4" data-oid="f387672926" />
            </button>
            <button type="button" aria-label="Layers panel" title="Layers" onClick={() => openTab("layers")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-primary" data-oid="89eab6b126">
              <Layers className="h-4 w-4" data-oid="6b2976eea9" />
            </button>
            <button type="button" aria-label="Object panel" title="Object" onClick={() => openTab("object")} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-primary" data-oid="ff34a1d3a9">
              <Boxes className="h-4 w-4" data-oid="8c50dd6431" />
            </button>
          </nav>
        }
        <aside
          aria-label="Panels"
          data-open={panelsOpen}
          data-collapsed={collapsed}
          className="absolute inset-y-0 right-0 z-40 flex w-[304px] max-w-[88vw] translate-x-full flex-col overflow-y-auto border-l border-border bg-card shadow-2xl transition-transform duration-200 data-[open=true]:translate-x-0 md:static md:z-auto md:w-[296px] md:max-w-none md:shrink-0 md:translate-x-0 md:shadow-none md:transition-none md:data-[collapsed=true]:hidden" data-oid="0ac3bbee39">
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
          <div className="sticky top-0 z-10 flex items-end gap-ds-xs border-b border-border bg-card pl-ds-md pr-ds-xs pt-ds-sm" data-oid="ed081b9c1e">
            <div role="tablist" aria-label="Panel sections" className="ds-tab-list flex-1 gap-ds-md border-b-0" data-oid="dc59387f60">
              <button type="button" role="tab" id="tab-color" aria-controls="panel-tab" aria-selected={tab === "color"} onClick={() => setTab("color")} className="ds-tab inline-flex items-center gap-ds-xs pb-ds-sm" data-oid="443adc3c80">
                Colour
              </button>
              <button type="button" role="tab" id="tab-brushes" aria-controls="panel-tab" aria-selected={tab === "brushes"} onClick={() => setTab("brushes")} className="ds-tab inline-flex items-center gap-ds-xs pb-ds-sm" data-oid="6eb0c736e3">
                Brushes
              </button>
              <button type="button" role="tab" id="tab-layers" aria-controls="panel-tab" aria-selected={tab === "layers"} onClick={() => setTab("layers")} className="ds-tab inline-flex items-center gap-ds-xs pb-ds-sm" data-oid="89b474a560">
                Layers
              </button>
              <button type="button" role="tab" id="tab-object" aria-controls="panel-tab" aria-selected={tab === "object"} onClick={() => setTab("object")} className="ds-tab inline-flex items-center gap-ds-xs pb-ds-sm" data-oid="1f572481af">
                Object
              </button>
            </div>
            <button type="button" aria-label="Collapse panels" title="Collapse panels" onClick={() => setCollapsed(true)} className="mb-ds-xs hidden h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground md:grid" data-oid="351b84970e">
              <PanelRightClose className="h-4 w-4" data-oid="89f927145a" />
            </button>
          </div>
          <div id="panel-tab" role="tabpanel" aria-labelledby={`tab-${tab}`} className="flex flex-col" data-oid="b947f8d1ff" data-oid-text-editable="false" data-oid-text-source="expression:d72a2073dd5f|expression:e211dfe9a438|expression:5afa108e8fa6|expression:34d1a033247e">
            {tab === "color" &&
            <>
                <ColorPanel studio={studio} />
                <SwatchesPanel studio={studio} />
              </>
            }
            {tab === "brushes" && <BrushPanel studio={studio} />}
            {tab === "layers" && <LayersPanel studio={studio} />}
            {tab === "object" && <ObjectPanel studio={studio} />}
          </div>
        </aside>
      </div>
      <NewProjectDialog studio={studio} />
    </main>);

}