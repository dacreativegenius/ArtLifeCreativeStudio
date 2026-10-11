/**
 * WCAG contrast diagnostics over resolved HSL tuples.
 *
 * These are advisory only: the compiler records findings and raises non-blocking
 * warnings for core semantic pairs, but never throws on low contrast. The editor
 * and agents decide what to do with the findings.
 */
import { CONTRAST_PAIRS } from "./schema";
import { parseHslTuple } from "./hex";

type Rgb = [number, number, number];
type Rgba = [...Rgb, number];

const OPAQUE_WHITE = "0 0% 100%";

/**
 * Bare HSL tuple `"H S% L% / A%"` -> [r,g,b,a] in 0..1.
 * Parsing uses the compiler's canonical tuple grammar so diagnostics accept
 * exactly the same color language as CSS emission.
 */
function tupleToRgba(tuple: string): Rgba {
  const { hue: h, saturation: s, lightness: l, alpha } = parseHslTuple(tuple);

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const mm = l - c / 2;
  return [r + mm, g + mm, b + mm, alpha];
}

/** Alpha-composite foreground over background using straight-alpha channels. */
function composite(foreground: Rgba, background: Rgba): Rgba {
  const [fr, fg, fb, fa] = foreground;
  const [br, bg, bb, ba] = background;
  const alpha = fa + ba * (1 - fa);
  if (alpha === 0) return [0, 0, 0, 0];
  const channel = (front: number, back: number) =>
    (front * fa + back * ba * (1 - fa)) / alpha;
  return [channel(fr, br), channel(fg, bg), channel(fb, bb), alpha];
}

function channel(v: number): number {
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: Rgb | Rgba): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG contrast ratio between a foreground and background HSL tuple (1..21).
 *
 * Translucent colors are evaluated as rendered pixels: the background is
 * composited over `backdrop`, then the foreground is composited over that
 * visible background. The backdrop itself is flattened over opaque white so
 * this function is deterministic even when all three inputs contain alpha.
 */
export function contrastRatio(
  foreground: string,
  background: string,
  backdrop = OPAQUE_WHITE,
): number {
  const canvas = tupleToRgba(OPAQUE_WHITE);
  const visibleBackdrop = composite(tupleToRgba(backdrop), canvas);
  const visibleBackground = composite(tupleToRgba(background), visibleBackdrop);
  const visibleForeground = composite(tupleToRgba(foreground), visibleBackground);
  const la = relativeLuminance(visibleForeground);
  const lb = relativeLuminance(visibleBackground);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastLevel = "AAA" | "AA" | "AA-large" | "fail";

export interface ContrastFinding {
  pair: string;
  ratio: number;
  level: ContrastLevel;
  advisory: boolean;
}

function level(ratio: number): ContrastLevel {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA-large";
  return "fail";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Evaluate every configured semantic pair against the authored tokens. */
function evaluate(tokens: Record<string, string>): ContrastFinding[] {
  const findings: ContrastFinding[] = [];
  for (const { pair, fg, bg, advisory } of CONTRAST_PAIRS) {
    const fgTuple = tokens[fg];
    const bgTuple = tokens[bg];
    if (fgTuple === undefined || bgTuple === undefined) continue;
    // The page background is the deterministic underlay for component/status
    // surfaces. The base pair itself sits on the browser's opaque white canvas.
    const backdrop = pair === "base" ? OPAQUE_WHITE : tokens.background ?? OPAQUE_WHITE;
    const ratio = round2(contrastRatio(fgTuple, bgTuple, backdrop));
    findings.push({ pair, ratio, level: level(ratio), advisory });
  }
  return findings;
}

export interface ContrastReport {
  findings: ContrastFinding[];
  /** Non-blocking warning strings for core pairs below AA. */
  warnings: string[];
}

/** Run contrast diagnostics over the canonical color tokens. */
export function checkContrast(tokens: Record<string, string>): ContrastReport {
  const findings = evaluate(tokens);
  // Findings record every band (AAA/AA/AA-large/fail). Warnings fire only for
  // genuine failures (< 3:1, i.e. below even AA-large) on core pairs — many
  // real palettes (e.g. shadcn's white-on-red destructive) sit in the AA-large
  // band by design, so warning there would be pure noise.
  const warnings: string[] = [];
  for (const f of findings) {
    if (!f.advisory && f.level === "fail") {
      warnings.push(
        `low contrast: ${f.pair} is ${f.ratio}:1; below the 3:1 large-text floor`,
      );
    }
  }
  return { findings, warnings };
}
