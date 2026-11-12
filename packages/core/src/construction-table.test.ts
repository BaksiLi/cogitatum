import { describe, expect, it } from "vitest";
import { explainSource, formatExplain } from "./index.js";
import type { ExplainEffect } from "./types.js";

/**
 * The 0.7 construction table: for a mark, its context and any clause, exactly
 * one outcome — the relation constructed (possibly none), the occurrence's
 * framing and any diagnostic. Tokens and position alone select a cell.
 */
function outcome(source: string, line: number) {
  const compiled = explainSource(source);
  const graph = compiled.graphs[0];
  const entry = compiled.explanations[0].entries.find(e => e.sourceSpan.startLine === line)!;
  const effect = <K extends ExplainEffect["kind"]>(kind: K) => entry.effects.find((e): e is Extract<ExplainEffect, { kind: K }> => e.kind === kind);
  const emitted = effect("emitBearing");
  const name = (key: string) => graph.points.find(p => p.key === key)?.id ?? graph.bearings.find(b => b.key === key)?.handle ?? key;
  const frame = effect("frameOccurrence");
  return {
    relation: emitted ? `${emitted.bearing.kind}(${emitted.bearing.sources.map(s => name(s.key)).join(",")} → ${name(emitted.bearing.target.key)})` : undefined,
    framing: frame && frame.framing + (frame.framing === "unbound" ? ":" + frame.intention : ""),
    focus: frame?.focus,
    codes: entry.diagnosticCodes,
    bearings: graph.bearings.length,
    severities: [...new Set(compiled.diagnostics.map(d => d.severity))]
  };
}

const FOCUSES = {
  "a Question declaration": { head: "- [Q @f] 應延期嗎？", question: true },
  "a Question use": { head: "- [C @f] 預算已用盡。\n- [Q use @f] 這算理由嗎？", question: true },
  "a neutral use of a Point declared Q": { head: "- [Q @f] 應延期嗎？\n- [. use @f]", question: false },
  "a Claim declaration": { head: "- [C @f] 應延後採用。", question: false },
  "a neutral declaration": { head: "- [. @f] 背景材料。", question: false },
  "a Ground use of a Point declared Q": { head: "- [Q @f] 應延期嗎？\n- [C @c] 是。\n  - [G use @f]", question: false }
} as const;

const DEFAULTS = [
  // mark, beneath a Question focus, beneath any other Point focus
  [".", "concerns", "concerns"],
  ["C", "answers", "concerns"],
  ["G", "concerns", "supports"],
  ["O", "challenges", "challenges"],
  ["Q", "concerns", "concerns"],
  ["R", "respondsTo", "respondsTo"],
  ["D", "interprets", "interprets"]
] as const;

describe("default relation of a marked occurrence beneath a Point focus", () => {
  for (const [label, { head, question }] of Object.entries(FOCUSES)) {
    const lines = head.split("\n");
    const indent = /^ */.exec(lines[lines.length - 1])![0] + "  ";
    it.each(DEFAULTS)(`[%s] beneath ${label}`, (mark, underQuestion, otherwise) => {
      const kind = question ? underQuestion : otherwise;
      const unbound = mark === "G" && question;
      for (const header of [`${mark} @x`, mark]) {
        const result = outcome(`${head}\n${indent}- [${header}] 成本超出預算。`, lines.length + 1);
        expect(result.relation).toBe(`${kind}(${header.includes("@x") ? "x" : result.relation!.split("(")[1].split(" ")[0]} → f)`);
        expect(result.framing).toBe(unbound ? "unbound:supports" : "aligned");
        expect(result.focus).toBe(question ? "question" : "point");
        expect(result.codes).toEqual(unbound ? ["UNBOUND_GROUND_UNDER_QUESTION"] : []);
      }
    });
    it.each(DEFAULTS)(`[%s use @p] beneath ${label} follows its own mark, not @p's declaration`, (mark, underQuestion, otherwise) => {
      const result = outcome(`- [Q @p] 另一個問題。\n${head}\n${indent}- [${mark} use @p]`, lines.length + 2);
      expect(result.relation).toBe(`${question ? underQuestion : otherwise}(p → f)`);
    });
  }
});

