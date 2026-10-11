type IconProps = {className?: string;strokeWidth?: number;};

function Nib({ strokeWidth = 1.75 }: {strokeWidth?: number;}) {
  return (
    <g fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.2 21.3a.9.9 0 0 1-1.3 0l-1.3-1.3a.9.9 0 0 1 0-1.3l4.6-4.6a.9.9 0 0 1 1.3 0l1.3 1.3a.9.9 0 0 1 0 1.3z" />
      <path d="m15.8 14.1-1.1-5.6a.9.9 0 0 0-.6-.6L3.9 5.2a.8.8 0 0 0-1 1l2.7 10.2a.9.9 0 0 0 .6.6l5.6 1.1" />
      <path d="m3.1 5.4 6.1 6.1" />
      <circle cx="10.4" cy="12.6" r="1.6" />
    </g>);

}

/** Add Anchor Point tool — pen nib with a plus. */
export function PenPlusIcon({ className, strokeWidth = 1.75 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" data-oid="fb6e472a29" data-oid-component-root="true" data-oid-classname-dynamic="true" style={{ borderColor: "#000000", borderStyle: "solid", borderWidth: "0px" }}>
      <Nib strokeWidth={strokeWidth} />
      <path d="M19 2.5v6M16 5.5h6" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>);

}

/** Delete Anchor Point tool — pen nib with a minus. */
export function PenMinusIcon({ className, strokeWidth = 1.75 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" data-oid="143df41049" data-oid-component-root="true" data-oid-classname-dynamic="true">
      <Nib strokeWidth={strokeWidth} />
      <path d="M16 5.5h6" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>);

}

/** Anchor Point (convert) tool — a caret over a corner anchor with a bezier handle. */
export function AnchorConvertIcon({ className, strokeWidth = 1.75 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" data-oid="6cfde3650c" data-oid-component-root="true" data-oid-classname-dynamic="true">
      <g fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 20 12 7.5 20.5 20" />
        <rect x="10" y="5.5" width="4" height="4" rx=".5" />
        <path d="M3 7.5h5M16 7.5h5" strokeDasharray="1.5 2" />
        <circle cx="3" cy="7.5" r="1" fill="currentColor" />
        <circle cx="21" cy="7.5" r="1" fill="currentColor" />
      </g>
    </svg>);

}