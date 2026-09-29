import { useRef, useState } from "react";
import { cn } from "@vibe/ui";

/**
 * Click-to-type numeric readout that sits next to a slider.
 * Shows "12px" at rest; click/tap to type an exact value, Enter or blur applies, Esc cancels,
 * ↑ / ↓ nudge by 1 (Shift = 10). Values are clamped to [min, max].
 */
export function NumInput({
  value,
  min,
  max,
  suffix = "",
  label,
  onChange,
  className
}: {value: number;min: number;max: number;suffix?: string;label: string;onChange: (v: number) => void;className?: string;}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));

  const commit = (raw: string | null) => {
    if (raw === null) return;
    const n = parseFloat(raw.replace(/[^\d.-]/g, ""));
    if (!Number.isNaN(n) && clamp(n) !== value) onChange(clamp(n));
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={`${label} — type a value from ${min} to ${max}`}
      title="Click to type a value"
      value={draft ?? `${value}${suffix}`}
      onFocus={(e) => {
        cancelled.current = false;
        setDraft(String(value));
        const el = e.currentTarget;
        requestAnimationFrame(() => el.select());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!cancelled.current) commit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();else
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const step = (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
          const base = parseFloat(draft ?? String(value));
          const next = clamp((Number.isNaN(base) ? value : base) + step);
          setDraft(String(next));
          onChange(next);
        }
      }}
      className={cn(
        "h-6 w-12 shrink-0 cursor-text rounded-sm border border-transparent bg-transparent px-ds-xs text-right type-caption text-foreground outline-none hover:border-border focus:border-primary focus:bg-background",
        className
      )} data-oid="68b4b6ea2b" data-oid-component-root="true" data-oid-classname-dynamic="true" />);


}