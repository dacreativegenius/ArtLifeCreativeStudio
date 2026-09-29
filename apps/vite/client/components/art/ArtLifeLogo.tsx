/** Art Life Creative Studio mark — the upright pen nib that forms a capital "A". Same geometry as branding/logo-mark.svg. */
export function ArtLifeLogo({ className, strokeWidth = 40 }: {className?: string;strokeWidth?: number;}) {
  return (
    <svg viewBox="64 64 384 384" className={className} aria-hidden="true" data-oid="0196e299fb" data-oid-component-root="true" data-oid-callsite-deletable="true" data-oid-callsite-single="true" data-oid-classname-dynamic="true">
      <g fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <path d="M256 84C298 160 338 236 348 316H164C174 236 214 160 256 84Z" />
        <path d="M256 84V206" />
        <circle cx="256" cy="238" r="24" />
        <path d="M178 316 150 424" />
        <path d="M334 316 362 424" />
      </g>
    </svg>);

}