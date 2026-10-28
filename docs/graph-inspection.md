---
title: Graph inspection
summary: Read compiled structure as text, with explicit preservation and comparison limits.
section: reference
order: 5
---

# Graph inspection

Cogitatum 0.5 provides a plain-text inspection view of one compiled graph.
It exposes individual Points and Bearings without reconstructing the author's document or evaluating its reasoning.
This page specifies the `structure-v1` projection and graph-text version 1 retained by the Core/CLI 0.6.0 checkout.
The notation version stays 1; note records and their prose remain outside this bounded structural view.
The projection is the bounded preservation contract for the first inspection view; broader source rewriting and theoretical interpretations require their own contracts.

## Inspect a document

Build the source checkout, then run:

```sh
npm run cog:dist -- graph --format text inquiry.cog.md
```

Installed CLI packages expose the same operation as `cog graph --format text inquiry.cog.md`.
`cog graph` reads source, parses it and compiles its Points and Bearings.
Its name identifies the result to inspect, just as `cog ast` identifies the parsed source tree.
`cog check` and `cog explain` also compile, returning diagnostics and a compilation trace respectively; there is no separate compilation step to run first.
`--format` selects the output representation of that compilation: JSON by default, or the text projection below.
`cog graph` and `cog graph --format json` return the same JSON output.
The JSON data's `version` identifies the compiler format contract; the CLI's `--format json|text` option does not select a language version.
Neither option rewrites source or calls an LLM.
For an already compiled Graph IR in a program, call Core `formatGraph(graph)`; the CLI's file argument expects source rather than saved Graph IR JSON.
Graph text inspection accepts `document` input only.
Host input can contain several independent source units and source-selection errors; use its complete JSON envelope rather than silently formatting one surviving graph.

For example:

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=0
- [C @claim] The bridge is safe.
  - [G @inspection; @route] Yesterday's inspection found no defects.
- [O -> @route] The inspection omitted the underside.
```

```text graph-text-reference
cogitatum-graph-text 1
format: "0.6.0"
projection: structure-v1
status: no-errors

points (3):
p1: role(C) id="claim" text="The bridge is safe."
p2: role(G) id="inspection" text="Yesterday's inspection found no defects."
p3: role(O) text="The inspection omitted the underside."

bearings (2):
b1: supports([p2], p1) handle="route"
b2: challenges([p3], b1)

