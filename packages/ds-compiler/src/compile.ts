import { createHash } from "node:crypto";
import {
  parseDesignMd,
  validateAndFill,
  normalizeResolvedTokens,
  canonicalJson,
} from "./parse";
import { emitCss } from "./emit-css";
import { checkContrast, type ContrastFinding } from "./contrast";
import type { FontLoadingPlan } from './font-loading-plan';
import { updateManagedFontBlock } from './managed-font-block';

export interface Provenance {
  /** What kind of source produced these tokens. */
  sourceKind: string;
  /** WCAG contrast findings per semantic pair. */
  contrast: ContrastFinding[];
  /** Non-fatal advisories surfaced during compilation (incl. low-contrast). */
  warnings: string[];
  /** sha256 of the input DESIGN.md text (formatting-sensitive). */
  sourceHash: string;
  /** sha256 of the normalized token set (formatting-insensitive, canonical). */
  documentHash: string;
  /** sha256 of the emitted global.css. */
  compiledHash: string;
  /** sha256(canonical plan JSON + NUL + exact managed HTML block). */
  fontLoadingHash?: string;
}

export interface CompileResult {
  css: string;
  prose: string;
  html?: string;
  provenance: Provenance;
}

export interface CompileOptions {
  html: string;
  fontLoadingPlan: FontLoadingPlan;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Compile a DESIGN.md into Tailwind v4 global.css + provenance.
 *
 * One color-token set is required. No DTCG export, no component registry. Outputs are the CSS
 * string, the prose body, and a provenance record describing contrast
 * diagnostics and the source/document/compiled hashes.
 */
export function compileDesignSystem(text: string, options?: CompileOptions): CompileResult {
  const { frontmatter, prose } = parseDesignMd(text);
  const resolved = validateAndFill(frontmatter);
  const css = emitCss(resolved);

  const contrastReport = checkContrast(resolved.colors);

  const managedFonts = options
    ? updateManagedFontBlock(options.html, options.fontLoadingPlan)
    : undefined;
  const provenance: Provenance = {
    sourceKind: "designmd",
    contrast: contrastReport.findings,
    warnings: contrastReport.warnings,
    sourceHash: sha256(text),
    documentHash: sha256(canonicalJson(normalizeResolvedTokens(resolved))),
    compiledHash: sha256(css),
    ...(managedFonts ? { fontLoadingHash: managedFonts.fontLoadingHash } : {}),
  };

  return { css, prose, ...(managedFonts ? { html: managedFonts.html } : {}), provenance };
}
