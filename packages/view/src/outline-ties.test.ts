import { describe, expect, it } from "vitest";
import type { SourceParseMode } from "@cogitatum/core";
import { prepareView } from "@cogitatum/core/host";
import { outlineTies } from "./projection.js";

const project = (source: string, mode: SourceParseMode = "document") => prepareView(source, mode);

describe("outline ties", () => {
  it.each([
    "- [C @outer] Outer.\n  - [G]Glued.\n    - [G] Child.\n- [. @independent +> @outer] Independent.",
    "- [C @outer] Outer.\n  - [node] Retired.\n- [. @independent +> @outer] Independent.",
    "- [C @outer] Outer.\n  - [G clarifies ^] Retired.\n- [. @independent +> @outer] Independent."
  ])("supply no tie for a rejected annotation: %s", source => {
    expect(outlineTies(project(source).units[0])).toEqual([]);
  });

  it("leaves nested Claims and neutral Points connected by their default Bearings", () => {
    const reading = project([
      "- [Q] Should the library open later?",
      "  - [C] Yes, evening demand is real.",
      "    - [G] Forty people came after six.",
      "  - [C] No, the budget cannot cover it.",
      "  - [.] A note on staffing.",
      "- [C] An unrelated root claim.",
    ].join("\n"));
    expect(reading.units[0].graph.bearings.map(bearing => bearing.kind)).toEqual(["answers", "supports", "answers", "concerns"]);
    expect(outlineTies(reading.units[0])).toEqual([]);
  });

  it("leaves members of a joint step to their Bearing", () => {
    const reading = project("- [C] Claim.\n  - [_ +> ^]\n    - [.] First member.\n    - [.] Second member.");
    expect(outlineTies(reading.units[0])).toEqual([]);
  });

  it.each([
    ["a neutral Point with default relevance", "- [C] Claim.\n  - [.] Staffing.", []],
    ["Grounds rejected as joint members", "- [C] Claim.\n  - [_ +> ^]\n    - [G] First.\n    - [G] Second.", []],
    ["a failed target", "- [Q] Question.\n  - [C supports @missing] Broken.\n  - [.] Aside.", []],
    ["a Point bearing elsewhere", [
      "- [Q] Parent.", "  - [C @child supports @other] Nested.", "- [C @other] Other.", "  - [G use @child supports @other] Reused.",
    ].join("\n"), [["Nested.", "Parent."]]],
    ["a selector bearing on the parent's step", "- [C] Claim.\n  - [G] Ground.\n    - [G/] Supplement.", [["Supplement.", "Ground."]]],
    ["a use", [
      "- [C @claim] The claim.", "- [C @other] Other.", "- [Q @question] Question.", "  - [C +> @other] Local.", "  - [. use @claim]",
      "    - [C +> @other] New beneath the use.", "    - [. use @question]",
    ].join("\n"), [["Local.", "Question."], ["New beneath the use.", "The claim."]]],
    ["a Bearing already joining the pair", [
      "- [C @parent supports @child] Parent.", "  - [C @child +> @other] Child.", "  - [. +> @other] Aside.",
      "- [C @ancestor supports @grandchild] Ancestor.", "  - [C @middle +> @other] Middle.",
      "    - [C @grandchild +> @other] Grandchild.", "    - [. +> @other] Note.", "- [C @other] Other.",
    ].join("\n"), [["Aside.", "Parent."], ["Middle.", "Ancestor."], ["Grandchild.", "Middle."], ["Note.", "Middle."]]],
  ])("ties only an unconnected declaration: %s", (name, source, expected) => {
    const reading = project(source);
    if (name === "a neutral Point with default relevance") {
      const staffing = reading.units[0].occurrences.find(item => item.text === "Staffing.")!;
      expect(reading.units[0].commitments.find(item => item.occurrenceId === staffing.id)).toMatchObject({
        basis: "indentation", kind: "concerns", frame: { framing: "aligned", focus: "point" }
      });
    }
    const text = new Map(reading.units[0].graph.points.map(point => [point.key, point.text]));
    expect(outlineTies(reading.units[0]).map(tie => [text.get(tie.child.key), text.get(tie.parent.key)])).toEqual(expected);
  });

  it("keeps each host unit's ties inside that unit when point keys repeat", () => {
    const fence = "```";
    const reading = project([
      "Before.",
      fence + "cog",
      "- [Q] First?",
      "  - [C +> @other] One.",
      "- [C @other] Other.",
      fence,
      "Between.",
      fence + "cog",
      "- [Q] Second?",
      "  - [C +> @other] Two.",
      "    - [. +> @other] Detail.",
      "- [C @other] Other.",
      fence,
    ].join("\n"), "host");
    const point = (unit: number, text: string) => reading.units[unit].graph.points.find(item => item.text === text)!;
    expect(point(0, "One.").key).toBe(point(1, "Two.").key);
    expect(outlineTies(reading.units[0])).toEqual([
      { child: { kind: "point", key: point(0, "One.").key }, parent: { kind: "point", key: point(0, "First?").key } },
    ]);
    expect(outlineTies(reading.units[1])).toEqual([
      { child: { kind: "point", key: point(1, "Two.").key }, parent: { kind: "point", key: point(1, "Second?").key } },
      { child: { kind: "point", key: point(1, "Detail.").key }, parent: { kind: "point", key: point(1, "Two.").key } },
    ]);
  });
});
