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

for (const name of ["core", "cli", "view"]) {
  const directory = join(root, "packages", name);
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  assert.equal(pkg.version, rootPackage.version);
  assert.match(pkg.version, /^\d+\.\d+\.\d+-alpha\.\d+$/);
  if (["core", "cli"].includes(name)) {
    assert.deepEqual(pkg.publishConfig, { access: "public", tag: "alpha" });
    assert.notEqual(pkg.private, true);
  } else {
    assert.equal(pkg.private, true, `${pkg.name} is an experimental checkout package, not a release package.`);
  }
  const [packed] = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--cache", cache, "--pack-destination", temporary], directory));
  const paths = packed.files.map((file) => file.path);
  for (const path of paths) {
    const permitted = /^(package\.json|README\.md|LICENSE(?:\.md|\.txt)?|(?:dist|src)\/[a-z-]+\.(?:js|d\.ts|js\.map|ts))$/.test(path)
      || (name === "core" && /^dist\/schemas\/(ast|graph-ir|explain|source)\.schema\.json$/.test(path))
      || (name === "view" && path === "dist/style.css");
    assert.ok(permitted && !path.includes(".test."), `Unexpected ${pkg.name} payload: ${path}`);
  }
  for (const required of ["package.json", "README.md", "dist/index.js", "dist/index.d.ts"]) {
    assert.ok(paths.includes(required), `${pkg.name} lacks ${required}`);
  }
  if (name === "core") {
    assert.ok(paths.includes("src/index.ts"), "Development export must resolve in the packed package.");
    for (const schema of ["ast", "graph-ir", "explain", "source"]) {
      assert.ok(paths.includes(`dist/schemas/${schema}.schema.json`), `Missing package schema: ${schema}`);
    }
  }
  tarballs.push(join(temporary, packed.filename));
  process.stdout.write(`${pkg.name}@${pkg.version}: ${paths.length} allowed files, ${packed.size} bytes.\n`);
}

