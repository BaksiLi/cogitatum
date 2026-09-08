import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "cogitatum-packages-"));
const cache = join(temporary, "cache");
const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tarballs = [];

for (const name of ["core", "cli"]) {
  const directory = join(root, "packages", name);
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  assert.equal(pkg.version, rootPackage.version);
  assert.match(pkg.version, /^\d+\.\d+\.\d+-alpha\.\d+$/);
  assert.deepEqual(pkg.publishConfig, { access: "public", tag: "alpha" });
  const [packed] = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--cache", cache, "--pack-destination", temporary], directory));
  const paths = packed.files.map((file) => file.path);
  for (const path of paths) {
    const permitted = /^(package\.json|README\.md|LICENSE(?:\.md|\.txt)?|(?:dist|src)\/[a-z-]+\.(?:js|d\.ts|js\.map|ts))$/.test(path)
      || (name === "core" && /^dist\/schemas\/(ast|graph-ir|explain)\.schema\.json$/.test(path));
    assert.ok(permitted && !path.includes(".test."), `Unexpected ${pkg.name} payload: ${path}`);
  }
  for (const required of ["package.json", "README.md", "dist/index.js", "dist/index.d.ts"]) {
    assert.ok(paths.includes(required), `${pkg.name} lacks ${required}`);
  }
  if (name === "core") {
    assert.ok(paths.includes("src/index.ts"), "Development export must resolve in the packed package.");
    for (const schema of ["ast", "graph-ir", "explain"]) {
      assert.ok(paths.includes(`dist/schemas/${schema}.schema.json`), `Missing package schema: ${schema}`);
    }
  }
  tarballs.push(join(temporary, packed.filename));
  process.stdout.write(`${pkg.name}@${pkg.version}: ${paths.length} allowed files, ${packed.size} bytes.\n`);
}

writeFileSync(join(temporary, "package.json"), JSON.stringify({ private: true, type: "module" }));
run("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", cache, ...tarballs], temporary);
for (const name of ["ast", "graph-ir", "explain"]) {
  const imported = JSON.parse(run(process.execPath, ["--input-type=module", "-e",
    `import schema from '@cogitatum/core/schemas/${name}' with { type: 'json' }; console.log(JSON.stringify(schema));`
  ], temporary));
  assert.deepEqual(imported, JSON.parse(readFileSync(join(root, "spec", `${name}.schema.json`), "utf8")));
}
const probe = `
import assert from 'node:assert/strict';
import { compileGraphWithExplain, parseDocument } from '@cogitatum/core';
const { graph, explain } = compileGraphWithExplain(parseDocument('- Ordinary context.\\n  - [C @claim] A claim.\\n    - [G; @route] A reason.\\n- [O _> @route] A route objection.\\n'));
assert.equal(graph.points.length, 3);
assert.equal(graph.points[1].id, undefined);
assert.equal(graph.bearings[0].handle, 'route');
assert.deepEqual(graph.bearings[1].target, {key: graph.bearings[0].key, kind: 'bearing'});
assert.ok(explain.entries.some(entry => entry.recognition.kind === 'body'));
assert.deepEqual(graph.diagnostics, []);
`;
run(process.execPath, ["--input-type=module", "-e", probe], temporary);
// Consumers may set the development condition; the package must remain usable.
const tsx = resolve(root, "node_modules/tsx/dist/loader.mjs");
run(process.execPath, ["--conditions", "development", "--import", tsx, "--input-type=module", "-e", probe], temporary);
const executable = join(temporary, "node_modules", ".bin", "cog");
assert.match(run(executable, ["--version"], temporary), new RegExp(rootPackage.version.replaceAll(".", "\\.")));
const graph = JSON.parse(run(executable, ["graph", join(root, "examples/getting-started.cog.md")], temporary));
assert.equal(graph.points.length, 4);
assert.equal(graph.bearings.length, 3);
assert.equal(graph.diagnostics.length, 0);

writeFileSync(join(temporary, "consumer.mts"), `import {type Point, type Bearing, type Annotation, type OperatorClause, type ExplainEmittedBearingSummary, compileGraph, parseDocument} from '@cogitatum/core';
const graph = compileGraph(parseDocument('- [C] Claim.'));
const points: Point[] = graph.points;
const bearings: Bearing[] = graph.bearings;
const identity: string | undefined = points[0]?.id;
const keys: string[] = bearings.flatMap(bearing => bearing.sources.map(source => source.key));
const pointTarget = {key: 'point-key', kind: 'point' as const};
const routeTarget = {key: 'route-key', kind: 'bearing' as const};
const summary = {key: 'another-route', sources: [pointTarget], derivedBy: 'operator' as const};
const undercut: ExplainEmittedBearingSummary = {...summary, kind: 'undercuts', target: routeTarget};
// @ts-expect-error An emitted undercut cannot target a Point.
const invalidUndercut: ExplainEmittedBearingSummary = {...summary, kind: 'undercuts', target: pointTarget};
// @ts-expect-error Only C admits open role status.
const invalidRole: Annotation = {kind: 'role', role: 'G', status: 'open', raw: 'G?'};
// @ts-expect-error Operator clauses have exactly one target.
const multipleTargets: OperatorClause = {op: 'supports', sources: 'self', target: [{id: 'a'}, {id: 'b'}]};
// @ts-expect-error Point annotations use themselves as the source.
const otherSource: Annotation = {kind: 'role', role: 'G', raw: '', operatorClause: {op: 'supports', sources: [{id: 'other'}], target: {id: 'claim'}}};
// @ts-expect-error AST annotations have one semantic home.
graph.points[0] && parseDocument('- [C] Claim.').blocks[0].role;
`);
run(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--module", "NodeNext", "--target", "ES2022", "consumer.mts"], temporary);
process.stdout.write(`Packed packages passed isolated offline installation, API, CLI, and TypeScript checks.\nReviewable tarballs: ${temporary}\n`);

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
