---
version: 1
description: "A crisp blue foundation with restrained violet and sky accents."
font:
  inter: { source: google, sourceFamilyId: Inter, cssFamilyName: Inter, fallback: sans-serif }
  source-serif-4: { source: google, sourceFamilyId: "Source Serif 4", cssFamilyName: "Source Serif 4", fallback: serif }
  jetbrains-mono: { source: google, sourceFamilyId: "JetBrains Mono", cssFamilyName: "JetBrains Mono", fallback: monospace }
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
  2xl: "3rem"
  3xl: "4rem"
radii:
  none: "0px"
  sm: "0.25rem"
  md: "0.375rem"
  lg: "0.5rem"
  xl: "0.75rem"
  full: "9999px"
type:
  scale:
    display: { fontSize: "3rem", lineHeight: "1.1", letterSpacing: "-0.03em", fontKey: inter, fontStyle: normal }
    heading: { fontSize: "1.5rem", lineHeight: "1.25", letterSpacing: "-0.015em", fontKey: inter, fontStyle: normal }
    body: { fontSize: "1rem", lineHeight: "1.6", letterSpacing: "normal", fontKey: inter, fontStyle: normal }
    label: { fontSize: "0.875rem", lineHeight: "1.4", letterSpacing: "0.01em", fontKey: source-serif-4, fontStyle: normal }
    caption: { fontSize: "0.75rem", lineHeight: "1.4", letterSpacing: "0.02em", fontKey: jetbrains-mono, fontStyle: normal }
  weights: { display: 700, heading: 600, body: 400, label: 500, caption: 400 }
colors:
  primitives:
    expressive:
      primary: { "100": "#DBEAFE", "300": "#93C5FD", "500": "#3B82F6", "700": "#1D4ED8", "900": "#1E3A8A" }
      secondary: { "100": "#EDE9FE", "300": "#C4B5FD", "500": "#8B5CF6", "700": "#6D28D9", "900": "#4C1D95" }
      tertiary: { "100": "#E0F2FE", "300": "#7DD3FC", "500": "#0EA5E9", "700": "#0369A1", "900": "#0C4A6E" }
    status:
      danger: { "100": "#FEE2E2", "300": "#FCA5A5", "500": "#EF4444", "700": "#B91C1C", "900": "#7F1D1D" }
      success: { "100": "#DCFCE7", "300": "#86EFAC", "500": "#22C55E", "700": "#15803D", "900": "#14532D" }
      warning: { "100": "#FEF3C7", "300": "#FCD34D", "500": "#F59E0B", "700": "#B45309", "900": "#78350F" }
      info: { "100": "#DBEAFE", "300": "#93C5FD", "500": "#3B82F6", "700": "#1D4ED8", "900": "#1E3A8A" }
    neutral:
      gray: { "100": "#FFFFFF", "300": "#E5E7EB", "500": "#9CA3AF", "700": "#4B5563", "900": "#111827" }
  semantic:
    background: "{color.neutral.gray.100}"
    foreground: "{color.neutral.gray.900}"
    card: "{color.neutral.gray.100}"
    card-foreground: "{color.neutral.gray.900}"
    popover: "{color.neutral.gray.100}"
    popover-foreground: "{color.neutral.gray.900}"
    primary: "{color.expressive.primary.500}"
    primary-foreground: "{color.neutral.gray.100}"
    secondary: "{color.expressive.secondary.100}"
    secondary-foreground: "{color.neutral.gray.900}"
    muted: "{color.neutral.gray.300}"
    muted-foreground: "{color.neutral.gray.700}"
    accent: "{color.expressive.tertiary.100}"
    accent-foreground: "{color.expressive.tertiary.900}"
    destructive: "{color.status.danger.500}"
    destructive-foreground: "{color.neutral.gray.100}"
    border: "{color.neutral.gray.300}"
    input: "{color.neutral.gray.300}"
    ring: "{color.expressive.primary.500}"
    success: "{color.status.success.500}"
    success-foreground: "{color.neutral.gray.100}"
    warning: "{color.status.warning.500}"
    warning-foreground: "{color.neutral.gray.900}"
    info: "{color.status.info.500}"
    info-foreground: "{color.neutral.gray.100}"
    chart-1: "{color.expressive.primary.500}"
    chart-2: "{color.expressive.secondary.500}"
    chart-3: "{color.expressive.tertiary.500}"
    chart-4: "{color.status.success.500}"
    chart-5: "{color.status.warning.500}"
---

## Overview

This is the normative design system for this app. Mercury's `@vibe/ds-compiler`
resolves semantic aliases into the named primitive ramps above, then compiles
them into `apps/vite/client/global.css`. Named spacing and radius scales are
emitted alongside typography and color variables. `global.css` is generated;
edit this document and run `pnpm ds:compile` to regenerate it.

## Guardrail

Components consume semantic utilities such as `bg-background`, `text-foreground`,
`bg-primary`, and `rounded-lg`. Never hardcode palette values in components.
