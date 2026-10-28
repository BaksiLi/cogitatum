import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, explainSource, parseAnnotation, parseDocument } from "./index.js";

const compile = (source: string) => compileGraphWithExplain(parseDocument(source));
const names = (source: string) => {
  const { graph } = compile(source);
  const ids = new Map([...graph.points.map(p => [p.key, p.id]), ...graph.bearings.map(b => [b.key, b.handle])]);
  return graph.bearings.map(b => ({
    kind: b.kind, handle: b.handle, text: b.text,
    sources: b.sources.map(s => ids.get(s.key)), target: [b.target.kind, ids.get(b.target.key)]
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
};

describe("local Bearing selector constructors", () => {
  it.each(["_", "bearing", "edge"])("shares scalar selection and joint construction through %s", family => {
    for (const [header, op, kind] of [["+> ^/", "+>", "supports"], ["-> ^/", "->", "challenges"], ["clarifies ^/", "clarifies", "clarifies"], ["~> ^/", "~>", "concerns"], ["/", "~>", "concerns"]]) {
      const prefix = "- [C @claim] Claim.\n  - [G @reason; @step] Reason.\n";
      const local = prefix + `    - [${header === "/" ? family + "/" : family + " " + header}; @review] Review the step.
      - [. @a] First source.
        - [G @detail] Reason for this source.
      - [. @b] Second source.
      - [_ note] Literal note.
      - [O/ @objection] Challenge the review.`;
      const explicit = prefix + `    - [. @a] First source.
      - [G @detail] Reason for this source.
    - [. @b] Second source.
    - [_ @a, @b ${op} @step; @review] Review the step.
      - [_ note] Literal note.
      - [O/ @objection] Challenge the review.`;
      const result = compile(local);
      expect(result.graph.diagnostics, local).toEqual([]);
      expect(names(local)).toEqual(names(explicit));
      expect(result.graph.bearings[1]).toMatchObject({ kind, sources: result.graph.points.slice(2).filter(p => p.id === "a" || p.id === "b").map(p => ({ kind: "point", key: p.key })) });
      expect(result.explain.entries[2].recognition).toEqual(header === "/" ? { kind: "bearing", members: true, selector: "attachment" } : { kind: "bearing", members: true });
      expect(result.explain.entries[2].effects).toContainEqual({
        kind: "selectAttachment", ownerSpan: result.graph.points[1].sourceSpan,
        target: { kind: "bearing", key: result.graph.bearings[0].key }
      });
    }
  });

  it("keeps nested selector groups as commentary without enlarging either source set", () => {
    const { graph, explain } = compile(`- [C] Claim.
  - [_ +> ^; @outer]
    - [.] Original source.
    - [_ -> ^/; @review]
      - [.] First objection source.
      - [.] Second objection source.
      - [_ +> ^/; @backing]
        - [.] Backing source.`);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.bearings.map(b => [b.handle, b.sources.length, b.target])).toEqual([
      ["outer", 1, { kind: "point", key: graph.points[0].key }],
      ["review", 2, { kind: "bearing", key: graph.bearings[0].key }],
      ["backing", 1, { kind: "bearing", key: graph.bearings[1].key }]
    ]);
    expect(explain.entries[3].effects).toContainEqual(expect.objectContaining({ kind: "localBearingMember", eligible: false, function: "commentary" }));
  });

  it("selects constructed and reused Bearings through ordinary body", () => {
    const source = `- [. @a] Source.
- [C @claim] Claim.
- [_ @a +> @claim; @step]
  - Context.
    - [_ +> ^/]
      - [.] Warrant.
- [_ use @step]
  - [_ ~> ^/]
    - [.] Which conditions?
    - [.] Which scope?`;
    const { graph, explain } = compile(source);
    expect(graph.diagnostics.map(d => d.code)).toEqual(["IMPLICIT_ATTACHMENT_THROUGH_BODY"]);
    expect(graph.bearings.slice(1).map(b => b.target)).toEqual([
      { kind: "bearing", key: graph.bearings[0].key }, { kind: "bearing", key: graph.bearings[0].key }
    ]);
    expect(explain.entries[7].effects).toContainEqual({
      kind: "selectBearing", contextSpan: explain.entries[6].sourceSpan,
      target: { kind: "bearing", key: graph.bearings[0].key }
    });
  });

  it.each(["[_ +> ^/ @a +> @c]", "[_ -> ^/;", "[_ ~> ^/ @a]", "[_ G/", "[_ g/]", "[_G/]", "[bearingQ/]", "[_ G/@a]"])("retains malformed %s commentary and its failed boundary", header => {
    const { graph } = compile(`- [C @c] Claim.
  - [_ +> ^; @outer]
    - [. @source] Original source.
    - ${header}
      - [. @a] Active material.
        - [G @detail] Its reason.`);
    expect(graph.diagnostics.some(d => d.severity === "error")).toBe(true);
    expect(graph.diagnostics.map(d => d.code)).not.toContain("INVALID_LOCAL_BEARING_MEMBER");
    expect(graph.bearings.map(b => b.handle)).toEqual(["outer", undefined]);
    expect(graph.bearings[0].sources).toEqual([{ kind: "point", key: graph.points[1].key }]);
  });

  it.each([
    "- [C] Unattached.\n  - [_ -> ^/]\n    - [.] Source.",
    "- [C] Outer.\n  - [G] Ground.\n    - [C] Nearer unattached Point.\n      - [_ +> ^/]\n        - [.] Source.",
    "- [C] Claim.\n  - [_ +> ^]\n    - [.] Member.\n      - [_ ~> ^/]\n        - [.] Question."
  ])("never looks past the nearest context", source => {
    const { graph } = compile(source);
    expect(graph.diagnostics.map(d => d.code)).toEqual(["NO_LOCAL_BEARING_ATTACHMENT"]);
    expect(graph.bearings.filter(b => b.target.kind === "bearing")).toEqual([]);
  });

  it("propagates failed reused and constructed targets without partial joints", () => {
    const { graph } = compile(`- [C @claim] Claim.
  - [G +> @missing; @bad] Failed relation.
    - [_ -> ^/; @review]
      - [.] First.
      - [.] Second.
- [_ use @bad]
  - [_ +> ^/]
    - [.] Backing.`);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics.map(d => d.code)).toEqual([
      "UNKNOWN_TARGET", "UNRESOLVED_BEARING_TARGET", "UNRESOLVED_BEARING_TARGET", "INVALID_BEARING_REFERENCE"
    ]);
  });

  it.each([["_ Q", "[_ ~> ^]"], ["_ D/", "[_ clarifies ^/]"], ["_ C/", "Write an operator and target"]])("names the relation instead of accepting the role header %s", (header, hint) => {
    const { diagnostics } = parseAnnotation(header);
    expect(diagnostics.map(d => d.code)).toEqual(["MALFORMED_BEARING_MODE"]);
    expect(diagnostics[0].message).toContain(hint);
  });

  it("explains the same Point target boundary for R/ and its group form", () => {
    for (const [header, local, named] of [["R/", "[R]", "[R respondsTo @target]"], ["_ R/", "[_ respondsTo ^]", "[_ @source respondsTo @target]"]]) {
      const message = parseAnnotation(header).diagnostics[0].message;
      expect(message).toContain("respondsTo requires a Point target");
      expect(message).toContain(`write ${local}`);
      expect(message).toContain(named);
    }
  });

  it("lets [D/] clarify the exposed step, like its constructor form [_ clarifies ^/]", () => {
    const step = "- [C @claim] Claim.\n  - [G; @step] Reason.\n";
    expect(names(step + "    - [D/ @meaning] What the step means.")).toContainEqual(
      { kind: "clarifies", handle: undefined, text: undefined, sources: ["meaning"], target: ["bearing", "step"] });
    expect(names(step + "    - [_ clarifies ^/]\n      - [. @meaning] What the step means.")).toContainEqual(
      { kind: "clarifies", handle: undefined, text: undefined, sources: ["meaning"], target: ["bearing", "step"] });
  });

  it("migrates a bare retired /> to -> and asks for its target", () => {
    const codes = parseAnnotation("_ />").diagnostics.map(d => d.code);
    expect(codes).toEqual(["RETIRED_AUTHORING_SYNTAX", "MALFORMED_EXPLICIT_BEARING"]);
    expect(parseAnnotation("_ />").diagnostics[0].message).toContain("^/ for the locally exposed Bearing");
  });

  it("names the Point-targeted spelling when the nearest Point has no step", () => {
    const message = (source: string) => compile(source).graph.diagnostics.find(d => d.code === "NO_LOCAL_BEARING_ATTACHMENT")!.message;
    expect(message("- [C] Claim.\n  - [_ -> ^/]\n    - [.] Source.")).toContain("write [_ -> ^]");
    expect(message("- [C] Claim.\n  - [O/] Single.")).toContain("write [O]");
    expect(message("- [C] Claim.\n  - [Q/ @q; @h] Why?")).toContain("write [Q @q; @h]");
    expect(message("- [C] Claim.\n  - [_/]\n    - [.] Source.")).toContain("write [_]");
  });

  it("explains that a group header offers no Point for a direct response", () => {
    const { graph } = compile("- [C] Claim.\n  - [G; @step] Ground.\n    - [_ ~> ^/] Why?\n      - [.] Source.\n      - [R] Response.");
    const message = graph.diagnostics.find(d => d.code === "INVALID_LOCAL_BEARING_MEMBER")!.message;
    expect(message).toContain("creates no Point, so a direct R has no Point to respond to");
    expect(message).toContain("write [Q/]");
  });

  it.each(["R +>", "D respondsTo", "R use @p +>"])("does not interpret incomplete [%s] as an ordinary local role", header => {
    const { graph } = compile(`- [. @p] Shared.\n- [C] Claim.\n  - [_ +> ^]\n    - [.] Source.\n    - [${header}] Incomplete.`);
    const message = graph.diagnostics.find(d => d.code === "INVALID_LOCAL_BEARING_MEMBER")!.message;
    expect(message).toContain("complete independent clauses");
    expect(message).not.toContain("has no Point to");
    expect(graph.bearings).toEqual([]);
  });

  it("retains the target selector when suggesting a missing header space", () => {
    expect(parseAnnotation("_G/").diagnostics[0].message).toContain("[_ +> ^/]");
  });

  it("retains host locations and ordered reused sources", () => {
    const result = explainSource("Intro.\r\n  ```cog\r\n  - [. @p] Shared.\r\n  - [C] Claim.\r\n    - [G; @step] Ground.\r\n      - [_ -> ^/]\r\n        - [. use @p]\r\n        - [.] Other.\r\n  ```", "host");
    expect(result.diagnostics).toEqual([]);
    expect(result.explanations[0].entries[3].sourceSpan.startColumn).toBe(9);
    expect(result.graphs[0].bearings[1].sources[0].key).toBe(result.graphs[0].points[0].key);
  });
});
