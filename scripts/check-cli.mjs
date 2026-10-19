import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const cli = resolve("packages/cli/dist/index.js");

const valid = run(["explain", "examples/getting-started.cog.md"], 0);
assert.equal(valid.version, "0.5.0");
assert.ok(valid.entries.some((entry) => entry.recognition.kind === "body"));
assert.ok(
  valid.entries.some((entry) =>
    entry.effects.some(
      (effect) => effect.kind === "emitBearing" && effect.bearing.kind === "supports"
    )
  )
);

const invalid = run(["explain", "fixtures/diagnostics/unknown-bearing-target.cog.md"], 1);
assert.deepEqual(invalid.diagnostics.map((diagnostic) => diagnostic.code), ["UNKNOWN_TARGET"]);
assert.ok(
  invalid.entries.some((entry) =>
    entry.effects.some(
      (effect) => effect.kind === "rejectBearing" && effect.reason === "validation-error"
    )
  )
);

const host = run(["explain", "--input", "host", "fixtures/host/two-inquiries.md"], 0);
assert.equal(host.mode, "host");
assert.equal(host.units.length, 2);
assert.equal(host.explanations.length, 2);
assert.equal(host.explanations[1].entries[0].sourceSpan.startLine, 18);

const joint = run(["graph", "fixtures/core/local-linked.cog.md"], 0);
assert.equal(joint.points.length, 8);
assert.equal(joint.bearings.length, 6);
const route = joint.bearings.find((bearing) => bearing.handle === "joint-route");
assert.equal(route.derivedBy, "structural");
assert.equal(route.sourceSpan.startLine, 3);
assert.deepEqual(route.sources.map((source) => joint.points.find((point) => point.key === source.key).sourceSpan.startLine), [4, 7]);
const rejectedLinked = run(["graph", "fixtures/diagnostics/invalid-linked-members.cog.md"], 1);
assert.equal(rejectedLinked.points.length, 8);
assert.equal(rejectedLinked.bearings.length, 3);
assert.ok(!rejectedLinked.bearings.some((bearing) => bearing.handle === "failed-route"));
const retired = run(["graph", "fixtures/diagnostics/retired-join.cog.md"], 1);
assert.equal(retired.points.length, 4);
assert.equal(retired.bearings.length, 2);
assert.deepEqual(retired.diagnostics.map(diagnostic => diagnostic.code), ["RETIRED_JOIN_ANNOTATION"]);

const reuse = run(["explain", "fixtures/core/narrative-reference-reuse.cog.md"], 0);
assert.deepEqual(reuse.diagnostics, []);
assert.equal(reuse.entries.filter(entry => entry.effects.some(effect => effect.kind === "focusPoint")).length, 6);
const reusedGraph = run(["graph", "fixtures/core/narrative-reference-reuse.cog.md"], 0);
assert.equal(reusedGraph.points.length, 6);
assert.equal(reusedGraph.bearings.length, 7);
assert.deepEqual(reusedGraph.points.find(point => point.id === "observation").declaration, { form: "role", role: "C" });

process.stdout.write("CLI Explain, linked and reference-use contracts passed.\n");

function run(args, expectedStatus) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  assert.equal(
    result.status,
    expectedStatus,
    `cog ${args.join(" ")} exited ${String(result.status)}\n${result.stderr}\n${result.stdout}`
  );
  return JSON.parse(result.stdout);
}
