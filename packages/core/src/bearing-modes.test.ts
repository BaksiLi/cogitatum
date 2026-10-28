import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, parseAnnotation, parseDocument } from "./index.js";

const compile = (source: string) => compileGraphWithExplain(parseDocument(source));

describe("Bearing mode selection", () => {
  it.each(["_", "bearing", "edge"])("constructs member-sourced Bearings through the %s family spelling", family => {
    for (const [clause, kind] of [["+> ^", "supports"], ["-> ^", "challenges"], ["respondsTo ^", "respondsTo"], ["clarifies ^", "clarifies"], ["~> ^", "concerns"], ["", "concerns"]]) {
      const { graph, explain } = compile(`- [O @target] Target.
  - [${(family + " " + clause).trim()}; @route] Step description.
    - [. @a] First source.
    - [. @b] Second source.`);
      expect(graph.diagnostics).toEqual([]);
      expect(graph.points.map(point => point.id)).toEqual(["target", "a", "b"]);
      expect(graph.bearings).toEqual([expect.objectContaining({
        kind, handle: "route", text: "Step description.", derivedBy: "structural",
        sources: graph.points.slice(1).map(point => ({ kind: "point", key: point.key })),
        target: { kind: "point", key: graph.points[0].key }
      })]);
      expect(explain.entries[1].recognition).toEqual({ kind: "bearing", members: true });
    }
  });

  it.each(["_", "bearing", "edge"])("rejects role-headed %s headers without reinterpreting them as listed sources, use or note", family => {
    for (const [suffix, clause] of [["G @a +> @b", "+> ^"], ["G +>", "+> ^"], ["G use @a", "+> ^"], ["G note", "+> ^"], ["G supports @b", "+> ^"], ["G @a", "+> ^"],
      ["O; @route", "-> ^"], ["g", "+> ^"], ["Q", "~> ^"], ["R", "respondsTo ^"], ["D/", "clarifies ^/"], ["G/ @a +> @b", "+> ^/"], ["C", undefined], ["R/", "respondsTo ^"]] as const) {
      const header = `${family} ${suffix}`;
      const parsed = parseAnnotation(header);
      expect(parsed.annotation, header).toMatchObject({ kind: "bearing", members: true, syntaxErrors: ["mode"] });
      expect(parsed.diagnostics.map(diagnostic => diagnostic.code), header).toEqual(["MALFORMED_BEARING_MODE"]);
      expect(parsed.diagnostics[0].message, header).toContain(clause ? `rite [_ ${clause}]` : "Write an operator and target");
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

  it.each([["_G", "+> ^"], ["bearingG", "+> ^"], ["edgeG", "+> ^"], ["_O; @route", "-> ^"], ["_D", "clarifies ^"]])("keeps the glued role header [%s] a rejected member boundary instead of body", (header, clause) => {
    const parsed = parseAnnotation(header);
    expect(parsed.annotation).toMatchObject({ kind: "bearing", members: true, syntaxErrors: ["mode"] });
    // The hint names the relation directly; separating the role would only produce another rejected header.
    expect(parsed.diagnostics.find(diagnostic => diagnostic.code === "MALFORMED_BEARING_MODE")?.message).toContain(`Write [_ ${clause}]`);
    const { graph } = compile(`- [C @outer] Outer.
  - [${header}]
    - [. @a] Source.`);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toContain("MALFORMED_BEARING_MODE");
  });

  it.each(["[_O-ring]", "[edgeless]", "[_Gx]"])("leaves %s as ordinary body", header => {
    const ast = parseDocument(`- [C] Outer.\n  - ${header} text`);
    expect(ast.blocks[0].children[0].annotation).toBeUndefined();
  });

  it.each(["_", "bearing", "edge"])("retains the %s boundary when both role and operator spacing are missing", family => {
    for (const suffix of ["G->@outer", "O+>@outer", "Q/~>@step", "G?/>@outer", "D_~>@outer"]) {
      for (const closer of ["]", ""]) {
        const header = `${family}${suffix}`;
        const { graph, explain } = compile(`- [C @outer] Outer.
  - [G; @step] Original reason.
    - [${header}${closer} Malformed step.
      - [G @source] Retained source.
        - [O @detail] Source objection.`);
        expect(explain.entries[2].recognition.kind, header).toBe("bearing");
        expect(graph.diagnostics.some(d => d.code === "MALFORMED_BEARING_MODE"), header).toBe(true);
        expect(graph.diagnostics.map(d => d.code), header).not.toContain("IMPLICIT_ATTACHMENT_THROUGH_BODY");
        expect(graph.bearings.map(b => b.kind), header).toEqual(["supports", "challenges"]);
        expect(graph.bearings[1].target.key, header).toBe(graph.points.find(p => p.id === "source")!.key);
      }
    }
    for (const suffix of ["O-ring", "G+ratio", "G/O ratio", "G/~ratio"]) {
      const ast = parseDocument(`- [C] Outer.\n  - [${family}${suffix}] Ordinary prose.`);
      expect(ast.blocks[0].children[0].annotation, suffix).toBeUndefined();
    }
  });

  it.each(["supports", "+>", "challenges", "->", "~>", "respondsTo", "clarifies", "answers", "concerns"])("asks [_ %s] for its target instead of supplying one", token => {
    const { graph } = compile(`- [O @outer] Outer.
  - [_ ${token}]
    - [.] Source.`);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["MALFORMED_EXPLICIT_BEARING"]);
    expect(graph.diagnostics[0].message).toContain("write ^ for the nearest Point or ^/ for its exposed Bearing");
    expect(graph.diagnostics[0].message).not.toContain("include sources");
    expect(graph.bearings).toEqual([]);
  });

  it.each(["^", "^/"])("asks [_ %s] for the operator before its target", target => {
    const parsed = parseAnnotation(`_ ${target}`);
    expect(parsed.annotation).toMatchObject({ kind: "bearing", syntaxErrors: ["mode"] });
    expect(parsed.diagnostics[0].message).toContain(`[_ +> ${target}]`);
  });

  it.each(["_", "bearing", "edge"])("keeps incomplete explicit %s headers explicit", family => {
    for (const suffix of ["@a +>", "@a +> G", "@a G", "@a +> @b G"]) {
      const parsed = parseAnnotation(`${family} ${suffix}`);
      expect(parsed.annotation).toMatchObject({ kind: "bearing", syntaxErrors: expect.arrayContaining(["operator"]) });
      expect(parsed.diagnostics.some(diagnostic => diagnostic.severity === "error")).toBe(true);
      expect(parsed.annotation).toMatchObject({ members: false });
      expect(parsed.diagnostics.map(diagnostic => diagnostic.code)).not.toContain("MALFORMED_BEARING_MODE");
    }
    for (const suffix of ["cases", "Because"]) {
      const parsed = parseAnnotation(`${family} ${suffix}`);
      expect(parsed.annotation, suffix).toMatchObject({ kind: "bearing", members: false, syntaxErrors: ["mode"] });
      expect(parsed.diagnostics.map(diagnostic => diagnostic.code), suffix).toEqual(["MALFORMED_BEARING_MODE"]);
    }
    expect(parseAnnotation(family)).toMatchObject({ annotation: { kind: "bearing", members: true }, diagnostics: [] });
    expect(parseAnnotation(`${family} use @route G`).annotation).toMatchObject({
      kind: "bearingUse", ref: { id: "route" }, syntaxErrors: ["reference"]
    });
    expect(parseAnnotation(`${family} note G`).annotation).toMatchObject({
      kind: "note", syntaxErrors: ["note"]
    });
  });

  it.each(["[_ G", "[bearing O", "[edge respondsTo ^; @route", "[_ +> ^ use @a"])("retains the local boundary of unclosed %s", header => {
    const { graph, explain } = compile(`- [O @outer] Outer.
  - ${header}
    - [. @a] Source.
      - [O @o] Objection to the source.`);
    expect(explain.entries[1].recognition.kind).toBe("bearing");
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toContain("MALFORMED_ANNOTATION_PREFIX");
    expect(graph.bearings).toEqual([expect.objectContaining({
      kind: "challenges",
      target: { kind: "point", key: graph.points.find(point => point.id === "a")!.key }
    })]);
  });

  it("preserves specific syntax errors while rejecting an unclosed local header", () => {
    const ast = parseDocument("- [C] Target.\n  - [_ +> ^; @bad!");
    expect(ast.blocks[0].children[0].annotation).toMatchObject({
      kind: "bearing", members: true, syntaxErrors: expect.arrayContaining(["operator", "handle"])
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
    const active = compile("- [C] Target.\n  - [_ +> ^ note]\n    - [. @visible] Active.");
    expect(literal.graph.points).toHaveLength(1);
    expect(active.graph.points.map(point => point.id)).toEqual([undefined, "visible"]);
    expect(active.explain.entries[1].recognition.kind).toBe("bearing");
    expect(active.graph.bearings).toEqual([]);
  });
});
