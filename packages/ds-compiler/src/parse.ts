import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  COLOR_SLOTS,
  REQUIRED_SEMANTIC,
  COLOR_RAMP_STEPS,
  COLOR_PRIMITIVE_GROUPS,
  SPACING_SCALE_KEYS,
  RADIUS_SCALE_KEYS,
  REQUIRED_TYPE_ROLES,
  COLOR_REFERENCE_RE,
  type ColorRampStep,
  type ColorPrimitiveGroup,
  type SpacingScaleKey,
  type RadiusScaleKey,
} from "./schema";
import { toTuple } from "./hex";

export type FontSourceId = "google";
export type FontFallback = "sans-serif" | "serif" | "monospace" | "cursive" | "fantasy";
export type FontTableKey = string;

export interface FontReference {
  source: FontSourceId;
  sourceFamilyId: string;
  cssFamilyName: string;
  fallback: FontFallback;
}

export interface FontCatalogueEntry {
  source: FontSourceId;
  sourceFamilyId: string;
  displayName: string;
  cssFamilyName: string;
  category: string;
  weights: number[];
}

export interface FontFace {
  weight: number;
  style: "normal" | "italic" | "oblique";
}

export interface ResolvedFontLoading {
  href: string;
  families: Array<{ cssFamilyName: string; faces: FontFace[] }>;
}

export type FontResolution =
  | { status: "available"; reference: FontReference; entry: FontCatalogueEntry }
  | { status: "unavailable"; reference: FontReference; reason: string };

export function createFontTableKey(
  familyName: string,
  existingKeys: Iterable<string> = [],
): FontTableKey {
  let base = familyName
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) base = "font";
  if (/^[0-9]/.test(base)) base = `font-${base}`;
  const used = new Set(existingKeys);
  base = base.slice(0, 64).replace(/-+$/g, "") || "font";
  if (!used.has(base)) return base;
  let suffix = 2;
  while (true) {
    const suffixText = `-${suffix}`;
    const candidate = `${base.slice(0, 64 - suffixText.length).replace(/-+$/g, "")}${suffixText}`;
    if (!used.has(candidate)) return candidate;
    suffix += 1;
  }
}

export type FontSpec = Record<FontTableKey, FontReference>;

export interface TypeScaleStep {
  fontSize: string;
  lineHeight: string;
  letterSpacing: string;
  fontKey: FontTableKey;
  fontStyle: "normal" | "italic" | "oblique";
}

export interface TypeSpec {
  scale: Record<string, TypeScaleStep>;
  weights: Record<string, number>;
}

export type ColorRamp = Record<ColorRampStep, string>;
export type ColorPrimitives = Record<
  ColorPrimitiveGroup,
  Record<string, ColorRamp>
>;
export interface ColorDefinition {
  primitives: ColorPrimitives;
  semantic: Record<string, string>;
}
export type SpacingScale = Record<SpacingScaleKey, string>;
export type RadiusScale = Record<RadiusScaleKey, string>;

/** DESIGN.md frontmatter shape. `colors` is the sole semantic/primitive token
 *  set. Font/type/spacing/radii are consumed by the compiler. */
export interface Frontmatter {
  version: 1;
  id?: string;
  description?: string;
  colors: ColorDefinition;
  spacing: SpacingScale;
  radii: RadiusScale;
  font: FontSpec;
  type: TypeSpec;
}

export interface ParsedDesignMd {
  frontmatter: Frontmatter;
  prose: string;
}

export interface RenderDocumentInput {
  schemaVersion: 1;
  designSystemId: string;
  description?: string;
  colors: Frontmatter["colors"];
  spacing: SpacingScale;
  radii: RadiusScale;
  font: FontSpec;
  type: TypeSpec;
}

/** Adapt the service's normalized JSON names to canonical DESIGN.md names. */
export function frontmatterFromRenderDocument(
  document: RenderDocumentInput,
): Frontmatter {
  if (document.schemaVersion !== 1) {
    throw new Error("design-system document schemaVersion must be 1");
  }
  return {
    version: document.schemaVersion,
    id: document.designSystemId,
    ...(document.description !== undefined ? { description: document.description } : {}),
    colors: document.colors,
    spacing: document.spacing,
    radii: document.radii,
    font: document.font,
    type: document.type,
  };
}

/** Canonically serialize a structured document without touching the filesystem. */
export function renderDesignMd(document: RenderDocumentInput): string {
  const resolved = validateAndFill(frontmatterFromRenderDocument(document));
  const prose = typeof document.description === "string" ? document.description : "";
  return serializeDesignMd(resolved, prose);
}

