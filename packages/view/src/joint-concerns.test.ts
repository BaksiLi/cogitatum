import { describe, expect, it } from "vitest";
import { explainSource } from "@cogitatum/core";
import { focusNeighborhood, projectExploration, projectGraph, referenceKey } from "./projection.js";
import { projectReading } from "./reading-projection.js";

const declarations = [
  "- [. @before] Original clause.",
  "- [. @after] Revised clause.",
  "- [Q @change] Has the scope changed?"
].join("\n");

describe("joint concerns in Reading and Map", () => {
  it("keeps a common comparison, independent relations and a Bearing target distinct after JSON export", () => {
    const source = declarations + [
      "", "- [_ @after, @before ~> @change; @comparison] Compare the versions.",
      "- [_ @before ~> @change; @original]",
      "- [_ @after ~> @change; @revision]",
      "- [_ @before, @after concerns @comparison; @context] Material concerning the comparison."
    ].join("\n");
    const explained = JSON.parse(JSON.stringify(explainSource(source)));
    const retained = JSON.stringify(explained);
    const reading = projectReading(source, explained), unit = reading.units[0];
    expect(reading.diagnostics).toEqual([]);
    expect(unit.occurrences.map(occurrence => occurrence.raw)).toEqual(source.split("\n"));
    const line = (id: string) => unit.occurrences.find(occurrence => occurrence.id === id)!.line;
    expect(unit.bearings.map(route => [
      route.bearing.kind, line(route.occurrenceId), route.sources.map(source => line(source.occurrenceId)),
      route.target.ref.kind, line(route.target.occurrenceId)
    ])).toEqual([
      ["concerns", 4, [2, 1], "point", 3],
      ["concerns", 5, [1], "point", 3],
      ["concerns", 6, [2], "point", 3],
      ["concerns", 7, [1, 2], "bearing", 4]
    ]);
    expect(unit.bearings.every(route => route.sources.every(source => source.basis === "declaration"))).toBe(true);
    expect(unit.notes.map(note => [line(note.occurrenceId), note.content.map(row => row.text)])).toEqual([
      [4, ["Compare the versions."]], [7, ["Material concerning the comparison."]]
    ]);
    const topology = projectGraph(unit.graph), display = projectExploration(topology);
    const [joint, original, revision, context] = unit.graph.bearings;
    expect(display.nodes.filter(node => node.ref.kind === "bearing").map(node => node.name)).toEqual(["comparison", "context"]);
    expect(display.inlineBearings.map(node => node.name)).toEqual(["original", "revision"]);
    for (const bearing of [joint, context]) {
      expect(display.links.filter(link => link.bearingKey === bearing.key)).toEqual([
        ...bearing.sources.map(source => ({
          source: referenceKey(source), target: referenceKey({ kind: "bearing", key: bearing.key }),
          bearingKey: bearing.key, segment: "input"
        })),
        { source: referenceKey({ kind: "bearing", key: bearing.key }), target: referenceKey(bearing.target),
          bearingKey: bearing.key, segment: "output" }
      ]);
    }
    expect(focusNeighborhood(topology, { kind: "bearing", key: joint.key }).bearingKeys).toEqual([joint.key, context.key]);
    expect(display.links.filter(link => [original.key, revision.key].includes(link.bearingKey))).toHaveLength(2);
    expect(JSON.stringify(explained)).toBe(retained);
  });

  it.each(["@after, @missing", "@after, @after", "@after, @existing"])(
    "does not draw a reduced joint or a dangling dependent for %s",
    sources => {
      const source = declarations + [
        "", "- [_ @before, @after ~> @change; @existing]",
        `- [_ ${sources} ~> @change; @failed] Keep this failed prose.`,
        "- [_ @before, @after ~> @failed; @dependent]"
      ].join("\n");
      const explained = explainSource(source), reading = projectReading(source, explained), unit = reading.units[0];
      expect(reading.diagnostics).toEqual(explained.diagnostics);
      expect(unit.bearings.map(route => route.bearing.handle)).toEqual(["existing"]);
      expect(unit.occurrences[4]).toMatchObject({ text: "Keep this failed prose.", references: [], diagnostics: expect.any(Array) });
      expect(unit.occurrences[4].diagnostics.length).toBeGreaterThan(0);
      const display = projectExploration(projectGraph(unit.graph));
      expect(display.nodes.filter(node => node.ref.kind === "bearing").map(node => node.name)).toEqual(["existing"]);
      expect(display.inlineBearings).toEqual([]);
      expect(display.links).toHaveLength(3);
    }
  );
});
