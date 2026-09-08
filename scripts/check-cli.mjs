import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const cli = resolve("packages/cli/dist/index.js");

const valid = run(["explain", "examples/getting-started.cog.md"], 0);
assert.equal(valid.version, "0.3.0");
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

process.stdout.write("CLI Explain contracts passed.\n");

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
