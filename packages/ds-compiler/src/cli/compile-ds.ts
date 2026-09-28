#!/usr/bin/env tsx
/**
 * CLI: compile-ds [DESIGN.md] [out-global.css]
 *                 [--provenance path] [--html path] [--font-plan path]
 *                 [--document path] [--validate-source-document]
 *                 [--prior-design path]
 *
 * With no managed-font flags, compiles DESIGN.md to global.css using the legacy
 * defaults. With --html and --font-plan, atomically promotes canonical DESIGN.md,
 * global.css, generated HTML, and optional provenance.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { compileDesignSystem } from '../compile';
import {
  compileArtifactTransaction,
  validateAgentDesignSystemOutput,
  withPreAgentDesignMdRollback,
} from '../compiler-transaction';
import { parseCanonicalFontLoadingPlanJson } from '../managed-font-block';
import { renderDesignMd, type RenderDocumentInput } from '../parse';

const DEFAULT_INPUT = "apps/vite/design/DESIGN.md";
const DEFAULT_OUTPUT = "apps/vite/client/global.css";

interface CliOptions {
  provenance?: string;
  html?: string;
  fontPlan?: string;
  document?: string;
  validateSourceDocument: boolean;
  priorDesign?: string;
}

function parseArgs(argv: string[]): { input: string; output: string; options: CliOptions } {
  const positional: string[] = [];
  const options: CliOptions = { validateSourceDocument: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      if (positional.length >= 2) throw new Error(`unexpected positional argument: ${arg}`);
      positional.push(arg);
      continue;
    }
    if (arg === '--validate-source-document') {
      options.validateSourceDocument = true;
      continue;
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
    switch (arg) {
      case '--provenance': options.provenance = value; break;
      case '--html': options.html = value; break;
      case '--font-plan': options.fontPlan = value; break;
      case '--document': options.document = value; break;
      case '--prior-design': options.priorDesign = value; break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }
  return {
    input: positional[0] ?? DEFAULT_INPUT,
    output: positional[1] ?? DEFAULT_OUTPUT,
    options,
  };
}

function main(argv: string[]): void {
  const { input, output, options } = parseArgs(argv);
  if ((options.html === undefined) !== (options.fontPlan === undefined)) {
    throw new Error('--html and --font-plan must be provided together');
  }
  if (options.validateSourceDocument && !options.document) {
    throw new Error('--validate-source-document requires --document');
  }

  // When run via the root `pnpm --filter @vibe/ds-compiler ds:compile`, the
  // script's cwd is the ds-compiler package dir, not where the user invoked it.
  // pnpm/npm set INIT_CWD to the original invocation dir; resolve against that
  // so the documented relative paths (e.g. apps/vite/design/DESIGN.md) work.
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const inputPath = resolve(baseDir, input);
  const cssPath = resolve(baseDir, output);
  const text = readFileSync(inputPath, "utf8");
  const designDocument = options.document
    ? JSON.parse(readFileSync(resolve(baseDir, options.document), 'utf8')) as RenderDocumentInput
    : undefined;

  const compile = (): void => {
    if (options.validateSourceDocument && designDocument) {
      validateAgentDesignSystemOutput(inputPath, designDocument);
    }
    const canonicalText = designDocument ? renderDesignMd(designDocument) : text;
    if (options.html && options.fontPlan) {
      const htmlPath = resolve(baseDir, options.html);
      compileArtifactTransaction({
        paths: {
          designMd: inputPath,
          css: cssPath,
          html: htmlPath,
          ...(options.provenance
            ? { provenance: resolve(baseDir, options.provenance) }
            : {}),
        },
        designMd: canonicalText,
        html: readFileSync(htmlPath, 'utf8'),
        fontLoadingPlan: parseCanonicalFontLoadingPlanJson(
          readFileSync(resolve(baseDir, options.fontPlan), 'utf8'),
        ),
      });
      console.log(`[ds-compiler] wrote ${htmlPath}`);
    } else {
      const result = compileDesignSystem(canonicalText);
      mkdirSync(dirname(cssPath), { recursive: true });
      writeFileSync(cssPath, result.css, 'utf8');
      if (options.provenance) {
        const provenancePath = resolve(baseDir, options.provenance);
        mkdirSync(dirname(provenancePath), { recursive: true });
        writeFileSync(provenancePath, `${JSON.stringify(result.provenance, null, 2)}\n`, 'utf8');
      }
    }
  };

  if (options.priorDesign) {
    withPreAgentDesignMdRollback(inputPath, resolve(baseDir, options.priorDesign), compile);
  } else {
    compile();
  }
  console.log(`[ds-compiler] wrote ${cssPath}`);
  if (options.provenance) console.log(`[ds-compiler] wrote ${resolve(baseDir, options.provenance)}`);

  console.log("[ds-compiler] done.");
}

main(process.argv.slice(2));
