import { describe, it, expect } from "vitest";
import { hexToHslTuple, toTuple, hslTupleToHex, parseHslTuple } from "./hex";

describe("hexToHslTuple", () => {
  it("converts the primary fixtures", () => {
    expect(hexToHslTuple("#ff0000")).toBe("0 100% 50%");
    expect(hexToHslTuple("#00ff00")).toBe("120 100% 50%");
    expect(hexToHslTuple("#0000ff")).toBe("240 100% 50%");
    expect(hexToHslTuple("#000000")).toBe("0 0% 0%");
    expect(hexToHslTuple("#ffffff")).toBe("0 0% 100%");
  });

  it("accepts #rgb shorthand", () => {
    expect(hexToHslTuple("#fff")).toBe("0 0% 100%");
  });

  it("does not emit trailing .0 on integer results", () => {
    expect(hexToHslTuple("#ff0000")).not.toMatch(/\.0/);
  });

  it("throws on invalid hex", () => {
    expect(() => hexToHslTuple("not-a-hex")).toThrow(/invalid hex/i);
    expect(() => hexToHslTuple("#12")).toThrow(/invalid hex/i);
    expect(() => hexToHslTuple("#gggggg")).toThrow(/invalid hex/i);
  });
});

describe("alpha colors", () => {
  it("normalizes 8-digit hex and tuple alpha", () => {
    expect(hexToHslTuple("#33669980")).toBe("210 50% 40% / 50.2%");
    expect(toTuple("210 50% 40% / 50.20%")).toBe("210 50% 40% / 50.2%");
  });

  it("round-trips alpha through the DTCG hex conversion", () => {
    expect(hslTupleToHex("210 50% 40% / 50.2%")).toBe("#33669980");
  });

  it("parses alpha through the canonical tuple grammar", () => {
    expect(parseHslTuple("0 30.4% 45.1% / 45.1%")).toEqual({
      hue: 0,
      saturation: 0.304,
      lightness: 0.451,
      alpha: 0.451,
    });
  });
});

describe("toTuple", () => {
  it("passes through bare tuples untouched", () => {
    expect(toTuple("220 70% 50%")).toBe("220 70% 50%");
  });
  it("canonicalizes tuple number spelling and wraps 360 degrees", () => {
    expect(toTuple("360.0 070.00% 050.00%")).toBe("0 70% 50%");
  });
  it("converts hex inputs", () => {
    expect(toTuple("#ff0000")).toBe("0 100% 50%");
  });
  it("trims whitespace", () => {
    expect(toTuple("  220 70% 50%  ")).toBe("220 70% 50%");
  });
  it("throws on a non-hex, non-tuple string (e.g. an hsl() wrapper)", () => {
    expect(() => toTuple("hsl(220 70% 50%)")).toThrow(/invalid token value/i);
  });
  it("throws on garbage", () => {
    expect(() => toTuple("blue")).toThrow(/invalid token value/i);
  });
  it("throws on malformed or out-of-range tuples", () => {
    for (const value of ["1.2.3 40% 50%", "20 101% 50%", "20 40% 101%", "-1 40% 50%", "361 40% 50%"]) {
      expect(() => toTuple(value)).toThrow(/invalid token value/i);
    }
  });
  it("still accepts a bare tuple and trims it", () => {
    expect(toTuple("  220 70% 50%  ")).toBe("220 70% 50%");
  });
});

describe("hslTupleToHex", () => {
  it("inverts the primary tuple", () => {
    expect(hslTupleToHex("0 100% 50%")).toBe("#ff0000");
  });
  it("round-trips green and blue", () => {
    expect(hslTupleToHex("120 100% 50%")).toBe("#00ff00");
    expect(hslTupleToHex("240 100% 50%")).toBe("#0000ff");
  });
});
