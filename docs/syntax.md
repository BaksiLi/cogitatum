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
annotation := "[" (role | gap | material | edge | linked | selector) "]"
role       := ("Q" | "C" | "C?" | "G" | "O" | "R" | "D") [REF] [OP REF] [";" REF]
gap        := "?" [REF] [OP REF] [";" REF]
material   := REF [OP REF] [";" REF]
edge       := "edge" REF_LIST (OP | KIND) REF [";" REF]
linked     := "linked" [";" REF]
REF_LIST   := REF ("," REF)*
REF        := "@" ID
ID         := [a-z][a-z0-9_-]*
OP         := "+>" | "->" | "_>" | "~>"
selector   := ("G_" | "O_") [REF] [";" REF]
KIND       := "supports" | "challenges" | "undercuts" | "about"
            | "answers" | "repliesTo" | "clarifies"
```

Token order and case matter; `edge` and `linked` are lowercase. Whitespace separates words and reference lists use commas. Each operator has exactly one target; an `edge` has one or more unique sources. Optional prose follows the closing bracket.

| Form | Effect |
| --- | --- |
| `[C]`, `[C? @claim]`, `[G]` | A role-bearing Point |
| `[?]`, `[? @gap]` | Open-gap Point |
| `[@passage]` | Named material Point without a role |
| `[O -> @claim]` | Anonymous Point and explicit challenge |
| `[G @reason; @route]` | Named Point and named structural Bearing, if the parent permits it |
| `[edge @a, @b +> @claim; @route]` | One joint Bearing between existing Points; no new Point |
| `[linked; @route]` with direct Grounds | One structural joint support to the nearest enclosing Point; no new Point |
| Unmarked body or grouping | No Point or Bearing of its own |

Empty brackets, unfinished reserved prefixes, malformed operators, invalid names, repeated sources, and a bare `;` are errors.
Invalid annotations remain inspectable in the AST; a valid Point can survive an error in its attached Bearing.
`[Context for this section]` and its unclosed counterpart are ordinary body.
A role token, `?`, `edge`, `linked`, or `@` at the beginning selects annotation parsing; incorrect case and the retired `join` and `scope` prefixes are also recognized for diagnostics.
Recognition does not make invalid forms legal.
Words such as `Context`, `joined`, and `linked-data` do not select annotation parsing.
Annotation-shaped `[linked evidence]` is now reserved and diagnosed instead of remaining transparent body; `[join the debate]` likewise receives the retirement diagnostic.
To keep such text as ordinary prose, omit the annotation-shaped brackets or place prose before them.

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

Outside a linked block, without an operator, use the nearest enclosing Point:

| Child | Parent | Derived kind |
| --- | --- | --- |
| `C`, `C?` | `Q` | `answers` |
| `G` | Any Point | `supports` |
| `O` | Any Point | `challenges` |
| `R` | `O` | `repliesTo` |
| `D` | Any Point | `clarifies` |
| `?` | Any Point | `about` |

Other combinations produce no structural Bearing. Body does not block lookup, but another Point does. An edge supplies a Bearing context: its first unsuffixed Point, possibly through body, needs an explicit operator and target. G_/O_ may instead select its owned attachment. Once a Point is reached, its children use the ordinary indentation rules again. An operator overrides the structural default; it does not create a second connection.

Recognized malformed `edge` headers retain this boundary in the AST, including incorrect case, an unclosed bracket, and invalid `;` separators. Their descendants cannot acquire a default connection to an outer Point because the edge failed. Valid descendant Points, their ordinary subtrees, and relations with independent explicit targets remain available in the partial result. The exact keyword is reserved: `[edgeless]` remains ordinary body.

A top-level Objection is legal even without a target:

```md cog-check points=1 bearings=0 diagnostics=0
- [O @draft] A network fault could explain the same observations.
```

It creates one Point and no Bearing or diagnostic.
Similarly, a Claim beneath a Gap creates no default connection and does not answer a Question outside the Gap.
See [connections from indentation](bearings.md#connections-from-indentation) for paired examples.

`supports` means positive bearing without specifying deductive, inductive, abductive, explanatory, or interpretive method. No kind asserts success or validity. The graph adds no negation from absence or transitive closure. See [Bearings](bearings.md) for examples.

## Local linked blocks

`[linked]` or `[linked; @route]` constructs one `supports` Bearing.
Its target is the nearest enclosing Point, possibly through ordinary body but never past another Point.
Its sources are the direct bare G children without an operator, selector, handle, or annotation error.
Classify direct children before lowering any selector: G_/O_ are commentary, and complete explicit Point clauses or edges are independent relations, never joint sources.
Their roles, content, optional anchors, and individual spans remain intact.
The linked block has no Point or operator clause of its own, and its Bearing uses `derivedBy: "structural"` and the header's span.
Optional prose after the header becomes that Bearing's `text`, exactly as prose after an `edge` does.
It is a description of the connection, not a new Point, member, or parsed argument.
An empty description leaves `text` absent.

A singleton is legal; an empty group or missing Point target is an error.
Direct body wrappers, unsuffixed other roles, reference members, and direct linked blocks are invalid.
Bare O in a Bearing context is not an alias for O_; the suffix or a complete target makes that request explicit.
A linked block cannot bypass an edge's explicit-target boundary.
Direct linked-block nesting, even through body, is rejected; a linked block inside a member Point's subtree is a separate inference and is legal.
Use header prose to describe the joint; use `edge` to reuse existing Points.

Any invalid member rejects the whole joint, never a reduced source set.
First Points below the group, including through invalid body wrappers, receive no structural connection to the outer target even after rejection.
Valid Points and their own ordinary subtrees remain available.
A complete explicit Point clause or direct edge remains independently authored and does not invalidate otherwise valid sources.
For example, G +> @missing rejects its own relation; incomplete G +> is unclassified and rejects the whole joint.
Clearly retained malformed selector intent remains commentary, receives its own diagnostic, and cannot become a G source.
A member's handle without an operator produces no default Bearing and receives `BEARING_HANDLE_WITHOUT_BEARING`.
Malformed member operators receive their normal syntax diagnostic and no fallback.
This preserves explicit intent without treating it as a joint source declaration.

Malformed reserved linked annotations remain linked constructs in the AST, including an unclosed prefix, so recovery cannot turn their members into unary support.
Membership/context failure yields no route to reference (`UNKNOWN_TARGET` for a subsequent handle reference).
A candidate rejected during ordinary name/reference validation follows the existing failed-Bearing dependency rules.
Duplicate member anchors invalidate the entire joint rather than deduplicating or dropping a source.
Distinct Points with the same prose remain distinct sources.

Unlike an `edge`, a linked block obtains its sources and target from the local structure.
An equivalent edge example must move the Grounds out of default-support placement while preserving their content, roles, names, status, and subtrees.
Use the same header description when comparing semantic content and topology after ignoring local keys, order, spans, Explain, and structural/operator provenance.
Leaving G children in place and adding an edge intentionally produces both unary and joint Bearings.
Neither construction adds reasoning closure, validity checks, minimality, or necessary-premise claims.

Retired `join` headers receive `RETIRED_JOIN_ANNOTATION`, including malformed reserved prefixes and unclosed headers.
They remain rejected linked boundaries in the AST, with the original spelling retained in `raw` and `syntaxErrors: ["linked"]`.
Their descendants cannot recover as unary supports to the outer Point.
Ordinary non-reserved text such as `[joining the discussion]` remains body.
Replace the old header with `linked`, then recompile the original source.
The rejected header creates no handle binding and receives one retirement diagnostic from annotation parsing.
Unclosed brackets may also receive the outline's malformed-prefix diagnostic, and invalid context or membership remains observable through the grouping diagnostics.

## Names and resolution

A Point name precedes its operator; a Bearing handle follows `;`. Both share one namespace within a source unit. Forward references work. Sources of an `edge` must resolve to Points; targets must satisfy their operator's kind restriction. Generated compilation keys cannot be used as authored names or references.

Duplicate Point anchors invalidate all Points with that anchor and dependent Bearings. Duplicate handles invalidate those Bearings. A Point/handle collision retains valid Points but rejects the conflicting route and ambiguous references. Bearings targeting a failed Bearing are rejected. A handle on an annotation that produces no Bearing is an error.

## Input modes

`document` compiles a standalone owned outline without a wrapper and is the default for both source APIs and the CLI.
`host` explicitly selects a Markdown host and extracts its document-level `cog` or `cogitatum` fenced code blocks.
Source selection uses the Markdown block tree, so comments, raw HTML, indented code examples, and apparent fences inside other literal code blocks stay inactive.
Host mode never falls back to the raw outline; no active regions means zero units, documents, and graphs, with no selection diagnostic.
Unfenced annotations stay host prose whether a fence is added or removed.
`auto` is retired: TypeScript callers choose `document | host`, JavaScript callers passing `auto` receive a `TypeError`, and CLI `--input auto` receives `INVALID_INPUT_MODE`.
When migrating a call that relied on automatic fence selection, pass `host` explicitly and reparse the original host.

All input modes permit indentation-based authoring, explicit-relation authoring, or a mixture.
These writing techniques are not additional compiler input modes.
`derivedBy` records how an individual Bearing was produced, not the input mode or an authoring style for the document.
The four symbolic operators retain their meanings.
An `edge` may instead use any case-sensitive canonical kind name, including `answers`, `repliesTo`, and `clarifies`.
Named-kind clauses are adopted only for `edge`; Point-attached clauses continue to use symbolic operators.

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

Each fence has its own namespace and graph; references cannot cross fences.
An actual Cogitatum fence nested in a Markdown list or blockquote receives `UNSUPPORTED_NESTED_COGITATUM_FENCE` and is omitted.
Its diagnostic retains the original host span, including the original location after container prefixes; it creates no source unit or graph entity.
Four-space or tab-indented code examples are literal host content rather than attempted active regions.
Empty closed active fences remain selected empty units with `EMPTY_COGITATUM_FENCE`.
Cogitatum deliberately requires a closer even though Markdown permits an unclosed code block: an unclosed active fence receives `UNCLOSED_COGITATUM_FENCE` and is omitted, preserving earlier complete units.

For example, this comment creates no active source and no annotation diagnostic:

````markdown cog-check input=host points=0 bearings=0 diagnostics=0
<!--
```cog
- [C @hidden] Hidden in a comment.
```
-->
````

Keep the original host alongside its mappings; selected unit text is not a replacement for the document.
The parallel `units[]`, `documents[]`, `graphs[]`, and optional `explanations[]` arrays pair by selected-unit index in reader order.
Skipped literal content and rejected nested regions occupy no index and never import a namespace.
No native Markdown annotation grammar, extension-based profile, or document-wide namespace is introduced here.

## Machine contract and CLI

Recognized failed Point declarations retain an AST annotation with kind "invalid" and their original annotation raw text.
They emit no Point, remain source boundaries in Explain, and prevent implicit descendants from attaching to a more distant outer Point.
Valid descendant Points, their own subtrees, and independent explicit relations survive; the first implicit Point receives FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET.
Ordinary bracket prose remains transparent body, and the removed scope directive retains its separately documented rejection policy.
This unpublished candidate is distinguished by its exact source/schema ref rather than a new package label for every PR.
The ownership repair follows alpha.6 at dc1a011c94e434996e0faec9a3c094779ee73277; previous candidate AST/Explain schemas do not admit the new invalid recognition merely because both report format 0.4.0.

`parseDocument` returns an ordered AST; `compileGraph` produces `GraphIR`. `parseSource` and `compileSource` expose envelopes for the input modes.

For debugging, `compileGraphWithExplain` and `explainSource` add a compiler trace: how a block was recognized, which points or connections were emitted or rejected, and why an indentation rule applied or no connection was produced. The CLI exposes this as `cog explain`.
Linked recognition and linkedMember effects identify the group span, syntactic eligibility and function: source, commentary, independent or unclassified.
Eligibility alone never certifies that the whole joint survived validation.
selectAttachment records the nearest ownerSpan and optional candidate Bearing target; a failed candidate is not a canonical graph entity.
local-attachment explains selector emissions, while no-local-attachment explains missing ownership; failed targets follow validation-error and dependency diagnostics.
The header emits with `linked-containment` or rejects with `invalid-linked`; later name/reference rejection uses `validation-error`.
Membership eligibility does not certify that the whole linked survived validation. It explains compilation decisions, not the truth of the prose, the strength of a reason, or a history of the author's thinking. The trace is an optional Alpha interface; ordinary integrations can use AST and Graph IR alone.

An AST block holds its text, raw source, children, span, and optional `annotation`. Role, anchor, status, operator, handle, and annotation errors live only inside `annotation`; there are no mirrored block-level semantic fields. A Point name appears as `annotation.anchor` in the AST and `id` in Graph IR. Ordinary body has no annotation. An `operatorClause` contains `op`, `sources`, and one authored `target: { id }`. Point annotations use `sources: "self"`; an `edge` uses a nonempty array of authored source references.

`compileGraph` and `compileGraphWithExplain` consume parser-produced ASTs of the current format and reject other format versions. They interpret `annotation`, not `raw`; changing an annotation does not rewrite the retained source text. To edit a note, change the source and parse it again. Importing arbitrary AST JSON requires validation first; compilation is not a general JSON validator.

| Entity | Compilation identity | Authored identity |
| --- | --- | --- |
| Point | Required `key` | Optional `id` |
| Bearing | Required `key` | Optional `handle` |

Graph references use `{ key, kind }`; AST references remain `{ id }`. Keys are opaque, nonempty strings, deterministic for one compilation and local to one graph, with no cross-revision promise. The current compiler emits keys such as `_p1` and `_b1`; consumers must not parse their prefixes or numbers, infer array indexes from them, or use them as authored references. Use `kind` to distinguish Point and Bearing references. A Bearing has `kind`, Point `sources`, one `target`, and `derivedBy: "operator" | "structural"`; optional text describes a route.

Explain emission references use graph keys; Bearing emissions also have a graph index and optional handle. The index addresses this compilation's Bearing array only. Emitted summaries obey the same kind/target restrictions as canonical Bearings. Rejected candidates can retain unresolved authored `{ id }` references or a resolved target of the wrong kind: that mismatch can explain the rejection. They are not graph entities. Diagnostic codes on an entry come from diagnostics whose source spans overlap that block; they can include diagnostics from its children. The top-level diagnostics retain their actual spans.

The **0.4.0-alpha.6** source candidate retains the **unpublished format identifier 0.4.0**, including the alpha.3 linked and alpha.4 host migrations below.
Its initial-BOM host-selection repair follows alpha.5 at `a003e89e1fa780377ebe887b2c7d823ec58a9ad0`.
Local attachment selection and linked commentary follow the nearest-frame repair at 2b0ccac660507b5ef7e3d535d7642eec64808344.
This candidate retains alpha.6 while unpublished; its exact source/schema ref identifies the AST selector and expanded Explain contract.
Previous candidate AST/Explain schemas reject these additions; no same-label JSON relabeling establishes compatibility.
An initial U+FEFF is recognized at the Markdown document boundary without stripping the original host or later content.
Original UTF-16 diagnostic columns include that initial code unit; selected content locations remain in the original host.
Its named-constructor baseline is alpha.4 at `1c494e825ceafe9dc247c6489d8c6f93db70e168`.
The AST `edge.operatorClause.op` now admits every canonical `BearingKind`; self-sourced Point clauses remain limited to the four symbolic `BearingOp` kinds.
GraphIR and Explain kind/target shapes are unchanged, and explicit construction uses the existing `operator-clause` trace reason and `derivedBy: "operator"`.
Earlier candidate AST schemas reject newly expressible named kinds; use the exact matching compiler/schema candidate rather than assuming compatibility from `0.4.0` alone.
Its source-selection baseline is alpha.3 at `8fc2f6a72cbaebcf07286cf62a41db4ca13461d7`.
Alpha.4 requires explicit source context, parses actual Markdown blocks, rejects nested active fences, and permits an empty host result.
These source-selection changes leave GraphIR/ref/typed-target shapes and all canonical negative kinds unchanged.
Old host envelopes must be regenerated from the original document with the chosen context; relabelling an older envelope, AST, or Explain projection does not apply the new selection policy.
Its exact migration baseline is the reviewed tree `5725f873abf5d3ad7c1eefb5b9f1416d59cf5f95`, which includes the parser-boundary fixes on main `f6eefef12b6ffd620d61ab28d31d9a8c5f6e1b02` (alpha.2).
The alpha.1/alpha.2 candidates used `join`; alpha.3 reserves `linked` and rejects the retired spelling.
The shared unpublished format number does **not** make those AST/Explain contracts compatible.
Upgrade compiler, matching schemas, and consumers together; migrate source headers and reparse source instead of relabelling old JSON.
Historical 0.3 research records remain evidence of that version's behavior.
Published format 0.3.0 treated `[join; @route]` as body, so its child Grounds produced separate unary supports.
The unpublished alpha.1/alpha.2 candidates introduced joint support through `join`; alpha.3 requires `linked` for that deliberate topology change.
Migration from published 0.3 therefore requires reviewing the intended grouping, not merely replacing every occurrence of a word.
Old AST/Explain variants containing `kind: "join"`, `joinMember`, or `join-*` reasons fail the current schemas.
Their absence does not establish candidate compatibility; retain the producing compiler's exact version/ref with stored JSON.

AST annotation kind and syntax-error name `join` become `linked`.
Explain recognition `join`, effect `joinMember`/`joinSpan`, and reasons `join-containment`, `join-membership`, and `invalid-join` become `linked`, `linkedMember`/`linkedSpan`, `linked-containment`, `linked-membership`, and `invalid-linked`.
Grouping diagnostics use `LINKED` in place of `JOIN`; retired input specifically receives `RETIRED_JOIN_ANNOTATION`.
GraphIR shape and all canonical kinds remain unchanged: old `challenges` stays `challenges` with a Point target, and old `undercuts` stays `undercuts` with a Bearing target.
`->` requires Point and `_>` requires Bearing; neither becomes target-polymorphic in this cut.
Valid renamed groups preserve individual identities and exactly one joint support.
Ordinary G defaults outside linked blocks are unchanged.

Consumers address entities by `(unit index, ref.kind, ref.key)` within one compilation; the unit index selects the corresponding `graphs[]` entry.
Explain's emission `graphIndex` instead indexes that selected graph's Bearing array.
Each document or fence unit has its own authored namespace; the same name in another unit is unrelated.
AST block order preserves reader order; its `sourceSpan` and Explain entry spans locate the original occurrence using one-based UTF-16 line/column positions.
A linked header's span can identify its Bearing, and a Point annotation can identify both its Point and its attached Bearing.
One span therefore need not select only one entity; inspect the typed emission references rather than choosing the first match.
Missing GraphIR spans cannot be reconstructed from a key or handle; source selection is unavailable for such an entity.
GraphIR contains no additional occurrence entity and cannot reproduce the authored document from its topology.
Executable consumer cases live in the source checkout's `fixtures/`: `core/local-linked.cog.md`, the host local-linked case, and `diagnostics/retired-join.cog.md`.

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