/** Resolved, tuple-valued tokens ready for emitCss. */
export interface ResolvedTokens {
  version: 1;
  id?: string;
  description?: string;
  colors: Record<string, string>;
  colorDefinition: ColorDefinition;
  radius: string;
  spacing: SpacingScale;
  radii: RadiusScale;
  font: FontSpec;
  type: TypeSpec;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Split a DESIGN.md into parsed YAML frontmatter + the remaining prose. */
export function parseDesignMd(text: string): ParsedDesignMd {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) {
    throw new Error("DESIGN.md is missing YAML frontmatter (--- ... ---)");
  }
  const rawFrontmatter = parseYaml(m[1]) as Record<string, unknown> | null;
  if (rawFrontmatter && "name" in rawFrontmatter) {
    throw new Error("DESIGN.md frontmatter name is no longer supported");
  }
  const frontmatter = rawFrontmatter as unknown as Frontmatter;
  const prose = m[2] ?? "";

  if (!frontmatter || !frontmatter.colors) {
    throw new Error("DESIGN.md frontmatter must define colors");
  }
  if (frontmatter.version !== 1) {
    throw new Error("DESIGN.md frontmatter version must be 1");
  }

  return { frontmatter, prose };
}

function normalizeColorDefinition(input: ColorDefinition): ColorDefinition {
  const primitives = {} as ColorPrimitives;
  for (const group of COLOR_PRIMITIVE_GROUPS) {
    const authoredGroup = input.primitives?.[group];
    if (!authoredGroup || typeof authoredGroup !== "object") {
      throw new Error(`missing primitive color group "${group}"`);
    }
    const rampNames = Object.keys(authoredGroup).sort();
    const minimum = group === "neutral" ? 1 : 3;
    if (rampNames.length < minimum) {
      throw new Error(
        `primitive color group "${group}" must define at least ${minimum} ramp(s)`,
      );
    }
    primitives[group] = {};
    for (const rampName of rampNames) {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(rampName)) {
        throw new Error(`invalid primitive ramp name "${group}.${rampName}"`);
      }
      const authoredRamp = authoredGroup[rampName];
      const authoredSteps = Object.keys(authoredRamp ?? {}).sort();
      const expectedSteps = [...COLOR_RAMP_STEPS].sort();
      if (JSON.stringify(authoredSteps) !== JSON.stringify(expectedSteps)) {
        throw new Error(
          `primitive ramp "${group}.${rampName}" must define exactly ${COLOR_RAMP_STEPS.join(", ")}`,
        );
      }
      primitives[group][rampName] = Object.fromEntries(
        COLOR_RAMP_STEPS.map((step) => [step, toTuple(authoredRamp[step])]),
      ) as ColorRamp;
    }
  }

  const allowed = new Set<string>(COLOR_SLOTS);
  const semantic: Record<string, string> = {};
  for (const slot of Object.keys(input.semantic ?? {}).sort()) {
    if (!allowed.has(slot)) throw new Error(`unknown color slot "${slot}"`);
    const reference = input.semantic[slot];
    const match = COLOR_REFERENCE_RE.exec(reference);
    if (!match) {
      throw new Error(`invalid primitive reference for semantic slot "${slot}"`);
    }
    const group = match[1] as ColorPrimitiveGroup;
    const ramp = match[2] as string;
    const step = match[3] as ColorRampStep;
    if (primitives[group][ramp]?.[step] === undefined) {
      throw new Error(
        `semantic slot "${slot}" references missing primitive token "${reference}"`,
      );
    }
    semantic[slot] = reference;
  }
  for (const slot of REQUIRED_SEMANTIC) {
    if (semantic[slot] === undefined) {
      throw new Error(`missing required semantic color slot "${slot}"`);
    }
  }
  return { primitives, semantic };
}

function resolveColorDefinition(input: ColorDefinition): {
  definition: ColorDefinition;
  resolved: Record<string, string>;
} {
  const definition = normalizeColorDefinition(input);
  const resolved: Record<string, string> = {};
  for (const [slot, reference] of Object.entries(definition.semantic)) {
    const match = COLOR_REFERENCE_RE.exec(reference)!;
    resolved[slot] = definition.primitives[match[1] as ColorPrimitiveGroup][match[2]][
      match[3] as ColorRampStep
    ];
  }
  return { definition, resolved };
}

