import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, parseDocument } from "./index.js";

const compile = (source: string) => compileGraphWithExplain(parseDocument(source)).graph;
const codes = (source: string) => compile(source).diagnostics.map(diagnostic => diagnostic.code);

// Spans move when a header is respelled; the relation structure must not.
function shape(source: string) {
  const graph = compile(source);
  const id = new Map(graph.points.map(point => [point.key, point.id ?? point.text]));
  const end = (end: { kind: string; key: string }) => end.kind === "point" ? id.get(end.key) : `bearing:${graph.bearings.findIndex(bearing => bearing.key === end.key)}`;
  return {
    diagnostics: graph.diagnostics.map(diagnostic => diagnostic.code),
    points: graph.points.map(point => [point.id, point.role, point.text]),
    bearings: graph.bearings.map(bearing => [bearing.kind, bearing.derivedBy, bearing.sources.map(end), end(bearing.target)])
  };
}

const usedBearing = "- [C @c] Claim.\n- [. @a] A.\n- [_ @a +> @c; @route] Step.";

describe("Local target terms", () => {
  // A mark is shorthand for a relation and a target term: the long spelling must compile to the same graph.
  it.each([
    ["[G]", "[G +> ^]"],
    ["[O]", "[O -> ^]"],
    ["[R]", "[R respondsTo ^]"],
    ["[D]", "[D clarifies ^]"],
    ["[Q]", "[Q ~> ^]"]
  ])("compiles %s and %s under a Point to the same graph", (short, long) => {
    const doc = (header: string) => `- [C @c] Claim.\n  - ${header} Child.`;
    expect(shape(doc(long))).toEqual(shape(doc(short)));
    expect(shape(doc(short)).diagnostics).toEqual([]);
  });

  it.each([
    ["[O/]", "[O -> ^/]"],
    ["[G/]", "[G +> ^/]"],
    ["[Q/]", "[Q ~> ^/]"],
    ["[D/]", "[D clarifies ^/]"]
  ])("compiles the Bearing selector %s and %s to the same graph", (short, long) => {
    const doc = (header: string) => `- [C @c] Claim.\n  - [G @g] Reason.\n    - ${header} Pressure.`;
    expect(shape(doc(long))).toEqual(shape(doc(short)));
    expect(shape(doc(short)).diagnostics).toEqual([]);
  });

  it.each([
    ["[_]", "[_ ~> ^]"],
    ["[_/]", "[_ ~> ^/]"]
  ])("compiles the bare constructor %s and %s to the same graph", (short, long) => {
    const doc = (header: string) => `- [C @c] Claim.\n  - [G @g] Reason.\n    - ${header} Group.\n      - [. @a] A.\n      - [. @b] B.`;
    expect(shape(doc(long))).toEqual(shape(doc(short)));
    expect(shape(doc(short)).diagnostics).toEqual([]);
  });

  it("lets a constructor take listed sources toward the local target", () => {
    const graph = compile(`- [C @c] Claim.
  - [. @a] A.
  - [. @b] B.
  - [_ @a, @b +> ^] Joint support.`);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.bearings).toEqual([expect.objectContaining({ kind: "supports", derivedBy: "structural" })]);
  });

  it.each([
    ["root Point mark", "- [G +> ^] Orphan.", ["NO_LOCAL_POINT_TARGET"]],
    ["root Bearing selector", "- [G +> ^/] Orphan.", ["NO_LOCAL_BEARING_ATTACHMENT"]],
    ["root constructor", "- [_ +> ^] Group.\n  - [. @a] A.", ["LOCAL_BEARING_REQUIRES_POINT_TARGET"]],
    ["nested member constructor", "- [C @c] Claim.\n  - [_ +> ^] Outer.\n    - [_ +> ^] Inner.\n      - [. @a] A.", ["INVALID_LOCAL_BEARING_MEMBER", "NESTED_LOCAL_BEARING_UNSUPPORTED"]],
    ["constructor under a use Bearing", `${usedBearing}\n- [_ use @route]\n  - [_ +> ^] Group.\n    - [. @b] B.`, ["LOCAL_BEARING_REQUIRES_POINT_TARGET"]],
    ["mark under a use Bearing", `${usedBearing}\n- [_ use @route]\n  - [G +> ^] Reason.`, ["BEARING_USE_REQUIRES_EXPLICIT_TARGET"]],
    ["mark under an explicit Bearing", "- [C @c] Claim.\n- [. @a] A.\n- [_ @a +> @c] Step.\n  - [G +> ^] Reason.", ["EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET"]]
  ])("diagnoses a local target term in a %s at its own cause", (_context, source, expected) => {
    expect(codes(source)).toEqual(expected);
  });

  it.each([
    ["[G @^]", "MALFORMED_ROLE_ANNOTATION", "write [G], or [G +> ^]"],
    ["[O ^/]", "MALFORMED_ROLE_ANNOTATION", "write [O/], or [O -> ^/]"],
    ["[G +> @^]", "MALFORMED_BEARING_TARGETS", "without @"],
    ["[_ +> ^ @c]", "MALFORMED_BEARING_TARGETS", "without @"]
  ])("explains the misplaced target term in %s", (header, code, hint) => {
    const graph = compile(`- [C @c] Claim.\n  - ${header} Child.\n    - [. @a] A.`);
    expect(graph.diagnostics.find(item => item.code === code)?.message, header).toContain(hint);
  });

  it("points a spaced slash to the [_/] constructor", () => {
    expect(compile("- [C @c] Claim.\n  - [G; @s] Reason.\n    - [_ /] Group.\n      - [. @a] A.").diagnostics[0].message).toContain("write [_/] without a space");
  });

  it("classifies members by relation, not by spelling", () => {
    // Any relation toward ^ claims the member slot like its mark and rejects the whole group;
    // only a named target leaves the child an independent clause.
    for (const header of ["[G]", "[G +> ^]", "[. @r +> ^]"]) {
      const graph = compile(`- [C @c] Claim.\n  - [_ +> ^] Group.\n    - [. @a] A.\n    - ${header} Intruder.`);
      expect(graph.diagnostics.map(diagnostic => diagnostic.code), header).toEqual(["INVALID_LOCAL_BEARING_MEMBER"]);
      expect(graph.bearings, header).toEqual([]);
    }
    const independent = compile(`- [C @c] Claim.\n  - [_ +> ^] Group.\n    - [. @a] A.\n    - [G +> @c] Elsewhere.`);
    expect(independent.diagnostics).toEqual([]);
    expect(independent.bearings.map(bearing => [bearing.kind, bearing.derivedBy])).toEqual([["supports", "structural"], ["supports", "operator"]]);
  });
});
