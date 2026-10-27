import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, parseDocument, previewExplicitTarget } from "./index.js";

const compile = (text: string) => compileGraphWithExplain(parseDocument(text));
const errors = (text: string) => compile(text).graph.diagnostics.filter(d => d.severity === "error").map(d => d.code);

describe("0.6 authoring boundaries", () => {
  it.each([
    ["G", "supports"], ["O", "challenges"], ["R", "repliesTo"], ["D", "clarifies"]
  ].flatMap(([role, kind]) => [".", "Q", "C", "G", "O", "R", "D"].map(parent => [role, kind, parent])))(
    "keeps the %s / %s route to a %s parent through ordinary use, singleton construction and explicit endpoints",
    (role, kind, parent) => {
    const declarations = `- [. @source] Source.\n- [${parent} @target] Target.`;
    const forms = [
      `- [${parent} use @target]\n  - [${role} use @source; @route]`,
      `- [${parent} use @target]\n  - [_ ${role}; @route]\n    - [. use @source]`,
      `- [_ @source ${kind} @target; @route]`
    ];
    for (const form of forms) {
      const { graph } = compile(`${declarations}\n${form}`);
      expect(graph.diagnostics).toEqual([]);
      expect(graph.points.map(point => point.declaration)).toEqual([
        { form: "material" }, parent === "." ? { form: "material" } : { form: "role", role: parent }
      ]);
      expect(graph.bearings).toEqual([expect.objectContaining({
        kind,
        handle: "route",
        sources: [{ kind: "point", key: graph.points[0].key }],
        target: { kind: "point", key: graph.points[1].key }
      })]);
    }
  });

  it.each([
    ["_ @reason +> @claim", ". @aside", "EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET"],
    ["_ @reason +> @claim", ". use @reason", "EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET"],
    ["_ use @route", ". @aside", "BEARING_USE_REQUIRES_EXPLICIT_TARGET"],
    ["_ use @route", ". use @reason", "BEARING_USE_REQUIRES_EXPLICIT_TARGET"]
  ])("requires an explicit connection for [%s] > [%s] without discarding the Point's own subtree", (context, pointHeader, code) => {
    const { graph } = compile(`- [C @claim] Claim.
  - [G @reason; @route] Reason.
- [${context}]
  - Presentation context.
    - [${pointHeader}] Neutral material.
      - [G @detail] A reason for that material.`);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual([code]);
    expect(graph.diagnostics[0].message).toContain("including a neutral declaration or use");
    expect(graph.bearings).toHaveLength(context.includes("use") ? 2 : 3);
    const targetId = pointHeader.includes("use") ? "reason" : "aside";
    expect(graph.bearings.at(-1)).toMatchObject({
      kind: "supports",
      sources: [{ kind: "point", key: graph.points.find(point => point.id === "detail")!.key }],
      target: { kind: "point", key: graph.points.find(point => point.id === targetId)!.key }
    });
  });

  it.each(["G", "O", "R", "D"])("%s linked with one source carries no unfinishedness advice", role => {
    const source = `- [O @target] Target.\n  - [_ ${role}; @route]\n    - [. @source] Source.`;
    for (const suffix of ["", "\n    - [_ note] Detail about this step.\n    - [O/] This step assumes a stable context."]) {
      const { graph } = compile(source + suffix);
      expect(graph.diagnostics).toEqual([]);
      expect(graph.bearings[0].sources).toEqual([{ kind: "point", key: graph.points[1].key }]);
      expect(graph.bearings[0].text).toBeUndefined();
      expect(graph.points).toHaveLength(suffix ? 3 : 2);
      expect(graph.bearings).toHaveLength(suffix ? 2 : 1);
      if (suffix) {
        expect(graph.bearings[1].target).toEqual({ kind: "bearing", key: graph.bearings[0].key });
      }
    }
  });

  it.each([["G", "C", "supports"], ["O", "C", "challenges"], ["R", "O", "repliesTo"], ["D", ".", "clarifies"]])(
    "%s linked beneath %s constructs one %s joint from neutral members",
    (role, parent, kind) => {
      const source = `- [${parent} @target] Target.
  - [_ ${role}; @joint] Route description.
    - [point @a] First.
      - [O] Doubt about the first source.
    - [node @b] Second.
    - [_ note] Route note.
    - [O/] Doubt about the joint.`;
      const {graph, explain} = compile(source);
      expect(graph.diagnostics).toEqual([]);
      expect(graph.points).toHaveLength(5);
      expect(graph.points.slice(1, 4).filter(p => p.id).map(p => p.declaration.form)).toEqual(["material", "material"]);
      expect(graph.bearings.map(b => b.kind)).toEqual([kind, "challenges", "challenges"]);
      expect(graph.bearings[0]).toMatchObject({handle:"joint", text:"Route description.", sources:[{key:graph.points[1].key,kind:"point"},{key:graph.points[3].key,kind:"point"}]});
      expect(graph.bearings[1].target.key).toBe(graph.points[1].key);
      expect(graph.bearings[2].target).toEqual({kind:"bearing",key:graph.bearings[0].key});
      expect(explain.entries[1].recognition).toEqual({kind:"localBearing",role});
      expect(graph.notes).toHaveLength(2);
    }
  );

  it("replies to the nearest Point without requiring an O mark or falling back to an outer O", () => {
    for (const source of [
      "- [C @p] Material.\n- [O use @p]\n  - [_ R]\n    - [. @a] Reply.",
      "- [O @p] Material.\n- [. use @p]\n  - [_ R]\n    - [. @a] Reply.",
      "- [O] Outer.\n  - [C @p] Inner.\n    - [_ R]\n      - [. @a] Reply."
    ]) {
      const { graph } = compile(source);
      expect(graph.diagnostics).toEqual([]);
      expect(graph.bearings).toHaveLength(1);
      expect(graph.bearings[0]).toMatchObject({
        kind: "repliesTo",
        target: { kind: "point", key: graph.points.find(point => point.id === "p")!.key }
      });
    }
  });

  it.each(["[linked]", "[linked; @old]", "[_ C]", "[_ Q]", "[G/ linked]", "[O/ linked]"])(
    "does not turn failed %s into a Point or independent source attachments", header => {
      const {graph} = compile(`- [C @outer] Outer.\n  - ${header}\n    - [. @a] First.\n      - [O] Source objection.\n    - [. @b] Second.`);
      expect(graph.diagnostics.some(d => d.severity === "error")).toBe(true);
      expect(graph.points).toHaveLength(4);
      expect(graph.bearings.map(b => b.kind)).toEqual(["challenges"]);
      expect(graph.bearings[0].target.key).toBe(graph.points[1].key);
    }
  );

  it.each(["[G @a]", "[G use @declared]", "[. use @missing]"])("rejects a joint atomically for %s", member => {
    const {graph} = compile(`- [. @declared] Declared.\n- [C @c] Claim.\n  - [_ O; @joint]\n    - ${member} First.\n    - [. @b] Second.\n- [O /> @joint] Objection.`);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics.some(d => d.severity === "error")).toBe(true);
  });

  it.each(["Q", "C", "G", "O", "R", "D", "."])("Q, C and neutral children under %s retain organization without attachments", mark => {
    const {graph, explain} = compile(`- [${mark} @parent] Parent.\n  - [Q @q] Question?\n    - [C @answer] Seconds.\n    - [. @context] Background.`);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.points).toHaveLength(4);
    expect(graph.bearings).toEqual([]);
    expect(explain.entries.flatMap(entry => entry.effects.filter(effect => effect.kind === "implicitAttachment"))).toEqual([]);
  });

  it("keeps Q uses local and explicit overrides singular, with a source-preserving preview", () => {
    const source = "- [C @p] Parent.\n- [C @q] Reused as inquiry.\n- [. use @p]\n  - [Q use @q]";
    const {graph} = compile(source);
    expect(graph.bearings).toEqual([]);
    expect(graph.points[1].declaration).toEqual({form:"role",role:"C"});
    expect(compile(source.replace("[Q use @q]", "[Q use @q +> @p]")).graph.bearings.map(b=>b.kind)).toEqual(["supports"]);
    expect(previewExplicitTarget(source, {line:4})).toMatchObject({status:"unavailable", reason:"no-attachment"});
    expect(compile(source.replace("[Q use @q]", "[Q use @q concerns @p]")).graph.bearings.map(b=>b.kind)).toEqual(["concerns"]);
  });

  it("keeps body transparent, notes literal, and Bearing contexts bounded for Q", () => {
    const {graph} = compile("- [C @c] Claim.\n  - Body\n    - [Q] Question?\n  - [note]\n    - [Q] Literal?\n- [_ @c +> @c; @r]\n  - [Q] No Point context?");
    expect(graph.bearings.map(b => b.kind)).toEqual(["supports"]);
    expect(graph.points).toHaveLength(3);
    expect(graph.diagnostics.map(d=>d.code)).toEqual(["EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET"]);
  });

  it.each(["->", "/>"])("retains %s's typed Bearing target through JSON", op => {
    const ast = parseDocument(`- [. @a] Source.\n- [. @b] Target.\n- [_ @a +> @b; @r]\n- [O ${op} @r] Objection.`);
    const clause = ast.blocks[3].annotation;
    expect(clause).toMatchObject({operatorClause:{op:"challenges",targetKind:op==="/>"?"bearing":"either"}});
    const {graph}=compileGraphWithExplain(JSON.parse(JSON.stringify(ast)));
    expect(graph.diagnostics).toEqual([]);
    expect(graph.bearings[1].target).toEqual({kind:"bearing",key:graph.bearings[0].key});
    expect(errors("- [. @p] Point.\n- [O /> @p] Bad target.")).toContain("CHALLENGE_REQUIRES_BEARING_TARGET");
  });

  it.each(["?", "? @gap", "? ~> @outer", "? use @outer", "?/"])("retires %s without leaking a Point or outer attachment", mark => {
    const {graph} = compile(`- [C @outer] Outer.\n  - [${mark}] Missing material.\n    - [G] Child.`);
    expect(graph.points).toHaveLength(2);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics.map(d=>d.code)).toEqual(["RETIRED_GAP_ANNOTATION","FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET"]);
  });

  it.each(["_", "edge", "bearing"])("retires named about for %s while preserving the failed boundary", family => {
    const {graph} = compile(`- [. @a] Source.\n- [C @c] Claim.\n  - [${family} @a about @c; @r]\n    - [G] Child.\n- [O /> @r] Dependent.`);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics.map(d=>d.code)).toEqual(expect.arrayContaining(["RETIRED_BEARING_KIND","EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET","UNKNOWN_TARGET"]));
  });

  it("keeps a question reply and a joint answer explicit without relabelling their Points", () => {
    const {graph}=compile("- [Q @q] Who did what?\n- [Q @followup] Which project?\n- [. @a] A collected samples.\n- [. @b] B calibrated the instrument.\n- [_ @followup repliesTo @q]\n- [_ @a, @b answers @q]");
    expect(graph.diagnostics).toEqual([]);
    expect(graph.bearings.map(b=>b.kind)).toEqual(["repliesTo","answers"]);
    expect(graph.points.map(p=>p.declaration.role)).toEqual(["Q","Q",undefined,undefined]);
  });
});
