# @cogitatum/core

Cogitatum is a lightweight markup language for making selected reasoning structure explicit inside ordinary prose. This package provides its deterministic parser and compiler for Node.js and browsers.

Points are independently identified authored content, including questions and fragments; they need not be declarative sentences or truth-apt propositions.
Every relation is a relation plus one target term: `@name`, `^` for the nearest enclosing Point, or `^/` for the locally exposed Bearing.
Marks abbreviate default clauses: `[G]` is `[G +> ^]`, and G / O / R / D / Q state `supports` / `challenges` / `respondsTo` / `clarifies` / `concerns`, irrespective of the parent's mark.
C and neutral Points state no relation; author `answers` explicitly when intended.

Checkout version **0.6.0**, format **0.6.0**, not yet published.
`point` / `node` / `.` and `bearing` / `edge` / `_` share construction, use and local note operations.
A Bearing constructor writes `[_ OP TARGET]`: its direct neutral children are its ordered sources, or `[_ @a, @b OP TARGET]` lists them; `[_]` and `[_/]` record joint `concerns`.
The first token after the family spelling selects construction, `use` for reuse or `note` for note mode; a role letter such as `[_ G]` is `MALFORMED_BEARING_MODE`.
`[. note]` and `[_ note]` select the nearest context's Point or Bearing, with literal subtrees and no outward fallback.
`GraphIR.notes` links each authored record to its resolved target and owning AST block.
Complete `compileSource` / `explainSource` envelopes preserve the text and subtree; Graph IR alone omits note prose.
Local and explicit Bearing descriptions use the same source ownership; `Bearing.text` derives only from the constructor's prose, including continuations.
`->` and named `challenges` accept a Point or Bearing, emitting `challenges` with a typed target; `/>` and `_>` are retired with `RETIRED_AUTHORING_SYNTAX`.
`clarifies` and `concerns` likewise accept either target; `answers` and `respondsTo` require a Point.
Constructors, Point declarations and Point uses accept all six canonical kind names, alongside the three symbolic operators; named `undercuts` is rejected.
`R` is Response; `[Q @question respondsTo @objection]` retains its local Q mark and constructs one response without requiring a chronological conversation.
Named clauses never impose global declaration-role checks; retired `repliesTo` receives a migration error, without default fallback.
Reference-only `[. use @p]` or locally marked `[G use @p]` occurrences resolve an existing Point without copying its subtree or changing declaration metadata.
Neutral Point use focuses without a default attachment.
Graph IR `Point.declaration` holds `form` and its applicable `role`; `key`, `id`, `text` and the canonical `sourceSpan` remain top-level, and use marks stay in AST/Explain.
Gap declarations and openness status are retired in 0.6.
`[_ +> ^; @route]` constructs one Bearing from direct neutral members to the nearest enclosing Point; an optional handle follows the clause.
One source is a complete construction, without an implied authoring status.
A direct member's relation decides its function: toward `^/` it is commentary, toward a name independent, and toward `^`, by mark or clause, an invalid member; no automatic rewrite, reduced source set or outward target fallback is permitted.
The old `[linked]`, `[G linked]` and `[linked G]` headers are retired with `RETIRED_LINKED_ANNOTATION`, without compiling aliases; `join` remains retired.
AST and Explain recognise every constructor as `kind: "bearing"` with `members` and optional `selector`; source membership appears as Explain `localBearingMember` with `local-bearing-*` reasons and `*_LOCAL_BEARING*` diagnostic codes.
Convergent, Linked and Serial still name graph structures; multi-source support records an array of participating sources, not reasoning strength or success.
Serial authoring uses ordinary Point nesting or explicit relations.
`concerns` replaces the retired named `about` spelling.
Bearing-only `[_ use @route]` resolves a validated existing Bearing without constructing or aliasing one; its note never changes `Bearing.text`.
G/, O/, Q/ and D/ select only the nearest constructor's exposed Bearing `^/`: its local attachment, constructed Bearing, or explicitly referenced Bearing.
They construct `supports`, `challenges`, `concerns` and `clarifies` respectively, without adding to the selected Bearing's sources.
`[Q/ use @q]` reuses Point content with a local Q mark; notes and occurrence prose keep their existing ownership.
Selectors never cross a nearer unattached Point or failed context.
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
Indented nonbullet continuation lines extend the same block's content, including blank paragraphs.
Bullet indentation uses one character per source unit, spaces or hard tabs.
Continuations repeat the owning bullet's indentation and add spaces in place of its marker and separator; this padding does not choose the unit's indentation style.
The complete Point content is shared at uses; use prose remains local, and note subtrees remain literal.
AST text/raw use LF and spans include continuations but exclude children; annotation recognition is confined to the bullet header.
Keep shared content, occurrence notes, quoted source context and proposed reconstructions separate; retained original source plus AST/Explain is required for reading, not Graph IR alone.
The historical npm `alpha` tag provides **0.3.0-alpha.1**, predating local Bearing construction.
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
It counts only active written operands, not declarations, ordinary prose mentions, literal note descendants, implicit attachments, self sources, local source membership or local selectors.
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
It also refuses a constructor with listed sources that has neither an `operatorClause` nor a recorded syntax error, instead of deriving a relation; validate imported AST JSON against the AST schema first.