function resolveNamedScale<K extends string>(
  name: string,
  keys: readonly K[],
  authored: Partial<Record<K, string>> | undefined,
): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const value = authored?.[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`missing required ${name}.${key}`);
    }
    out[key] = value.trim();
  }
  return out;
}

const FONT_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const FONT_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
const FONT_FAMILY_UNSAFE_RE = /[,;{}<>\\]|\/\*|\*\//;
const FONT_FALLBACKS = new Set<FontFallback>([
  "sans-serif", "serif", "monospace", "cursive", "fantasy",
]);

function normalizeFontString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  const normalized = value.trim().normalize("NFC");
  if (normalized.length < 1 || normalized.length > 200) {
    throw new Error(`${path} must contain 1-200 characters after trimming`);
  }
  if (FONT_CONTROL_RE.test(normalized)) throw new Error(`${path} contains control characters`);
  if (FONT_FAMILY_UNSAFE_RE.test(normalized)) {
    throw new Error(`${path} must be one CSS family name without stack or delimiter content`);
  }
  return normalized;
}

function resolveFont(font: FontSpec): FontSpec {
  if (!font || typeof font !== "object" || Array.isArray(font)) {
    throw new Error("font must be a table of references");
  }
  const out: FontSpec = {};
  for (const key of Object.keys(font).sort()) {
    if (key.length > 64 || !FONT_KEY_RE.test(key)) throw new Error(`invalid font key "${key}"`);
    const reference = font[key] as FontReference;
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
      throw new Error(`font.${key} must be a font reference`);
    }
    const properties = Object.keys(reference).sort();
    if (JSON.stringify(properties) !== JSON.stringify(["cssFamilyName", "fallback", "source", "sourceFamilyId"])) {
      throw new Error(`font.${key} must contain exactly source, sourceFamilyId, cssFamilyName, and fallback`);
    }
    if (reference.source !== "google") throw new Error(`font.${key}.source must be "google"`);
    if (!FONT_FALLBACKS.has(reference.fallback)) throw new Error(`font.${key}.fallback is invalid`);
    out[key] = {
      source: reference.source,
      sourceFamilyId: normalizeFontString(reference.sourceFamilyId, `font.${key}.sourceFamilyId`),
      cssFamilyName: normalizeFontString(reference.cssFamilyName, `font.${key}.cssFamilyName`),
      fallback: reference.fallback,
    };
  }
  return out;
}

function resolveType(type: TypeSpec): TypeSpec {
  const scale: Record<string, TypeScaleStep> = {};
  const weights: Record<string, number> = {};
  for (const [key, step] of Object.entries(type?.scale ?? {})) {
    if (key.length > 64 || !FONT_KEY_RE.test(key)) throw new Error(`invalid typography role "${key}"`);
    const candidate = step as TypeScaleStep;
    if (
      !step ||
      typeof step !== "object" ||
      typeof candidate.fontSize !== "string" ||
      typeof candidate.lineHeight !== "string" ||
      typeof candidate.letterSpacing !== "string" ||
      typeof candidate.fontKey !== "string" ||
      candidate.fontKey.length > 64 ||
      !FONT_KEY_RE.test(candidate.fontKey) ||
      !["normal", "italic", "oblique"].includes(candidate.fontStyle)
    ) {
      throw new Error(
        `invalid type.scale."${key}": expected all typography controls`,
      );
    }
    if (JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(["fontKey", "fontSize", "fontStyle", "letterSpacing", "lineHeight"])) {
      throw new Error(`invalid type.scale."${key}": unexpected typography control`);
    }
    scale[key] = {
      fontSize: candidate.fontSize.trim(),
      lineHeight: candidate.lineHeight.trim(),
      letterSpacing: candidate.letterSpacing.trim(),
      fontKey: candidate.fontKey,
      fontStyle: candidate.fontStyle,
    };
  }
  for (const [key, weight] of Object.entries(type?.weights ?? {})) {
    if (key.length > 64 || !FONT_KEY_RE.test(key)) throw new Error(`invalid typography weight role "${key}"`);
    if (typeof weight !== "number" || !Number.isInteger(weight) || weight < 1 || weight > 1000) {
      throw new Error(`invalid type.weights."${key}": expected an integer from 1 through 1000`);
    }
    weights[key] = weight;
  }
  for (const role of REQUIRED_TYPE_ROLES) {
    if (scale[role] === undefined) {
      throw new Error(`missing required type.scale.${role}`);
    }
    if (weights[role] === undefined) {
      throw new Error(`missing required type.weights.${role}`);
    }
  }
  if (JSON.stringify(Object.keys(scale).sort()) !== JSON.stringify(Object.keys(weights).sort())) {
    throw new Error("type.scale and type.weights must have identical role keys");
  }
  return { scale, weights };
}

