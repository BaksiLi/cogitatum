# @cogitatum/core

Cogitatum is a lightweight markup language for making selected reasoning structure explicit inside ordinary prose. This package provides its deterministic parser and compiler for Node.js and browsers.

Points are independently identified authored content, including questions and fragments; they need not be declarative sentences or truth-apt propositions.
Every relation is a relation plus one target term: `@name`, `^` for the nearest enclosing Point, or `^/` for the locally exposed Bearing.
In ordinary Point context, a marked occurrence without a clause constructs one Bearing toward its focus, the nearest presented Point occurrence.
The mark and the focus choose the kind; a clause replaces that default; at root there is no default attachment.
C beneath Q offers a candidate `answers` relation; elsewhere C and `.` record `concerns`.
G beneath Q records `concerns` with unbound support intention and suggestion `UNBOUND_GROUND_UNDER_QUESTION`; elsewhere it records `supports`.
O/Q/R/D record `challenges` / `concerns` / `respondsTo` / `interprets`.
The focus occurrence's own mark matters: `[Q use @q]` is a Question focus, `[. use @q]` is not, regardless of q's declaration.
Body is transparent, Notes literal, and a nearer Point blocks an outer Q.
Direct neutral constructor members remain sources of only the joint Bearing.
To leave an addressable Point unattached, place it outside every Point focus and Bearing context; one outdent may only rebind it.

