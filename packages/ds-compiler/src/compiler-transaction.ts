import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { compileDesignSystem, type CompileResult } from './compile';
import type { FontLoadingPlan } from './font-loading-plan';
import { renderDesignMd, type RenderDocumentInput } from './parse';

export interface CompilerArtifactPaths {
  designMd: string;
  css: string;
  html: string;
  provenance?: string;
}

export interface CompilerTransactionInput {
  paths: CompilerArtifactPaths;
  designMd: string;
  html: string;
  fontLoadingPlan: FontLoadingPlan;
}

export interface CompilerTransactionIo {
  exists(path: string): boolean;
  mkdir(path: string): void;
  read(path: string): string;
  write(path: string, content: string): void;
  rename(from: string, to: string): void;
  remove(path: string): void;
}

const nodeIo: CompilerTransactionIo = {
  exists: existsSync,
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  read: (path) => readFileSync(path, 'utf8'),
  write: (path, content) => writeFileSync(path, content, 'utf8'),
  rename: renameSync,
  remove: (path) => rmSync(path, { force: true }),
};

/** Validate the agent-written DESIGN.md against the submitted structured document. */
export function validateAgentDesignSystemOutput(
  designMdPath: string,
  designDocument: RenderDocumentInput,
  io: CompilerTransactionIo = nodeIo,
): void {
  const sourceHash = compileDesignSystem(io.read(designMdPath)).provenance.documentHash;
  const canonicalHash = compileDesignSystem(renderDesignMd(designDocument)).provenance.documentHash;
  if (sourceHash !== canonicalHash) {
    throw new Error('agent-authored DESIGN.md does not match the canonical design document');
  }
}

/** Restore the pre-agent DESIGN.md snapshot when validation or promotion fails. */
export function withPreAgentDesignMdRollback<T>(
  designMdPath: string,
  priorDesignMdPath: string,
  action: () => T,
  io: CompilerTransactionIo = nodeIo,
): T {
  const priorDesignMd = io.read(priorDesignMdPath);
  try {
    return action();
  } catch (error) {
    try {
      io.write(designMdPath, priorDesignMd);
    } catch (rollbackError) {
      const original = error instanceof Error ? error.message : String(error);
      const compensation = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`design-system compilation failed (${original}); DESIGN.md restore failed (${compensation})`);
    }
    throw error;
  }
}

/**
 * Compile, stage, validate and promote DESIGN.md, CSS and generated HTML as one
 * recoverable file transaction. The optional provenance file participates in
 * rollback but is not part of the three-artifact integrity set.
 * The service-side direct-edit equivalent is `writeFileEditTransaction` in
 * `services/mercury_service_1/src/pipeline/astEditInSandbox.ts`; it uses the
 * sandbox API rather than Node fs.
 */
export function compileArtifactTransaction(
  input: CompilerTransactionInput,
  io: CompilerTransactionIo = nodeIo,
): CompileResult {
  const nonce = `.mercury-ds-${process.pid}-${randomUUID()}`;
  const result = compileDesignSystem(input.designMd, {
    html: input.html,
    fontLoadingPlan: input.fontLoadingPlan,
  });
  if (result.html === undefined) {
    throw new Error('compiler did not produce the complete design-system artifact set');
  }
  const artifacts = [
    { path: input.paths.designMd, content: input.designMd },
    { path: input.paths.css, content: result.css },
    { path: input.paths.html, content: result.html },
    ...(input.paths.provenance
      ? [{ path: input.paths.provenance, content: `${JSON.stringify(result.provenance, null, 2)}\n` }]
      : []),
  ];
  const records = artifacts.map((artifact) => ({
    ...artifact,
    staged: `${artifact.path}${nonce}.stage`,
    backup: `${artifact.path}${nonce}.backup`,
    existed: io.exists(artifact.path),
    backedUp: false,
    promoted: false,
  }));

  const cleanup = (): void => {
    for (const record of records) {
      try { io.remove(record.staged); } catch { /* best-effort cleanup */ }
      try { io.remove(record.backup); } catch { /* best-effort cleanup */ }
    }
  };
  const rollback = (): void => {
    const failures: string[] = [];
    for (const record of [...records].reverse()) {
      if (record.promoted) {
        try {
          io.remove(record.path);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (record.backedUp && io.exists(record.backup)) {
        try {
          io.rename(record.backup, record.path);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
    for (const record of records) {
      try { io.remove(record.staged); } catch { /* best-effort staged cleanup */ }
    }
    if (failures.length > 0) throw new Error(failures.join('; '));
    cleanup();
  };

  try {
    for (const record of records) {
      io.mkdir(dirname(record.path));
      io.write(record.staged, record.content);
      if (io.read(record.staged) !== record.content) {
        throw new Error(`staged design-system artifact mismatch: ${record.path}`);
      }
    }
    for (const record of records) {
      if (record.existed) {
        io.rename(record.path, record.backup);
        record.backedUp = true;
      }
    }
    for (const record of records) {
      io.rename(record.staged, record.path);
      record.promoted = true;
    }
    cleanup();
    return result;
  } catch (error) {
    try {
      rollback();
    } catch (rollbackError) {
      const original = error instanceof Error ? error.message : String(error);
      const compensation = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      throw new Error(`design-system artifact transaction failed (${original}); rollback failed (${compensation})`);
    }
    throw error;
  }
}