function validateFontBindings(font: FontSpec, type: TypeSpec): void {
  const referenced = new Set<string>();
  for (const [role, step] of Object.entries(type.scale)) {
    if (!Object.prototype.hasOwnProperty.call(font, step.fontKey)) {
      throw new Error(`type.scale.${role}.fontKey references missing font "${step.fontKey}"`);
    }
    referenced.add(step.fontKey);
  }
  const identities = new Set<string>();
  for (const [key, reference] of Object.entries(font)) {
    if (!referenced.has(key)) throw new Error(`font.${key} is not referenced by a typography role`);
    const identity = `${reference.source}\u0000${reference.sourceFamilyId}`;
    if (identities.has(identity)) throw new Error(`duplicate font identity at font.${key}`);
    identities.add(identity);
  }
}

/** Validate and resolve the canonical primitive/semantic document. */
export function validateAndFill(fm: Frontmatter): ResolvedTokens {
  if (fm.version !== 1) {
    throw new Error("DESIGN.md frontmatter version must be 1");
  }
  if ("name" in fm) {
    throw new Error("DESIGN.md frontmatter name is no longer supported");
  }
  const font = resolveFont(fm.font);
  const type = resolveType(fm.type);
  validateFontBindings(font, type);
  const colorResult = resolveColorDefinition(fm.colors);
  const spacing = resolveNamedScale("spacing", SPACING_SCALE_KEYS, fm.spacing);
  const radii = resolveNamedScale("radii", RADIUS_SCALE_KEYS, fm.radii);
  return {
    version: fm.version,
    ...(typeof fm.id === "string" ? { id: fm.id } : {}),
    ...(typeof fm.description === "string"
      ? { description: fm.description }
      : {}),
    colors: colorResult.resolved,
    colorDefinition: colorResult.definition,
    radius: radii.lg,
    spacing,
    radii,
    font,
    type,
  };
}

// ---------------------------------------------------------------------------
// Normalization + deterministic serialization
// ---------------------------------------------------------------------------

function sortedRecord<T>(rec: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(rec).sort()) out[key] = rec[key];
  return out;
}

/**
 * Canonical, sorted, tuple-normalized view of resolved tokens. Two documents
 * that differ only in key order, hex vs tuple spelling, or whitespace produce
 * the same object — the stable basis for `documentHash`.
 */
export interface NormalizedTokens {
  colors: ColorDefinition;
  spacing: SpacingScale;
  radii: RadiusScale;
  font: FontSpec;
  type: TypeSpec;
}

export function normalizeResolvedTokens(t: ResolvedTokens): NormalizedTokens {
  const norm: NormalizedTokens = {
    colors: t.colorDefinition,
    spacing: t.spacing,
    radii: t.radii,
    font: Object.fromEntries(
      Object.keys(t.font).sort().map((key) => {
        const reference = t.font[key];
        return [key, {
          source: reference.source,
          sourceFamilyId: reference.sourceFamilyId,
          cssFamilyName: reference.cssFamilyName,
          fallback: reference.fallback,
        }];
      }),
    ),
    type: {
      scale: sortedRecord(t.type.scale),
      weights: sortedRecord(t.type.weights),
    },
  };
  return norm;
}

/** Deterministic JSON for a normalized-token object (keys already sorted). */
export function canonicalJson(value: NormalizedTokens): string {
  return JSON.stringify(value);
}

/**
 * Serialize resolved tokens back into a canonical DESIGN.md. Keys are sorted
 * so parse -> serialize -> parse is a stable round trip. Used by the compiler's
 * contract tests (and mirrored
 * service-side).
 */
export function serializeDesignMd(t: ResolvedTokens, prose = ""): string {
  const norm = normalizeResolvedTokens(t);
  const fm: Record<string, unknown> = {
    version: t.version,
    ...(t.id !== undefined ? { id: t.id } : {}),
    ...(t.description !== undefined ? { description: t.description } : {}),
    spacing: norm.spacing,
    radii: norm.radii,
    font: norm.font,
    type: norm.type,
    colors: norm.colors,
  };
  const yaml = stringifyYaml(fm, { sortMapEntries: true }).trimEnd();
  const body = prose ? `\n${prose.replace(/^\n+/, "")}` : "\n";
  return `---\n${yaml}\n---\n${body}`;
}