diagnostics (0):
```

The second relation targets `b1`, the inspection step; targeting `p1` would challenge the claim itself.
`supports([p2, p3], p1)` would be one joint step, whereas two separate Bearing rows would remain two distinct steps.
A Serial structure retains its intermediate Point and each step; the formatter adds no transitive support.

## Structural contract

For format 0.6.0, a graph has finite, disjoint typed identity sets of Points and Bearings.
Each Bearing has a nonempty, duplicate-free, ordered sequence of Point sources and one typed Point or Bearing target.
`supports`, `challenges`, `concerns` and `clarifies` admit either target type; `answers` and `respondsTo` require a Point.
Point declaration metadata is `role` with its role, or `material` without a role.
Neither form carries an open or resolved status.
Authored names are separate from compilation-local keys.
Refer to [the machine contract](syntax.md#machine-contract-and-cli) for field definitions and source-unit scope.

Schema validity checks JSON shape and local restrictions.
A well-formed graph additionally needs unique identities, resolved typed references and source uniqueness by identity.
Compiler-produced graphs also reflect a particular source and its compilation rules; schema validation alone does not establish that provenance or agreement with source.
The formatter consumes current compiler-produced Graph IR, not arbitrary unvalidated JSON.
It rejects an unsupported version, duplicate typed keys, dangling references or an invalid source set rather than printing guessed endpoints.
These checks protect the representation; they are not a complete graph validator.

Identity remains significant even when two Points have identical text or two Bearings have identical kinds and endpoints.
Sources retain their order without treating that order as a sequence of inference.
Isolated Points, shared premises, intermediate Points, self-references and cycles remain representable.
A cyclic reference prints a label rather than recursively expanding the target.
A Bearing-targeted challenge addresses that individual relation, including a joint relation; it creates no extra member-to-conclusion supports.
No graph row asserts truth, logical validity, defeat, acceptability or resolution.

## What structure-v1 preserves

| Graph information | Treatment |
| --- | --- |
| Format version | Printed explicitly |
| Each Point and Bearing identity | Replaced by a distinct output-local `pN` or `bN` label, used consistently in every reference |
| Point `declaration`, `text`, optional `id` | Preserved; declaration records its form and applicable role |
| Bearing `kind`, ordered `sources`, typed `target`, optional `handle` and `text` | Preserved, including separate instances with equal endpoints |
| Optional name/text absence versus empty string | Preserved by omitting the field or printing `=""` |
| Point and Bearing array order | Used to allocate and print labels; no sorting or deduplication |
| Compilation key spelling | Omitted; labels do not promise persistence between exports or revisions |
| Entity `sourceSpan` and Bearing `derivedBy` | Omitted from the structural projection |
| `notes` source/target records | Omitted; identical structure text does not establish equal object notes |
| Diagnostics | Reported separately in original order, including severity, code, message, optional span and explanation |
| Original source, ordinary body, note prose and literal subtrees, use-occurrence prose and marks, AST target requirements, Explain trace | Not part of Graph IR and not reconstructed |

Always retain the original input, input mode, compiler/package version and complete source envelope when source fidelity or reproducibility matters.
A graph-only export cannot recover omitted context or distinguish two source spellings that compile to the same graph.
For example, `[G]` and `[G +> ^]` compile the same Bearing, but AST records whether the mark supplies the relation or the author wrote it out.
Changing the mark later therefore changes the first relation and leaves the second as written.

## Comparison boundaries

A structural comparison under `structure-v1` applies within one format version to graphs without error diagnostics.
It permits a separate bijection of Point identities and Bearing identities, preserving every Point's declaration, text and optional name, and every Bearing's kind, ordered sources, typed target, optional handle and text.
It may ignore compilation-key spelling, entity array order, entity spans and `derivedBy`.
Diagnostics must still be reviewed separately; a matching surviving subgraph cannot make a failed compilation equivalent to a deliberate omission.

This defines a comparison scope, not a public comparison algorithm.
Text output is deterministic for the same graph and notation version, but isomorphic graphs with different array order need not produce identical strings.
The notation is not a canonical graph hash or a decoder-backed interchange format.
JSON remains the machine interchange representation.

Adding an anchor changes retained authored identity metadata, so that edit does not preserve this projection unchanged.
Reordering a Bearing's source list also changes it.
Changing a Point's declaration from C to G changes it even if the connections remain the same.
Conversely, a local and explicit form may preserve the projection while changing occurrence prose, literal boundaries or future attachment behavior.
The [reconstruction comparisons](syntax.md#reconstruction-choices) show how Linked and Serial arrangements differ; they do not license arbitrary outline rearrangements.

## Text and diagnostic rules

Labels are assigned in array order, starting at `p1` and `b1`, independently of authored names and raw key spelling.
An authored name such as `p1` is printed as `id="p1"` or `handle="p1"`; it never replaces an output label.
Fields containing arbitrary text are JSON-quoted without Unicode normalization.
Control and format characters, including bidirectional overrides, and Unicode line/paragraph separators are escaped as UTF-16 `\uXXXX` sequences.
Each entity occupies one physical line; literal backslashes and quotes cannot introduce extra records.
Output uses LF line endings and one final LF, without terminal colour sequences.

`status: no-errors` means only that the supplied graph contains no error diagnostic.
Warnings and suggestions remain visible; absence of errors does not certify a complete or successful argument.
`status: partial` means error diagnostics exist, so the displayed graph may omit rejected constructions.
All supplied diagnostics are printed, including those on an empty graph.
The CLI retains exit status 0 for no compilation errors, 1 for compilation or I/O failure, and 2 for invalid arguments.
Argument errors retain JSON diagnostics even when text output was requested.

## Review names before a deliberate edit

The CLI offers `cog check --references inquiry.cog.md` to inspect written references before renaming an observation or reviewing which names to retain.
Run it on the complete file; use `--input host` for Markdown.
This is a read-only inventory, not an automatic cleanup rule.

Here both Points participate in a connection, but neither name has a written reference:

```md cog-check points=2 bearings=1 diagnostics=0
- [C @sampling] Wait ten minutes before sampling.
  - [G @measurement; @route] Drift was below 0.1% after ten minutes.
