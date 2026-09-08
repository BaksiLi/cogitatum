---
title: Complete syntax
summary: Format 0.3.0 grammar, indentation, references, input modes, and machine contract.
section: reference
order: 3
---

# Complete syntax

Public reference for **format 0.3.0**, delivered by the **0.3.0-alpha.1** candidate packages. Syntax and machine contracts may change before a stable release. Examples, schemas, and conformance fixtures are checked against the implementation.

## Outline and body

Write a Markdown-style outline. Root blocks start at column one. Indent with spaces; a child can use any greater width, but a dedent must match an active ancestor level. Tabs, indented roots, and unmatched dedents are diagnosed and their apparent annotations are not compiled.

Every nonblank source line must be a bullet block beginning with `- ` after indentation. An annotation starts the block's content after that marker. Unmarked content remains body. Other line forms produce `UNSUPPORTED_LINE` and are not represented as blocks. Blank lines do not produce blocks. The AST preserves supported block order, raw block lines, body, and source spans; byte-for-byte whitespace round trips are not promised. This is a restricted outline parser, not a complete Markdown parser.

```md cog-check require=supports
- Ordinary context.
  - [C @claim] A claim.
    - An unmarked explanation.
      - [G] A selected reason.
```

## Annotation grammar

```text
annotation := "[" (role | gap | material | edge) "]"
role       := ("Q" | "C" | "C?" | "G" | "O" | "R" | "D") [REF] [OP REF] [";" REF]
gap        := "?" [REF] [OP REF] [";" REF]
material   := REF [OP REF] [";" REF]
edge       := "edge" REF_LIST OP REF [";" REF]
REF_LIST   := REF ("," REF)*
REF        := "@" ID
ID         := [a-z][a-z0-9_-]*
OP         := "+>" | "->" | "_>" | "~>"
```

Token order and case matter; `edge` is lowercase. Whitespace separates words and reference lists use commas. Each operator has exactly one target; an `edge` has one or more unique sources. Optional prose follows the closing bracket.

| Form | Effect |
| --- | --- |
| `[C]`, `[C? @claim]`, `[G]` | A role-bearing Point |
| `[?]`, `[? @gap]` | Open-gap Point |
| `[@passage]` | Named material Point without a role |
| `[O -> @claim]` | Anonymous Point and explicit challenge |
| `[G @reason; @route]` | Named Point and named structural Bearing, if the parent permits it |
| `[edge @a, @b +> @claim; @route]` | One joint Bearing between existing Points; no new Point |
| Unmarked body or grouping | No Point or Bearing of its own |

Empty brackets, unfinished reserved prefixes, malformed operators, invalid names, repeated sources, and a bare `;` are errors. Invalid annotations remain inspectable in the AST. A valid Point can survive an error in its attached Bearing. `[Context for this section]` and its unclosed counterpart are ordinary body. Only a role token, `?`, `edge`, or `@` at the beginning selects annotation parsing; incorrect case and the retired `scope` prefix are also recognized so they can be diagnosed. Recognition does not make those invalid forms legal. A word beginning with a role letter, such as `Context`, does not select annotation parsing.

## Roles and connections

Roles are `Q` question, `C` claim, `G` ground, `O` objection, `R` reply, and `D` distinction. `C?` is an open claim; `[?]` is a gap. Other roles cannot take `?`.

| Operator | Kind | Permitted target |
| --- | --- | --- |
| `+>` | `supports` | Point or Bearing |
| `->` | `challenges` | Point |
| `_>` | `undercuts` | Bearing |
| `~>` | `about` | Point or Bearing |

Without an operator, use the nearest enclosing Point:

| Child | Parent | Derived kind |
| --- | --- | --- |
| `C`, `C?` | `Q` | `answers` |
| `G` | Any Point | `supports` |
| `O` | Any Point | `challenges` |
| `R` | `O` | `repliesTo` |
| `D` | Any Point | `clarifies` |
| `?` | Any Point | `about` |

Other combinations produce no structural Bearing. Body does not block lookup, but another Point does. An `edge` cannot be an implicit target: the first Point beneath it, possibly through body, needs an explicit operator and target. Once a Point is reached, its children use the ordinary indentation rules again. An operator overrides the structural default; it does not create a second connection.

`supports` means positive bearing without specifying deductive, inductive, abductive, explanatory, or interpretive method. No kind asserts success or validity. The graph adds no negation from absence or transitive closure. See [Bearings](bearings.md) for examples.

## Names and resolution

A Point name precedes its operator; a Bearing handle follows `;`. Both share one namespace within a source unit. Forward references work. Sources of an `edge` must resolve to Points; targets must satisfy their operator's kind restriction. Generated compilation keys cannot be used as authored names or references.

