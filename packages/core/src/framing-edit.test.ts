import { describe, expect, it } from "vitest";
import { analyzeSourceEdits, explainSource, previewFramingEdit, previewRelationEdit } from "./index.js";

const opposed = "- [C @delay] 應延後採用。\n- [O @cost +> @delay] 成本超出預算。\n";
const bearings = (source: string) => explainSource(source).graphs[0].bearings.map(({ sourceSpan: _span, ...bearing }) => bearing);

describe("graph-preserving repairs of an opposed framing", () => {
  it.each([
    ["G", "- [C @delay] 應延後採用。\n- [G @cost +> @delay] 成本超出預算。\n", "aligned"],
    [".", "- [C @delay] 應延後採用。\n- [. @cost +> @delay] 成本超出預算。\n", "compatible"]
  ] as const)("re-marks as %s, keeping the clause and every relation", (mark, proposedSource, framing) => {
    const preview = previewFramingEdit(opposed, { operation: "remark", line: 2, mark });
    expect(preview).toMatchObject({ status: "ready", proposedSource, proposedDiagnostics: [], declarationChanged: true, framing: { before: { framing: "opposed" }, after: { framing } } });
    expect(preview.status === "ready" && preview.edit).toEqual({ offset: opposed.indexOf("[O") + 1, remove: "O", insert: mark });
    expect(bearings(proposedSource)).toEqual(bearings(opposed));
  });

  it("splits: the support stays in place and the objection intention becomes an unbound root use", () => {
    const preview = previewFramingEdit(opposed, { operation: "split", line: 2 });
    expect(preview).toMatchObject({
      status: "ready", addedLine: 3, proposedDiagnostics: [],
      proposedSource: "- [C @delay] 應延後採用。\n- [G @cost +> @delay] 成本超出預算。\n- [O use @cost]\n"
    });
    expect(bearings((preview as { proposedSource: string }).proposedSource)).toEqual(bearings(opposed));
  });

  it("adds the split use after the enclosing root block, never beneath a Point", () => {
    const nested = "- [C @delay] 應延後採用。\n  - [O @cost +> @delay] 成本超出預算。\n    - [G @bill] 帳單為證。\n- [C @next] 下一點。";
    const preview = previewFramingEdit(nested, { operation: "split", line: 2 });
    expect(preview).toMatchObject({
      status: "ready", addedLine: 4,
      proposedSource: "- [C @delay] 應延後採用。\n  - [G @cost +> @delay] 成本超出預算。\n    - [G @bill] 帳單為證。\n- [O use @cost]\n- [C @next] 下一點。"
    });
  });

  it("splits a source without a final newline and inside a host fence", () => {
    expect(previewFramingEdit(opposed.trimEnd(), { operation: "split", line: 2 })).toMatchObject({ proposedSource: opposed.trimEnd().replace("[O", "[G") + "\n- [O use @cost]" });
    const host = "Prose.\n\n```cog\n" + opposed + "```\nMore prose.\n";
    expect(previewFramingEdit(host, { operation: "split", line: 5, mode: "host" })).toMatchObject({
      status: "ready", addedLine: 6, proposedSource: "Prose.\n\n```cog\n" + opposed.replace("[O", "[G") + "- [O use @cost]\n```\nMore prose.\n"
    });
  });

  it("splits a G whose clause challenges, and an opposed use", () => {
    expect(previewFramingEdit("- [C @c] 主張。\n- [G @x -> @c] 其實是反對。", { operation: "split", line: 2 }))
      .toMatchObject({ proposedSource: "- [C @c] 主張。\n- [O @x -> @c] 其實是反對。\n- [G use @x]" });
    expect(previewFramingEdit("- [C @c] 主張。\n- [. @x] 材料。\n- [O use @x +> @c]", { operation: "split", line: 3 }))
      .toMatchObject({ status: "ready", declarationChanged: false, proposedSource: "- [C @c] 主張。\n- [. @x] 材料。\n- [G use @x +> @c]\n- [O use @x]" });
  });

  it.each([
    ["an unnamed Point", "- [C @c] 主張。\n- [O +> @c] 沒有名字。", "unnamed-point"],
    ["an aligned occurrence", "- [C @c] 主張。\n- [G @x +> @c] 理由。", "not-opposed"],
    ["a default relation", "- [C @c] 主張。\n  - [O @x] 反對。", "not-opposed"]
  ])("does not split %s", (_label, source, reason) => {
    expect(previewFramingEdit(source, { operation: "split", line: 2 })).toMatchObject({ status: "unavailable", reason });
  });
});

