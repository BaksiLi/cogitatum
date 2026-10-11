---
title: Complete syntax
summary: Format 0.4.0 grammar, indentation, references, input modes, and machine contract.
section: reference
order: 4
---

# Complete syntax

Public reference for **format 0.4.0**, delivered by the **0.4.0-alpha.2** source candidate packages (not yet published). Syntax and machine contracts may change before a stable release. Examples, schemas, and conformance fixtures are checked against the implementation.

## Outline and body

Write a Markdown-style outline. Root blocks start at column one. Indent with spaces; a child can use any greater width, but a dedent must match an active ancestor level. Tabs, indented roots, and unmatched dedents are diagnosed and their apparent annotations are not compiled.

Every nonblank source line must be a bullet block beginning with `- ` after indentation. An annotation starts the block's content after that marker. Unmarked content remains body. Other line forms produce `UNSUPPORTED_LINE` and are not represented as blocks. Blank lines do not produce blocks. The AST preserves supported block order, raw block lines, body, and source spans; byte-for-byte whitespace round trips are not promised. This is a restricted outline parser, not a complete Markdown parser.

```md cog-check require=supports points=2 bearings=1 diagnostics=0
- Ordinary context.
  - [C @claim] A claim.
    - An unmarked explanation.
      - [G] A selected reason.
```

## Annotation grammar

```text
annotation := "[" (role | gap | material | edge | join) "]"
role       := ("Q" | "C" | "C?" | "G" | "O" | "R" | "D") [REF] [OP REF] [";" REF]
gap        := "?" [REF] [OP REF] [";" REF]
material   := REF [OP REF] [";" REF]
edge       := "edge" REF_LIST OP REF [";" REF]
join       := "join" [";" REF]
REF_LIST   := REF ("," REF)*
REF        := "@" ID
ID         := [a-z][a-z0-9_-]*
OP         := "+>" | "->" | "_>" | "~>"
```

Token order and case matter; `edge` and `join` are lowercase. Whitespace separates words and reference lists use commas. Each operator has exactly one target; an `edge` has one or more unique sources. Optional prose follows the closing bracket.

| Form | Effect |
| --- | --- |
| `[C]`, `[C? @claim]`, `[G]` | A role-bearing Point |
| `[?]`, `[? @gap]` | Open-gap Point |
| `[@passage]` | Named material Point without a role |
| `[O -> @claim]` | Anonymous Point and explicit challenge |
| `[G @reason; @route]` | Named Point and named structural Bearing, if the parent permits it |
| `[edge @a, @b +> @claim; @route]` | One joint Bearing between existing Points; no new Point |
| `[join; @route]` with direct Grounds | One structural joint support to the nearest enclosing Point; no new Point |
| Unmarked body or grouping | No Point or Bearing of its own |

Empty brackets, unfinished reserved prefixes, malformed operators, invalid names, repeated sources, and a bare `;` are errors. Invalid annotations remain inspectable in the AST. A valid Point can survive an error in its attached Bearing. `[Context for this section]` and its unclosed counterpart are ordinary body. Only a role token, `?`, `edge`, `join`, or `@` at the beginning selects annotation parsing; incorrect case and the retired `scope` prefix are also recognized so they can be diagnosed. Recognition does not make those invalid forms legal. A word beginning with a role letter, such as `Context`, does not select annotation parsing.

## Roles and connections

Roles are `Q` Question, `C` Claim, `G` Ground, `O` Objection, `R` Reply, and `D` Distinction.
`C?` is a Claim with open status; `[?]` is a Gap, a separate Point form that is always open.
A bare anchor marks named content without a role (`form: "material"`), a separate Point form.
Other roles cannot take `?`.
Open status is not a confidence score, and its absence does not certify acceptance or truth.

| Operator | Kind | Permitted target |
| --- | --- | --- |
| `+>` | `supports` | Point or Bearing |
| `->` | `challenges` | Point |
| `_>` | `undercuts` | Bearing |
| `~>` | `about` | Point or Bearing |

Outside a join, without an operator, use the nearest enclosing Point:

| Child | Parent | Derived kind |
| --- | --- | --- |
| `C`, `C?` | `Q` | `answers` |
| `G` | Any Point | `supports` |
| `O` | Any Point | `challenges` |
| `R` | `O` | `repliesTo` |
| `D` | Any Point | `clarifies` |
| `?` | Any Point | `about` |

