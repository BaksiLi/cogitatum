import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const cli = resolve("packages/cli/dist/index.js");

const valid = run(["explain", "examples/getting-started.cog.md"], 0);
assert.equal(valid.version, "0.4.0");
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

const joint = run(["graph", "fixtures/core/local-join.cog.md"], 0);
assert.equal(joint.points.length, 8);
assert.equal(joint.bearings.length, 6);
const route = joint.bearings.find((bearing) => bearing.handle === "joint-route");
assert.equal(route.derivedBy, "structural");
assert.equal(route.sourceSpan.startLine, 3);
assert.deepEqual(route.sources.map((source) => joint.points.find((point) => point.key === source.key).sourceSpan.startLine), [4, 7]);
const rejectedJoint = run(["graph", "fixtures/diagnostics/invalid-join-members.cog.md"], 1);
assert.equal(rejectedJoint.points.length, 8);
assert.equal(rejectedJoint.bearings.length, 3);
assert.ok(!rejectedJoint.bearings.some((bearing) => bearing.handle === "failed-route"));

process.stdout.write("CLI Explain and join contracts passed.\n");

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
