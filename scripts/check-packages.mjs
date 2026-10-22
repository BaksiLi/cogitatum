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
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  if (["core", "cli"].includes(name)) {
    assert.deepEqual(pkg.publishConfig, { access: "public" });
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
import { analyzeSourceReferences, compileGraph, compileGraphWithExplain, compileSource, formatGraph, GRAPH_TEXT_VERSION, parseDocument } from '@cogitatum/core';
const { graph, explain } = compileGraphWithExplain(parseDocument('- Ordinary context.\\n  - [C @claim] A claim.\\n    - [G; @route] A reason.\\n- [O /> @route] A route objection.\\n'));
assert.equal(GRAPH_TEXT_VERSION, '1');
assert.ok(formatGraph(graph).includes('b2: challenges([p3], b1)'));
assert.ok(formatGraph(graph).includes('status: no-errors'));
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
assert.equal(local.graph.bearings[1].kind, 'challenges');
const reuse = compileGraphWithExplain(parseDocument('- [C @premise] Original.\\n- [C @claim] Claim.\\n  - [G use @premise; @step] Local prose.\\n    - [O/ use @premise] Reuse as objection.'));
assert.deepEqual(reuse.graph.diagnostics, []);
assert.equal(reuse.graph.points.length, 2);
assert.equal(reuse.graph.points[0].text, 'Original.');
assert.deepEqual(reuse.graph.points[0].declaration, {form: 'role', role: 'C'});
assert.equal('status' in reuse.graph.points[0], false);
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
const notes = compileGraphWithExplain(parseDocument('- [C @c] Claim.\\n  - [note] Detail.\\n    - [C? @c] Quoted retired syntax.\\n    - [G +> @missing] Literal.\\n  - Group\\n    - [G] Reason.'));
assert.equal(notes.graph.points.length, 2);
assert.equal(notes.graph.bearings.length, 1);
assert.deepEqual(notes.graph.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity]), [['IMPLICIT_ATTACHMENT_THROUGH_BODY', 'suggestion']]);
assert.deepEqual(notes.explain.entries[1].effects, [{kind: 'preserveNote', parentSpan: notes.graph.points[0].sourceSpan}]);
assert.ok(notes.explain.entries[3].effects.some(effect => effect.kind === 'implicitAttachment' && effect.target.key === notes.graph.points[0].key && effect.crossedBodySpans[0].startLine === 5));
const retired = compileGraph(parseDocument('- [C? @old] Retired.'));
assert.deepEqual(retired.points, []);
assert.equal(retired.diagnostics[0].code, 'RETIRED_CLAIM_OPENNESS');
const retiredKind = compileGraphWithExplain(parseDocument('- [C @claim] Claim.\\n- [G @reason] Reason.\\n- [edge @reason +> @claim; @route]\\n- [edge @reason undercuts @route; @failed]\\n  - [O/] No fallback.'));
assert.deepEqual(retiredKind.graph.bearings.map(bearing => bearing.handle), ['route']);
assert.ok(retiredKind.graph.diagnostics.some(diagnostic => diagnostic.code === 'RETIRED_BEARING_KIND'));
assert.ok(retiredKind.graph.diagnostics.some(diagnostic => diagnostic.code === 'NO_LOCAL_BEARING_ATTACHMENT'));
assert.equal(retiredKind.explain.entries[3].recognition.kind, 'edge');
const malformedUse = parseDocument('- [use] Missing operand.');
assert.deepEqual(malformedUse.blocks[0].annotation.syntaxErrors, ['reference', 'retired']);
const layout = compileGraphWithExplain(parseDocument('-    [C @outer] Outer.\\n\\t- [C @failed] Failed.\\n    - [G @inner] Inner.\\n      - [G @detail] Detail.'));
assert.equal(layout.graph.points[0].sourceSpan.startColumn, 6);
assert.deepEqual(layout.graph.points.map(point => point.id), ['outer', 'inner', 'detail']);
assert.equal(layout.graph.bearings.length, 1);
assert.deepEqual(layout.graph.bearings[0].target, { key: layout.graph.points[1].key, kind: 'point' });
assert.deepEqual(layout.graph.diagnostics.map(diagnostic => diagnostic.code), ['TAB_INDENTATION_UNSUPPORTED', 'FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET']);
const referenceText = '- [_ use @route] Review.\\n- [_ @reason supports @claim; @route] Support.\\n- [C @claim] Claim.\\n- [G @reason] Reason.';
const inventory = analyzeSourceReferences(referenceText);
assert.equal(inventory.references.status, 'complete');
assert.deepEqual(inventory.diagnostics, []);
assert.equal(inventory.units[0].source, referenceText);
assert.deepEqual(inventory.references.units[0].map(name => [name.name, name.ref.kind, name.references.map(reference => [reference.kind, reference.sourceSpan.startLine, reference.sourceIndex])]), [
  ['route', 'bearing', [['bearing-use', 1, undefined]]],
  ['claim', 'point', [['target', 2, undefined]]],
  ['reason', 'point', [['source', 2, 0]]]
]);
const localNames = analyzeSourceReferences('- [C @claim] Claim.\\n  - [G @reason; @route] Reason.');
assert.deepEqual(localNames.references.units[0].map(name => name.references), [[], [], []]);
const incompleteInventory = analyzeSourceReferences(fence + 'cog\\n- [C @claim] Claim.\\n' + fence + '\\n' + fence + 'cog\\n- [. use @claim] Unclosed.', 'host');
assert.deepEqual(incompleteInventory.references, { status: 'unavailable', reason: 'source-errors' });
assert.equal(incompleteInventory.diagnostics[0].code, 'UNCLOSED_COGITATUM_FENCE');
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
const inspectFile = join(root, "fixtures/core/local-linked.cog.md");
assert.equal(run(executable, ["graph", "--format", "text", inspectFile], temporary), readFileSync(join(root, "fixtures/text/local-linked.expected.txt"), "utf8"));
const reused = JSON.parse(run(executable, ["explain", join(root, "fixtures/core/narrative-reference-reuse.cog.md")], temporary));
assert.deepEqual(reused.diagnostics, []);
assert.equal(reused.entries.filter(entry => entry.effects.some(effect => effect.kind === "focusPoint")).length, 6);
const referenceFile = join(root, "fixtures/core/bearing-reference-reading.cog.md");
const cliReferences = JSON.parse(run(executable, ["check", "--references", referenceFile], temporary));
const apiReferences = JSON.parse(run(process.execPath, ["--input-type=module", "-e",
  "import {readFileSync} from 'node:fs'; import {analyzeSourceReferences} from '@cogitatum/core'; console.log(JSON.stringify(analyzeSourceReferences(readFileSync(process.argv[1], 'utf8'))));", referenceFile
], temporary));
assert.deepEqual(cliReferences, apiReferences);
assert.equal(cliReferences.references.status, "complete");