This checkout is unreleased **0.7.0**, format **0.7.0**; the published baseline is Core/CLI **0.6.2**, format **0.6.0**.
`point` / `.` and `bearing` / `_` share construction, use and local note operations.
The former `node` and `edge` aliases receive `RETIRED_FAMILY_ALIAS`, with no compiling fallback.
A Bearing constructor writes `[_ OP TARGET]`: its direct neutral children are its ordered sources, or `[_ @a, @b OP TARGET]` lists them; `[_]` and `[_/]` record joint `concerns`.
The first token after the family spelling selects construction, `use` for reuse or `note` for note mode; a role letter such as `[_ G]` is `MALFORMED_BEARING_MODE`.
`[. note]` and `[_ note]` select the nearest context's Point or Bearing, with literal subtrees and no outward fallback.
`GraphIR.notes` links each authored record to its resolved target and owning AST block.
Complete `compileSource` / `explainSource` envelopes preserve the text and subtree; Graph IR alone omits note prose.
Local and explicit Bearing descriptions use the same source ownership; `Bearing.text` derives only from the constructor's prose, including continuations.
`->` and named `challenges` accept a Point or Bearing, emitting `challenges` with a typed target; `/>` and `_>` are retired with `RETIRED_AUTHORING_SYNTAX`.
`interprets` offers a reading, without certifying clarity or correctness; a distinction is one way to interpret.
The retired `clarifies` clause receives `RETIRED_BEARING_KIND` without fallback.
`interprets` and `concerns` likewise accept either target; `answers` and `respondsTo` require a Point.
Constructors, Point declarations and Point uses accept all six canonical kind names, alongside the three symbolic operators; named `undercuts` is rejected.
`R` is Response; `[Q @question respondsTo @objection]` retains its local Q mark and constructs one response without implying an answer, rebuttal, parties or turns.
Named clauses never impose global declaration-role checks; retired `repliesTo` receives a migration error, without default fallback.
Reference-only `[. use @p]` or locally marked `[G use @p]` occurrences resolve an existing Point without copying its subtree or changing declaration metadata.
Neutral Point use constructs relevance in ordinary Point context and stays unattached at root.
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
They construct `supports`, `challenges`, `concerns` and `interprets` respectively, without adding to the selected Bearing's sources.
`[Q/ use @q]` reuses Point content with a local Q mark; notes and occurrence prose keep their existing ownership.
Selectors never cross a nearer unattached Point or failed context.
Occurrence prose, local marks and original UTF-16 spans remain in AST/Explain; focusPoint maps each use to a typed Point ref, and rejectFocus explains lookup failure.
focusBearing similarly maps Bearing occurrences; selectBearing identifies a referenced context without claiming attachment ownership.
Canonical spans remain declaration/construction spans; several uses may map to the same entity.
Every successfully emitted structural Bearing has an `implicitAttachment` effect whose `contextSpan` identifies the local selected occurrence.
Its `targetSpan` identifies the canonical target and may differ when a Point or Bearing is reused.
`crossedBodySpans` is empty for direct containment.
A nonempty list triggers through-body advice for C→`answers`, G→`supports`, O/Q/R/D, selectors and constructors, but not weak default relevance.
Failed relations and named target clauses have no successful implicit-attachment effect; positional clauses still record their selected context.
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
Use the matching Core and schema versions; do not send 0.7 notes to an older compiler.
The following installs the published 0.6 baseline; use the [source checkout](../../README.md#release-status) for the 0.7 behavior documented here.

```sh
npm install @cogitatum/core@0.6.2
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

Experimental debugging APIs, `compileGraphWithExplain` and `explainSource`, add a compiler trace of recognition, emitted or rejected entities, occurrence framing, and diagnostics. This trace explains compilation decisions; it does not assess reasoning or record inquiry history. Use AST and Graph IR for integrations that do not need it.

## Example support and framing

`by example` modifies a constructed `supports` Bearing: `[G by example]` beneath a non-Q focus, `[. +> @claim by example]`, or `[_ +> ^ by example; @route]`.
It records the sources as one offered example, selecting no inference scheme or assessment of truth, representativeness or sufficiency.
The AST stores `annotation.profile: "example"` and Graph IR stores `profile: "example"` only on the support Bearing.
Point reuse does not transfer it; a Bearing use presents the same profiled Bearing.
Unknown or missing profiles receive `MALFORMED_BEARING_PROFILE`, with `syntaxErrors` value `"profile"`.
A profile without a support receives `PROFILE_REQUIRES_SUPPORTS`; the Point survives but no fallback Bearing is constructed.
Explain `rejectBearing` uses reason `unsupported-profile` for an incompatible profile.
Adding the profile refines plain support; checked relation edits refuse to join, separate or kind-decide it (`profiled-relation`), while `previewTargetForm` preserves it.

`previewFramingEdit(source, { operation: "remark", line, mark })` changes a written mark (`.`/Q/C/G/O/R/D) only when every relation stays the same.
It is available for explicit clauses and unattached roots; changing a default relation is refused as `changes-relation`.
`{ operation: "split", line }` repairs opposed framing on a named Point: `[O @cost +> @delay]` becomes `[G @cost +> @delay]` plus root `[O use @cost]`, retaining an unbound objection intention.
A nested objection use would instead construct a challenge.
Ready previews report before/after `framing`, `declarationChanged`, and `addedLine` for a split, alongside the proposed source and minimal `SourceEdit`; they never write source.
Public types are `FramingEdit`, `FramingEditOptions`, `FramingEditPreview` and `FramingEditUnavailableReason`.
`analyzeSourceEdits(source, mode?).preview(...)` accepts `{ kind: "framing", edit }`, as well as relation and target-form requests.

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

An editor that has already called `explainSource(source, mode)` may pass that result as a third argument; it must be the compilation of the same source and mode.

`SourceReferenceAnalysis`, `ReferencedName` and `WrittenReference` are exported TypeScript types.
The result is a separate analysis projection, not an instance of the Source envelope schema; `version` identifies the underlying format, while the package/source revision identifies this API.
No existing AST, Graph IR, Explain or Source schema is extended.

## Highlighting

`tokenizeSource(source)` returns one `SourceLine` per line of a document-mode unit, whose token texts concatenate back to the line exactly:

```js
import { tokenizeSource } from '@cogitatum/core';

for (const line of tokenizeSource(source)) {
  for (const token of line.tokens) paint(token.text, token.kind); // kind is undefined for prose
}
```

Kinds are `bullet`, `mark` (brackets, `.`, `_`, family words, `use` and `note`), `role`, `name`, `operator`, `relation`, `punct`, `code`, `note` (a literal note line) and `retired` (a spelling the compiler diagnoses).
`line.role` is the header's first mark as written, such as `G/`, `.`, `_` or `note`, for hosts that tint a whole header.
Tokens are lexical only: a highlighted name may be unknown, and a role may sit on a failed boundary; diagnostics remain the compiler's.
`tokenizeHostSource(source, mode)` places the same lines in a whole file:
each `PlacedSourceLine` adds its one-based host `line` and the one-based UTF-16 `column` of its first token.
A Markdown host contributes only its fences, and an indented fence's tokens start after the indentation Core removed.

## Graph inspection

Core exports `formatGraph(graph: GraphIR): string` and `GRAPH_TEXT_VERSION` (`"1"`).
The formatter reads one compiled graph and returns a deterministic plain-text entity table and relation list, preserving typed identities, declaration metadata, names, text, support profiles and ordered sources.
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
A mark's default clause is not written into the AST.
Resolve Point defaults from both the occurrence mark and its focus through Explain; the annotation alone does not determine the kind.
Using a Point as an explicit source preserves its declaration metadata; indentation defaults do not add global role restrictions to explicit construction.
Match the **0.7.0** schemas and compiler; older JSON must be recompiled from retained source, not relabelled.

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
This bundle describes format 0.7.0; published Core/CLI 0.6.2 uses format 0.6.0.
Published schemas are preserved in the source repository's `spec/0.6.0/` and `spec/0.5.0/`.
The envelope keeps source units and projections in parallel arrays, paired by index.
Schemas check data shapes; array alignment, reference integrity, and agreement with source remain compiler guarantees.
Keys are opaque strings: their numbering is not an integration contract.
Store application metadata separately from canonical compiler output.
The source-envelope export is absent from the historical npm `0.3.0-alpha.1` tarball.

Read the [introduction](https://onesimos.org/docs/introduction), [syntax](https://onesimos.org/docs/syntax), or try the [playground](https://onesimos.org/playground).

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
Explain `frameOccurrence { framing, intention?, focus? }` records aligned, compatible, opposed, unbound or no framing per Point occurrence.
G with a challenge clause and O with a supports clause are opposed (`OPPOSED_FRAMING`); the clause alone constructs the relation.
Graph IR has no framing and cannot certify its preservation or that of Notes.
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
An unbound G beneath Q also receives `preservation-failed`: naming its relevance would lose the unbound support intention.
Use a relation retarget preview to bind that intention deliberately.
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

`previewRelationEdit(source, edit)` previews deciding a relation's kind, separating a member-sourced group into one relation per member, joining adjacent sibling relations into a group, or retargeting a relation.
`{ operation: "retarget", line, target: { id: "answer" } }` gives one relation a new target, preserving kind, sources and position; positional targets use `{ local: "point" }` or `{ local: "bearing" }`.
For G left unbound beneath Q, retargeting binds its support intention: `[G @g]` becomes `[G @g +> @answer]`.
Deciding a default support G as `concerns` writes `[.]`.
A ready preview carries the proposed source, one minimal `SourceEdit`, the correspondence the edit implies and its commitment comparison; it never writes source.
Public types are `RelationEdit`, `RelationEditOptions`, `RelationEditPreview` and `RelationEditUnavailableReason`.

`graphCommitments(graph)` lists the distinct commitments a graph states: kind, optional support profile, sorted source Point keys, target and the Bearings stating it.
`entailment(stated, commitment)` returns the stated commitments that entail one commitment, or `undefined`.
A commitment entails itself, example support entails plain support but not conversely, and a set jointly `concerns` a target once each member is a source of some relation to it; no additional inference follows, so linked support is its own commitment while `[_]` grouping adds none.
`compareCommitments(before, after, correspondence)` returns `equivalent`, `refinement`, `weakening` or `revision` with the retracted and added commitments, removed, added and changed Points, and Bearings without continuation.
It is `indeterminate` for graphs with errors, another format version or an invalid correspondence.
The classification concerns recorded connections and Point selection; `equivalent` does not certify unchanged prose or declaration marks.
Changed Point content and declarations are reported for separate review, and notes and ordinary body remain outside the comparison.
`suggestCorrespondence` proposes a correspondence by name, unique text and continued endpoints, and reports ambiguity instead of choosing.
Public types are `Commitment`, `CommitmentComparison`, `CommitmentRelation`, `Correspondence`, `CorrespondenceBasis` and `CorrespondenceSuggestion`.
The comparison is a separate result contract; it reports `bearings.changed` for per-Bearing profile changes even when aggregate commitments are equivalent.