describe("root occurrences have no default attachment", () => {
  it.each([[".", "none"], ["C", "none"], ["Q", "none"], ["G", "unbound:supports"], ["O", "unbound:challenges"], ["R", "unbound:respondsTo"], ["D", "unbound:interprets"]])(
    "[%s] at root constructs nothing; framing %s", (mark, framing) => {
      const result = outcome(`- [${mark} @cost] 成本超出預算。`, 1);
      expect(result).toMatchObject({ relation: undefined, framing, focus: undefined, codes: [], bearings: 0 });
    });

  it("lets an explicit clause work at root", () => {
    const result = outcome("- [C @delay] 應延後採用。\n- [G @cost +> @delay] 成本超出預算。", 2);
    expect(result).toMatchObject({ relation: "supports(cost → delay)", framing: "aligned", codes: [] });
  });

  it("an unbound root use keeps an objection intention without inventing a target", () => {
    const result = outcome("- [C @delay] 應延後採用。\n- [G @cost +> @delay] 成本超出預算。\n- [O use @cost]", 3);
    expect(result).toMatchObject({ relation: undefined, framing: "unbound:challenges", codes: [], bearings: 1 });
  });
});

describe("a valid clause replaces the default and alone constructs", () => {
  const under = (focus: string, header: string) => outcome(`- [${focus} @f] 焦點。\n- [C @other] 另一點。\n- [. use @f]\n  - [${header}] 內容。`, 4);
  // The third root line re-presents @f neutrally; use the declaration focus instead where the mark matters.
  const beneath = (focus: string, header: string) => outcome(`- [C @other] 另一點。\n- [${focus} @f] 焦點。\n  - [${header}] 內容。`, 3);

  it.each([
    ["G +> @other", "supports(x → other)", "aligned"],
    ["O -> @other", "challenges(x → other)", "aligned"],
    ["Q ~> @other", "concerns(x → other)", "aligned"],
    ["R respondsTo @other", "respondsTo(x → other)", "aligned"],
    ["D interprets @other", "interprets(x → other)", "aligned"],
    ["C +> @other", "supports(x → other)", "compatible"],
    [". ~> @other", "concerns(x → other)", "compatible"],
    ["Q respondsTo @other", "respondsTo(x → other)", "compatible"],
    ["R -> @other", "challenges(x → other)", "compatible"],
    ["D -> @other", "challenges(x → other)", "compatible"],
    ["G ~> @other", "concerns(x → other)", "compatible"],
    ["G -> @other", "challenges(x → other)", "opposed"],
    ["O +> @other", "supports(x → other)", "opposed"]
  ])("[%s] constructs only %s (%s)", (header, relation, framing) => {
    const withName = header.replace(/^(\S+)/, "$1 @x");
    for (const focus of ["C", "Q"]) {
      const result = beneath(focus, withName);
      expect(result.relation).toBe(relation);
      expect(result.framing).toBe(framing);
      expect(result.focus).toBeUndefined();
      expect(result.bearings).toBe(1);
      expect(result.codes).toEqual(framing === "opposed" ? ["OPPOSED_FRAMING"] : []);
    }
    expect(under("Q", withName).bearings).toBe(1);
  });

  it("supports the Question explicitly and silently with [G +> ^]", () => {
    expect(beneath("Q", "G @x +> ^")).toMatchObject({ relation: "supports(x → f)", framing: "aligned", codes: [] });
    expect(beneath("Q", "G @x +> @f")).toMatchObject({ relation: "supports(x → f)", framing: "aligned", codes: [] });
  });

  it("never falls back to a default when the clause fails", () => {
    for (const header of ["G +> @missing", "C answers", ". ~>", "G clarifies ^"]) {
      const result = beneath("Q", header);
      expect(result).toMatchObject({ relation: undefined, framing: undefined, bearings: 0 });
      expect(result.severities).toContain("error");
    }
  });
});

