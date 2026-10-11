import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";

describe("contrastRatio", () => {
  it("keeps opaque WCAG ratios unchanged", () => {
    expect(contrastRatio("0 0% 0%", "0 0% 100%")).toBe(21);
    expect(contrastRatio("0 0% 100%", "0 0% 100%")).toBe(1);
  });

  it("composites a translucent foreground over its background", () => {
    expect(contrastRatio("0 0% 0% / 0%", "0 0% 100%")).toBe(1);
    expect(contrastRatio("0 0% 0% / 50%", "0 0% 100%")).toBeCloseTo(3.98, 2);
  });

  it("composites a translucent background over the supplied backdrop", () => {
    const overWhite = contrastRatio(
      "0 0% 0%",
      "0 0% 0% / 0%",
      "0 0% 100%",
    );
    const overBlack = contrastRatio(
      "0 0% 0%",
      "0 0% 100% / 0%",
      "0 0% 0%",
    );

    expect(overWhite).toBe(21);
    expect(overBlack).toBe(1);
  });
});
