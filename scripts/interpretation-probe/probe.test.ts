import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { explainSource, formatGraph } from "../../packages/core/src/index.js";
import { checkFiniteEntailment, runProbe } from "./run.mjs";

const source = readFileSync(new URL("./wet-ground.cog.md", import.meta.url), "utf8");

describe("source-preserving interpretation experiment", () => {
  it("retains the complete source, AST, graph and Explain while recording two distinct readings", () => {
    const expected = explainSource(source, "document");
    const result = runProbe(source);
    expect(result.recorded).toEqual(expected);
    expect(result.inspection).toBe(formatGraph(expected.graphs[0]));
    expect(result.recorded.graphs[0].bearings.map(b => b.kind)).toEqual(["supports", "challenges"]);
    expect(result.recorded.graphs[0].points).toHaveLength(3);
    expect(result.interpretations.map(i => i.id)).toEqual(["deductive-reading", "explanatory-reading"]);
    for (const reading of result.interpretations) {
      expect(reading.snapshot).toEqual(result.snapshot);
      for (const ref of reading.selected) {
        expect(ref.graphIndex).toBe(0);
        expect(ref.kind).toBe("bearing");
        expect(expected.graphs[0].bearings.some(b => b.key === ref.key)).toBe(true);
      }
      for (const mapping of reading.mappings) {
        expect(mapping.ref.kind).toBe("point");
        expect(expected.graphs[0].points.find(p => p.key === mapping.ref.key)?.text).toBe(mapping.text);
      }
    }
    expect(result.snapshot.compiledSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(runProbe(source)).toEqual(result);
  });

  it("produces a real deductive counterexample without rejecting the recorded support", () => {
    const result = runProbe(source);
    const deductive = result.interpretations[0];
    expect(deductive.assumptions).toEqual([]);
    expect(deductive.result).toMatchObject({ status: "counterexample", modelCount: 4, counterexample: { W: true, R: false } });
    expect(result.recorded.graphs[0].bearings[0]).toMatchObject({ kind: "supports", handle: "weather-route" });
    expect(result.recorded.graphs[0].diagnostics).toEqual([]);
  });

  it("checks two consistent candidate explanations without inferring rain, ranking, or undercut", () => {
    const result = runProbe(source);
    const explanatory = result.interpretations[1];
    expect(explanatory.assumptions.map(a => a.formula)).toEqual(["R -> W", "S -> W"]);
    expect(explanatory.assumptions.every(a => a.status === "assumed-for-check")).toBe(true);
    expect(explanatory.assumptions[0].origin).toBe("interpretation");
    expect(explanatory.assumptions[1].origin).toMatchObject({ id: "sprinkler", ref: { kind: "point" } });
    expect(explanatory.introducedAtoms).toContainEqual(expect.objectContaining({ atom: "S", assertedAsFact: false }));
    expect(explanatory.result.candidates.map(c => [c.hypothesis, c.check.status, c.check.modelCount])).toEqual([
      ["R", "entailed", 2], ["S", "entailed", 2]
    ]);
    for (const candidate of explanatory.result.candidates) {
      const witness = candidate.check.witness;
      expect(witness.W).toBe(true);
      expect(witness[candidate.hypothesis]).toBe(true);
    }
    expect(explanatory.result.observationEntailsRain).toMatchObject({ status: "counterexample", counterexample: { W: true, R: false } });
    expect(explanatory.result.ranking).toBe("not-assessed");
    expect(explanatory.result.undercutClassification).toBe("not-assessed");
  });

  it.each([
    ["claim", (s: string) => s.replace("It rained.", "It might have rained.")],
    ["literal note", (s: string) => s.replace("independently established", "measured directly")],
    ["occurrence prose", (s: string) => s + "- [_ use @weather-route] A different qualification.\n"],
    ["another same-endpoint Bearing", (s: string) => s + "- [edge @wet +> @rain; @other]\n"]
  ])("refuses a stale reading after changing %s", (_label, change) => {
    expect(() => runProbe(change(source))).toThrow("STALE_INTERPRETATION");
  });

  it("rejects source drift even when graph inspection is identical", () => {
    const changed = source.replace("independently established", "measured directly");
    expect(formatGraph(explainSource(changed, "document").graphs[0])).toBe(formatGraph(explainSource(source, "document").graphs[0]));
    expect(() => runProbe(changed)).toThrow("STALE_INTERPRETATION");
  });

  it("keeps the documented source executable and identical to the reviewed fixture", () => {
    const doc = readFileSync(new URL("../../docs/research/interpretation-probe.md", import.meta.url), "utf8");
    expect(doc.match(/```md cog-check[^\n]*\n([\s\S]*?)```/)?.[1]).toBe(source);
  });

  it("returns a nonzero exit and no assessment for stale CLI input", () => {
    const directory = mkdtempSync(join(tmpdir(), "cogitatum-stale-reading-"));
    try {
      const file = join(directory, "changed.cog.md");
      writeFileSync(file, source + "- A new qualification.\n");
      const result = spawnSync(process.execPath, ["--conditions", "development", "--import", "tsx", fileURLToPath(new URL("./run.mjs", import.meta.url)), file], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("STALE_INTERPRETATION");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("finite classical checks", () => {
  it("reports contradictory assumptions separately from successful entailment", () => {
    expect(checkFiniteEntailment([w => w.W, w => !w.W], w => w.R)).toEqual({ status: "inconsistent-assumptions", modelCount: 0 });
  });
  it("checks all valuations rather than only a supporting witness", () => {
    expect(checkFiniteEntailment([], w => w.W)).toMatchObject({ status: "counterexample", modelCount: 8, counterexample: { W: false } });
    expect(checkFiniteEntailment([w => w.W], w => w.W)).toMatchObject({ status: "entailed", modelCount: 4 });
  });
});