```

The connection comes from indentation.
The inventory lists `sampling`, `measurement` and the Bearing handle `route`, each with an empty reference array.
That does not justify removing them: a host or a later revision may rely on those names.

Conversely, this measurement has a written reference even though it participates in no Bearing:

```md cog-check points=1 bearings=0 diagnostics=0
- [. use @measurement] Revisit the calibration record.
- [. @measurement] Drift was below 0.1% after ten minutes.
```

The inventory records the forward Point use on the first line.
This is complete without a Bearing or an isolation diagnostic.
Ordinary prose mentions and literal note descendants do not count as syntax references.

Point uses, Bearing uses, explicit ordered sources and explicit targets appear separately in the inventory, with their containing block locations.
Each host fence has its own namespace.
If any selected input has errors, including an omitted unclosed or nested fence, the inventory is explicitly unavailable rather than reporting zero references.
Names with no written references generate no new warnings, and the command never edits the source.

## Compare commitments across revisions

A structural comparison asks whether two graphs are the same.
A commitment comparison asks what a revision retracted and what it added.
It distinguishes a refinement, which only adds, from a revision, which also retracts.

A commitment is a relation kind, an unordered set of sources and a target.
Several Bearings may state one commitment; they stay distinct entities when something addresses them.
Entailment between commitments has exactly two rules:

- A commitment entails itself.
- Every relation commits each of its sources to bearing on its target.
  So a set jointly concerns a target once each member is a source of some relation to it, of any kind.

Only relevance distributes.
Joint support gives no member support of its own, separate supports are not one joint support,
and bearing on a step is not bearing on its conclusion.
Linked support is therefore a commitment of its own, while grouping under `[_]` adds none:
`[_]` leaves open how its members bear, and refining it may decide that they bear together, separately or with a further premise.
A grouping still matters as an entity when another relation addresses it.
So `[_]` refined to `[_ +> ^]`, or split into sibling `[G]` occurrences, is a refinement,
while merging two `[G]` into one `[_ +> ^]` is a revision.
Selecting a Point is also counted: adding one refines and removing one retracts.

| Before | After | Relation |
| --- | --- | --- |
| `[_]` with members a, b | `[_ +> ^]` with members a, b | refinement |
| `[_]` with members a, b | `[G] a` and `[G] b` | refinement |
| `[G] a` and `[G] b` | `[_ +> ^]` with members a, b | revision |
| `[_ +> ^]` with members a, b | `[_]` with members a, b | weakening |
| `[_]` with member a | `[_ +> ^]` with members a, b | refinement |
| `[_]` with members a, b | `[_]` with member a | weakening |
| `[O/]` on a step | `[O]` on its conclusion | revision |
| `[G]` | `[G +> @claim]` | equivalent |

Comparing two revisions requires knowing which entity continues which.
Core does not infer this silently.
`suggestCorrespondence(before, after)` proposes pairs by authored name, unique text and continued endpoints,
lists every entity with several plausible continuations, and never chooses among equals.
An edit tool knows what it moved and passes its own correspondence to `compareCommitments(before, after, correspondence)`.
Continuity establishes identity only: a continued Point whose text or declaration changed is reported, not weighed.
Graphs with errors, other format versions and invalid correspondences are `indeterminate`.

The order classifies what an author committed to, never whether a reading is correct.
Notes, body prose, names, marks, source order and positions are presentation; review their changes separately.

## Preview relation edits

```sh
cog relation-edit --line 2 --decide supports inquiry.cog.md
cog relation-edit --line 2 --separate inquiry.cog.md
cog relation-edit --join 2,4 inquiry.cog.md
```

Three edits change recorded relations without touching Point text:

- `--decide <kind>` gives the relation on a line another kind, such as `[_]` to `[_ +> ^]` or `[G]` to `[O]`.
  A pure relation mark exchanges its letter; `Q`, `C` and neutral headers keep their mark and write the clause, as `[Q/]` to `[Q -> ^/]`.
- `--separate` replaces a group whose sources are its direct members with one relation per member, each keeping the group's kind and target.
- `--join` is its inverse: adjacent sibling relations of one kind and written target become the members of one new group.

Each preview knows which entity continues which, so it supplies its own correspondence to `compareCommitments` and reports the resulting relation.
The author sees whether the edit is a refinement, which only adds, or a weakening or revision, which retracts something already recorded.
So deciding `[_]` as joint support, or separating it into supports, is a refinement; joining two supports is a revision.

The preview recompiles the complete proposed source.
It is unavailable when the input or result has errors, when Points would be added, removed or reworded, or when anything beyond the edited relations would change.
Groups with a handle, a description or children other than members cannot be separated, and relations with a handle cannot be joined, because another relation may address them as entities.
`Q` and `C` occurrences cannot be joined either: a member keeps only its operand, and their marks also declare the Point.
Core provides `previewRelationEdit(source, { operation, line | lines, kind?, mode? })`; the command prints JSON and never writes to the input file.

## Preview named and positional targets

```sh
cog target-form --line 3 --to named inquiry.cog.md
cog target-form --line 3 --to positional inquiry.cog.md
```

Every relation ends in one target term: a name, or the positional `^` / `^/` that the outline resolves.
`target-form` previews exchanging one for the other in the occurrence on the given line.
The line is one-based in the complete input file; add `--input host` for a selected Cogitatum fence in Markdown.
Selecting a continuation line locates the same occurrence and edits its first-line annotation.
Core provides `previewTargetForm(source, { line, form: 'named' | 'positional', mode? })`.
The command prints JSON and never writes to the input file.

Before the edit, the Ground below selects the Claim through ordinary body:

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=1
- [C @claim] The service needs inspection.
  - Evidence collected this morning
    - [G; @route] Two independent retries timed out.
      - [O/] Both may share a transient fault.
```

