import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, parseAnnotation, parseDocument } from "./index.js";

const compile = (source: string) => compileGraphWithExplain(parseDocument(source));

describe("Bearing mode selection", () => {
  it.each(["_", "bearing", "edge"])("constructs local Bearings through the %s family spelling", family => {
    for (const [role, kind] of [["G", "supports"], ["O", "challenges"], ["R", "respondsTo"], ["D", "clarifies"]]) {
      const { graph, explain } = compile(`- [O @target] Target.
  - [${family} ${role}; @route] Step description.
    - [. @a] First source.
    - [. @b] Second source.`);
      expect(graph.diagnostics).toEqual([]);
      expect(graph.points.map(point => point.id)).toEqual(["target", "a", "b"]);
      expect(graph.bearings).toEqual([expect.objectContaining({
        kind, handle: "route", text: "Step description.", derivedBy: "structural",
        sources: graph.points.slice(1).map(point => ({ kind: "point", key: point.key })),
        target: { kind: "point", key: graph.points[0].key }
      })]);
      expect(explain.entries[1].recognition).toEqual({ kind: "localBearing", role });
    }
  });

  it.each(["_", "bearing", "edge"])("never reinterprets mixed local %s headers as explicit, use or note", family => {
    for (const suffix of ["G @a +> @b", "G +>", "G use @a", "G note", "G supports @b", "G @a", "G; @one; @two", "g", "Q", "C", "R/", "D/", "G/ @a +> @b"]) {
      const header = `${family} ${suffix}`;
      const parsed = parseAnnotation(header);
      expect(parsed.annotation, header).toMatchObject({ kind: "localBearing", syntaxErrors: expect.arrayContaining(["localBearing"]) });
      expect(parsed.diagnostics.map(diagnostic => diagnostic.code), header).toContain("MALFORMED_LOCAL_BEARING");
      const { graph } = compile(`- [C @outer] Outer.
  - [${header}] Rejected step.
    - [. @a] Material remains active.
      - [G @detail] Reason for the material.`);
      expect(graph.points.map(point => point.id), header).toEqual(["outer", "a", "detail"]);
      expect(graph.bearings, header).toEqual([expect.objectContaining({
        kind: "supports",
        sources: [{ kind: "point", key: graph.points[2].key }],
        target: { kind: "point", key: graph.points[1].key }
      })]);
    }
  });

  it.each(["_G", "bearingG", "edgeG", "_O; @route", "_D"])("keeps the glued local header [%s] a rejected boundary instead of body", header => {
    const parsed = parseAnnotation(header);
    expect(parsed.annotation).toMatchObject({ kind: "localBearing", syntaxErrors: expect.arrayContaining(["localBearing"]) });
    expect(parsed.diagnostics.find(diagnostic => diagnostic.code === "MALFORMED_LOCAL_BEARING")?.message).toContain("Separate the family spelling from the role with a space");
    const { graph } = compile(`- [C @outer] Outer.
  - [${header}]
    - [. @a] Source.`);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toContain("MALFORMED_LOCAL_BEARING");
  });

  it.each(["[_O-ring]", "[edgeless]", "[_Gx]"])("leaves %s as ordinary body", header => {
    const ast = parseDocument(`- [C] Outer.\n  - ${header} text`);
    expect(ast.blocks[0].children[0].annotation).toBeUndefined();
  });

  it.each([
    ["supports", "[_ G]"], ["+>", "[_ G]"], ["challenges", "[_ O]"], ["respondsTo", "[_ R]"], ["clarifies", "[_ D]"],
    ["answers", "name their endpoints explicitly"], ["concerns", "name their endpoints explicitly"]
  ])("points [_ %s] to the matching local header or explicit endpoints", (token, hint) => {
    const { graph } = compile(`- [O @outer] Outer.
  - [_ ${token}]
    - [.] Source.`);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["MALFORMED_BEARING_MODE"]);
    expect(graph.diagnostics[0].message).toContain(hint);
    expect(graph.bearings).toEqual([]);
  });

  it.each(["_", "bearing", "edge"])("keeps incomplete explicit %s headers explicit", family => {
    for (const suffix of ["@a +>", "@a +> G", "@a G", "@a +> @b G"]) {
      const parsed = parseAnnotation(`${family} ${suffix}`);
      expect(parsed.annotation).toMatchObject({ kind: "explicitBearing", syntaxErrors: expect.arrayContaining(["operator"]) });
      expect(parsed.diagnostics.some(diagnostic => diagnostic.severity === "error")).toBe(true);
      expect(parsed.diagnostics.map(diagnostic => diagnostic.code)).not.toContain("MALFORMED_LOCAL_BEARING");
    }
    for (const suffix of ["+>", "->", "~>", "supports", "cases", ""]) {
      const parsed = parseAnnotation(`${family} ${suffix}`.trim());
      expect(parsed.annotation, suffix).toMatchObject({ kind: "explicitBearing", syntaxErrors: ["mode"] });
      expect(parsed.diagnostics.map(diagnostic => diagnostic.code), suffix).toEqual(["MALFORMED_BEARING_MODE"]);
    }
    expect(parseAnnotation(`${family} use @route G`).annotation).toMatchObject({
      kind: "bearingUse", ref: { id: "route" }, syntaxErrors: ["reference"]
    });
    expect(parseAnnotation(`${family} note G`).annotation).toMatchObject({
      kind: "note", targetKind: "bearing", syntaxErrors: ["note"]
    });
  });

  it.each(["[_ G", "[bearing O", "[edge R; @route", "[_ G use @a"])("retains the local boundary of unclosed %s", header => {
    const { graph, explain } = compile(`- [O @outer] Outer.
  - ${header}
    - [. @a] Source.
      - [O @o] Objection to the source.`);
    expect(explain.entries[1].recognition.kind).toBe("localBearing");
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toContain("MALFORMED_ANNOTATION_PREFIX");
    expect(graph.bearings).toEqual([expect.objectContaining({
      kind: "challenges",
      target: { kind: "point", key: graph.points.find(point => point.id === "a")!.key }
    })]);
  });

  it("preserves specific syntax errors while rejecting an unclosed local header", () => {
    const ast = parseDocument("- [C] Target.\n  - [_ G; @bad!");
    expect(ast.blocks[0].children[0].annotation).toMatchObject({
      kind: "localBearing", role: "G", syntaxErrors: expect.arrayContaining(["localBearing", "handle"])
    });
    expect(ast.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      "MALFORMED_ANNOTATION_PREFIX", "MALFORMED_BEARING_HANDLE"
    ]);
  });

  it.each(["[linked]", "[linked G]", "[G linked]", "[O linked; @route]", "[. linked]", "[G linked"])(
    "rejects retired %s without creating a Point, attachment or handle", header => {
      const { graph } = compile(`- [C @outer] Outer.
  - ${header}
    - [. @a] First source.
    - [. @b] Second source.`);
      expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toContain("RETIRED_LINKED_ANNOTATION");
      expect(graph.points.map(point => point.id)).toEqual(["outer", "a", "b"]);
      expect(graph.bearings).toEqual([]);
    }
  );

  it("keeps only a leading note operation literal", () => {
    const literal = compile("- [C] Target.\n  - [_ note G]\n    - [G @hidden] Literal.");
    const active = compile("- [C] Target.\n  - [_ G note]\n    - [. @visible] Active.");
    expect(literal.graph.points).toHaveLength(1);
    expect(active.graph.points.map(point => point.id)).toEqual([undefined, "visible"]);
    expect(active.explain.entries[1].recognition.kind).toBe("localBearing");
    expect(active.graph.bearings).toEqual([]);
  });
});
