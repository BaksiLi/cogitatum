import { describe, expect, it } from "vitest";
import { prepareView } from "@cogitatum/core/host";
import { mapContext, projectExploration, projectGraph } from "./projection.js";

const source = [
  "- [C @c] The bridge is safe.",
  "  - [. @x] Inspectors visited on Monday.",
  "  - [G use @x]",
  "- [O @under] The underside was never seen.",
  "- [Q @q] Should we reopen it?",
  "  - [G @traffic] Traffic is heavy.",
  "- [O use @under]"
].join("\n");

describe("Map context", () => {
  const unit = prepareView(source, "document").units[0];
  const graph = unit.graph;
  const point = (id: string) => graph.points.find(p => p.id === id)!.key;
  const context = mapContext(unit);

  it("quiets only placement relevance that a stated relation entails", () => {
    const quiet = context.quiet.map(ref => graph.bearings.find(bearing => bearing.key === ref.key)!);
    expect(quiet.map(bearing => [bearing.kind, bearing.sources[0].key, bearing.target.key]))
      .toEqual([["concerns", point("x"), point("c")]]);
  });

  it("lists each awaiting role once per Point and awaited kind", () => {
    expect(context.awaiting).toEqual([
      { point: { kind: "point", key: point("under") }, awaits: "challenges" },
      { point: { kind: "point", key: point("traffic") }, awaits: "supports" }
    ]);
  });

  it("lets the stated relation collapse beside the quiet one, keeping both selectable", () => {
    const full = projectGraph(graph);
    const loud = projectExploration(full);
    const hushed = projectExploration(full, new Set(context.quiet.map(ref => ref.key)));
    const pair = graph.bearings.filter(bearing => bearing.target.key === point("c")).map(bearing => `bearing:${bearing.key}`);
    expect(loud.inlineBearings.map(node => node.id)).not.toEqual(expect.arrayContaining(pair));
    expect(hushed.inlineBearings.map(node => node.id)).toEqual(expect.arrayContaining(pair));
    expect(hushed.links.filter(link => pair.includes(`bearing:${link.bearingKey}`))).toHaveLength(2);
  });
});