Duplicate Point anchors invalidate all Points with that anchor and dependent Bearings. Duplicate handles invalidate those Bearings. A Point/handle collision retains valid Points but rejects the conflicting route and ambiguous references. Bearings targeting a failed Bearing are rejected. A handle on an annotation that produces no Bearing is an error.

## Input modes

`document` compiles a standalone outline without a wrapper. `host` extracts document-level `cog` or `cogitatum` fences from mixed Markdown. `auto` uses host mode when it finds a Cogitatum fence candidate and otherwise document mode.

````markdown
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

For debugging, `compileGraphWithExplain` and `explainSource` add a compiler trace: how a block was recognized, which points or connections were emitted or rejected, and why an indentation rule applied or no connection was produced. The CLI exposes this as `cog explain`. It explains compilation decisions, not the truth of the prose, the strength of a reason, or a history of the author's thinking. The trace is an optional Alpha interface; ordinary integrations can use AST and Graph IR alone.

An AST block holds its text, raw source, children, span, and optional `annotation`. Role, anchor, status, operator, handle, and annotation errors live only inside `annotation`; there are no mirrored block-level semantic fields. A Point name appears as `annotation.anchor` in the AST and `id` in Graph IR. Ordinary body has no annotation. An `operatorClause` contains `op`, `sources`, and one authored `target: { id }`. Point annotations use `sources: "self"`; an `edge` uses a nonempty array of authored source references.

`compileGraph` and `compileGraphWithExplain` consume parser-produced ASTs of the current format and reject other format versions. They interpret `annotation`, not `raw`; changing an annotation does not rewrite the retained source text. To edit a note, change the source and parse it again. Importing arbitrary AST JSON requires validation first; compilation is not a general JSON validator.

| Entity | Compilation identity | Authored identity |
| --- | --- | --- |
| Point | Required `key` | Optional `id` |
| Bearing | Required `key` | Optional `handle` |

Graph references use `{ key, kind }`; AST references remain `{ id }`. Keys are opaque, nonempty strings, deterministic for one compilation and local to one graph, with no cross-revision promise. The current compiler emits keys such as `_p1` and `_b1`; consumers must not parse their prefixes or numbers, infer array indexes from them, or use them as authored references. Use `kind` to distinguish Point and Bearing references. A Bearing has `kind`, Point `sources`, one `target`, and `derivedBy: "operator" | "structural"`; optional text describes a route.

Explain emission references use graph keys; Bearing emissions also have a graph index and optional handle. The index addresses this compilation's Bearing array only. Emitted summaries obey the same kind/target restrictions as canonical Bearings. Rejected candidates can retain unresolved authored `{ id }` references or a resolved target of the wrong kind: that mismatch can explain the rejection. They are not graph entities. Diagnostic codes on an entry come from diagnostics whose source spans overlap that block; they can include diagnostics from its children. The top-level diagnostics retain their actual spans.

Format 0.3.0 replaces generated Point IDs, optional Bearing IDs, ID-based graph references, mirrored AST block fields, and the AST operator's single-element `targets` array (now `target`). Consumers must migrate together; reparse older source rather than relabelling old JSON with the new version.

### Schemas for integrations

The source distribution's `spec/` directory contains self-contained JSON Schemas using draft 2020-12. The Core package includes the same contracts through `@cogitatum/core/schemas/ast`, `@cogitatum/core/schemas/graph-ir`, and `@cogitatum/core/schemas/explain` exports. For example, in Node.js:

```js
import graphSchema from '@cogitatum/core/schemas/graph-ir' with { type: 'json' };
```

The website also serves [AST](https://cogitatum.baksili.codes/schemas/0.3.0/ast.schema.json), [Graph IR](https://cogitatum.baksili.codes/schemas/0.3.0/graph-ir.schema.json), and [Explain](https://cogitatum.baksili.codes/schemas/0.3.0/explain.schema.json) schemas. Their `$id` includes the format version. Schema identifiers and published contracts must change together when a new format is introduced; a package-only fix need not change the format. The package copies support offline use and require no schema downloads.

These schemas validate individual AST, Graph IR, and Explain projections, not the surrounding multi-unit `parseSource` / `compileSource` / `explainSource` envelopes. Validate each document, graph, or explanation in the corresponding array.

Schema validation checks field shapes, allowed variants, and local restrictions. It does not establish key or authored-name uniqueness across entities, reference existence, source-span ordering, agreement between Explain and its graph, or whether a graph follows from particular source text. The compiler resolves names and references; conformance tests check its output invariants. Passing a schema also makes no claim about the quality of the reasoning.

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