`OperatorClause.op` holds the canonical selected `BearingKind`, and `target` is a `TargetTerm`: `{ id }` or `{ local: "point" | "bearing" }`.
Point declarations and uses have `sources: "self"`; constructors have `sources: "members"`, deriving their sources from direct neutral children, or a list of existing Point references.
All admit six kinds; which targets a kind accepts follows from `op`, without a separate `targetKind` field.
A mark's default clause is not written into the AST; `expandedClause(annotation)` returns the clause a mark abbreviates.
Using a Point as an explicit source preserves its declaration metadata; indentation defaults do not add global role restrictions to explicit construction.
Match the **0.6.0** schemas and compiler; older JSON must be recompiled from retained source, not relabelled.

In 0.5, consumers branch on `bearing.kind === 'challenges'` and then `bearing.target.kind` to distinguish a Point challenge from a Bearing challenge.
In 0.6 the authored target term itself decides the kind, so `/>` is retired: write `->`, and keep original source plus Explain for positional occurrences.
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

## Inspection and target form

```js
import { explainSource, formatExplain, previewTargetForm } from '@cogitatum/core';
const source = '- [C @claim] Claim.\n  - [G] Reason.';
console.log(formatExplain(explainSource(source)));
const preview = previewTargetForm(source, { line: 2, form: 'named' });
if (preview.status === 'ready') {
  console.log(preview.proposedSource); // Contains [G +> @claim].
}
```

`formatExplain(explainSource(source, mode))` prints every active compiler decision, including failed candidates, membership, selected context, ordered endpoints and note ownership.
It includes all host units and source-selection diagnostics.
`EXPLAIN_TEXT_VERSION` identifies its readable notation independently of `FORMAT_VERSION`.

`previewTargetForm(source, { line, form: 'named' | 'positional', mode? })` prepares one checked source edit without writing a file.
`line` is one-based in the complete source and `mode` is `document` (default) or `host`.
It exchanges one relation's positional `^` / `^/` target for the name it resolves to, or back, on Point declarations, uses, selectors and constructors.
A mark's default relation is written out with a named target and omitted again when the result is the mark's own default, so the two directions are inverse edits.
A constructor's members stay in place; select the constructor rather than a source member.

Ready results include `originalSource`, `proposedSource`, one minimal `edit: { offset, remove, insert }` in original UTF-16 code units, both diagnostic lists and the consequence for future moves and mark changes.
Before applying a saved preview, compare the complete current source with `originalSource`; recompute if it changed.
Unavailable results contain a reason and message, with no edit payload.
Errors anywhere in the complete input, anonymous targets and occurrences that state no relation prevent an edit.
The preview recompiles the complete proposed source, preserving content, entity identities and declaration marks, ordered endpoints, literal subtrees, note origins/targets and unrelated diagnostic occurrences.
Public types are `TargetForm`, `TargetFormOptions`, `TargetFormPreview`, `TargetFormUnavailableReason` and `SourceEdit`.
It replaces the published `previewExplicitTarget`; it adds no fields to AST, Graph IR, Explain or source schemas, and it is not a general formatter or patch application service.
The [inspection reference](../../docs/graph-inspection.md#preview-named-and-positional-targets) specifies the preservation limits.

## Commitment comparison

```js
import { compareCommitments, compileSource, suggestCorrespondence } from '@cogitatum/core';
const graph = source => compileSource(source).graphs[0];
const before = graph('- [C] Claim.\n  - [_]\n    - [.] A.\n    - [.] B.');
const after = graph('- [C] Claim.\n  - [_ +> ^]\n    - [.] A.\n    - [.] B.');
const { correspondence, ambiguous } = suggestCorrespondence(before, after);
const result = compareCommitments(before, after, correspondence);
if (result.status === 'compared') console.log(result.relation); // refinement
```

`previewRelationEdit(source, edit)` previews deciding a relation's kind, separating a member-sourced group into one relation per member, or joining adjacent sibling relations into a group.
A ready preview carries the proposed source, one minimal `SourceEdit`, the correspondence the edit implies and its commitment comparison; it never writes source.
Public types are `RelationEdit`, `RelationEditOptions`, `RelationEditPreview` and `RelationEditUnavailableReason`.

`graphCommitments(graph)` lists the distinct commitments a graph states: kind, sorted source Point keys, target and the Bearings stating it.
`entailment(stated, commitment)` returns the stated commitments that entail one commitment, or `undefined`.
A commitment entails itself, and a set jointly `concerns` a target once each member is a source of some relation to it; nothing else follows, so linked support is its own commitment while `[_]` grouping adds none.
`compareCommitments(before, after, correspondence)` returns `equivalent`, `refinement`, `weakening` or `revision` with the retracted and added commitments, removed, added and changed Points, and Bearings without continuation.
It is `indeterminate` for graphs with errors, another format version or an invalid correspondence.
`suggestCorrespondence` proposes a correspondence by name, unique text and continued endpoints, and reports ambiguity instead of choosing.
Public types are `Commitment`, `CommitmentComparison`, `CommitmentRelation`, `Correspondence`, `CorrespondenceBasis` and `CorrespondenceSuggestion`.
The comparison adds no fields to AST, Graph IR, Explain or source schemas.
