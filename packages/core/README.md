# @cogitatum/core

Cogitatum is a lightweight markup language for making selected reasoning structure explicit inside ordinary prose. This package provides its deterministic parser and compiler for Node.js and browsers.

Checkout version **0.6.0**, format **0.6.0**, not yet published.
`point` / `node` / `.` and `bearing` / `edge` / `_` share construction, use and local note operations.
`[. note]` and `[_ note]` select the nearest context's Point or Bearing, with literal subtrees and no outward fallback.
`GraphIR.notes` links each authored record to its resolved target and owning AST block.
Complete `compileSource` / `explainSource` envelopes preserve the text and subtree; Graph IR alone omits note prose.
Existing edge/linked descriptions use the same source ownership; `Bearing.text` derives only from the constructor's tail prose.
`->` requires a Point and `/>` requires a Bearing; both emit `challenges` with a typed target.
Named `challenges` accepts either target; named `undercuts` is rejected with migration guidance to `/>`.
Explicit `edge` clauses can use any canonical kind name; Point-attached clauses retain the four symbolic operators.
Reference-only `[. use @p]` or locally marked `[G use @p]` occurrences resolve an existing Point without copying its subtree or changing declaration metadata.
Neutral Point use focuses without a default attachment.
Graph IR `Point.declaration` holds `form`, optional `role` and Gap-only `status`; `key`, `id`, `text` and the canonical `sourceSpan` remain top-level, and use marks stay in AST/Explain.
Bearing-only `[_ use @route]` resolves a validated existing Bearing without constructing or aliasing one; its note never changes `Bearing.text`.
G/ and O/ select only the nearest constructor's exposed Bearing: its local attachment, constructed Bearing, or explicitly referenced Bearing.
Occurrence prose, local marks and original UTF-16 spans remain in AST/Explain; focusPoint maps each use to a typed Point ref, and rejectFocus explains lookup failure.
focusBearing similarly maps Bearing occurrences; selectBearing identifies a referenced context without claiming attachment ownership.
Canonical spans remain declaration/construction spans; several uses may map to the same entity.
Every successfully emitted structural Bearing has an `implicitAttachment` effect whose `contextSpan` identifies the local selected occurrence.
Its `targetSpan` identifies the canonical target and may differ when a Point or Bearing is reused.
`crossedBodySpans` is empty for direct containment; only a nonempty list triggers the existing through-body suggestion.
Failed relations and explicit target clauses have no successful implicit-attachment effect.
Within a source unit, each nonliteral AST block has one Explain entry with the same full block `sourceSpan`, in preorder.
The note header has an entry; its literal descendants do not.
These line spans identify occurrences only within the current compilation; retain the exact original source and rebuild the projections after an edit.
Keep shared content, occurrence notes, quoted source context and proposed reconstructions separate; retained original source plus AST/Explain is required for reading, not Graph IR alone.
The historical npm `alpha` tag provides **0.3.0-alpha.1** without linked.
The published package below uses the 0.5 API and syntax.
Build this source checkout to try 0.6; do not send 0.6 notes to a 0.5 compiler.

```sh
npm install @cogitatum/core@0.5.0
```

```js
import { parseDocument, compileGraph } from '@cogitatum/core';

const source = `- We are checking the deployment before changing the database.
  - [C @cause] The connection pool may be exhausted.
    - [G] The logs show connection acquisition failures.
`;
const graph = compileGraph(parseDocument(source));
console.log(graph.points, graph.bearings, graph.diagnostics);
```

Ordinary body stays in the source AST; only marked structure produces graph entities. `supports` records a positive bearing without certifying an inference or choosing its method.

Every Point and Bearing has a compilation-local `key`. Only authored Point anchors populate `id`; only authored route names populate a Bearing's `handle`. Graph references use `{ key, kind }`. Keys must not be persisted as stable references across revisions or source units.

`parseSource`, `compileSource`, `explainSource`, and `extractCogitatumSourceUnits` default to the owned `document` context.
Pass `host` explicitly for Markdown: actual document-level `cog`/`cogitatum` fences compile independently; comments, raw HTML, and literal code remain inactive.
Nested active fences are diagnosed and omitted; a host with no active regions returns empty projections without parsing host prose as an outline.
`auto` is retired and explicit JavaScript uses receive a `TypeError` with migration guidance.
Keep the original host and pair selected units with AST/Graph/Explain by array index; source spans refer to original one-based UTF-16 positions.

