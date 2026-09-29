import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function Panel({ title, actions, children }: {title: string;actions?: ReactNode;children: ReactNode;}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-border" data-oid="8f704ae429" data-oid-component-root="true" data-oid-text-editable="false" data-oid-text-source="element:header|expression:341c0a397540">
      <header className="flex h-9 items-center gap-ds-xs px-ds-sm" data-oid="9a55fde14f" data-oid-text-editable="false" data-oid-text-source="element:button|element:h2|expression:326b426f9ac7">
        <button
          type="button"
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground" data-oid="e8ea601ce3">
          
          <ChevronDown className="h-3.5 w-3.5 transition-transform aria-[expanded=false]:-rotate-90" aria-expanded={open} data-oid="53c69803b0" />
        </button>
        <h2 className="flex-1 type-label uppercase tracking-[0.12em] text-muted-foreground" data-oid="99e8806450">{title}</h2>
        {actions}
      </header>
      {open && <div className="px-ds-md pb-ds-md" data-oid="47c06a57d6">{children}</div>}
    </section>);

}

export const iconBtn =
"grid h-6 w-6 place-items-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-35";