import { COLOR_RAMP_STEPS, COLOR_SLOTS } from './schema';
import type { ColorDefinition, Frontmatter } from './parse';

const ramp = (value: string) => Object.fromEntries(
  COLOR_RAMP_STEPS.map((step) => [step, value]),
) as ColorDefinition['primitives']['expressive'][string];

export function makeColorDefinition(value = '#4f46e5'): ColorDefinition {
  const primitives: ColorDefinition['primitives'] = {
    expressive: {
      primary: ramp(value),
      secondary: ramp(value),
      tertiary: ramp(value),
    },
    status: {
      danger: ramp(value),
      success: ramp(value),
      warning: ramp(value),
    },
    neutral: {},
  };
  const semantic: Record<string, string> = {
    primary: '{color.expressive.primary.500}',
    secondary: '{color.expressive.secondary.500}',
    accent: '{color.expressive.tertiary.500}',
    destructive: '{color.status.danger.500}',
    success: '{color.status.success.500}',
    warning: '{color.status.warning.500}',
  };
  for (const slot of COLOR_SLOTS) {
    if (semantic[slot]) continue;
    primitives.neutral[slot] = ramp(value);
    semantic[slot] = `{color.neutral.${slot}.500}`;
  }
  return { primitives, semantic };
}

export function makeDocument(overrides: Partial<Frontmatter> = {}): Frontmatter {
  return {
    version: 1,
    id: 'ds-test-1',
    description: 'A test design system.',
    colors: makeColorDefinition(),
    spacing: {
      xs: '0.25rem',
      sm: '0.5rem',
      md: '1rem',
      lg: '1.5rem',
      xl: '2rem',
      '2xl': '3rem',
      '3xl': '4rem',
    },
    radii: {
      none: '0px',
      sm: '0.25rem',
      md: '0.375rem',
      lg: '0.5rem',
      xl: '0.75rem',
      full: '9999px',
    },
    font: {
      inter: { source: 'google', sourceFamilyId: 'Inter', cssFamilyName: 'Inter', fallback: 'sans-serif' },
      'source-serif-4': { source: 'google', sourceFamilyId: 'Source Serif 4', cssFamilyName: 'Source Serif 4', fallback: 'serif' },
    },
    type: {
      scale: {
        display: { fontSize: '3rem', lineHeight: '1.1', letterSpacing: '-0.03em', fontKey: 'source-serif-4', fontStyle: 'normal' },
        heading: { fontSize: '1.5rem', lineHeight: '1.25', letterSpacing: '-0.015em', fontKey: 'inter', fontStyle: 'normal' },
        body: { fontSize: '1rem', lineHeight: '1.6', letterSpacing: 'normal', fontKey: 'inter', fontStyle: 'normal' },
        label: { fontSize: '0.875rem', lineHeight: '1.4', letterSpacing: '0.01em', fontKey: 'inter', fontStyle: 'normal' },
        caption: { fontSize: '0.75rem', lineHeight: '1.4', letterSpacing: '0.02em', fontKey: 'inter', fontStyle: 'normal' },
      },
      weights: { display: 700, heading: 600, body: 400, label: 500, caption: 400 },
    },
    ...overrides,
  };
}
