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
- [O /> @route] The inspection omitted the underside.
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
`supports`, `challenges` and `concerns` admit either target type; `answers`, `respondsTo` and `clarifies` require a Point.
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
For example, named `challenges` and symbolic `/>` may currently target the same Bearing but retain different target requirements in AST.
A change to the target's declaration can therefore affect their later compilation differently.

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

## Preview an explicit target

Use `cog explicit-target --line 3 inquiry.cog.md` to preview fixing the currently selected target of one occurrence.
The line is one-based in the complete input file; add `--input host` for a selected Cogitatum fence in Markdown.
Selecting a continuation line locates the same occurrence and edits its first-line annotation.
The command prints JSON and does not write to the input file.

Before the edit, the Ground below selects the Claim through ordinary body:

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=1
- [C @claim] The service needs inspection.
  - Evidence collected this morning
    - [G; @route] Two independent retries timed out.
      - [O/] Both may share a transient fault.
```

The preview inserts a clause into the selected annotation:

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=0
- [C @claim] The service needs inspection.
  - Evidence collected this morning
    - [G +> @claim; @route] Two independent retries timed out.
      - [O/] Both may share a transient fault.
```

The same three Points and two individual Bearings remain, including the objection to this particular route.
The source prose, occurrence ownership, note boundaries, indentation, names, handles and line endings are retained.
The change removes this occurrence's implicit-attachment advice and changes its attachment provenance from structural to explicit.
It does not decide whether the observations are independent or sufficient.

**This deliberately changes future editing behavior.**
Moving the Ground under another Claim will retain `@claim` as its target.
Changing its role will retain the explicit operator rather than select a new relation from local defaults.
Choose this operation when that is the intended commitment; it is not an automatic formatting fix.
The inserted operators retain their normal target requirements: `+>`, `->` and `~>` permit either kind; optional `/>` requires a Bearing.
Later changes to the target declaration therefore need their own review.

The operation handles ordinary implicit `supports`, `challenges`, `respondsTo` and `clarifies` attachments on Point declarations and uses, with an already named Point target.
It inserts a symbol where available, otherwise the canonical kind name.
It declines anonymous targets, local `G/`, `O/` or `Q/` selectors and local Bearing headers/source members.
Unattached `.`, `Q` and `C` occurrences have no implicit relation to make explicit; the preview does not interpret them as answers or relevance relations.
Already explicit clauses are reported as unavailable rather than receiving a duplicate clause.
Any error anywhere in the complete input withholds a preview, including an invalid or unclosed separate host fence.

A ready result includes `originalSource`, `proposedSource`, one insertion in `edit`, the original and proposed diagnostic lists, and the consequence for future moves and role changes.
The insertion offset counts UTF-16 code units in `originalSource`, not UTF-8 bytes.
Before applying a saved preview, an editor or caller must compare the complete current source with `originalSource`; any difference requires a new preview.
The command provides no delayed apply or file overwrite mode.
An unavailable result contains a reason and message, with no edit or proposed source.
Exit status is 0 for a ready preview, 1 for an unavailable preview or I/O failure, and 2 for invalid command options.

The Core implementation reparses the proposed complete input in the same mode.
It checks the ordered AST including occurrence text and note subtrees, allowing only the selected clause and source metadata to change.
It checks every graph's identities, entity order, contents, declarations, ordered sources, typed targets and names, allowing only the selected Bearing's provenance and source positions to change.
Diagnostics retain their ordered severity, code and starting location, except that the selected implicit-attachment suggestion may disappear.
Full messages are returned for review because they may embed changed source columns.
These checks establish the stated structural and source preservation conditions; they do not certify an interpretation of the prose.

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

A local Bearing member's syntactic eligibility and the header's outcome are reported separately.
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

## Preview local and explicit forms

```sh
cog bearing-form --line 3 --to explicit inquiry.cog.md
cog bearing-form --line 3 --to local inquiry.cog.md
```

Add `--input host` for Markdown; line numbers always address the complete original file.
Core provides `previewBearingForm(source, { line, form: 'local' | 'explicit', mode? })`.
The operation supports ordinary G/O/R/D attachments, G/O/Q selectors and local/explicit Bearing constructors.
It never writes a file.

Local → explicit fixes the existing relation and named endpoints.
For a joint, it moves the neutral source occurrences and their complete subtrees before the constructor,
outside enclosing Bearing contexts where they would otherwise become unintended sources or invalid descendants.
The header description and commentary remain on the constructor.
Explicit → local keeps declarations in place and introduces ordered neutral source uses for a joint.
It checks that the actual local context selects the same target.
It does not restore a previous source arrangement.

A ready preview preserves Point identities, declaration marks, content and names;
individual Bearings, descriptions, ordered sources and typed targets;
the expected AST transformation, literal subtrees, note origins and resolved ownership;
and unrelated diagnostic codes, severities and their owning occurrences.
Only the chosen relation's structural/operator provenance and implicit-through-body advice may change.
Reordering declarations may change generated keys and source locations.
Full before/after diagnostics remain available for review.
The implementation reparses and recompiles the complete input to check these conditions.

The preview declines errors anywhere in the input, unnamed required endpoints,
changes to Point roles, a different nearest local target, and relations without a local spelling.
In particular, `answers` and Point-targeted `concerns` stay explicit.
No missing premise, new authored name or role interpretation is supplied automatically.

Ready JSON includes `originalSource`, `proposedSource`, `edits`, both diagnostic lists and the editing consequence.
Each edit has a UTF-16 `offset`, exact `remove` text and `insert` text, addressing the original source.
Edits are ordered and non-overlapping; apply them in reverse order only after comparing the complete current source with `originalSource`.
A mismatch requires a fresh preview.
An unavailable result has a reason and message, without an edit or proposed source.
Exit status is 0 for ready, 1 for unavailable or I/O failure, and 2 for invalid options.

These are **structural previews**, not judgments of equivalent reasoning.
Source positions and reading arrangement may change.
Future moves and role edits can also behave differently: an explicit clause fixes its relation and target,
while a local form follows its mark and nearest context.
The older `explicit-target` operation retains its narrower, single-insertion contract.

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