describe("opposed framing", () => {
  const source = "- [C @delay] 應延後採用。\n- [O @cost +> @delay] 成本超出預算。";

  it("constructs exactly the written support and advises without claiming contradiction", () => {
    const compiled = explainSource(source);
    expect(compiled.graphs[0].bearings).toHaveLength(1);
    expect(compiled.graphs[0].bearings[0]).toMatchObject({ kind: "supports", derivedBy: "operator" });
    expect(compiled.diagnostics).toEqual([expect.objectContaining({ severity: "suggestion", code: "OPPOSED_FRAMING" })]);
    expect(compiled.diagnostics[0].explanation).toContain("[O use @cost] at root");
    expect(formatExplain(compiled)).toContain("Presented as Objection; the clause alone constructs the relation (opposed framing).");
  });

  it.each([
    ["re-marked G", "- [C @delay] 應延後採用。\n- [G @cost +> @delay] 成本超出預算。"],
    ["re-marked neutral", "- [C @delay] 應延後採用。\n- [. @cost +> @delay] 成本超出預算。"],
    ["split with a root objection use", "- [C @delay] 應延後採用。\n- [G @cost +> @delay] 成本超出預算。\n- [O use @cost]"]
  ])("is repaired without changing the graph when %s", (_label, repaired) => {
    const strip = (text: string) => explainSource(text).graphs[0].bearings.map(({ sourceSpan: _span, ...bearing }) => bearing);
    expect(strip(repaired)).toEqual(strip(source));
    expect(explainSource(repaired).diagnostics).toEqual([]);
  });

  it("near miss: an objection use nested beneath a Point constructs a challenge", () => {
    const nested = "- [C @delay] 應延後採用。\n  - [O use @cost]\n- [G @cost +> @delay] 成本超出預算。";
    expect(outcome(nested, 2).relation).toBe("challenges(cost → delay)");
  });
});

describe("focus lookup", () => {
  it("a nearer Point blocks an outer Question", () => {
    const source = "- [Q @q] 應延期嗎？\n  - [. @bg] 去年的決議。\n    - [C @c] 預算已用盡。\n    - [G @g] 帳目如此。";
    expect(outcome(source, 3).relation).toBe("concerns(c → bg)");
    expect(outcome(source, 4)).toMatchObject({ relation: "supports(g → bg)", framing: "aligned", codes: [] });
  });

  it("a nested Question concerns the nearer focus and becomes the focus for its own children", () => {
    const source = "- [C @c] 應延後。\n  - [Q @q] 延到何時？\n    - [C @a] 下一季。";
    expect(outcome(source, 2).relation).toBe("concerns(q → c)");
    expect(outcome(source, 3).relation).toBe("answers(a → q)");
  });

  it("ordinary body is transparent: an answer across it is advised, weak relevance is not", () => {
    const source = "- [Q @q] 應延期嗎？\n  - 備忘\n    - [C @a] 是。\n    - [. @bg] 背景。\n    - [G @g] 預算已用盡。\n    - [O @o] 問題預設了可以延期。";
    expect(outcome(source, 3)).toMatchObject({ relation: "answers(a → q)", codes: ["IMPLICIT_ATTACHMENT_THROUGH_BODY"] });
    expect(outcome(source, 4)).toMatchObject({ relation: "concerns(bg → q)", codes: [] });
    expect(outcome(source, 5)).toMatchObject({ relation: "concerns(g → q)", codes: ["UNBOUND_GROUND_UNDER_QUESTION"] });
    expect(outcome(source, 6)).toMatchObject({ relation: "challenges(o → q)", codes: ["IMPLICIT_ATTACHMENT_THROUGH_BODY"] });
  });

  it("notes stay literal: a marked line inside a note constructs nothing", () => {
    const compiled = explainSource("- [Q @q] 應延期嗎？\n  - [note] 編者按\n    - [C] 是。");
    expect(compiled.graphs[0]).toMatchObject({ points: [{ id: "q" }], bearings: [] });
  });

  it("two neutral siblings record two independent relevance Bearings", () => {
    const source = "- [. @x] 標題。\n  - [. @a] 甲。\n  - [. @b] 乙。";
    expect(outcome(source, 2).relation).toBe("concerns(a → x)");
    expect(outcome(source, 3).relation).toBe("concerns(b → x)");
  });

  it("detachment is positional: an outdent may only rebind", () => {
    const nested = "- [C @outer] 外層。\n  - [C @inner] 內層。\n    - [. @m] 材料。";
    const outdented = "- [C @outer] 外層。\n  - [C @inner] 內層。\n  - [. @m] 材料。";
    const detached = "- [C @outer] 外層。\n  - [C @inner] 內層。\n- [. @m] 材料。";
    expect(outcome(nested, 3).relation).toBe("concerns(m → inner)");
    expect(outcome(outdented, 3).relation).toBe("concerns(m → outer)");
    expect(outcome(detached, 3)).toMatchObject({ relation: undefined, framing: "none" });
  });
});

