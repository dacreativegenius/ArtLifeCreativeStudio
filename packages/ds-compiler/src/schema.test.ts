import { describe, it, expect } from "vitest";
import {
  COLOR_SLOTS,
  REQUIRED_CORE,
  REQUIRED_SEMANTIC,
} from "./schema";

describe("schema", () => {
  it("COLOR_SLOTS has 30 slots (19 core + 6 status + 5 chart)", () => {
    // NOTE: spec text said "length 31" but the locked COLOR_SLOTS content it
    // dictates (and the real v4 template @theme inline block) is exactly 30:
    // 19 core + success/warning/info(+fg)=6 + chart-1..5=5. Content is the
    // source of truth (spec says "do not change values").
    expect(COLOR_SLOTS).toHaveLength(30);
  });

  it("REQUIRED_CORE excludes status + chart slots", () => {
    expect(REQUIRED_CORE).not.toContain("success");
    expect(REQUIRED_CORE).not.toContain("chart-1");
    // and still includes a true core slot
    expect(REQUIRED_CORE).toContain("primary");
  });

  it("requires core, success, and warning semantic aliases", () => {
    expect(REQUIRED_SEMANTIC).toEqual(expect.arrayContaining(REQUIRED_CORE));
    expect(REQUIRED_SEMANTIC).toEqual(
      expect.arrayContaining(['success', 'success-foreground', 'warning', 'warning-foreground']),
    );
  });
});
