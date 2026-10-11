export const COLOR_SLOTS = [
  "background","foreground","card","card-foreground","popover","popover-foreground",
  "primary","primary-foreground","secondary","secondary-foreground","muted","muted-foreground",
  "accent","accent-foreground","destructive","destructive-foreground","border","input","ring",
  "success","success-foreground","warning","warning-foreground","info","info-foreground",
  "chart-1","chart-2","chart-3","chart-4","chart-5",
] as const;
export type ColorSlot = (typeof COLOR_SLOTS)[number];
export const REQUIRED_CORE: ColorSlot[] = [
  "background","foreground","card","card-foreground","popover","popover-foreground",
  "primary","primary-foreground","secondary","secondary-foreground","muted","muted-foreground",
  "accent","accent-foreground","destructive","destructive-foreground","border","input","ring",
];
export const COLOR_RAMP_STEPS = ["100", "300", "500", "700", "900"] as const;
export type ColorRampStep = (typeof COLOR_RAMP_STEPS)[number];
export const COLOR_PRIMITIVE_GROUPS = ["expressive", "status", "neutral"] as const;
export type ColorPrimitiveGroup = (typeof COLOR_PRIMITIVE_GROUPS)[number];
export const SPACING_SCALE_KEYS = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const;
export type SpacingScaleKey = (typeof SPACING_SCALE_KEYS)[number];
export const RADIUS_SCALE_KEYS = ["none", "sm", "md", "lg", "xl", "full"] as const;
export const REQUIRED_TYPE_ROLES = ["display", "heading", "body", "label", "caption"] as const;
export type RadiusScaleKey = (typeof RADIUS_SCALE_KEYS)[number];

export const REQUIRED_SEMANTIC: ColorSlot[] = [
  ...REQUIRED_CORE,
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
];

export const COLOR_REFERENCE_RE =
  /^\{color\.(expressive|status|neutral)\.([a-zA-Z][a-zA-Z0-9_-]*)\.(100|300|500|700|900)\}$/;

/** A foreground/background slot pair whose contrast is worth checking. */
export interface ContrastPair {
  /** Stable label for the pair (used in diagnostics). */
  pair: string;
  fg: ColorSlot;
  bg: ColorSlot;
  /** Advisory pairs (status colors) are recorded but never raise a warning. */
  advisory: boolean;
}

/** Semantic fg/bg pairs checked for WCAG contrast. Core pairs are enforced as
 *  non-blocking warnings; advisory status pairs are recorded only. */
export const CONTRAST_PAIRS: ContrastPair[] = [
  { pair: "base", fg: "foreground", bg: "background", advisory: false },
  { pair: "card", fg: "card-foreground", bg: "card", advisory: false },
  { pair: "popover", fg: "popover-foreground", bg: "popover", advisory: false },
  { pair: "primary", fg: "primary-foreground", bg: "primary", advisory: false },
  { pair: "secondary", fg: "secondary-foreground", bg: "secondary", advisory: false },
  { pair: "muted", fg: "muted-foreground", bg: "muted", advisory: false },
  { pair: "accent", fg: "accent-foreground", bg: "accent", advisory: false },
  { pair: "destructive", fg: "destructive-foreground", bg: "destructive", advisory: false },
  { pair: "success", fg: "success-foreground", bg: "success", advisory: true },
  { pair: "warning", fg: "warning-foreground", bg: "warning", advisory: true },
  { pair: "info", fg: "info-foreground", bg: "info", advisory: true },
];