describe("re-marking never changes a relation", () => {
  it.each([
    ["a default support to neutral", "- [C @c] 主張。\n  - [G @x] 理由。", ".", "concerns in place of supports"],
    ["a default support to an objection", "- [C @c] 主張。\n  - [G @x] 理由。", "O", "challenges in place of supports"],
    ["a candidate answer to a Ground", "- [Q @q] 問題？\n  - [C @x] 回答。", "G", "concerns in place of answers"],
    ["a root Ground into no change of relation but a selector", "- [C @c] 主張。\n  - [G @g] 理由。\n    - [O/ @x] 反對這一步。", "G", "supports in place of challenges"]
  ] as const)("refuses %s", (_label, source, mark, detail) => {
    const preview = previewFramingEdit(source, { operation: "remark", line: source.split("\n").length, mark });
    expect(preview).toMatchObject({ status: "unavailable", reason: "changes-relation", message: expect.stringContaining(detail) });
  });

  it("re-marks freely where the clause states the relation, on declarations and uses", () => {
    expect(previewFramingEdit("- [C @c] 主張。\n- [R @x -> @c] 回應並反駁。", { operation: "remark", line: 2, mark: "O" }))
      .toMatchObject({ status: "ready", framing: { before: { framing: "compatible" }, after: { framing: "aligned" } }, proposedSource: "- [C @c] 主張。\n- [O @x -> @c] 回應並反駁。" });
    expect(previewFramingEdit("- [C @c] 主張。\n- [. @x] 材料。\n- [. use @x +> @c; @r]", { operation: "remark", line: 3, mark: "G" }))
      .toMatchObject({ status: "ready", declarationChanged: false, proposedSource: "- [C @c] 主張。\n- [. @x] 材料。\n- [G use @x +> @c; @r]" });
    expect(previewFramingEdit("- [C @c] 主張。\n- [point @x +> @c] 材料。", { operation: "remark", line: 2, mark: "G" }))
      .toMatchObject({ status: "ready", proposedSource: "- [C @c] 主張。\n- [G @x +> @c] 材料。" });
  });

  it("re-marks a root occurrence, changing only its unbound intention", () => {
    expect(previewFramingEdit("- [O @cost] 成本超出預算。", { operation: "remark", line: 1, mark: "." }))
      .toMatchObject({ status: "ready", framing: { before: { framing: "unbound", intention: "challenges" }, after: { framing: "none" } } });
  });

  it.each([
    ["the same mark", { operation: "remark", line: 2, mark: "O" }, "unchanged"],
    ["a body line", { operation: "remark", line: 3, mark: "G" }, "no-occurrence"],
    ["an unknown mark", { operation: "remark", line: 2, mark: "X" }, "invalid-operation"],
    ["a selector that the new mark lacks", { operation: "remark", line: 5, mark: "." }, "preservation-failed"]
  ] as const)("is unavailable for %s", (_label, edit, reason) => {
    const source = opposed + "- 普通正文\n- [C @c] 主張。\n  - [O/ @y] 沒有步驟可反對。".replace("  - [O/ @y] 沒有步驟可反對。", "  - [G @g] 理由。");
    const withSelector = "- [C @delay] 應延後採用。\n- [O @cost +> @delay] 成本超出預算。\n- 普通正文\n- [C @c] 主張。\n  - [G @g] 理由。\n    - [O/ @y] 反對。";
    const target = reason === "preservation-failed" ? { ...edit, line: 6 } : edit;
    expect(previewFramingEdit(reason === "preservation-failed" ? withSelector : source, target as never)).toMatchObject({ status: "unavailable", reason });
  });

  it("requires an error-free source and is offered through the shared analysis", () => {
    expect(previewFramingEdit("- [O @x +> @missing] 壞的。", { operation: "remark", line: 1, mark: "G" })).toMatchObject({ status: "unavailable", reason: "source-errors" });
    const analysis = analyzeSourceEdits(opposed);
    expect(analysis.preview({ kind: "framing", edit: { operation: "split", line: 2 } })).toMatchObject({ status: "ready", addedLine: 3 });
  });
});