`--to named` writes the target that `[G]` currently abbreviates:

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=0
- [C @claim] The service needs inspection.
  - Evidence collected this morning
    - [G +> @claim; @route] Two independent retries timed out.
      - [O/] Both may share a transient fault.
```

The same three Points and two individual Bearings remain, including the objection to this particular route.
`--to positional` on the second document restores the first; the two directions are one edit read both ways.
It does not decide whether the observations are independent or sufficient.

The edit changes only the target term, and the relation or selector slash it needs.
A mark's default relation is written out when its target is named, and omitted again when the result is the mark's own default: `[G +> ^]` becomes `[G]`, and `[O -> ^/]` becomes `[O/]`.
For a constructor, only the header's target changes; its members stay where they are, still its sources.
Spacing, names, handles, prose, note boundaries and line endings are retained.

**This deliberately changes future editing behavior.**
A named target stays fixed when the occurrence moves; a positional one follows the nearest Point or exposed Bearing.
A written relation stays when the mark changes; an abbreviated one follows the mark.
The `consequence` text states both effects for the chosen edit.
Choose this operation when that is the intended commitment; it is not an automatic formatting fix.

The preview declines errors anywhere in the input, including an invalid or unclosed separate host fence,
anonymous targets, occurrences that state no relation (`.` and `C`), a source member of a constructor (select the constructor instead),
and a target that is already in the requested form.
A positional target must resolve to the same entity at the occurrence's position.
No missing premise, new authored name or role interpretation is supplied automatically.

A ready result includes `originalSource`, `proposedSource`, one `edit` with a UTF-16 `offset`, exact `remove` text and `insert` text, both diagnostic lists, and the consequence.
The edit is the minimal one between the two annotations.
Before applying a saved preview, an editor or caller must compare the complete current source with `originalSource`; any difference requires a new preview.
An unavailable result contains a reason and message, with no edit or proposed source.
Exit status is 0 for a ready preview, 1 for an unavailable preview or I/O failure, and 2 for invalid command options.

The Core implementation reparses and recompiles the proposed complete input in the same mode.
It checks the ordered AST including occurrence text and note subtrees, allowing only the selected clause to change.
It checks every graph's identities, entity order, contents, declarations, ordered sources, typed targets and names, allowing only the selected Bearing's structural/operator provenance to change.
Diagnostics retain their ordered severity, code and owning occurrence, except that implicit-through-body advice may appear or disappear.
These checks establish the stated structural and source preservation conditions; they do not certify an interpretation of the prose.

The published `explicit-target` command and `previewExplicitTarget` were retired in 0.6: the command now reports `RETIRED_COMMAND` and points here.

## Inspect every local decision

```sh
cog explain --format text inquiry.cog.md
cog explain --input host --format text notes.md
```

Explain text shows every active occurrence and every compiler effect:
its selected context, ordered sources, typed target, reuse, note ownership,
joint membership or commentary, and why a Bearing was emitted, skipped or rejected.
It distinguishes a failed candidate from a surviving graph entity.
Ordinary body crossings and failed nearest contexts stay visible; nothing silently searches outward.
Literal note descendants remain owned by their note header and have no active decisions.

A constructor member's syntactic eligibility and the header's outcome are reported separately.
Explain names the surviving Bearing that includes the source, or states that the rejected header created none.
Unlike graph text, Explain text accepts host input.
It prints each independent selected unit and all aggregate diagnostics, including an unclosed fence that produced no unit.
Names and compilation-local keys are shown with source locations.
The header `cogitatum-explain-text 1` identifies this readable trace notation; it is not a source formatter or interchange decoder.
Core provides `formatExplain(explainSource(source, mode))` and `EXPLAIN_TEXT_VERSION`.
JSON Explain and the complete `export` envelope remain available.

The View package's Reading presents the same evidence beside the source:
selecting a row draws a rail from the context row that indentation selected, marks crossed body,
and states the decision in one line, such as `From indentation: challenges @g (L2), the nearest enclosing Point.`
Rows that create no relation say so, which makes Q, C and neutral Points' lack of implicit relations visible.

## Core API and compatibility

```ts
import { compileGraph, formatGraph, GRAPH_TEXT_VERSION, parseDocument } from '@cogitatum/core';

const graph = compileGraph(parseDocument(source));
const text = formatGraph(graph);
```

`formatGraph(graph: GraphIR): string` is pure and operates on exactly one graph.
It performs no parsing, repairs, inference or source rewriting.
When calling it on a graph extracted from a host envelope, the caller must separately retain and surface the envelope's aggregate diagnostics and unit scope.
The CLI deliberately rejects host graph text until a batch representation is specified.

`GRAPH_TEXT_VERSION` is `"1"`; it identifies the notation independently of `FORMAT_VERSION`.
The header records both versions.
Changing the spelling/layout of records or the projection requires a new notation version; supporting a future Graph IR format requires an explicit preservation review.
The formatter adds no further JSON schema change beyond the breaking [0.5 format migration](syntax.md#compatibility-and-migration); default graph output remains JSON.
The experimental View package's source-aware Reading consumes original input and a matching `explainSource` result; graph-text output is not its input or an intermediate source representation.
Its Map geometry and selection do not change Graph IR or source.
LaTeX, decoders and theoretical adapters remain separately scoped.
