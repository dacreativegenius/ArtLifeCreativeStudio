import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { compile } from "tailwindcss";
import { describe, it, expect } from "vitest";
import { emitCss } from "./emit-css";
import { COLOR_SLOTS } from "./schema";
import type { FontSpec, TypeSpec } from "./parse";

// Build a full semantic token map (all slots) of bare tuples.
function fullMap(primary = "262 83% 58%"): Record<string, string> {
  const m: Record<string, string> = {};
  for (const slot of COLOR_SLOTS) m[slot] = "0 0% 50%";
  m["primary"] = primary;
  return m;
}

const FONT: FontSpec = {
  inter: { source: "google", sourceFamilyId: "Inter", cssFamilyName: "Inter", fallback: "sans-serif" },
  "source-serif-4": { source: "google", sourceFamilyId: "Source Serif 4", cssFamilyName: "Source Serif 4", fallback: "serif" },
};
const EMPTY_TYPE: TypeSpec = { scale: {}, weights: {} };

// Generated apps compile global.css with Tailwind v4, which decides the cascade.
async function buildWithTailwind(css: string, candidates: string[]): Promise<string> {
  const require = createRequire(import.meta.url);
  const tailwindCss = readFileSync(require.resolve("tailwindcss/index.css"), "utf8");
  const compiler = await compile(css, {
    // tw-animate-css only adds keyframes and utilities; it declares no layers.
    loadStylesheet: async (id, base) => ({ path: id, base, content: id === "tailwindcss" ? tailwindCss : "" }),
  });
  return compiler.build(candidates);
}

/** Name of the top-level cascade layer whose block holds `selector`'s rule. */
function layerOf(css: string, selector: string): string | undefined {
  for (const [, name, body] of css.matchAll(/^@layer ([\w-]+) \{\n([\s\S]*?)^\}/gm)) {
    if (body?.includes(`${selector} {`)) return name;
  }
  return undefined;
}
const SPACING = { xs: "0.25rem", sm: "0.5rem", md: "1rem", lg: "1.5rem", xl: "2rem", "2xl": "3rem", "3xl": "4rem" } as const;
const RADII = { none: "0px", sm: "0.25rem", md: "0.375rem", lg: "0.5rem", xl: "0.75rem", full: "9999px" } as const;