describe("Bearing contexts and constructor members keep their own rules", () => {
  it("direct neutral members are sources of one joint Bearing, without relevance edges", () => {
    const source = "- [Q @q] 應延期嗎？\n  - [_ answers ^]\n    - [. @a] 延到下一季。\n    - [. @b] 並重估預算。";
    const compiled = explainSource(source);
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.graphs[0].bearings).toHaveLength(1);
    expect(compiled.graphs[0].bearings[0]).toMatchObject({ kind: "answers", sources: [{ kind: "point" }, { kind: "point" }] });
    expect(outcome(source, 3)).toMatchObject({ relation: undefined, framing: "none" });
  });

  it.each([".", "C", "G"])("the first [%s] beneath a listed-source constructor still needs an explicit target", mark => {
    const source = `- [C @a] 甲。\n- [C @b] 乙。\n- [_ @a +> @b]\n  - [${mark}] 評論。`;
    expect(outcome(source, 4)).toMatchObject({ relation: undefined, framing: undefined, codes: ["EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET"], bearings: 1 });
  });

  it("selectors address the exposed Bearing whatever the focus mark", () => {
    const source = "- [C @c] 應延後。\n  - [Q @q] 延到何時？\n    - [G/ @why] 因為這個問題取決於預算週期。";
    expect(outcome(source, 3)).toMatchObject({ framing: "aligned", focus: undefined, codes: [] });
    expect(outcome(source, 3).relation).toMatch(/^supports\(why → _b\d+\)$/);
  });

  it("children of a Point established inside a Bearing context follow the table", () => {
    const source = "- [C @a] 甲。\n- [C @b] 乙。\n- [_ @a +> @b; @route]\n  - [Q/ @q] 這一步成立嗎？\n    - [C @yes] 成立。";
    expect(outcome(source, 5).relation).toBe("answers(yes → q)");
  });
});

describe("candidate answers and their reasons", () => {
  it("Q > C > G/O keeps the answer, its reason and its objection distinct", () => {
    const source = "- [Q @choice] 我們應否採用這個方案？\n  - [C @adopt] 應採用這個方案。\n    - [G @saving] 它能降低成本。\n    - [O @risk] 它會增加維護風險。";
    const compiled = explainSource(source);
    expect(compiled.diagnostics).toEqual([]);
    expect([2, 3, 4].map(line => outcome(source, line).relation)).toEqual(["answers(adopt → choice)", "supports(saving → adopt)", "challenges(risk → adopt)"]);
  });

  it("an indirect candidate answer is recorded without inserting a conclusion", () => {
    const compiled = explainSource("- [Q] 應延期嗎？\n  - [C] 預算已用盡。");
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.graphs[0].points).toHaveLength(2);
    expect(compiled.graphs[0].bearings.map(b => b.kind)).toEqual(["answers"]);
  });

  it("a Ground directly beneath a Question records relevance, names its completions and invents no answer", () => {
    const compiled = explainSource("- [Q @q] 應延期嗎？\n  - [G @g] 預算已用盡。");
    expect(compiled.graphs[0].points).toHaveLength(2);
    expect(compiled.graphs[0].bearings.map(b => b.kind)).toEqual(["concerns"]);
    expect(compiled.diagnostics).toEqual([expect.objectContaining({ severity: "suggestion", code: "UNBOUND_GROUND_UNDER_QUESTION" })]);
    expect(compiled.diagnostics[0].explanation).toContain("[G @g +> ^]");
    expect(formatExplain(compiled)).toContain("Presented as Ground; supports target unstated. The placement records relevance only.");
  });
});
