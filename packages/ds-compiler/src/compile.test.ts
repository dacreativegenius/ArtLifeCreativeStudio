import { describe, expect, it } from 'vitest';
import { compileDesignSystem } from './compile';
import {
  canonicalJson,
  normalizeResolvedTokens,
  parseDesignMd,
  serializeDesignMd,
  validateAndFill,
} from './parse';
import { makeColorDefinition, makeDocument } from './test-fixture';
import type { FontLoadingPlan } from './font-loading-plan';
import {
  MANAGED_FONT_BLOCK_END,
  MANAGED_FONT_BLOCK_START,
  renderManagedFontBlock,
} from './managed-font-block';

function markdown(overrides = {}) {
  return serializeDesignMd(validateAndFill(makeDocument(overrides)), '## Overview\n\nTest system.\n');
}

describe('compileDesignSystem', () => {
  const loadingPlan: FontLoadingPlan = {
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap',
    families: [
      {
        cssFamilyName: 'Inter',
        faces: [
          { weight: 400, style: 'normal' },
          { weight: 700, style: 'normal' },
        ],
      },
    ],
  };

  it('emits one compiler-managed font block and its integrity hash', () => {
    const html = '<html><head><link rel="stylesheet" href="/direct-edit.css"></head><body></body></html>';
    const result = compileDesignSystem(markdown(), { html, fontLoadingPlan: loadingPlan });

    expect(result.html).toContain('mercury:managed-font-loading:start');
    expect(result.html).toContain('href="https://fonts.googleapis.com"');
    expect(result.html).toContain('href="https://fonts.gstatic.com" crossorigin');
    expect(result.html).toContain(
      'href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;display=swap"',
    );
    expect(result.html).toContain('href="/direct-edit.css"');
    expect(result.provenance.fontLoadingHash).toMatch(/^[a-f0-9]{64}$/);

    const recompiled = compileDesignSystem(markdown(), {
      html: result.html!,
      fontLoadingPlan: loadingPlan,
    });
    expect(recompiled.html).toBe(result.html);
    expect(recompiled.html!.match(/mercury:managed-font-loading:start/g)).toHaveLength(1);
    expect(recompiled.provenance.fontLoadingHash).toBe(result.provenance.fontLoadingHash);
  });

  it('replaces the block in place and removes unreferenced families', () => {
    const firstPlan: FontLoadingPlan = {
      href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400&family=Roboto:wght@400&display=swap',
      families: [
        { cssFamilyName: 'Inter', faces: [{ weight: 400, style: 'normal' }] },
        { cssFamilyName: 'Roboto', faces: [{ weight: 400, style: 'normal' }] },
      ],
    };
    const first = compileDesignSystem(markdown(), {
      html: '<html><head></head><body></body></html>',
      fontLoadingPlan: firstPlan,
    });
    const second = compileDesignSystem(markdown(), {
      html: first.html!,
      fontLoadingPlan: loadingPlan,
    });
    expect(second.html).not.toContain('Roboto');
    expect(second.html!.match(/mercury:managed-font-loading:start/g)).toHaveLength(1);
  });

  it.each([
    ['duplicate', (block: string) => `${block}\n${block}`],
    ['nested', (block: string) => block.replace(MANAGED_FONT_BLOCK_END, `${MANAGED_FONT_BLOCK_START}\n${MANAGED_FONT_BLOCK_END}`)],
    ['incomplete', (block: string) => block.replace(MANAGED_FONT_BLOCK_END, '')],
    ['malformed', (block: string) => block.replace('managed-font-loading:start', 'managed-font-loading:bogus')],
    ['tampered', (block: string) => block.replace('fonts.gstatic.com', 'example.com')],
  ])('rejects a %s managed block', (_name, mutate) => {
    const block = renderManagedFontBlock(loadingPlan).block;
    expect(() =>
      compileDesignSystem(markdown(), {
        html: `<html><head>${mutate(block)}</head><body></body></html>`,
        fontLoadingPlan: loadingPlan,
      }),
    ).toThrow(/managed font block/i);
  });

  it('resolves aliases and emits complete named token scales', () => {
    const result = compileDesignSystem(markdown());
    expect(result.css).toContain('--primary: hsl(243.4 75.4% 58.6%);');
    expect(result.css).toContain('--ds-space-3xl: 4rem;');
    expect(result.css).toContain('--spacing-ds-3xl: var(--ds-space-3xl);');
    expect(result.css).not.toContain('--spacing-xl:');
    expect(result.css).toContain('--radius-full: 9999px;');
  });

  it('emits only the canonical token set with class-based dark utilities', () => {
    const result = compileDesignSystem(markdown());
    expect(result.css).not.toContain('.dark {');
    expect(result.css).toContain('@custom-variant dark (&:is(.dark *));');
  });

  it('emits fonts, typography roles, and weights', () => {
    const document = makeDocument();
    document.type = {
      scale: {
        ...document.type.scale,
        display: {
          fontSize: '3rem',
          lineHeight: '1.1',
          letterSpacing: '-0.03em',
          fontKey: 'source-serif-4',
          fontStyle: 'italic',
        },
      },
      weights: document.type.weights,
    };
    const result = compileDesignSystem(serializeDesignMd(validateAndFill(document)));
    expect(result.css).toContain('--ds-font-inter: "Inter", sans-serif;');
    expect(result.css).toContain('--text-display: 3rem;');
    expect(result.css).toContain('--text-display--letter-spacing: -0.03em;');
    expect(result.css).toContain('--font-weight-display: 700;');
  });

  it('reports contrast failures without blocking compilation', () => {
    const colors = makeColorDefinition('#ffffff');
    const result = compileDesignSystem(markdown({ colors }));
    expect(result.provenance.contrast.some((finding) => finding.level === 'fail')).toBe(true);
    expect(result.provenance.warnings.length).toBeGreaterThan(0);
  });

  it('compiles translucent semantic colors without contrast diagnostics throwing', () => {
    const colors = makeColorDefinition('#96505073');
    const result = compileDesignSystem(markdown({ colors }));

    expect(result.css).toContain('--primary: hsl(0 30.4% 45.1% / 45.1%);');
    expect(result.provenance.contrast.length).toBeGreaterThan(0);
    expect(result.provenance.contrast.every((finding) =>
      Number.isFinite(finding.ratio) && finding.ratio >= 1 && finding.ratio <= 21,
    )).toBe(true);
  });

  it('is deterministic and formatting-insensitive', () => {
    const source = markdown();
    const first = compileDesignSystem(source);
    const second = compileDesignSystem(source.replace(/^version: 1\n/m, '\nversion: 1\n'));
    expect(compileDesignSystem(source).css).toBe(first.css);
    expect(second.provenance.sourceHash).not.toBe(first.provenance.sourceHash);
    expect(second.provenance.documentHash).toBe(first.provenance.documentHash);
  });

  it('keeps the primitive graph stable across canonical render and parse', () => {
    const first = validateAndFill(makeDocument());
    const second = validateAndFill(parseDesignMd(serializeDesignMd(first)).frontmatter);
    expect(canonicalJson(normalizeResolvedTokens(second))).toBe(
      canonicalJson(normalizeResolvedTokens(first)),
    );
  });

  it('rejects broken aliases and incomplete named scales', () => {
    const brokenAlias = makeDocument();
    brokenAlias.colors.semantic.primary = '{color.expressive.missing.500}';
    expect(() => validateAndFill(brokenAlias)).toThrow(/missing primitive token/);

    const brokenSpacing = makeDocument();
    delete (brokenSpacing.spacing as Partial<typeof brokenSpacing.spacing>).md;
    expect(() => validateAndFill(brokenSpacing)).toThrow(/missing required spacing.md/);
  });
});
