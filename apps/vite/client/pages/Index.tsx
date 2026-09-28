import { useStudio } from "../components/art/useStudio";
import { TopBar } from "../components/art/TopBar";
import { Toolbar } from "../components/art/Toolbar";
import { CanvasStage } from "../components/art/CanvasStage";
import { ColorPanel } from "../components/art/ColorPanel";
import { SwatchesPanel } from "../components/art/SwatchesPanel";
import { BrushPanel } from "../components/art/BrushPanel";
import { LayersPanel } from "../components/art/LayersPanel";

export default function Index() {
  const studio = useStudio();
  return (
    <main className="flex h-screen min-h-screen flex-col overflow-hidden bg-background type-body text-foreground" data-oid="fdeb5922f8" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true">
      <TopBar studio={studio} />
      <div className="flex min-h-0 flex-1" data-oid="06c4110718">
        <Toolbar studio={studio} />
        <CanvasStage studio={studio} />
        <aside aria-label="Panels" className="flex w-[296px] shrink-0 flex-col overflow-y-auto border-l border-border bg-card" data-oid="d224f60b94">
          <ColorPanel studio={studio} />
          <SwatchesPanel studio={studio} />
          <BrushPanel studio={studio} />
          <LayersPanel studio={studio} />
        </aside>
      </div>
    </main>);

}