import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GOOGLE_CSS2_REQUEST_MAX_BYTES,
  serializeGoogleCss2Request,
  type FontLoadingPlan,
} from './font-loading-plan';
import { assertCanonicalFontLoadingPlan } from './managed-font-block';

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/font-loading-plan-cases.json', import.meta.url), 'utf8'),
) as {
  cases: Array<{
    name: string;
    families: FontLoadingPlan['families'];
    expectedHref: string;
  }>;
  requestLimit: { familyCount: number; familyNamePrefix: string };
};

describe('canonical font loading plan', () => {
  it.each(fixtures.cases)('serializes $name', (fixture) => {
    expect(serializeGoogleCss2Request(fixture.families)).toBe(fixture.expectedHref);
  });

  it('rejects an oversized request without dropping any family', () => {
    const { familyCount, familyNamePrefix } = fixtures.requestLimit;
    const families = Array.from({ length: familyCount }, (_, index) => ({
      cssFamilyName: `${familyNamePrefix}${String(index).padStart(3, '0')}`,
      faces: [{ weight: 400, style: 'normal' as const }],
    }));
    const href = serializeGoogleCss2Request(families);

    expect(Buffer.byteLength(href, 'utf8')).toBeGreaterThan(GOOGLE_CSS2_REQUEST_MAX_BYTES);
    expect(() => assertCanonicalFontLoadingPlan({ href, families })).toThrow(
      `maximum is ${GOOGLE_CSS2_REQUEST_MAX_BYTES}`,
    );
  });

  it.each([0, -1, 1001])('rejects out-of-range canonical plan weight %s', (weight) => {
    const families = [{
      cssFamilyName: 'Inter',
      faces: [{ weight, style: 'normal' as const }],
    }];

    expect(() => assertCanonicalFontLoadingPlan({
      href: serializeGoogleCss2Request(families),
      families,
    })).toThrow('managed font block plan is malformed');
  });

  it('accepts the inclusive canonical plan weight boundaries', () => {
    const families = [{
      cssFamilyName: 'Inter',
      faces: [
        { weight: 1, style: 'normal' as const },
        { weight: 1000, style: 'normal' as const },
      ],
    }];

    expect(() => assertCanonicalFontLoadingPlan({
      href: serializeGoogleCss2Request(families),
      families,
    })).not.toThrow();
  });
});
