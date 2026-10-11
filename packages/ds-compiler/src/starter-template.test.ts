import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// src -> ds-compiler -> packages -> my-template
function readTemplateFile(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

describe("ordinary starter stylesheet", () => {
  const css = readTemplateFile("apps/vite/client/global.css");

  it("keeps the Tailwind v4 wiring and class-based dark variant", () => {
    expect(css).toContain("@import 'tailwindcss';");
    expect(css).toContain("@source '../../../packages/ui/src';");
    expect(css).toContain("@custom-variant dark (&:is(.dark *));");
  });

  it("ships explicit light and dark palettes", () => {
    expect(css).toMatch(/^:root \{/m);
    expect(css).toMatch(/^\.dark \{/m);
  });

  it("carries no design-system compiler output or workflow", () => {
    expect(css).not.toContain("@vibe/ds-compiler");
    expect(css).not.toContain("DESIGN.md");
    expect(css).not.toContain("ds:compile");
    expect(css).not.toContain("--ds-");
    expect(css).not.toMatch(/\.ds-[a-z]/);
  });
});

describe("template AGENTS.md theme guidance", () => {
  const agentsMd = readTemplateFile("AGENTS.md");

  it("never directs the coder to Mercury's design-system workflow", () => {
    expect(agentsMd).not.toContain("apps/vite/design/DESIGN.md");
    expect(agentsMd).not.toContain("ds:compile");
    expect(agentsMd).not.toContain("the compiler intentionally emits one palette");
  });

  it("switches themes through next-themes and defers to compiler ownership", () => {
    expect(agentsMd).toContain("`next-themes` owns the `<html>` theme class");
    expect(agentsMd).toContain("follow the system prompt's THEME SWITCHING section");
    expect(agentsMd).toContain("marks `global.css` compiler-owned");
    // The forcedTheme/setTheme/defaultTheme mechanics live in the service's
    // DS-off-only prompt segment so design-system runs do not pay for them.
    expect(agentsMd).not.toContain("forcedTheme");
    expect(agentsMd).not.toContain('toggle `class="dark"` on `<html>` in `index.html`');
  });
});