describe("near misses the previews make visible", () => {
  it("an objection use nested beneath a Point is a challenge, not the split repair", () => {
    const nested = "- [C @delay] 應延後採用。\n  - [O use @cost]\n- [G @cost +> @delay] 成本超出預算。";
    expect(bearings(nested).map(b => b.kind)).toEqual(["challenges", "supports"]);
  });

  it("re-marking an explicit support does not weaken it; a default support does", () => {
    const explicit = previewFramingEdit("- [C @c] 主張。\n  - [G @x +> ^] 理由。", { operation: "remark", line: 2, mark: "." });
    expect(explicit).toMatchObject({ status: "ready", proposedSource: "- [C @c] 主張。\n  - [. @x +> ^] 理由。" });
    const weakened = previewRelationEdit("- [C @c] 主張。\n  - [G @x] 理由。", { operation: "decide", line: 2, kind: "concerns" });
    expect(weakened).toMatchObject({ status: "ready", proposedSource: "- [C @c] 主張。\n  - [. @x] 理由。", comparison: { relation: "weakening" } });
  });
});

describe("selected target correction", () => {
  const source = "- [Q @q] 應延期嗎？\n  - [C @a] 應延期。\n  - [G @g] 預算已用盡。\n";

  it("binds an unbound Ground to the selected answer and reports what it retracts and adds", () => {
    const preview = previewRelationEdit(source, { operation: "retarget", line: 3, target: { id: "a" } });
    expect(preview).toMatchObject({
      status: "ready", proposedDiagnostics: [],
      proposedSource: "- [Q @q] 應延期嗎？\n  - [C @a] 應延期。\n  - [G @g +> @a] 預算已用盡。\n",
      comparison: { relation: "revision", retracted: [{ kind: "concerns" }], added: [{ kind: "supports" }] }
    });
  });

  it("keeps kind, sources and outline position, abbreviating only where the mark states the relation", () => {
    const named = "- [C @c] 主張。\n- [C @d] 另一主張。\n  - [G @x +> @c; @r] 理由。";
    expect(previewRelationEdit(named, { operation: "retarget", line: 3, target: { local: "point" } }))
      .toMatchObject({ status: "ready", proposedSource: "- [C @c] 主張。\n- [C @d] 另一主張。\n  - [G @x; @r] 理由。", comparison: { relation: "revision" } });
    const constructor = "- [C @c] 主張。\n- [C @d] 另一主張。\n- [. @a] 甲。\n- [_ @a +> @c]";
    expect(previewRelationEdit(constructor, { operation: "retarget", line: 4, target: { id: "d" } }))
      .toMatchObject({ status: "ready", proposedSource: "- [C @c] 主張。\n- [C @d] 另一主張。\n- [. @a] 甲。\n- [_ @a +> @d]" });
  });

  it.each([
    ["an unknown target", { id: "missing" }, "invalid-result"],
    ["the same target", { local: "point" }, "unchanged"],
    ["a malformed target", { id: "Not A Name" }, "invalid-operation"],
    ["a Bearing slot that does not exist", { local: "bearing" }, "invalid-result"]
  ] as const)("is unavailable for %s", (_label, target, reason) => {
    expect(previewRelationEdit(source, { operation: "retarget", line: 2, target: target as never })).toMatchObject({ status: "unavailable", reason });
  });
});
