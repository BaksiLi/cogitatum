import { describe, expect, it } from "vitest";
import { analyzeSourceReferences, compileGraphWithExplain, parseDocument } from "./index.js";
import type { BearingKind, GraphIR } from "./types.js";

const compile = (source: string) => compileGraphWithExplain(parseDocument(source));
const codes = (graph: GraphIR) => graph.diagnostics.map(diagnostic => diagnostic.code);
const kinds: BearingKind[] = ["supports", "challenges", "concerns", "answers", "respondsTo", "clarifies"];
const pointKinds = ["answers", "respondsTo", "clarifies"];

describe("named Point clauses", () => {
  it.each(kinds)("states %s once while retaining the occurrence's Q role, content and child context", kind => {
    const source = `- [O @target] Original objection.
- [C @outer] Local context.
  - [Q @question ${kind} @target; @step] Which time scale
    do you mean?
    - [C @answer answers @question] Seconds.
    - [. note] Shared question note.
    - [_ note] Note on this attachment.`;
    const { graph, explain } = compile(source);
    expect(codes(graph)).toEqual([]);
    expect(graph.points.map(point => [point.id, point.declaration.role])).toEqual([
      ["target", "O"], ["outer", "C"], ["question", "Q"], ["answer", "C"]
    ]);
    expect(graph.points[2].text).toBe("Which time scale\ndo you mean?");
    expect(graph.bearings).toMatchObject([
      { kind, handle: "step", sources: [{ key: graph.points[2].key }], target: { kind: "point", key: graph.points[0].key }, derivedBy: "operator" },
      { kind: "answers", sources: [{ key: graph.points[3].key }], target: { kind: "point", key: graph.points[2].key }, derivedBy: "operator" }
    ]);
    expect(graph.bearings[0].text).toBeUndefined();
    expect(graph.notes.map(note => note.target)).toEqual([
      { kind: "point", key: graph.points[2].key }, { kind: "bearing", key: graph.bearings[0].key }
    ]);
    expect(explain.entries[2].recognition).toEqual({ kind: "role", role: "Q" });
    expect(explain.entries[2].effects.filter(effect => effect.kind === "emitBearing")).toHaveLength(1);
    expect(explain.entries[2].effects.some(effect => effect.kind === "implicitAttachment")).toBe(false);
  });

  it.each(kinds)("accepts %s uniformly on neutral Point-family declarations and uses", kind => {
    for (const family of [".", "point", "node"]) {
      const { graph } = compile(`- [C @target] Target.\n- [${family} @source ${kind} @target; @first] Shared content.\n- [${family} use @source ${kind} @target; @second] Local prose.`);
      expect(codes(graph), family).toEqual([]);
      expect(graph.points, family).toHaveLength(2);
      expect(graph.points[1], family).toMatchObject({ id: "source", text: "Shared content.", declaration: { form: "material" } });
      expect(graph.bearings.map(bearing => [bearing.kind, bearing.sources[0].key, bearing.target.key]), family).toEqual([
        [kind, graph.points[1].key, graph.points[0].key], [kind, graph.points[1].key, graph.points[0].key]
      ]);
      expect(graph.bearings[0].key, family).not.toBe(graph.bearings[1].key);
    }
  });

  it.each(kinds)("retains shared identity and local Q context when a use explicitly states %s", kind => {
    const { graph, explain } = compile(`- [. @shared] Shared content.
- [O @target] Objection.
- [C @outer] Outer.
  - [Q use @shared ${kind} @target; @step] Local explanation.
    - [C @answer answers @shared] Candidate answer.
    - [O/ @review] Review the explicitly constructed attachment.`);
    expect(codes(graph)).toEqual([]);
    expect(graph.points).toHaveLength(5);
    expect(graph.points[0]).toMatchObject({ text: "Shared content.", declaration: { form: "material" } });
    expect(graph.bearings.map(bearing => [bearing.kind, bearing.target.key])).toEqual([
      [kind, graph.points[1].key], ["answers", graph.points[0].key], ["challenges", graph.bearings[0].key]
    ]);
    expect(explain.entries[3].recognition).toEqual({ kind: "use", role: "Q", ref: { id: "shared" } });
    expect(explain.entries[3].effects).toContainEqual({
      kind: "focusPoint", operand: { id: "shared" }, ref: { kind: "point", key: graph.points[0].key }
    });
  });

  it.each(kinds)("keeps the target constraint of %s on declarations and uses", kind => {
    for (const mark of ["Q @new", "Q use @source"]) {
      const { graph } = compile(`- [G @source] Existing content.\n- [C @target] Target.\n- [_ @source +> @target; @base]\n- [C @outer] Outer.\n  - [${mark} ${kind} @base; @step] Assessment.`);
      const pointOnly = pointKinds.includes(kind);
      expect(codes(graph), mark).toEqual(pointOnly ? ["BEARING_KIND_REQUIRES_POINT_TARGET"] : []);
      expect(graph.bearings, mark).toHaveLength(pointOnly ? 1 : 2);
      if (!pointOnly) expect(graph.bearings[1].target, mark).toEqual({ kind: "bearing", key: graph.bearings[0].key });
    }
  });

  it.each([
    "answers", "Answers @target", "answers @target, @outer", "answers @target clarifies @outer"
  ])("rejects the malformed clause %s without a default, while retaining valid Point focus", clause => {
    for (const mark of ["Q @question", "Q use @shared"]) {
      const { graph } = compile(`- [. @shared] Shared.\n- [O @target] Target.\n- [C @outer] Outer.\n  - [${mark} ${clause}; @failed] Local question.\n    - [R @child] Child reply.\n    - [O/] No attachment to select.`);
      expect(codes(graph).length, mark).toBeGreaterThan(1);
      expect(codes(graph), mark).toContain("NO_LOCAL_BEARING_ATTACHMENT");
      expect(graph.bearings, mark).toHaveLength(1);
      expect(graph.bearings[0].kind, mark).toBe("respondsTo");
      expect(graph.points.find(point => point.key === graph.bearings[0].target.key)?.id, mark).toBe(mark.includes("use") ? "shared" : "question");
    }
  });

  it.each(["[Q @question answer @target]", "[Q @question respondsTo @target"])(
    "keeps unknown kinds and unclosed %s as failed boundaries",
    header => {
      const { graph } = compile(`- [O @target] Target.\n- [C @outer] Outer.\n  - ${header} Bad header.\n    - [G @child] Child.`);
      expect(codes(graph)).toContain("FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET");
      expect(graph.points.map(point => point.id)).toEqual(["target", "outer", "child"]);
      expect(graph.bearings).toEqual([]);
    }
  );

  it.each(["G/", "G/ use @shared", "O/", "O/ use @shared"])("excludes a named clause from %s", mark => {
    const { graph } = compile(`- [G @shared] Shared.\n- [C @target] Target.\n  - [G; @base] Ground.\n    - [${mark} supports @target; @failed] Mixed selection.`);
    expect(codes(graph)).toEqual(["LOCAL_SELECTOR_WITH_EXPLICIT_CLAUSE"]);
    expect(graph.bearings).toHaveLength(1);
  });

  it.each(kinds)("treats an attached %s clause as independent of local joint sources", kind => {
    const { graph, explain } = compile(`- [O @target] Explicit target.\n- [C @outer] Joint target.\n  - [_ G; @joint]\n    - [. @source] Joint source.\n    - [Q @question ${kind} @target; @independent] Independent question.`);
    expect(codes(graph)).toEqual([]);
    expect(graph.bearings).toHaveLength(2);
    expect(graph.bearings[0].sources).toEqual([{ kind: "point", key: graph.points[2].key }]);
    expect(graph.bearings[1].sources).toEqual([{ kind: "point", key: graph.points[3].key }]);
    expect(explain.entries[4].effects).toContainEqual({
      kind: "localBearingMember", localBearingSpan: explain.entries[2].sourceSpan, eligible: false, function: "independent"
    });
  });

  it("inventories written use operands and named targets without treating self as a written source", () => {
    const result = analyzeSourceReferences("- [O @target] Objection.\n- [Q @question respondsTo @target; @reply] Which scale?\n- [. use @question clarifies @target]");
    expect(result.diagnostics).toEqual([]);
    const names = result.references.units[0];
    expect(names.find(name => name.name === "question")?.references.map(ref => ref.kind)).toEqual(["point-use"]);
    expect(names.find(name => name.name === "target")?.references.map(ref => ref.kind)).toEqual(["target", "target"]);
  });
});
