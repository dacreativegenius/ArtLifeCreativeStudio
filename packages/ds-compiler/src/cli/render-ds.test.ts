import { describe, it, expect } from "vitest";
import {
  parseDesignMd,
  frontmatterFromRenderDocument,
  validateAndFill,
  serializeDesignMd,
  normalizeResolvedTokens,
  canonicalJson,
  type RenderDocumentInput,
  type Frontmatter,
} from "../parse";
import { compileDesignSystem } from "../compile";
import { makeColorDefinition, makeDocument } from "../test-fixture";

// The render CLI's core transformation: a document (frontmatter shape) ->
// validateAndFill -> serializeDesignMd. Testing the transformation directly
// (the CLI only adds file I/O around this).
function render(document: Frontmatter): string {
  const prose = typeof document.description === "string" ? document.description : "";
  return serializeDesignMd(validateAndFill(document), prose);
}

describe("render-ds transformation", () => {
  it("produces a DESIGN.md that parses back to the same resolved tokens", () => {
    const document = makeDocument();
    const md = render(document);
    const { frontmatter } = parseDesignMd(md);
    expect(frontmatter.id).toBe("ds-test-1");
    expect(frontmatter).not.toHaveProperty("name");
    expect(frontmatter.description).toBe("A test design system.");
    // parse(render(doc)) resolves to the same tokens as validateAndFill(doc).
    expect(normalizeResolvedTokens(validateAndFill(frontmatter))).toEqual(
      normalizeResolvedTokens(validateAndFill(document)),
    );
  });

  it("is deterministic — same document renders byte-for-byte identically", () => {
    const document = makeDocument();
    expect(render(document)).toBe(render(document));
  });

  it("round-trips the document hash: compile(render(doc)) is stable across a parse→render cycle", () => {
    const document = makeDocument();
    const md1 = render(document);
    // Feed the rendered md back through parse → render; the compiled
    // documentHash must be identical (render preserves the document's identity,
    // which is what lets the service reconcile its own hash against the compiler).
    const md2 = render(parseDesignMd(md1).frontmatter);
    expect(md2).toBe(md1);
    expect(compileDesignSystem(md1).provenance.documentHash).toBe(
      compileDesignSystem(md2).provenance.documentHash,
    );
    // The canonical normalized form the hash derives from is non-empty/stable.
    const canonical = canonicalJson(normalizeResolvedTokens(validateAndFill(document)));
    expect(canonical.length).toBeGreaterThan(0);
  });

  it("supports a single color-token set", () => {
    const document = makeDocument({ colors: makeColorDefinition() });
    const md = render(document);
    const { frontmatter } = parseDesignMd(md);
    expect(frontmatter.colors.semantic.primary).toBeDefined();
    expect(() => compileDesignSystem(md)).not.toThrow();
  });

  it("maps service document identity into canonical frontmatter", () => {
    const { version: _version, id: _id, ...tokens } = makeDocument();
    const serviceDocument: RenderDocumentInput = {
      ...tokens,
      schemaVersion: 1,
      designSystemId: "ds-service-1",
    };
    const resolved = validateAndFill(
      frontmatterFromRenderDocument(serviceDocument),
    );
    const { frontmatter } = parseDesignMd(
      serializeDesignMd(resolved, serviceDocument.description),
    );
    expect(frontmatter.version).toBe(1);
    expect(frontmatter.id).toBe("ds-service-1");
  });

  it("throws on a document missing required semantic color slots", () => {
    const colors = makeColorDefinition();
    delete colors.semantic.primary;
    const document = makeDocument({ colors });
    expect(() => render(document)).toThrow();
  });

  it("rejects a service document from any other schema", () => {
    const { version: _version, id: _id, ...tokens } = makeDocument();
    expect(() =>
      frontmatterFromRenderDocument({
        ...tokens,
        schemaVersion: 2,
        designSystemId: "ds-unsupported",
      } as unknown as RenderDocumentInput),
    ).toThrow(/schemaVersion must be 1/);
  });
});