Other combinations produce no structural Bearing. Body does not block lookup, but another Point does. An `edge` cannot be an implicit target: the first Point beneath it, possibly through body, needs an explicit operator and target. Once a Point is reached, its children use the ordinary indentation rules again. An operator overrides the structural default; it does not create a second connection.

Recognized malformed `edge` headers retain this boundary in the AST, including incorrect case, an unclosed bracket, and invalid `;` separators. Their descendants cannot acquire a default connection to an outer Point because the edge failed. Valid descendant Points, their ordinary subtrees, and relations with independent explicit targets remain available in the partial result. The exact keyword is reserved: `[edgeless]` remains ordinary body.

A top-level Objection is legal even without a target:

```md cog-check points=1 bearings=0 diagnostics=0
- [O @draft] A network fault could explain the same observations.
```

It creates one Point and no Bearing or diagnostic.
Similarly, a Claim beneath a Gap creates no default connection and does not answer a Question outside the Gap.
See [connections from indentation](bearings.md#connections-from-indentation) for paired examples.

`supports` means positive bearing without specifying deductive, inductive, abductive, explanatory, or interpretive method. No kind asserts success or validity. The graph adds no negation from absence or transitive closure. See [Bearings](bearings.md) for examples.

## Local joins

`[join]` or `[join; @route]` constructs one `supports` Bearing.
Its target is the nearest enclosing Point, possibly through ordinary body but never past another Point.
Its sources are all its direct child blocks, each a `G` Point without an operator, handle, or annotation error.
Their roles, content, optional anchors, and individual spans remain intact.
The join has no Point or operator clause of its own, and its Bearing uses `derivedBy: "structural"` and the header's span.
Optional prose after the header becomes that Bearing's `text`, exactly as prose after an `edge` does.
It is a description of the connection, not a new Point, member, or parsed argument.
An empty description leaves `text` absent.

A singleton is legal; an empty group or missing Point target is an error.
Direct body wrappers, other roles, direct edges, reference members, and direct joins are invalid.
A join cannot bypass an edge's explicit-target boundary.
Direct join nesting, even through body, is rejected; a join inside a member Point's subtree is a separate inference and is legal.
Use header prose to describe the joint; use `edge` to reuse existing Points.

Any invalid member rejects the whole joint, never a reduced source set.
First Points below the group, including through invalid body wrappers, receive no structural connection to the outer target even after rejection.
Valid Points and their own ordinary subtrees remain available.
A valid explicit member operator or direct edge remains an independently authored Bearing, subject to ordinary reference validation, while invalidating membership in the join.
A member's handle without an operator produces no default Bearing and receives `BEARING_HANDLE_WITHOUT_BEARING`.
Malformed member operators receive their normal syntax diagnostic and no fallback.
This preserves explicit intent without treating it as a joint source declaration.

Malformed reserved join annotations remain join constructs in the AST, including an unclosed prefix, so recovery cannot turn their members into unary support.
Membership/context failure yields no route to reference (`UNKNOWN_TARGET` for a subsequent handle reference).
A candidate rejected during ordinary name/reference validation follows the existing failed-Bearing dependency rules.
Duplicate member anchors invalidate the entire joint rather than deduplicating or dropping a source.
Distinct Points with the same prose remain distinct sources.

Unlike an `edge`, a join obtains its sources and target from the local structure.
An equivalent edge example must move the Grounds out of default-support placement while preserving their content, roles, names, status, and subtrees.
Use the same header description when comparing semantic content and topology after ignoring local keys, order, spans, Explain, and structural/operator provenance.
Leaving G children in place and adding an edge intentionally produces both unary and joint Bearings.
Neither construction adds reasoning closure, validity checks, minimality, or necessary-premise claims.

The 0.4.0-alpha.1 source rejects `[join]` with prose as `JOIN_BODY_UNSUPPORTED` and emits no joint Bearing.
The unpublished 0.4.0-alpha.2 source accepts it and preserves the description in the joint Bearing's `text`.
Previously legal notes, including joins without header prose, are unchanged.
Format 0.4.0 and its schemas remain unchanged: the AST already preserves header text, and Graph IR already admits optional Bearing text.

## Names and resolution

A Point name precedes its operator; a Bearing handle follows `;`. Both share one namespace within a source unit. Forward references work. Sources of an `edge` must resolve to Points; targets must satisfy their operator's kind restriction. Generated compilation keys cannot be used as authored names or references.

Duplicate Point anchors invalidate all Points with that anchor and dependent Bearings. Duplicate handles invalidate those Bearings. A Point/handle collision retains valid Points but rejects the conflicting route and ambiguous references. Bearings targeting a failed Bearing are rejected. A handle on an annotation that produces no Bearing is an error.

## Input modes

`document` compiles a standalone outline without a wrapper. `host` extracts document-level `cog` or `cogitatum` fences from mixed Markdown. `auto` uses host mode when it finds a Cogitatum fence candidate and otherwise document mode.

All input modes permit indentation-based authoring, explicit-relation authoring, or a mixture.
These writing techniques are not additional compiler input modes.
`derivedBy` records how an individual Bearing was produced, not the input mode or an authoring style for the document.
Only `supports`, `challenges`, `undercuts`, and `about` have explicit operators; `answers`, `repliesTo`, and `clarifies` are structural only.

Host integrations can use the source envelope to keep each independent fence paired with its AST, graph, and source locations:

```js
import { compileSource } from '@cogitatum/core';

const markdown = [
  'Introductory prose.',
  '',
  '```cog',
  '- [C @claim] A claim.',
  '  - [G] A reason.',
  '```',
].join('\n');
const result = compileSource(markdown, 'host');
const inquiries = result.units.map((unit, index) => ({
  unit,
  ast: result.documents[index],
  graph: result.graphs[index],
}));
```

Each fence compiles independently; anchors and compilation keys do not cross fences. `unit.startLine` and graph `sourceSpan` values locate results in the original host document. Source spans use one-based lines and UTF-16 columns. Keep each source unit paired with the projection at the same array index, and treat diagnostics as part of the result even when a partial graph is available.

````markdown cog-check input=host require=supports points=2 bearings=1 diagnostics=0
Context outside the selected inquiry.

```cog
- [C @claim] A selected claim.
  - [G] A reason.