For an already extracted outline, `parseDocument(source, { lineOffset, lineColumnOffsets })` maps spans back to its original location.
`lineOffset` counts preceding lines; `lineColumnOffsets` counts removed UTF-16 code units for each source line.
Offsets must be nonnegative safe integers; omitted options and missing per-line entries default to zero.
Invalid offsets or resulting coordinates beyond JavaScript's safe integer range throw `RangeError` instead of returning malformed spans.
These are caller errors, separate from source diagnostics.

ESM; Node.js 22.12 or newer for development and CLI use.

Experimental debugging APIs, `compileGraphWithExplain` and `explainSource`, add a compiler trace of recognition, emitted or rejected entities, and diagnostics. This trace explains compilation decisions; it does not assess reasoning or record inquiry history. Use AST and Graph IR for integrations that do not need it.

## Written name references

Before renaming a shared observation, inspect where its name is written:

```js
import { analyzeSourceReferences } from '@cogitatum/core';

const review = analyzeSourceReferences(source); // Pass 'host' for Markdown.
if (review.references.status === 'complete') {
  for (const names of review.references.units) {
    for (const name of names) {
      console.log(name.name, name.ref, name.sourceSpan, name.references);
    }
  }
}
```

Supply the complete document or host, not a selected fragment whose references may occur elsewhere.
`references.units[i]` inventories declared Point names and Bearing handles in `units[i]`, in declaration order.
Each record contains the authored `name` without `@`, the compiler's typed `ref`, the declaration block's `sourceSpan`, and `references` in source order.
A reference has a block `sourceSpan` and `kind`: `point-use`, `bearing-use`, `source` or `target`.
An explicit `source` also has a zero-based `sourceIndex`, preserving its order in that Bearing's source list.
These are whole-block spans in original one-based UTF-16 coordinates, not replacement ranges for name tokens.
Resolve identities with the unit index and typed key together; names and keys may repeat in another unit, and keys may change after edits.

The inventory reuses the parser's annotation fields and the compiler's resolved Explain effects, including forward references.
It counts only active written operands, not declarations, ordinary prose mentions, literal note descendants, implicit attachments, self sources, linked membership or local selectors.
The record's typed `ref` identifies the entity referenced, including a Bearing used as an explicit target.
Inspect AST/Explain for occurrence prose, attachment ownership and the relation constructed by a Point use; the inventory is not a replacement for those projections.

On any error, including an omitted nested or unclosed host fence, `references` is `{ status: 'unavailable', reason: 'source-errors' }`, without inventories or counts.
The unchanged compiler `diagnostics` explain why; warnings and suggestions do not prevent a complete inventory.
A host without active units returns a complete empty unit array, which makes no claim about names in host prose or external material.
Completeness covers only the supplied source in the chosen mode; the API cannot detect that a caller has supplied a valid-looking fragment.

An empty `references` array means no active syntax references in this supplied unit.
It does not establish that a name is useless, that its entity is disconnected, or that removal is safe: hosts, citations and later revisions may rely on it.
This API reads source without editing, inventing names or reconstructing text from Graph IR.
Retain the exact original source alongside the report; host unit text is a selected, normalised projection.
Any later edit needs its own preservation contract and recompilation, including occurrence notes and how local attachments respond to moves.

`SourceReferenceAnalysis`, `ReferencedName` and `WrittenReference` are exported TypeScript types.
The result is a separate analysis projection, not an instance of the Source envelope schema; `version` identifies the underlying format, while the package/source revision identifies this API.
No existing AST, Graph IR, Explain or Source schema is extended.

## Graph inspection

Core exports `formatGraph(graph: GraphIR): string` and `GRAPH_TEXT_VERSION` (`"1"`).
The formatter reads one compiled graph and returns a deterministic plain-text entity table and relation list, preserving typed identities, declaration metadata, names, text and ordered sources.
Error-bearing graphs are explicitly marked partial and include diagnostics.
It does not reconstruct source, infer validity or mutate the input.
See [Graph inspection](../../docs/graph-inspection.md) for the versioned preservation contract and comparison limits.

## Compiler contracts

