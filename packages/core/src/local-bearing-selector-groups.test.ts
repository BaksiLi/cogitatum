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
    for (const [role, op, kind] of [["G", "+>", "supports"], ["O", "->", "challenges"], ["Q", "~>", "concerns"]]) {
      const prefix = "- [C @claim] Claim.\n  - [G @reason; @step] Reason.\n";
      const local = prefix + `    - [${family} ${role}/; @review] Review the step.
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
      expect(result.explain.entries[2].recognition).toEqual({ kind: "localBearing", role, selector: "attachment" });
      expect(result.explain.entries[2].effects).toContainEqual({
        kind: "selectAttachment", ownerSpan: result.graph.points[1].sourceSpan,
        target: { kind: "bearing", key: result.graph.bearings[0].key }
      });
    }
  });

  it("keeps nested selector groups as commentary without enlarging either source set", () => {
    const { graph, explain } = compile(`- [C] Claim.
  - [_ G; @outer]
    - [.] Original source.
    - [_ O/; @review]
      - [.] First objection source.
      - [.] Second objection source.
      - [_ G/; @backing]
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
    - [_ G/]
      - [.] Warrant.
- [_ use @step]
  - [_ Q/]
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

  it.each(["[_ G/ @a +> @c]", "[_ O/;", "[_ Q/ @a]", "[_ G/", "[_ g/]", "[_G/]", "[bearingQ/]", "[_ G/@a]"])("retains malformed %s commentary and its failed boundary", header => {
    const { graph } = compile(`- [C @c] Claim.
  - [_ G; @outer]
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
    "- [C] Unattached.\n  - [_ O/]\n    - [.] Source.",
    "- [C] Outer.\n  - [G] Ground.\n    - [C] Nearer unattached Point.\n      - [_ G/]\n        - [.] Source.",
    "- [C] Claim.\n  - [_ G]\n    - [.] Member.\n      - [_ Q/]\n        - [.] Question."
  ])("never looks past the nearest context", source => {
    const { graph } = compile(source);
    expect(graph.diagnostics.map(d => d.code)).toEqual(["NO_LOCAL_BEARING_ATTACHMENT"]);
    expect(graph.bearings.filter(b => b.target.kind === "bearing")).toEqual([]);
  });

  it("propagates failed reused and constructed targets without partial joints", () => {
    const { graph } = compile(`- [C @claim] Claim.
  - [G +> @missing; @bad] Failed relation.
    - [_ O/; @review]
      - [.] First.
      - [.] Second.
- [_ use @bad]
  - [_ G/]
    - [.] Backing.`);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics.map(d => d.code)).toEqual([
      "UNKNOWN_TARGET", "UNRESOLVED_BEARING_TARGET", "UNRESOLVED_BEARING_TARGET", "INVALID_BEARING_REFERENCE"
    ]);
  });

  it.each(["_ Q", "_ R/", "_ D/", "_ C/"])("does not invent a relation for %s", header => {
    expect(parseAnnotation(header).diagnostics.map(d => d.code)).toContain("MALFORMED_LOCAL_BEARING");
  });

  it.each([["R", "respondsTo"], ["D", "clarifies"]])("explains the same Point target boundary for %s/ and its group form", (role, kind) => {
    for (const prefix of ["", "_ "]) {
      const header = prefix + role + "/";
      const message = parseAnnotation(header).diagnostics[0].message;
      expect(message).toContain(`${kind} requires a Point target`);
      expect(message).toContain(`write [${prefix}${role}]`);
      expect(message).toContain(prefix ? `[_ @source ${kind} @target]` : `[${role} ${kind} @target]`);
    }
  });

  it("suggests the Bearing-targeted mark for a bare />", () => {
    expect(parseAnnotation("_ />").diagnostics[0].message).toContain("[_ O/]");
  });

  it("names the Point-targeted spelling when the nearest Point has no step", () => {
    const message = (source: string) => compile(source).graph.diagnostics.find(d => d.code === "NO_LOCAL_BEARING_ATTACHMENT")!.message;
    expect(message("- [C] Claim.\n  - [_ O/]\n    - [.] Source.")).toContain("write [_ O]");
    expect(message("- [C] Claim.\n  - [O/] Single.")).toContain("write [O]");
    expect(message("- [C] Claim.\n  - [Q/] Why?")).toContain("explicit ~> or concerns target");
  });

  it("explains that a group header offers no Point for a direct response", () => {
    const { graph } = compile("- [C] Claim.\n  - [G; @step] Ground.\n    - [_ Q/] Why?\n      - [.] Source.\n      - [R] Response.");
    const message = graph.diagnostics.find(d => d.code === "INVALID_LOCAL_BEARING_MEMBER")!.message;
    expect(message).toContain("creates no Point, so a direct R has no Point to respond to");
    expect(message).toContain("write [Q/]");
  });

  it.each(["R +>", "D respondsTo", "R use @p +>"])("does not interpret incomplete [%s] as an ordinary local role", header => {
    const { graph } = compile(`- [. @p] Shared.\n- [C] Claim.\n  - [_ G]\n    - [.] Source.\n    - [${header}] Incomplete.`);
    const message = graph.diagnostics.find(d => d.code === "INVALID_LOCAL_BEARING_MEMBER")!.message;
    expect(message).toContain("complete independent clauses");
    expect(message).not.toContain("has no Point to");
    expect(graph.bearings).toEqual([]);
  });

  it("retains the target selector when suggesting a missing header space", () => {
    expect(parseAnnotation("_G/").diagnostics[0].message).toContain("[_ G/]");
  });

  it("retains host locations and ordered reused sources", () => {
    const result = explainSource("Intro.\r\n  ```cog\r\n  - [. @p] Shared.\r\n  - [C] Claim.\r\n    - [G; @step] Ground.\r\n      - [_ O/]\r\n        - [. use @p]\r\n        - [.] Other.\r\n  ```", "host");
    expect(result.diagnostics).toEqual([]);
    expect(result.explanations[0].entries[3].sourceSpan.startColumn).toBe(9);
    expect(result.graphs[0].bearings[1].sources[0].key).toBe(result.graphs[0].points[0].key);
  });
});
