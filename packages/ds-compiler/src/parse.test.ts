import { describe, expect, it } from 'vitest';
import { parseDesignMd, serializeDesignMd, validateAndFill } from './parse';
import { makeColorDefinition, makeDocument } from './test-fixture';

function makeMd(document = makeDocument()): string {
  return serializeDesignMd(validateAndFill(document), '## Overview\n\nA test design system.\n');
}

describe('parseDesignMd', () => {
  it('splits frontmatter and prose', () => {
    const { frontmatter, prose } = parseDesignMd(makeMd());
    expect(frontmatter).not.toHaveProperty('name');
    expect(frontmatter.colors.semantic.primary).toBe('{color.expressive.primary.500}');
    expect(prose).toContain('## Overview');
    expect(prose).not.toContain('---');
  });

  it('throws when frontmatter or colors is missing', () => {
    expect(() => parseDesignMd('# just prose\n')).toThrow();
    expect(() => parseDesignMd('---\nid: X\n---\nbody')).toThrow(/define colors/);
  });

  it('rejects legacy DESIGN.md name frontmatter', () => {
    const legacy = makeMd().replace('id: ds-test-1', 'id: ds-test-1\nname: Legacy');
    expect(() => parseDesignMd(legacy)).toThrow(/name is no longer supported/);
  });

  it('rejects any document version other than the current contract', () => {
    expect(() => parseDesignMd(makeMd().replace('version: 1', 'version: 2'))).toThrow(
      /version must be 1/,
    );
  });

  it('accepts exactly one color definition', () => {
    const document = makeDocument({ colors: makeColorDefinition() });
    expect(parseDesignMd(makeMd(document)).frontmatter.colors.semantic.primary).toBeDefined();
  });
});

describe('validateAndFill', () => {
  it('converts primitive hex values to resolved tuples', () => {
    const resolved = validateAndFill(makeDocument());
    expect(resolved.colors.primary).toMatch(/^\d/);
    expect(resolved.colors.primary).not.toMatch(/^#/);
  });

  it('requires primitive groups, semantic aliases, and named rhythm scales', () => {
    const missingAlias = makeDocument();
    delete missingAlias.colors.semantic.primary;
    expect(() => validateAndFill(missingAlias)).toThrow(/missing required semantic color slot/);

    const missingRamp = makeDocument();
    delete (missingRamp.colors.primitives.expressive.primary as Partial<
      typeof missingRamp.colors.primitives.expressive.primary
    >)['300'];
    expect(() => validateAndFill(missingRamp)).toThrow(/must define exactly/);

    const missingRadius = makeDocument();
    delete (missingRadius.radii as Partial<typeof missingRadius.radii>).lg;
    expect(() => validateAndFill(missingRadius)).toThrow(/missing required radii.lg/);
  });

  it('rejects unknown semantic slots', () => {
    const unknown = makeDocument();
    unknown.colors.semantic['brand-special'] = '{color.expressive.primary.500}';
    expect(() => validateAndFill(unknown)).toThrow(/unknown color slot/);
  });

  it('preserves complete typography role controls', () => {
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
    expect(validateAndFill(document).type.scale.display).toEqual({
      fontSize: '3rem',
      lineHeight: '1.1',
      letterSpacing: '-0.03em',
      fontKey: 'source-serif-4',
      fontStyle: 'italic',
    });
  });

  it('rejects invalid font references, bindings, identities, and role parity', () => {
    const extraField = makeDocument();
    (extraField.font.inter as typeof extraField.font.inter & { metadata?: string }).metadata = 'not persisted';
    expect(() => validateAndFill(extraField)).toThrow(/contain exactly/);

    const invalidFallback = makeDocument();
    invalidFallback.font.inter.fallback = 'system-ui' as typeof invalidFallback.font.inter.fallback;
    expect(() => validateAndFill(invalidFallback)).toThrow(/fallback is invalid/);

    for (const field of ['sourceFamilyId', 'cssFamilyName'] as const) {
      const unsafe = makeDocument();
      unsafe.font.inter[field] = 'Inter, Arial';
      expect(() => validateAndFill(unsafe)).toThrow(/without stack or delimiter content/);

      const control = makeDocument();
      control.font.inter[field] = 'Inter\u0000';
      expect(() => validateAndFill(control)).toThrow(/control characters/);
    }

    const dangling = makeDocument();
    dangling.type.scale.body!.fontKey = 'missing';
    expect(() => validateAndFill(dangling)).toThrow(/missing font/);

    const unreachable = makeDocument();
    unreachable.font.unused = { source: 'google', sourceFamilyId: 'Unused', cssFamilyName: 'Unused', fallback: 'serif' };
    expect(() => validateAndFill(unreachable)).toThrow(/not referenced/);

    const duplicate = makeDocument();
    duplicate.font.copy = { ...duplicate.font.inter };
    duplicate.type.scale.caption!.fontKey = 'copy';
    expect(() => validateAndFill(duplicate)).toThrow(/duplicate font identity/);

    const mismatch = makeDocument();
    mismatch.type.weights.extra = 400;
    expect(() => validateAndFill(mismatch)).toThrow(/identical role keys/);

    const fractionalWeight = makeDocument();
    fractionalWeight.type.weights.body = 400.5;
    expect(() => validateAndFill(fractionalWeight)).toThrow(/expected an integer/);
  });

  it('normalizes font references without renaming authored keys', () => {
    const document = makeDocument();
    document.font.inter.sourceFamilyId = '  Inte\u0301r ';
    document.font.inter.cssFamilyName = ' Inte\u0301r  ';
    const normalized = validateAndFill(document).font;
    expect(normalized.inter).toEqual({ source: 'google', sourceFamilyId: 'Int\u00e9r', cssFamilyName: 'Int\u00e9r', fallback: 'sans-serif' });
  });

  it('rejects missing typography roles, weights, or controls', () => {
    const missingRole = makeDocument();
    delete missingRole.type.scale.caption;
    expect(() => validateAndFill(missingRole)).toThrow(/missing required type\.scale\.caption/);

    const missingWeight = makeDocument();
    delete missingWeight.type.weights.label;
    expect(() => validateAndFill(missingWeight)).toThrow(/missing required type\.weights\.label/);

    const missingControl = makeDocument();
    delete (missingControl.type.scale.body as Partial<typeof missingControl.type.scale.body>).fontStyle;
    expect(() => validateAndFill(missingControl)).toThrow(/expected all typography controls/);
  });
});