AST blocks keep their semantic fields only in `annotation`; source `raw` and block text are retained separately.
To migrate an older format, apply the [source migration](../../docs/syntax.md#compatibility-and-migration) and reparse retained source.
The compiler rejects ASTs with a different format version.
It also refuses an `edge` annotation that has neither an `operatorClause` nor a recorded syntax error, instead of deriving a relation; validate imported AST JSON against the AST schema first.

`OperatorClause.op` holds the canonical selected `BearingKind`; edge sources are existing Point references, and self-sourced Point annotations admit only symbolic `BearingOp` kinds.
Using a Point as an explicit source preserves its declaration metadata; indentation defaults do not add global role restrictions to explicit construction.
Match the **0.6.0** schemas and compiler; older JSON must be recompiled from retained source, not relabelled.

In 0.5, consumers branch on `bearing.kind === 'challenges'` and then `bearing.target.kind` to distinguish a Point challenge from a Bearing challenge.
The resolved target does not recover the authored restriction: symbolic `/>` and named `challenges` can reach the same Bearing while only `/>` requires that target kind.
Keep the AST for `operatorClause.targetKind`, and original source plus Explain for local occurrences.
Replacing the named `undercuts` operator with `/>` preserves its authored restriction; replacing it with named `challenges` broadens it.
Follow the [complete migration procedure](../../docs/syntax.md#compatibility-and-migration), including diagnostic-code changes and regenerating all projections.

The package includes a draft 2020-12 JSON Schema bundle for offline integration:

```js
import astSchema from '@cogitatum/core/schemas/ast' with { type: 'json' };
import graphSchema from '@cogitatum/core/schemas/graph-ir' with { type: 'json' };
import explainSchema from '@cogitatum/core/schemas/explain' with { type: 'json' };
import sourceSchema from '@cogitatum/core/schemas/source' with { type: 'json' };
```

`sourceSchema` covers the `parseSource`, `compileSource`, and `explainSource` result envelopes and refers to the AST, Graph IR, and Explain schemas by their `$id`.
Load those sibling schemas from the same compiler bundle into a validator before compiling it.
This bundle describes format 0.6.0; the published 0.5.0 bundle describes format 0.5.0.
Published schemas are preserved in the source repository's `spec/0.5.0/`.
The envelope keeps source units and projections in parallel arrays, paired by index.
Schemas check data shapes; array alignment, reference integrity, and agreement with source remain compiler guarantees.
Keys are opaque strings: their numbering is not an integration contract.
Store application metadata separately from canonical compiler output.
The source-envelope export is absent from the historical npm `0.3.0-alpha.1` tarball.

Read the [introduction](https://cogitatum.onesimos.net/docs/introduction), [syntax](https://cogitatum.onesimos.net/docs/syntax), or try the [playground](https://cogitatum.onesimos.net/playground).

## Explicit target preview

`previewExplicitTarget(source, { line, mode? })` prepares one checked source edit without writing a file.
`line` is one-based in the complete source and `mode` is `document` (default) or `host`.
The operation inserts a symbolic target clause for an ordinary implicit support, challenge or relevance attachment to an already named Point.
It preserves source prose and occurrence ownership as well as graph structure, while deliberately making future moves retain the explicit target.
It also verifies that every object note retains its exact origin and resolved target.

```js
import { previewExplicitTarget } from '@cogitatum/core';
const source = '- [C @claim] Claim.\n  - [G] Reason.';
const preview = previewExplicitTarget(source, { line: 2 });
if (preview.status === 'ready') {
  console.log(preview.proposedSource); // Contains [G +> @claim].
}
```

Ready results include the original/proposed source, a single insertion (`edit.offset` in UTF-16 code units and `edit.insert`), both diagnostic lists and the consequence for future edits.
Before applying a saved preview, compare the complete current source with `originalSource`; recompute if it changed.
Unavailable results contain only the common version/mode/diagnostics and a reason/message, with no edit payload.
Errors anywhere in the complete input prevent an edit; anonymous targets, selectors, Linked constructions and dialogical relations require separate authoring decisions.
The public types are `ExplicitTargetOptions`, `ExplicitTargetPreview` and `ExplicitTargetUnavailableReason`.
This API does not add fields to AST, Graph IR, Explain or source schemas, and it is not a general formatter or patch application service.