```
````

Fences use at least three backticks or tildes with zero to three leading spaces; their first info word is exactly `cog` or `cogitatum`. A closer uses the same marker and at least the opener's length, independently indented zero to three spaces. Up to the opener's indentation is removed from each content line. Source spans retain host line and column positions.

Each fence has its own namespace and graph; references cannot cross fences. Missing, empty, unclosed, tab-indented, or over-indented Cogitatum fences produce diagnostics. The scanner does not parse host lists or blockquotes; use document-level fences. Host prose stays with the host document.

## Machine contract and CLI

`parseDocument` returns an ordered AST; `compileGraph` produces `GraphIR`. `parseSource` and `compileSource` expose envelopes for the input modes.

For debugging, `compileGraphWithExplain` and `explainSource` add a compiler trace: how a block was recognized, which points or connections were emitted or rejected, and why an indentation rule applied or no connection was produced. The CLI exposes this as `cog explain`.
Join recognition and `joinMember` effects identify the group span and syntactic membership eligibility; `join-membership` explains suppression of a default Bearing.
The header emits with `join-containment` or rejects with `invalid-join`; later name/reference rejection uses `validation-error`.
Membership eligibility does not certify that the whole join survived validation. It explains compilation decisions, not the truth of the prose, the strength of a reason, or a history of the author's thinking. The trace is an optional Alpha interface; ordinary integrations can use AST and Graph IR alone.

An AST block holds its text, raw source, children, span, and optional `annotation`. Role, anchor, status, operator, handle, and annotation errors live only inside `annotation`; there are no mirrored block-level semantic fields. A Point name appears as `annotation.anchor` in the AST and `id` in Graph IR. Ordinary body has no annotation. An `operatorClause` contains `op`, `sources`, and one authored `target: { id }`. Point annotations use `sources: "self"`; an `edge` uses a nonempty array of authored source references.

`compileGraph` and `compileGraphWithExplain` consume parser-produced ASTs of the current format and reject other format versions. They interpret `annotation`, not `raw`; changing an annotation does not rewrite the retained source text. To edit a note, change the source and parse it again. Importing arbitrary AST JSON requires validation first; compilation is not a general JSON validator.

| Entity | Compilation identity | Authored identity |
| --- | --- | --- |
| Point | Required `key` | Optional `id` |
| Bearing | Required `key` | Optional `handle` |

Graph references use `{ key, kind }`; AST references remain `{ id }`. Keys are opaque, nonempty strings, deterministic for one compilation and local to one graph, with no cross-revision promise. The current compiler emits keys such as `_p1` and `_b1`; consumers must not parse their prefixes or numbers, infer array indexes from them, or use them as authored references. Use `kind` to distinguish Point and Bearing references. A Bearing has `kind`, Point `sources`, one `target`, and `derivedBy: "operator" | "structural"`; optional text describes a route.

Explain emission references use graph keys; Bearing emissions also have a graph index and optional handle. The index addresses this compilation's Bearing array only. Emitted summaries obey the same kind/target restrictions as canonical Bearings. Rejected candidates can retain unresolved authored `{ id }` references or a resolved target of the wrong kind: that mismatch can explain the rejection. They are not graph entities. Diagnostic codes on an entry come from diagnostics whose source spans overlap that block; they can include diagnostics from its children. The top-level diagnostics retain their actual spans.

Format 0.4.0 reserves `join` and adds its AST and Explain variants.
Format 0.3.0 treated `[join; @route]` as ordinary body, so nested Grounds produced unary supports; reparsing that source now changes its graph deliberately.
Ordinary G defaults outside joins are unchanged.
Upgrade compiler, schemas, and consumers together; reparse source rather than relabelling 0.3.0 JSON.

Format 0.3.0 replaced generated Point IDs, optional Bearing IDs, ID-based graph references, mirrored AST block fields, and the AST operator's single-element `targets` array (now `target`). Consumers must migrate together; reparse older source rather than relabelling old JSON with the new version.

### Schemas for integrations

The source distribution's `spec/` directory contains JSON Schemas using draft 2020-12. The current development checkout includes AST, Graph IR, Explain, and source-envelope contracts through `@cogitatum/core/schemas/{ast,graph-ir,explain,source}`. The source-envelope schema refers to the other three by `$id`; load those sibling schemas too when validating it. The published npm `0.3.0-alpha.1` tarball includes only the first three exports. For example, in Node.js:

```js
import graphSchema from '@cogitatum/core/schemas/graph-ir' with { type: 'json' };
```

Schema `$id` values now use `/schemas/0.4.0/` and must change with the format contract.
Use the package copies for offline validation; this source candidate does not publish those URLs or update the hosted compiler.
The hosted website and published npm Alpha remain separate release surfaces.

The AST, Graph IR, and Explain schemas validate individual projections.
The source-envelope schema validates the shape of the multi-unit `parseSource` / `compileSource` / `explainSource` envelopes, including each projection through its sibling schema.

Schema validation checks field shapes, allowed variants, and local restrictions.
It does not establish equal lengths or correct index pairing of the envelope arrays, key or authored-name uniqueness across entities, reference existence, source-span ordering, agreement between Explain and its graph, or whether a graph follows from particular source text.
The compiler pairs source units with their projections and resolves names and references; conformance tests check its output invariants.
Passing a schema also makes no claim about the quality of the reasoning.

Canonical objects reject unknown fields. Integration metadata, confidence scores, inference-method profiles, and workflow history should be stored alongside the compiler output, with their own contracts, rather than injected into it. This keeps the meaning of existing Bearings explicit while leaving integrations free to add their own interpretations.

```sh
cog check inquiry.cog.md
cog ast inquiry.cog.md
cog graph inquiry.cog.md
cog explain inquiry.cog.md
cog check --input host notebook.md
cog --version
```

Commands output JSON; help and version output text. Exit status is `0` without error diagnostics, `1` for source or I/O errors, and `2` for invalid arguments. `--` ends option parsing for a filename starting with `-`. Warnings and suggestions do not fail a command. Diagnostics provide compiler evidence, not substantive review.

Native editor adapters, execution semantics, collaboration state, and Cogitatio runtime are outside this prerelease. For a working note, return to the [quick start](quick-start.md) or [examples](https://cogitatum.baksili.codes/examples).
