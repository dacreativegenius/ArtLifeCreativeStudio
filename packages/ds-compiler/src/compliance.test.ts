import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compileDesignSystem } from "./compile";

// Depth from this test file (src/) to the default DESIGN.md:
//   src -> ds-compiler -> packages -> my-template, then apps/vite/design.
const designMdPath = fileURLToPath(
  new URL("../../../apps/vite/design/DESIGN.md", import.meta.url),
);

describe("compliance: default DESIGN.md compiles clean", () => {
  const md = readFileSync(designMdPath, "utf8");
  const { css } = compileDesignSystem(md);

  it("emits every status + chart token as a :root custom property", () => {
    const required = [
      "success",
      "warning",
      "info",
      "chart-1",
      "chart-2",
      "chart-3",
      "chart-4",
      "chart-5",
    ];
    for (const slot of required) {
      expect(css).toContain(`--${slot}:`);
    }
  });

  it("contains NO raw 6-digit hex (compliance counter == 0)", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