writeFileSync(join(temporary, "package.json"), JSON.stringify({ private: true, type: "module" }));
run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", cache, ...tarballs], temporary);
run("npm", ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", cache], temporary);
for (const name of ["ast", "graph-ir", "explain", "source"]) {
  const imported = JSON.parse(run(process.execPath, ["--input-type=module", "-e",
    `import schema from '@cogitatum/core/schemas/${name}' with { type: 'json' }; console.log(JSON.stringify(schema));`
  ], temporary));
  assert.deepEqual(imported, JSON.parse(readFileSync(join(root, "spec", `${name}.schema.json`), "utf8")));
}
const probe = `
import assert from 'node:assert/strict';
import { compileGraphWithExplain, compileSource, parseDocument } from '@cogitatum/core';
const { graph, explain } = compileGraphWithExplain(parseDocument('- Ordinary context.\\n  - [C @claim] A claim.\\n    - [G; @route] A reason.\\n- [O /> @route] A route objection.\\n'));
assert.equal(graph.points.length, 3);
assert.equal(graph.points[1].id, undefined);
assert.equal(graph.bearings[0].handle, 'route');
assert.deepEqual(graph.bearings[1].target, {key: graph.bearings[0].key, kind: 'bearing'});
assert.ok(explain.entries.some(entry => entry.recognition.kind === 'body'));
assert.deepEqual(graph.diagnostics, []);
const fence = String.fromCharCode(96).repeat(3);
const hostText = ['<!--', fence + 'cog', '- [C @hidden] Hidden.', fence, '-->', '', fence + 'cog', '- [C @visible] Visible.', fence].join('\\n');
const host = compileSource(hostText, 'host');
assert.equal(host.graphs.length, 1);
assert.equal(host.graphs[0].points[0].id, 'visible');
assert.equal(host.graphs[0].points[0].sourceSpan.startLine, 8);
assert.deepEqual(host.diagnostics, []);
const local = compileGraphWithExplain(parseDocument('- [C @claim] Claim.\\n  - [G; @step] Ground.\\n    - [O/] Assessment.'));
assert.deepEqual(local.graph.diagnostics, []);
assert.equal(local.graph.bearings[1].kind, 'undercuts');
const reuse = compileGraphWithExplain(parseDocument('- [C? @premise] Original.\\n- [C @claim] Claim.\\n  - [G use @premise; @step] Local prose.\\n    - [O/ use @premise] Reuse as objection.'));
assert.deepEqual(reuse.graph.diagnostics, []);
assert.equal(reuse.graph.points.length, 2);
assert.equal(reuse.graph.points[0].text, 'Original.');
assert.equal(reuse.graph.points[0].status, 'open');
assert.equal(reuse.graph.bearings.length, 2);
assert.deepEqual(reuse.graph.bearings[0].sources, [{key: reuse.graph.points[0].key, kind: 'point'}]);
assert.ok(reuse.explain.entries[2].effects.some(effect => effect.kind === 'focusPoint' && effect.ref.key === reuse.graph.points[0].key));
assert.equal(reuse.explain.entries[3].recognition.kind, 'use');
const bearingUse = compileGraphWithExplain(parseDocument('- [_ use @route] Local note.\\n  - [O/ @bias; @attack] Shared offset.\\n    - [O] Independent instruments.\\n    - [O/] The offset cancels.\\n- [C @p] Premise.\\n- [C @c] Claim.\\n- [_ @p supports @c; @route] Original description.'));
assert.deepEqual(bearingUse.graph.diagnostics, []);
assert.equal(bearingUse.graph.points.length, 5);
assert.equal(bearingUse.graph.bearings.length, 4);
const originalRoute = bearingUse.graph.bearings.find(bearing => bearing.handle === 'route');
assert.equal(originalRoute.text, 'Original description.');
assert.equal(originalRoute.sourceSpan.startLine, 7);
assert.deepEqual(bearingUse.explain.entries[0].effects, [{kind: 'focusBearing', operand: {id: 'route'}, ref: {kind: 'bearing', key: originalRoute.key}}]);
assert.ok(bearingUse.explain.entries[1].effects.some(effect => effect.kind === 'selectBearing' && effect.target.key === originalRoute.key));
assert.deepEqual(local.graph.bearings[1].target, {key: local.graph.bearings[0].key, kind: 'bearing'});
assert.ok(local.explain.entries[2].effects.some(effect => effect.kind === 'selectAttachment'));
`;
run(process.execPath, ["--input-type=module", "-e", probe], temporary);
// Consumers may set the development condition; the package must remain usable.
const tsx = resolve(root, "node_modules/tsx/dist/loader.mjs");
run(process.execPath, ["--conditions", "development", "--import", tsx, "--input-type=module", "-e", probe], temporary);
const integrationProbe = `
import assert from 'node:assert/strict';
import { compileSource } from '@cogitatum/core';
import { projectGraph, createGraphView } from '@cogitatum/view';
const compiled = compileSource('- [C @claim] A claim.\\n  - [G] A reason.\\n', 'document');
assert.equal(projectGraph(compiled.graphs[0]).nodes.length, 3);
assert.equal(typeof createGraphView, 'function');
`;
run(process.execPath, ["--input-type=module", "-e", integrationProbe], temporary);
run(process.execPath, ["--conditions", "development", "--import", tsx, "--input-type=module", "-e", integrationProbe], temporary);
assert.ok(readFileSync(join(temporary, "node_modules/@cogitatum/view/dist/style.css"), "utf8").includes(".cog-graph"));
const executable = join(temporary, "node_modules", ".bin", "cog");
assert.match(run(executable, ["--version"], temporary), new RegExp(rootPackage.version.replaceAll(".", "\\.")));
const graph = JSON.parse(run(executable, ["graph", join(root, "examples/getting-started.cog.md")], temporary));
assert.equal(graph.points.length, 4);
assert.equal(graph.bearings.length, 3);
assert.equal(graph.diagnostics.length, 0);
const reused = JSON.parse(run(executable, ["explain", join(root, "fixtures/core/narrative-reference-reuse.cog.md")], temporary));
assert.deepEqual(reused.diagnostics, []);
assert.equal(reused.entries.filter(entry => entry.effects.some(effect => effect.kind === "focusPoint")).length, 6);

writeFileSync(join(temporary, "consumer.mts"), `import {type Point, type Bearing, type Annotation, type OperatorClause, type ExplainEmittedBearingSummary, compileGraph, parseDocument} from '@cogitatum/core';
import { createGraphView } from '@cogitatum/view';
const mount = (container: HTMLElement) => {
  const view = createGraphView(container, { onSelect: node => { const text: string = node.text; } });
  view.update(graph, 'host:source-unit');
  // @ts-expect-error A host must identify the source unit to retain selection safely.
  view.update(graph);
  return view;
};
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
const namedKind: Annotation = {kind: 'edge', raw: 'edge @a answers @b', operatorClause: {op: 'answers', sources: [{id: 'a'}], target: {id: 'b'}}};
const localSelector: Annotation = {kind: 'role', role: 'O', selector: 'attachment', raw: 'O/'};
const pointUse: Annotation = {kind: 'use', ref: {id: 'p'}, role: 'G', raw: 'G use @p'};
const neutralPoint: Annotation = {kind: 'material', raw: '.'};
const neutralUse: Annotation = {kind: 'use', ref: {id: 'p'}, raw: '. use @p'};
const bearingUse: Annotation = {kind: 'bearingUse', ref: {id: 'route'}, raw: '_ use @route'};
// @ts-expect-error A Bearing use cannot construct or alias an attachment.
const aliasedBearingUse: Annotation = {kind: 'bearingUse', ref: {id: 'route'}, handle: 'alias', raw: ''};
// @ts-expect-error A Bearing use cannot serve as a self-sourced Point.
const attachedBearingUse: Annotation = {kind: 'bearingUse', ref: {id: 'route'}, operatorClause: {op: 'supports', sources: 'self', target: {id: 'c'}}, raw: ''};
// @ts-expect-error Neutral material is a Point variant, not a local role.
const neutralRole: Annotation = {kind: 'material', role: 'G', raw: '.'};
const selectorUse: Annotation = {kind: 'use', ref: {id: 'p'}, role: 'O', selector: 'attachment', raw: 'O/ use @p'};
// @ts-expect-error A use operand is not a declaration anchor.
const aliasedUse: Annotation = {kind: 'use', ref: {id: 'p'}, anchor: 'alias', raw: ''};
// @ts-expect-error Occurrence status is excluded.
const statusUse: Annotation = {kind: 'use', ref: {id: 'p'}, role: 'C', status: 'open', raw: ''};
// @ts-expect-error A use selector excludes an explicit operator clause.
const excludedUse: Annotation = {kind: 'use', ref: {id: 'p'}, role: 'O', selector: 'attachment', operatorClause: {op: 'undercuts', sources: 'self', target: {id: 'b'}}, raw: ''};
// @ts-expect-error Only G and O can select local attachments.
const invalidUseSelector: Annotation = {kind: 'use', ref: {id: 'p'}, role: 'Q', selector: 'attachment', raw: ''};
// @ts-expect-error A selector and a complete operator clause are mutually exclusive.
const excludedSelector: Annotation = {kind: 'role', role: 'O', selector: 'attachment', operatorClause: {op: 'undercuts', sources: 'self', target: {id: 'b'}}, raw: ''};
// @ts-expect-error Only G and O support a selector.
const invalidSelector: Annotation = {kind: 'role', role: 'Q', selector: 'attachment', raw: 'Q/'};
// @ts-expect-error Named kinds are only adopted on edge clauses.
const namedSelf: Annotation = {kind: 'role', role: 'Q', raw: '', operatorClause: {op: 'repliesTo', sources: 'self', target: {id: 'b'}}};
// @ts-expect-error Operator clauses have exactly one target.
const multipleTargets: OperatorClause = {op: 'supports', sources: 'self', target: [{id: 'a'}, {id: 'b'}]};
// @ts-expect-error Point annotations use themselves as the source.
const otherSource: Annotation = {kind: 'role', role: 'G', raw: '', operatorClause: {op: 'supports', sources: [{id: 'other'}], target: {id: 'claim'}}};
// @ts-expect-error AST annotations have one semantic home.
graph.points[0] && parseDocument('- [C] Claim.').blocks[0].role;
`);
run(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--module", "NodeNext", "--target", "ES2022", "consumer.mts"], temporary);
process.stdout.write(`Packed packages passed isolated installation, offline reinstall, API, CLI, and TypeScript checks.\nReviewable tarballs: ${temporary}\n`);

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
