/**
 * Deterministic hex <-> HSL-tuple conversion for the DS compiler.
 *
 * A "tuple" is the bare, space-separated HSL form Tailwind v4 expects inside
 * `hsl(...)`: `"H S% L%"` (no `hsl()` wrapper, no commas). H/S/L are each
 * rounded to 1 decimal via Math.round(x*10)/10 so integer results print
 * without a trailing ".0" (e.g. 50 -> "50%", not "50.0%").
 */

/** Round to 1 decimal place, dropping a trailing ".0" via numeric coercion. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Normalize a hex string to 6 or 8 lowercase hex digits, or throw. */
function normalizeHex(hex: string): string {
  const raw = hex.trim().toLowerCase();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(raw);
  if (!m) {
    throw new Error(`invalid hex: "${hex}"`);
  }
  let body = m[1];
  if (body.length === 3 || body.length === 4) {
    body = body.split("").map((ch) => ch + ch).join("");
  }
  return body;
}

/** Convert `#rgb`/`#rrggbb` to a bare HSL tuple `"H S% L%"`. */
export function hexToHslTuple(hex: string): string {
  const body = normalizeHex(hex);
  const r = parseInt(body.slice(0, 2), 16) / 255;
  const g = parseInt(body.slice(2, 4), 16) / 255;
  const b = parseInt(body.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  const l = (max + min) / 2;

  // Gray short-circuit: max === min => achromatic, S = H = 0.
  // (Avoids 0/0 -> NaN in the saturation formula for #000/#fff/grays.)
  const alpha = body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1;
  const alphaSuffix = alpha < 1 ? ` / ${round1(alpha * 100)}%` : "";

  if (delta === 0) return `0 0% ${round1(l * 100)}%${alphaSuffix}`;

  const s = delta / (1 - Math.abs(2 * l - 1));

  let h: number;
  if (max === r) {
    h = ((g - b) / delta) % 6;
  } else if (max === g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }
  h *= 60;
  if (h < 0) h += 360;

  // Round first, then wrap: hues extremely close to 360° can round up to
  // 360.0, but CSS normalizes hue to [0, 360) — keep emitted tuples canonical.
  const hr = round1(h) % 360;

  return `${hr} ${round1(s * 100)}% ${round1(l * 100)}%${alphaSuffix}`;
}

/** Matches a numeric bare HSL tuple `"H S% L%"`. Range validation is separate. */
const TUPLE_RE =
  /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s+((?:\d+(?:\.\d+)?|\.\d+))%\s+((?:\d+(?:\.\d+)?|\.\d+))%(?:\s*\/\s*((?:\d+(?:\.\d+)?|\.\d+))%)?$/;

function normalizeTuple(value: string): string | null {
  const match = TUPLE_RE.exec(value.trim());
  if (!match) return null;
  const hue = Number(match[1]);
  const saturation = Number(match[2]);
  const lightness = Number(match[3]);
  const alpha = match[4] === undefined ? 100 : Number(match[4]);
  if (
    !Number.isFinite(hue) ||
    !Number.isFinite(saturation) ||
    !Number.isFinite(lightness) ||
    hue < 0 ||
    hue > 360 ||
    saturation < 0 ||
    saturation > 100 ||
    lightness < 0 ||
    lightness > 100 ||
    !Number.isFinite(alpha) ||
    alpha < 0 ||
    alpha > 100
  ) {
    return null;
  }
  const alphaSuffix = alpha < 100 ? ` / ${round1(alpha)}%` : "";
  return `${round1(hue) % 360} ${round1(saturation)}% ${round1(lightness)}%${alphaSuffix}`;
}

export interface ParsedHslTuple {
  hue: number;
  saturation: number;
  lightness: number;
  alpha: number;
}

/**
 * Parse the compiler's canonical bare HSL grammar into normalized channels.
 *
 * Keeping this parser next to `toTuple` prevents downstream diagnostics from
 * accepting a smaller language than the compiler itself (notably, tuples with
 * an optional `/ A%` alpha channel).
 */
export function parseHslTuple(tuple: string): ParsedHslTuple {
  const normalized = normalizeTuple(tuple);
  if (!normalized) {
    throw new Error(`invalid hsl tuple: "${tuple}"`);
  }
  const match = TUPLE_RE.exec(normalized);
  if (!match) {
    throw new Error(`invalid hsl tuple: "${tuple}"`);
  }
  return {
    hue: parseFloat(match[1]),
    saturation: parseFloat(match[2]) / 100,
    lightness: parseFloat(match[3]) / 100,
    alpha: match[4] === undefined ? 1 : parseFloat(match[4]) / 100,
  };
}

/** Pass authored values through: convert hex, validate + keep bare tuples.
 *  Accepts `unknown` because values arrive from parsed YAML — a numeric/null/
 *  object value yields a clear contract error instead of an opaque TypeError. */
export function toTuple(v: unknown): string {
  if (typeof v !== "string") {
    throw new Error(
      `invalid token value: ${JSON.stringify(v)} (expected #hex or "H S% L%")`,
    );
  }
  const t = v.trim();
  if (t.startsWith("#")) return hexToHslTuple(t);
  const tuple = normalizeTuple(t);
  if (tuple !== null) return tuple;
  throw new Error(`invalid token value: "${v}" (expected #hex/#hexa or "H S% L% / A%")`);
}

/** Inverse: bare HSL tuple `"H S% L%"` -> `#rrggbb`. (For P1 DTCG export.) */
export function hslTupleToHex(tuple: string): string {
  const { hue: h, saturation: s, lightness: l, alpha } = parseHslTuple(tuple);

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const mm = l - c / 2;
  const toByte = (v: number) =>
    Math.round((v + mm) * 255)
      .toString(16)
      .padStart(2, "0");
  const alphaHex = alpha < 1
    ? Math.round(alpha * 255).toString(16).padStart(2, "0")
    : "";
  return `#${toByte(r)}${toByte(g)}${toByte(b)}${alphaHex}`;
}