writeFileSync(join(temporary, "consumer.mts"), `import {type Point, type PointDeclaration, type Bearing, type Annotation, type OperatorClause, type ExplainEmittedBearingSummary, type SourceReferenceAnalysis, type ReferencedName, type WrittenReference, analyzeSourceReferences, formatGraph, GRAPH_TEXT_VERSION, compileGraph, parseDocument} from '@cogitatum/core';
import { createGraphView, declarationMark } from '@cogitatum/view';
const inventory: SourceReferenceAnalysis = analyzeSourceReferences('- [C @claim] Claim.');
if (inventory.references.status === 'complete') {
  const names: ReferencedName[] = inventory.references.units[0];
  const references: WrittenReference[] = names[0].references;
  for (const reference of references) {
    if (reference.kind === 'source') { const order: number = reference.sourceIndex; }
  }
} else {
  const reason: 'source-errors' = inventory.references.reason;
  // @ts-expect-error Incomplete analysis cannot supply misleading empty inventories.
  inventory.references.units;
}
// @ts-expect-error Source operands retain their authored order.
const unorderedSource: WrittenReference = {kind: 'source', sourceSpan: {startLine: 1, startColumn: 1, endLine: 1, endColumn: 5}};
const mount = (container: HTMLElement) => {
  const view = createGraphView(container, { onSelect: node => { const text: string = node.text; } });
  view.update(graph, 'host:source-unit');
  // @ts-expect-error A host must identify the source unit to retain selection safely.
  view.update(graph);
  return view;
};
const graph = compileGraph(parseDocument('- [C] Claim.'));
const inspection: string = formatGraph(graph);
const notationVersion: string = GRAPH_TEXT_VERSION;
// @ts-expect-error The text formatter accepts a graph, not source text.
formatGraph('source');
const points: Point[] = graph.points;
const bearings: Bearing[] = graph.bearings;
const identity: string | undefined = points[0]?.id;
const declared: PointDeclaration | undefined = points[0]?.declaration;
const declaredName: string | undefined = points[0] && declarationMark(points[0].declaration).name;
// @ts-expect-error Declaration metadata is nested; Points have no flat role.
const flatRole = points[0]?.role;
// @ts-expect-error Points cannot mix flat and nested declaration metadata.
const mixedPoint: Point = {key: 'p', text: 'Claim.', form: 'role', role: 'C', declaration: {form: 'role', role: 'C'}};
// @ts-expect-error Only Gap admits open status.
const openGround: PointDeclaration = {form: 'role', role: 'G', status: 'open'};
// @ts-expect-error Claim openness is retired.
const openClaim: PointDeclaration = {form: 'role', role: 'C', status: 'open'};
// @ts-expect-error A Gap declaration is always open.
const closedGap: PointDeclaration = {form: 'gap'};
const keys: string[] = bearings.flatMap(bearing => bearing.sources.map(source => source.key));
const pointTarget = {key: 'point-key', kind: 'point' as const};
const routeTarget = {key: 'route-key', kind: 'bearing' as const};
const summary = {key: 'another-route', sources: [pointTarget], derivedBy: 'operator' as const};
const routeChallenge: ExplainEmittedBearingSummary = {...summary, kind: 'challenges', target: routeTarget};
const pointChallenge: ExplainEmittedBearingSummary = {...summary, kind: 'challenges', target: pointTarget};
// @ts-expect-error undercuts is no longer a canonical kind.
const invalidUndercut: ExplainEmittedBearingSummary = {...summary, kind: 'undercuts', target: pointTarget};
// @ts-expect-error Role-level openness is unsupported.
const invalidRole: Annotation = {kind: 'role', role: 'G', status: 'open', raw: 'G?'};
const namedKind: Annotation = {kind: 'edge', raw: 'edge @a answers @b', operatorClause: {op: 'answers', targetKind: 'point', sources: [{id: 'a'}], target: {id: 'b'}}};
// Named edge challenges may accept either target; Point clauses must choose one.
const generalChallenge: Annotation = {kind: 'edge', raw: '', operatorClause: {op: 'challenges', targetKind: 'either', sources: [{id: 'a'}], target: {id: 'b'}}};
const roleChallengePoint: Annotation = {kind: 'role', role: 'O', raw: '', operatorClause: {op: 'challenges', targetKind: 'point', sources: 'self', target: {id: 'b'}}};
const roleChallengeBearing: Annotation = {kind: 'role', role: 'O', raw: '', operatorClause: {op: 'challenges', targetKind: 'bearing', sources: 'self', target: {id: 'b'}}};
// @ts-expect-error Unrestricted named challenges have no Point-attached form.
const roleChallengeEither: Annotation = {kind: 'role', role: 'O', raw: '', operatorClause: {op: 'challenges', targetKind: 'either', sources: 'self', target: {id: 'b'}}};
const gapChallengePoint: Annotation = {kind: 'gap', status: 'open', raw: '', operatorClause: {op: 'challenges', targetKind: 'point', sources: 'self', target: {id: 'b'}}};
const gapChallengeBearing: Annotation = {kind: 'gap', status: 'open', raw: '', operatorClause: {op: 'challenges', targetKind: 'bearing', sources: 'self', target: {id: 'b'}}};
// @ts-expect-error Unrestricted named challenges have no Point-attached form.
const gapChallengeEither: Annotation = {kind: 'gap', status: 'open', raw: '', operatorClause: {op: 'challenges', targetKind: 'either', sources: 'self', target: {id: 'b'}}};
const materialChallengePoint: Annotation = {kind: 'material', raw: '', operatorClause: {op: 'challenges', targetKind: 'point', sources: 'self', target: {id: 'b'}}};
const materialChallengeBearing: Annotation = {kind: 'material', raw: '', operatorClause: {op: 'challenges', targetKind: 'bearing', sources: 'self', target: {id: 'b'}}};
// @ts-expect-error Unrestricted named challenges have no Point-attached form.
const materialChallengeEither: Annotation = {kind: 'material', raw: '', operatorClause: {op: 'challenges', targetKind: 'either', sources: 'self', target: {id: 'b'}}};
const useChallengePoint: Annotation = {kind: 'use', ref: {id: 'a'}, raw: '', operatorClause: {op: 'challenges', targetKind: 'point', sources: 'self', target: {id: 'b'}}};
const useChallengeBearing: Annotation = {kind: 'use', ref: {id: 'a'}, raw: '', operatorClause: {op: 'challenges', targetKind: 'bearing', sources: 'self', target: {id: 'b'}}};
// @ts-expect-error Unrestricted named challenges have no Point-attached form.
const useChallengeEither: Annotation = {kind: 'use', ref: {id: 'a'}, raw: '', operatorClause: {op: 'challenges', targetKind: 'either', sources: 'self', target: {id: 'b'}}};
// @ts-expect-error Target requirement must match the authored relation kind.
const invalidSupportsPoint: OperatorClause = {op: 'supports', targetKind: 'point', sources: [{id: 'a'}], target: {id: 'b'}};
// @ts-expect-error Target requirement must match the authored relation kind.
const invalidSupportsBearing: OperatorClause = {op: 'supports', targetKind: 'bearing', sources: [{id: 'a'}], target: {id: 'b'}};
// @ts-expect-error Target requirement must match the authored relation kind.
const invalidAboutPoint: OperatorClause = {op: 'about', targetKind: 'point', sources: [{id: 'a'}], target: {id: 'b'}};
// @ts-expect-error Target requirement must match the authored relation kind.
const invalidAboutBearing: OperatorClause = {op: 'about', targetKind: 'bearing', sources: [{id: 'a'}], target: {id: 'b'}};
// @ts-expect-error Target requirement must match the authored relation kind.
const invalidAnswersBearing: OperatorClause = {op: 'answers', targetKind: 'bearing', sources: [{id: 'a'}], target: {id: 'b'}};
// @ts-expect-error Target requirement must match the authored relation kind.
const invalidAnswersEither: OperatorClause = {op: 'answers', targetKind: 'either', sources: [{id: 'a'}], target: {id: 'b'}};
// @ts-expect-error Target requirement must match the authored relation kind.
const invalidRepliestoBearing: OperatorClause = {op: 'repliesTo', targetKind: 'bearing', sources: [{id: 'a'}], target: {id: 'b'}};
// @ts-expect-error Target requirement must match the authored relation kind.
const invalidRepliestoEither: OperatorClause = {op: 'repliesTo', targetKind: 'either', sources: [{id: 'a'}], target: {id: 'b'}};
// @ts-expect-error Target requirement must match the authored relation kind.
const invalidClarifiesBearing: OperatorClause = {op: 'clarifies', targetKind: 'bearing', sources: [{id: 'a'}], target: {id: 'b'}};
// @ts-expect-error Target requirement must match the authored relation kind.
const invalidClarifiesEither: OperatorClause = {op: 'clarifies', targetKind: 'either', sources: [{id: 'a'}], target: {id: 'b'}};
const localSelector: Annotation = {kind: 'role', role: 'O', selector: 'attachment', raw: 'O/'};
const pointUse: Annotation = {kind: 'use', ref: {id: 'p'}, role: 'G', raw: 'G use @p'};
const neutralPoint: Annotation = {kind: 'material', raw: '.'};
const literalNote: Annotation = {kind: 'note', raw: 'note'};
// @ts-expect-error Notes cannot declare identities.
const namedNote: Annotation = {kind: 'note', raw: 'note', anchor: 'note'};
const neutralUse: Annotation = {kind: 'use', ref: {id: 'p'}, raw: '. use @p'};
const bearingUse: Annotation = {kind: 'bearingUse', ref: {id: 'route'}, raw: '_ use @route'};
// @ts-expect-error A Bearing use cannot construct or alias an attachment.
const aliasedBearingUse: Annotation = {kind: 'bearingUse', ref: {id: 'route'}, handle: 'alias', raw: ''};
// @ts-expect-error A Bearing use cannot serve as a self-sourced Point.
const attachedBearingUse: Annotation = {kind: 'bearingUse', ref: {id: 'route'}, operatorClause: {op: 'supports', targetKind: 'either', sources: 'self', target: {id: 'c'}}, raw: ''};
// @ts-expect-error Neutral material is a Point variant, not a local role.
const neutralRole: Annotation = {kind: 'material', role: 'G', raw: '.'};
const selectorUse: Annotation = {kind: 'use', ref: {id: 'p'}, role: 'O', selector: 'attachment', raw: 'O/ use @p'};
// @ts-expect-error A use operand is not a declaration anchor.
const aliasedUse: Annotation = {kind: 'use', ref: {id: 'p'}, anchor: 'alias', raw: ''};
// @ts-expect-error Occurrence status is excluded.
const statusUse: Annotation = {kind: 'use', ref: {id: 'p'}, role: 'C', status: 'open', raw: ''};
// @ts-expect-error A use selector excludes an explicit operator clause.
const excludedUse: Annotation = {kind: 'use', ref: {id: 'p'}, role: 'O', selector: 'attachment', operatorClause: {op: 'challenges', targetKind: 'bearing', sources: 'self', target: {id: 'b'}}, raw: ''};
// @ts-expect-error Only G and O can select local attachments.
const invalidUseSelector: Annotation = {kind: 'use', ref: {id: 'p'}, role: 'Q', selector: 'attachment', raw: ''};
// @ts-expect-error A selector and a complete operator clause are mutually exclusive.
const excludedSelector: Annotation = {kind: 'role', role: 'O', selector: 'attachment', operatorClause: {op: 'challenges', targetKind: 'bearing', sources: 'self', target: {id: 'b'}}, raw: ''};
// @ts-expect-error Only G and O support a selector.
const invalidSelector: Annotation = {kind: 'role', role: 'Q', selector: 'attachment', raw: 'Q/'};
// @ts-expect-error Named kinds are only adopted on edge clauses.
const namedSelf: Annotation = {kind: 'role', role: 'Q', raw: '', operatorClause: {op: 'repliesTo', targetKind: 'point', sources: 'self', target: {id: 'b'}}};
// @ts-expect-error Operator clauses have exactly one target.
const multipleTargets: OperatorClause = {op: 'supports', targetKind: 'either', sources: 'self', target: [{id: 'a'}, {id: 'b'}]};
// @ts-expect-error Point annotations use themselves as the source.
const otherSource: Annotation = {kind: 'role', role: 'G', raw: '', operatorClause: {op: 'supports', targetKind: 'either', sources: [{id: 'other'}], target: {id: 'claim'}}};
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
