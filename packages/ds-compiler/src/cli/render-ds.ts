#!/usr/bin/env tsx
/**
 * CLI: render-ds <document.json> [out-DESIGN.md]
 *
 * The inverse of `compile-ds`: reads a design-system document (the DESIGN.md
 * frontmatter shape as JSON) and writes a canonical DESIGN.md by running it
 * through the SAME validate/fill/serialize path the parser uses. This makes
 * `compile-ds(render-ds(document))` reproduce the document's tokens exactly, so
 * the compiler's `documentHash` matches the service's hash of the same document
 * (the reconciliation invariant).
 *
 * Used by the canvas-native apply-draft flow: the persisted draft document is
 * rendered into the sandbox as DESIGN.md, then compiled to global.css before the
 * Apply agent runs.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  renderDesignMd,
  type RenderDocumentInput,
} from "../parse";

const DEFAULT_OUTPUT = "apps/vite/design/DESIGN.md";

function main(argv: string[]): void {
  const [inputArg, outArg] = argv;
  if (!inputArg) {
    console.error("usage: render-ds <document.json> [out-DESIGN.md]");
    process.exit(2);
    return;
  }
  const outMd = outArg ?? DEFAULT_OUTPUT;

  // Mirror compile-ds: resolve documented relative paths against the original
  // invocation dir (pnpm/npm set INIT_CWD), not the package dir.
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const inputPath = resolve(baseDir, inputArg);
  const outPath = resolve(baseDir, outMd);

  const raw = readFileSync(inputPath, "utf8");
  let document: RenderDocumentInput;
  try {
    document = JSON.parse(raw) as RenderDocumentInput;
  } catch (err) {
    console.error(`[ds-compiler] document JSON is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
    return;
  }

  // validateAndFill enforces the required core color slots and normalizes; a
  // malformed document throws here (non-zero exit) rather than writing a bad md.
  const md = renderDesignMd(document);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, md, "utf8");
  console.log(`[ds-compiler] wrote ${outPath}`);
}

main(process.argv.slice(2));