describe("emitCss", () => {
  const css = emitCss({
    colors: fullMap(),
    radius: "0.5rem",
    spacing: SPACING,
    radii: RADII,
    font: FONT,
    type: EMPTY_TYPE,
  });

  it("has a generated do-not-edit header", () => {
    expect(css).toMatch(/GENERATED.*do not edit/i);
  });

  it("emits :root and @theme inline blocks without a mode override", () => {
    expect(css).toContain(":root {");
    expect(css).toContain("@theme inline {");
    expect(css).not.toContain(".dark {");
  });

  it("wraps tuples in hsl() in :root", () => {
    expect(css).toContain("--primary: hsl(262 83% 58%);");
  });

  it("emits --color-* mappings and radius scale in @theme inline", () => {
    expect(css).toContain("--color-primary: var(--primary);");
    expect(css).toContain("--radius-lg: 0.5rem;");
  });

  it("puts --radius in :root", () => {
    const root = css.slice(css.indexOf(":root {"), css.indexOf("@theme inline {"));
    expect(root).toContain("--radius: 0.5rem;");
  });

  it("contains NO raw 6-digit hex anywhere (compliance counter stays 0)", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("includes the four keyframes and base layer", () => {
    expect(css).toContain("@keyframes accordion-down");
    expect(css).toContain("@keyframes shimmer");
    expect(css).toContain("@layer base {");
    expect(css).toContain("@apply bg-background text-foreground;");
  });

  it("emits the live-preview component recipe contract from design tokens", () => {
    for (const className of [
      ".ds-button-primary",
      ".ds-button-secondary",
      ".ds-tabs",
      ".ds-input",
      ".ds-menu-popover",
      ".ds-radio-group",
      ".ds-listbox-option",
    ]) {
      expect(css).toContain(className);
    }
    expect(css).toContain("padding: var(--ds-space-xs) var(--ds-space-md);");
    expect(css).toContain("border-radius: var(--radius-lg);");
    expect(css).toContain("background: var(--primary);");
    expect(css).toContain("font-family: var(--font-label);");
    expect(css).toContain(".ds-tab[aria-selected='true']");
    expect(css).toContain(".ds-listbox-option[aria-selected='true']");
  });

  it("emits font families and a namespaced design-system spacing scale", () => {
    expect(css).toContain('--ds-font-inter: "Inter", sans-serif;');
    expect(css).toContain('--ds-font-source-serif-4: "Source Serif 4", serif;');
    expect(css).toContain("--ds-space-xl: 2rem;");
    expect(css).toContain("--spacing-ds-xl: var(--ds-space-xl);");
  });

  it("does not override Tailwind's reserved base or named spacing variables", () => {
    expect(css).not.toMatch(/^\s*--spacing:\s/m);
    for (const key of Object.keys(SPACING)) {
      expect(css).not.toMatch(new RegExp(`^\\s*--spacing-${key}:`, "m"));
    }
  });

  it("emits the authored body type as the default sans family", () => {
    const withType = emitCss({
      colors: fullMap(),
      radius: "0.5rem",
      spacing: SPACING,
      radii: RADII,
      font: FONT,
      type: {
        scale: {
          body: {
            fontSize: "1rem",
            lineHeight: "1.5rem",
            letterSpacing: "normal",
            fontKey: "inter",
            fontStyle: "normal",
          },
        },
        weights: { body: 400 },
      },
    });
    expect(withType).toContain("--text-body: 1rem;");
    expect(withType).toContain("--text-body--line-height: 1.5rem;");
    expect(withType).toContain("--font-body: var(--ds-font-inter);");
    expect(withType).toContain("--font-sans: var(--font-body);");
    expect(withType).toContain("--font-weight-body: 400;");
  });

  it("emits complete Alpha 2 role controls and a canonical role utility", async () => {
    const withRole = emitCss({
      colors: fullMap(),
      radius: "0.5rem",
      spacing: SPACING,
      radii: RADII,
      font: FONT,
      type: {
        scale: {
          display: {
            fontSize: "3rem",
            lineHeight: "1.1",
            letterSpacing: "-0.03em",
            fontKey: "source-serif-4",
            fontStyle: "italic",
          },
        },
        weights: { display: 700 },
      },
    });
    expect(withRole).toContain("--text-display--letter-spacing: -0.03em;");
    expect(withRole).toContain("--font-display: var(--ds-font-source-serif-4);");
    expect(withRole).toContain(".type-display {");
    expect(withRole).toContain("font-style: var(--font-style-display);");
    expect(withRole).toContain("font-weight: var(--font-weight-display);");

    // Explicit utilities on the same element must beat the role, and the role
    // must still beat ds-* recipe typography: `.type-*` belongs in the
    // components layer, after the recipes, below Tailwind's utilities layer.
    const built = await buildWithTailwind(withRole, ["type-display", "text-7xl", "font-black"]);
    expect(built).toContain("@layer theme, base, components, utilities;");
    expect(layerOf(built, ".type-display")).toBe("components");
    expect(layerOf(built, ".ds-button")).toBe("components");
    expect(built.indexOf(".type-display {")).toBeGreaterThan(built.indexOf(".ds-button {"));
    expect(layerOf(built, ".text-7xl")).toBe("utilities");
    expect(layerOf(built, ".font-black")).toBe("utilities");
    expect(built).toMatch(/\.text-7xl \{[^}]*font-size:/);
    expect(built).toMatch(/\.font-black \{[^}]*font-weight:/);
  });

  it('escapes quoted font family names', () => {
    const css = emitCss({
      colors: fullMap(), radius: '0.5rem', spacing: SPACING, radii: RADII,
      font: { body: { source: 'google', sourceFamilyId: 'A', cssFamilyName: 'A "Quoted" Family', fallback: 'fantasy' } },
      type: { scale: { body: { fontSize: '1rem', lineHeight: '1.5', letterSpacing: 'normal', fontKey: 'body', fontStyle: 'normal' } }, weights: { body: 400 } },
    });
    expect(css).toContain('--ds-font-body: "A \\"Quoted\\" Family", fantasy;');
  });

  describe("single token set", () => {
    const singleSet = emitCss({
      colors: fullMap(),
      radius: "0.5rem",
      spacing: SPACING,
      radii: RADII,
      font: FONT,
      type: EMPTY_TYPE,
    });

    it("omits the .dark token block but keeps dark utilities class-based", () => {
      expect(singleSet).not.toContain(".dark {");
      expect(singleSet).toContain("@custom-variant dark (&:is(.dark *));");
    });

    it("still emits :root, @theme inline, and @color mappings", () => {
      expect(singleSet).toContain(":root {");
      expect(singleSet).toContain("@theme inline {");
      expect(singleSet).toContain("--color-primary: var(--primary);");
    });
  });
});
