import { useEffect, useMemo, useRef } from "react";
import { Redo2, Undo2 } from "lucide-react";
import type { Studio } from "./useStudio";
import { Panel, iconBtn } from "./Panel";

export function HistoryPanel({ studio }: {studio: Studio;}) {
  const { labels, current } = useMemo(
    () => studio.historyEntries(),
    // recompute only when a history step is added / undone (not on every drag frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studio.histVersion]
  );
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[aria-current='step']")?.scrollIntoView({ block: "nearest" });
  }, [current, labels.length]);

  return (
    <Panel
      title="History"
      actions={
      <div className="flex items-center" data-oid="76196980c8" data-oid-component-root="true">
          <button type="button" aria-label="Undo (Ctrl+Z)" className={iconBtn} disabled={!studio.canUndo} onClick={studio.undo} data-oid="bbdf851fba" data-oid-classname-dynamic="true">
            <Undo2 className="h-3.5 w-3.5" data-oid="acd91a5c6e" />
          </button>
          <button type="button" aria-label="Redo (Ctrl+Shift+Z)" className={iconBtn} disabled={!studio.canRedo} onClick={studio.redo} data-oid="16f77a5896" data-oid-classname-dynamic="true">
            <Redo2 className="h-3.5 w-3.5" data-oid="20e374192f" />
          </button>
        </div>
      }>
      <ol ref={listRef} aria-label="History steps" className="flex max-h-56 flex-col gap-px overflow-y-auto rounded-md border border-border bg-background p-ds-xs" data-oid="890a6dd3b6">
        {labels.map((label, index) =>
        <li key={index} data-index={index} data-oid="b5e1645020" data-oid-shared="true">
            <button
            type="button"
            aria-current={index === current ? "step" : undefined}
            data-future={index > current}
            onClick={() => studio.jumpToHistory(index)}
            className="flex w-full items-center gap-ds-sm rounded-sm px-ds-xs py-[3px] text-left text-label text-foreground hover:bg-secondary aria-[current=step]:bg-accent aria-[current=step]:text-accent-foreground data-[future=true]:text-muted-foreground data-[future=true]:opacity-60" data-oid="d757e4ec49" data-oid-shared="true">
              <span className="w-6 shrink-0 text-right type-caption opacity-70" data-oid="613345ca14" data-oid-shared="true">{index}</span>
              <span className="truncate" data-oid="2868007aa6" data-oid-shared="true">{label}</span>
            </button>
          </li>
        )}
      </ol>
      <p className="mt-ds-xs type-caption text-muted-foreground" data-oid="1938324c77">CLICK A STEP TO JUMP BACK · LAST 150 STEPS</p>
    </Panel>);

}