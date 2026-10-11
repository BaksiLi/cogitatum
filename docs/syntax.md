---
title: Complete syntax
summary: Format 0.4.0 grammar, indentation, references, input modes, and machine contract.
section: reference
order: 4
---

# Complete syntax

Public reference for **format 0.4.0**, delivered by the **0.4.9** source candidate packages (not yet published). Match the exact source/schema ref: this unpublished identifier covers successive authoring changes. Examples, schemas, and conformance fixtures are checked against the implementation.

## Outline and body

Write a Markdown-style outline. Root blocks start at column one. Indent with spaces; a child can use any greater width, but a dedent must match an active ancestor level. Tabs, indented roots, and unmatched dedents are diagnosed and their apparent annotations are not compiled.

Every nonblank source line must be a bullet block beginning with `- ` after indentation. An annotation starts the block's content after that marker. Unmarked content remains body. Other line forms produce `UNSUPPORTED_LINE` and are not represented as blocks. Blank lines do not produce blocks. The AST preserves supported block order, raw block lines, body, and source spans; byte-for-byte whitespace round trips are not promised. This is a restricted outline parser, not a complete Markdown parser.

```md cog-check require=supports points=2 bearings=1 diagnostics=1
- Ordinary context.
  - [C @claim] A claim.
    - An unmarked explanation.
      - [G] A selected reason.
```

## Annotation grammar

```text
annotation := "[" (role | gap | material | edge | linked | selector | use | bearingUse | note) "]"
role       := ("Q" | "C" | "G" | "O" | "R" | "D") [REF] [OP REF] [";" REF]
gap        := "?" [REF] [OP REF] [";" REF]
material   := "." [REF] [OP REF] [";" REF]
edge       := ("edge" | "_") REF_LIST (OP | KIND) REF [";" REF]
linked     := "linked" [";" REF]
note       := "note"
REF_LIST   := REF ("," REF)*
REF        := "@" ID
ID         := [a-z][a-z0-9_-]*
OP         := "+>" | "->" | "/>" | "~>"
selector   := ("G/" | "O/") [REF] [";" REF]
use        := MARK "use" REF [OP REF] [";" REF]
bearingUse := "_" "use" REF
MARK       := "." | "Q" | "C" | "G" | "O" | "R" | "D" | "G/" | "O/"
KIND       := "supports" | "challenges" | "undercuts" | "about"
            | "answers" | "repliesTo" | "clarifies"
```

Token order and case matter; `edge`, `linked`, `note` and `use` are lowercase. Whitespace separates words and reference lists use commas. Each operator has exactly one target; an `edge` has one or more unique sources. A selector mark and an operator are mutually exclusive, including on a use. Optional prose follows the closing bracket.

| Form | Effect |
| --- | --- |
| `[C]`, `[C @claim]`, `[G]` | A role-bearing Point |
| `[?]`, `[? @gap]` | Open-gap Point |
| `[.]`, `[. @passage]` | Neutral Point, optionally named |
| `[O -> @claim]` | Anonymous Point and explicit challenge |
| `[G @reason; @route]` | Named Point and named structural Bearing, if the parent permits it |
| `[_ @a, @b +> @claim; @route]` or `[edge @a, @b +> @claim; @route]` | One joint Bearing between existing Points; no new Point |
| `[linked; @route]` with direct Grounds | One structural joint support to the nearest enclosing Point; no new Point |
| `[. use @p]` | Focus an existing Point without a default attachment |
| `[G use @p; @route]` | Reuse an existing Point as a local Ground, with an attachment if the context permits |
| `[_ use @route]` | Focus an existing validated Bearing without constructing a relation or changing its endpoints |
| `[note]` and its subtree | Literal supplementary prose, owned by its direct source parent |
| Unmarked body or grouping | No Point or Bearing of its own |

Empty brackets, unfinished reserved prefixes, malformed operators, invalid names, repeated sources, and a bare `;` are errors.
Invalid annotations remain inspectable in the AST; a valid Point can survive an error in its attached Bearing.
`[Context for this section]` and its unclosed counterpart are ordinary body.
A role token, `?`, `.`, `_`, `edge` or `linked` at the beginning selects annotation parsing; incorrect case and the retired `join` and `scope` prefixes are also recognized for diagnostics.
Recognition does not make invalid forms legal.
Words such as `Context`, `joined`, and `linked-data` do not select annotation parsing.
Annotation-shaped `[linked evidence]` is now reserved and diagnosed instead of remaining transparent body; `[join the debate]` likewise receives the retirement diagnostic.
To keep such text as ordinary prose, omit the annotation-shaped brackets or place prose before them.

## Literal notes

The optional `[note]` header preserves its following prose and whole indented subtree outside graph construction.
Inside it, every Cog-looking spelling, including a nested `[note]`, malformed header, anchor or unresolved use, is literal text.
No inner name registers, conflicts with a declaration or satisfies an outside reference.
Dedenting out of that subtree restores normal interpretation.
Outline layout errors still apply; a note does not enable arbitrary Markdown.

The keyword must be lower-case note; surrounding header whitespace is allowed.
An empty `[note]` is a valid placeholder, with no warning.
A leading bracket followed by note (case-insensitive) and end, whitespace, semicolon, @ or closing bracket reserves the header.
Parameters, wrong case or a missing closing bracket produce `MALFORMED_NOTE` and retain the literal boundary.
`[note @alias]` therefore never activates its children after failing.
`[notebook]`, `[note-like]`, quoted `"[note]"` and escaped `\[note]` remain ordinary body; the escape backslash remains in authored text.
Native Markdown activation and shortcut-link precedence remain deferred.

A note belongs to its direct source parent or the document root.
Point declarations, Point uses, linked and explicit Bearing constructions, Bearing uses and ordinary body all use this same rule.
A Ground can emit both a Point and a Bearing; its note still belongs to that source occurrence without selecting an entity owner.
Multiple sibling notes preserve their order; reuse does not import notes from the declaration.
Existing inline Point/Bearing-use prose remains separate.

Direct valid notes are supplementary `linked` members, excluded from the ordered active sources.
Notes-only `linked` still fails `EMPTY_LINKED`; a malformed direct note invalidates membership atomically.
Ordinary body under linked remains invalid and does not flatten nested Grounds.

Keep a qualification that changes a Claim's scope in its content or a clearly retained argument context.
Moving live argument into note, or promoting note prose to Points, is an explicit authoring change rather than a formatter repair.

## Roles and connections

Roles are `Q` Question, `C` Claim, `G` Ground, `O` Objection, `R` Reply, and `D` Distinction.
`[?]` is a Gap, a separate Point form that is always open.
C? is retired; use C for a Claim or possible answer, preserving tentative wording.
A dot marks neutral content, optionally named, without a role (`declaration.form: "material"`), a separate Point form.
Roles cannot take `?`.
C certifies neither truth, certainty, acceptance nor completion; Gap openness is not a confidence score.

| Operator | Kind | Permitted target |
| --- | --- | --- |
| `+>` | `supports` | Point or Bearing |
| `->` | `challenges` | Point |
| `/>` | `undercuts` | Bearing |
| `~>` | `about` | Point or Bearing |

Outside a linked block, without an operator, use the nearest enclosing Point:

| Child | Parent | Derived kind |
| --- | --- | --- |
| `C` | `Q` | `answers` |
| `G` | Any Point | `supports` |
| `O` | Any Point | `challenges` |
| `R` | `O` | `repliesTo` |
| `D` | Any Point | `clarifies` |
| `?` | Any Point | `about` |

Other combinations produce no structural Bearing.
Body is transparent, but a Point declaration or Point use owns a new Point frame.
Every Point occurrence, including a declaration, has a locally written mark; `.` is the neutral mark and selects no role.
Defaults read only local marks: the child occurrence's own mark and, for `answers` and `repliesTo`, the enclosing occurrence's Q or O mark.
A referenced Point's declaration never supplies either.
An edge or Bearing use supplies a Bearing context: its first unsuffixed Point, possibly through body, needs an explicit operator and target.
G/ and O/ may instead select the constructed or referenced Bearing.
Once a Point frame is reached, its children use the ordinary indentation rules again.
An operator overrides the structural default; it does not create a second connection.

Successful implicit selection across ordinary body adds `IMPLICIT_ATTACHMENT_THROUGH_BODY` at `suggestion` severity.
It names the actual selected target (or its source span if anonymous), the responsible occurrence and the crossed body regions, grouped once per selection.
This includes a C's own answers attachment before it supplies context to its children, linked lookup and `G/` and `O/` selectors.
It changes diagnostics only: Points, Bearings, identities, validation and fallback stay unchanged.
Failed selections, complete explicit endpoints, root groups, leaf prose, nearer active contexts and literal notes receive no such success advice.
Keep deliberate grouping, reposition active content or write the intended target explicitly.
There is no automatic note-wrapping fix: that would remove the active subtree from the graph.

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
Its sources are direct bare G declarations or G-labelled uses without an operator, selector, handle, or annotation error.
Classify direct children before lowering any selector: G/ and O/ are commentary, and complete explicit Point clauses or edges are independent relations, never joint sources.
Their roles, content, optional anchors, and individual spans remain intact.
The linked block has no Point or operator clause of its own, and its Bearing uses `derivedBy: "structural"` and the header's span.
Optional prose after the header becomes that Bearing's `text`, exactly as prose after an `edge` does.
It is a description of the connection, not a new Point, member, or parsed argument.
An empty description leaves `text` absent.

A singleton is legal; an empty group or missing Point target is an error.
Direct body wrappers, unsuffixed other roles, bare uses, and direct linked blocks are invalid.
Bare O in a Bearing context is not an alias for O/; the suffix or a complete target makes that request explicit.
A linked block cannot bypass an edge's explicit-target boundary.
Direct linked-block nesting, even through body, is rejected; a linked block inside a member Point's subtree is a separate inference and is legal.
Use header prose to describe the joint; G-labelled uses contribute existing Points without unary member attachments.

Any invalid member rejects the whole joint, never a reduced source set.
First Points below the group, including through invalid body wrappers, receive no structural connection to the outer target even after rejection.
Valid Points and their own ordinary subtrees remain available.
A complete explicit Point clause or direct edge remains independently authored and does not invalidate otherwise valid sources.
A direct Bearing use is an independent occurrence, never a source, even when its reference fails.
Its selectors discuss its explicitly referenced Bearing, not the surrounding joint.
For example, G +> @missing rejects its own relation; incomplete G +> is unclassified and rejects the whole joint.
Clearly retained malformed selector intent remains commentary, receives its own diagnostic, and cannot become a G source.
A member's handle without an operator produces no default Bearing and receives `BEARING_HANDLE_WITHOUT_BEARING`.
Malformed member operators receive their normal syntax diagnostic and no fallback.
This preserves explicit intent without treating it as a joint source declaration.

Malformed reserved linked annotations remain linked constructs in the AST, including an unclosed prefix, so recovery cannot turn their members into unary support.
Membership/context failure yields no route to reference (`UNKNOWN_TARGET` for a subsequent handle reference).
A candidate rejected during ordinary name/reference validation follows the existing failed-Bearing dependency rules.
Duplicate member anchors invalidate the entire joint rather than deduplicating or dropping a source.
Repeated resolved Point identities, including a declaration and use of that same Point, also reject the entire joint.
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

## Reference-only occurrences

`[. use @p]` resolves an existing Point, including a forward declaration in the same unit.
`[G @p]` and `[. @p]` always declare; repeating them never silently becomes a use.
`[G use @p]` supplies a local G mark without changing p's declaration role, status, text or identity.
The same rule applies to Q/C/O/R/D; occurrence status such as `[C? use @p]` is unsupported.
Trailing prose stays on the occurrence's AST block, never on the original Point or the constructed Bearing.
Uses do not copy subtrees, inherit remote roles or status, create aliases, or enter a declaration's surrounding context.

`[. use @p]` owns no default attachment, even when p has relations elsewhere.
Its children focus p but have no imported Q/O mark for answer/reply defaults.
`[O use @p]` supplies a local O context, so an R child replies to p.
`[Q use @p]` presents the same content as a local inquiry, allowing C children to answer it.
It does not generate whether/why question text, transform the Point, reopen it or change shared status.
The author chooses the content/mark fit; declare a separate Question when different question content is intended.

```md cog-check require=answers points=3 bearings=1 diagnostics=0
- [. @wet] The road is wet.
- [. use @wet] A neutral reminder.
  - [C @aside] Not an answer.
- [Q use @wet] Presented here as the local inquiry.
  - [C @yes] Yes.
```

Only `yes` answers `wet`; the Point keeps `declaration.form: "material"` and its text.
A complete symbolic override, such as `[. use @p +> @claim; @step]`, constructs exactly one local attachment.
`O/` or `G/` beneath that occurrence selects step; beneath a bare use or linked member they fail.
A handle without a locally constructed attachment is diagnosed.

```md cog-check require=supports,undercuts,repliesTo points=4 bearings=3 diagnostics=0
- [C @observation] Two retries timed out.
- [C @claim] The shared configuration may explain the timeouts.
  - [G use @observation; @step] This observation matters in the current step.
    - [O/ @objection] The environment could explain both retries.
      - [R @reply] A control run kept the environment stable.
```

Unknown, duplicate/ambiguous names and Bearing operands have no Point focus.
They retain a failed boundary; implicit descendants never fall back to an outer Point or use a Bearing as a Point focus.
Valid descendant declarations, their own subtrees and complete independent relations survive.
When only a use's attachment syntax fails, its otherwise valid Point operand retains focus but owns no attachment.
`[use case]` remains ordinary bracket prose; bare use intent is reserved only before @, a separator or end.
`[. use case]` is a malformed marked use and receives `MALFORMED_POINT_USE`.
Incorrect case, malformed reserved uses and unclosed use prefixes are diagnosed boundaries.

### Bearing occurrences and reading

`[_ use @route]` focuses an existing validated Bearing, including a forward reference in the same source unit.
It emits no Point or Bearing, adds no alias, changes no endpoints, and copies neither sources nor subtrees.
Prose after its bracket is an occurrence note; an existing or absent `Bearing.text` remains unchanged.
`[_ use @route; @alias]` and any attachment clause on a Bearing use are errors.
Point operands, unknown or ambiguous names and failed Bearings produce a rejected focus.
Their frames remain boundaries: descendants cannot fall back to an outer Point or Bearing.
Valid declarations and independently explicit relations still survive.

The nearest constructor exposes one Bearing for `G/` or `O/`:

| Nearest constructor | Exposed Bearing |
| --- | --- |
| Point declaration or Point use | Only the attachment constructed at this occurrence |
| Explicit edge or linked block | The Bearing constructed there |
| Bearing use | The existing validated Bearing explicitly referenced there |

A referenced Bearing is a focus, not a newly owned attachment.
Point frames shadow outer Bearing contexts; neutral Point uses and linked members expose no unary attachment.
An ordinary O always challenges a Point, so it needs an explicit Point target directly beneath a Bearing use.
An O beneath O/ challenges that new O Point, while a sibling O/ selects its local attack Bearing.
R beneath O/ replies to that O Point.
Existing explicit graph cycles remain possible; references never recursively expand source.

```md cog-check require=supports,undercuts,challenges points=5 bearings=4 diagnostics=0
- [C @premise] Measurements agree.
- [C @claim] The comparison is reliable.
- [_ @premise supports @claim; @route] The original inference description.
- [_ use @route] Discuss the earlier inference here.
  - [O/ @bias; @attack] Both measurements may share an offset.
    - [O @independent] The instruments used independent references.
    - [O/] A shared offset cancels in the comparison.
```

Reading must keep shared entity content, the occurrence note, original source or quoted context, and a proposed reconstruction distinguishable.
A note such as “Ten minutes eliminates drift” does not replace a referenced result limited to one room-temperature trial, add a premise, or certify paraphrase equivalence.
Repeated uses are not additional independent observations or speakers' agreement.
Reuse does not rebind “I” or “yesterday” to the new section; retain access to the declaration and its original context.
Declare a different Point when different content is intended, and keep proposed edits separate until explicitly applied.
These distinctions are maintained through original source, ordered AST blocks and typed Explain mappings; the compiler does not infer attribution or classify quoted versus reconstructed prose.
A graph projection cannot recover the narrative or safely rewrite an unchanged document.

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
An initial U+FEFF is recognized at the Markdown document boundary without globally stripping source; original diagnostic columns include that UTF-16 code unit.

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
Match the exact source/schema candidate when storing or consuming unpublished compiler results.

`parseDocument` returns an ordered AST; `compileGraph` produces `GraphIR`. `parseSource` and `compileSource` expose envelopes for the input modes.

For debugging, `compileGraphWithExplain` and `explainSource` add a compiler trace: how a block was recognized, which points or connections were emitted or rejected, and why an indentation rule applied or no connection was produced. The CLI exposes this as `cog explain`.
Linked recognition and linkedMember effects identify the group span, syntactic eligibility and function: source, commentary, independent or unclassified.
Eligibility alone never certifies that the whole joint survived validation.
selectAttachment records the nearest ownerSpan and optional candidate Bearing target; a failed candidate is not a canonical graph entity.
For selection through a Bearing use, selectBearing instead records contextSpan and an optional validated Bearing target; it claims no new attachment ownership.
local-attachment explains selector emissions, while no-local-attachment explains missing ownership; failed targets follow validation-error and dependency diagnostics.
Use recognition carries the authored operand, optional local role and selector.
focusPoint pairs an authored operand {id} with a typed resolved Point ref {key,kind}; rejectFocus records syntax or reference failure.
Bearing-use recognition is bearingUse with an authored operand; focusBearing resolves it to a validated typed Bearing ref.
rejectFocus also records failed Bearing uses; inspect recognition to distinguish the expected entity kind.
Point uses emit no Point; a constructed attachment still emits its own Bearing.
Bearing uses emit neither entity.
The header emits with `linked-containment` or rejects with `invalid-linked`; later name/reference rejection uses `validation-error`.
Membership eligibility does not certify that the whole linked survived validation. It explains compilation decisions, not the truth of the prose, the strength of a reason, or a history of the author's thinking. The trace is an optional Alpha interface; ordinary integrations can use AST and Graph IR alone.

A Graph IR Point holds `key`, optional `id`, shared `text`, its canonical declaration `sourceSpan`, and `declaration`.
`declaration` records how the Point was introduced: `form` (`role`, `gap` or `material`), `role` only for the role form, and `status: "open"` only for Gap.
These remain distinct fields; open status belongs to that declaration, and no use changes it.
Marks written at uses, including neutral and selector marks, live only in the AST annotation and Explain recognition; derive them from there, never from `declaration`.
An attachment created at an occurrence is an ordinary Bearing.

An AST block holds its text, raw source, children, span, and optional `annotation`. Role, anchor, status, operator, handle, and annotation errors live only inside `annotation`; there are no mirrored block-level semantic fields. A Point name appears as `annotation.anchor` in the AST and `id` in Graph IR. Ordinary body has no annotation. An `operatorClause` contains `op`, `sources`, and one authored `target: { id }`. Point annotations use `sources: "self"`; an `edge` uses a nonempty array of authored source references.
The distinct use annotation holds ref: {id}, never a declaration anchor.
The separate bearingUse annotation also holds ref: {id}, with no role, handle, anchor or operatorClause.
Its operand can be absent only on a diagnosed malformed use; original raw text and occurrence prose remain inspectable.

A note has `annotation: { kind: "note", raw, syntaxErrors?: ["note"] }`.
Its children retain complete literal text, raw lines, order, nesting and source spans, with no annotations at any depth.
Explain emits one `note` recognition and `preserveNote` effect for the header; `parentSpan` locates its direct source parent and is absent at document root.
Read the whole subtree from AST: literal children do not receive separate Explain entries.
This also applies to a malformed reserved note, which retains its error and literal boundary.
Direct notes in linked have `linkedMember` function `supplementary` and `eligible: false`.

The `implicitAttachment` Explain effect records the successful typed `target`, its canonical `targetSpan` when available, the LOCAL selected `contextSpan` and ordered `crossedBodySpans`.
The entry span identifies the responsible source occurrence.
For a reused target, its remote declaration span and local context span may differ; neither substitutes for the other.
Unavailable target spans are omitted, never manufactured.
Rejected Bearings receive no successful-attachment effect or suggestion.

`compileGraph` and `compileGraphWithExplain` consume parser-produced ASTs of the current format and reject other format versions. They interpret `annotation`, not `raw`; changing an annotation does not rewrite the retained source text. To edit a note, change the source and parse it again. Importing arbitrary AST JSON requires validation first; compilation is not a general JSON validator.

| Entity | Compilation identity | Authored identity |
| --- | --- | --- |
| Point | Required `key` | Optional `id` |
| Bearing | Required `key` | Optional `handle` |

Graph references use `{ key, kind }`; AST references remain `{ id }`. Keys are opaque, nonempty strings, deterministic for one compilation and local to one graph, with no cross-revision promise. The current compiler emits keys such as `_p1` and `_b1`; consumers must not parse their prefixes or numbers, infer array indexes from them, or use them as authored references. Use `kind` to distinguish Point and Bearing references. A Bearing has `kind`, Point `sources`, one `target`, and `derivedBy: "operator" | "structural"`; optional text describes a route.

Explain emission references use graph keys; Bearing emissions also have a graph index and optional handle. The index addresses this compilation's Bearing array only. Emitted summaries obey the same kind/target restrictions as canonical Bearings. Rejected candidates can retain unresolved authored `{ id }` references or a resolved target of the wrong kind: that mismatch can explain the rejection. They are not graph entities. Diagnostic codes on an entry come from diagnostics whose source spans overlap that block; they can include diagnostics from its children. The top-level diagnostics retain their actual spans.

## Compatibility and migration

This edition is an unpublished source candidate, package 0.4.9 / format 0.4.0.
Match the exact producing commit with its compiler, schemas and consumers; the retained format identifier alone does not distinguish earlier unpublished candidates.
Reparse the retained original document with explicit document or host context.
Relabelling older AST/Explain/source JSON cannot establish corrected selection, use mappings or new constructor shapes.
This candidate reserves previously transparent `[note]` and retires `C?` with `RETIRED_CLAIM_OPENNESS`.
Keep the original source and producing version, review every affected region, then explicitly migrate and reparse.
C? to C preserves the written content and may preserve topology, but intentionally removes Claim open metadata.
C certifies neither truth, acceptance, certainty nor completion; Q and the always-open Gap remain distinct.
A retired C? is a failed constructor, never an alias or ordinary body; independent explicit clauses retain normal recovery.
Earlier 0.4.0 JSON is not silently interchangeable with this unpublished schema revision.
Historical 0.3 research records remain evidence of that version's behaviour.

| Earlier source | Current source | Meaning and recovery |
| --- | --- | --- |
| [@p] | [. @p] | Neutral Point declaration; old annotation is a rejected boundary, never a lookup |
| [use @p] (unpublished candidate) | [. use @p] | Neutral reference occurrence; no default attachment |
| [G_] / [O_] (unpublished candidate) | [G/] / [O/] | Same strict nearest-owner selector; old intent stays rejected commentary |
| _> @b | /> @b | undercuts still requires a Bearing target; old attachment is rejected |
| [join; @b] (unpublished candidate) | [linked; @b] | Same ordered joint sources after source migration; no accepted join alias |
| [edge @p KIND @c; @b] | Unchanged, or [_ @p KIND @c; @b] | Two spellings of ONE explicit constructor, with all seven kinds |
| source API auto | Explicit document or host | Host never falls back to parsing unselected prose as an outline |
| Graph IR Point `form` / `role` / `status` (0.3 and earlier 0.4 candidates) | Point `declaration: { form, role?, status? }` | Retain Gap openness; deliberately remove retired Claim openness when migrating source. `key`, `id`, `text` and `sourceSpan` stay on the Point |

Perform source spelling changes on annotations, not arbitrary prose, and compile before comparing the intended graph.
For example, replacing a candidate [join] with [linked] preserves one joint support; removing the wrapper instead creates independent supports.
Published format 0.3.0 treated [join; @b] as ordinary body, so migration from published 0.3 requires reviewing intended grouping rather than blindly renaming a word.
Old anchor AST kind becomes material with optional anchor; use retains a distinct ref operand.
Explain uses linked recognition, linkedMember with source/commentary/independent/supplementary/unclassified function, attachment selection and focusPoint/rejectFocus.
Previous join variants/reasons and anchor-annotation emit reasons are not current machine contracts; material-annotation now explains neutral Point emissions.
Retired source receives migration errors and retains its failed boundary; valid unrelated content remains available in the partial graph.
An old anchor-only declaration emits no Point, a retired selector stays commentary, and a retired operator rejects only its attachment when the Point/use operand itself is valid.
Canonical GraphIR stays {version, points, bearings, diagnostics}; typed refs stay {key, kind}.
The nested Point `declaration` is an incompatible JSON-shape change within this unpublished candidate: compiler, schemas and consumers must match, and stored graphs must be reparsed from source rather than relabelled.
The complete negative-kind mapping is challenges → challenges (Point target), undercuts → undercuts (Bearing target).
The authored -> and /> checks remain distinct; no kind unification or C/R removal occurs.

Consumers address entities by `(unit index, ref.kind, ref.key)` within one compilation; the unit index selects the corresponding `graphs[]` entry.
Explain's emission `graphIndex` instead indexes that selected graph's Bearing array.
Each document or fence unit has its own authored namespace; the same name in another unit is unrelated.
AST block order preserves reader order; its `sourceSpan` and Explain entry spans locate the original occurrence using one-based UTF-16 line/column positions.
A linked header's span can identify its Bearing, and a Point annotation can identify both its Point and its attached Bearing.
One span therefore need not select only one entity; inspect the typed emission references rather than choosing the first match.
Point and Bearing occurrence spans map through focusPoint or focusBearing to the original entity key; canonical spans stay at declarations/constructions.
Valid use block text holds the local note separately from shared entity text.
Address an occurrence by source-unit index and Explain entry index; address its entity by source-unit index and (kind,key), scoped to that compilation.
Several occurrences may match one entity; return their distinct locations instead of silently choosing a single span.
Optional missing canonical spans do not justify inventing source positions or extracting narrative from Graph IR.
An occurrence can both focus a Point and emit an attached Bearing; neither operation creates a GraphIR occurrence entity.
Document integrations select (ref.kind, ref.key) within their document scope; host integrations additionally need the selected-unit index and separate namespace.
Keys are local to each compilation and do not promise cross-revision identity.
These mappings preserve reader order and original UTF-16 positions without reconstructing narrative from the graph.
Missing GraphIR spans cannot be reconstructed from a key or handle; declaration navigation requires a real declaration span even when mapped occurrence spans remain available.
GraphIR contains no additional occurrence entity and cannot reproduce the authored document from its topology.
Executable consumer cases live in the source checkout's `fixtures/`: `core/local-linked.cog.md`, the host local-linked case, and `diagnostics/retired-join.cog.md`.
`core/narrative-reference-reuse.cog.md` checks serial reuse, linked ordered sources, owned objections and replies, with no subtree copying.
`core/bearing-reference-reading.cog.md` preserves quoted context, a separate reconstruction, stronger occurrence prose and repeated route discussion without changing shared content.
`diagnostics/retired-authoring-spellings.cog.md` checks rejected migration spellings, failure boundaries and the retained independent partial graph.

Format 0.3.0 replaced generated Point IDs, optional Bearing IDs, ID-based graph references, mirrored AST block fields, and the AST operator's single-element `targets` array (now `target`). Consumers must migrate together; reparse older source rather than relabelling old JSON with the new version.

### Schemas for integrations

The source distribution's `spec/` directory contains JSON Schemas using draft 2020-12. The current development checkout includes AST, Graph IR, Explain, and source-envelope contracts through `@cogitatum/core/schemas/{ast,graph-ir,explain,source}`. The source-envelope schema refers to the other three by `$id`; load those sibling schemas too when validating it. The published npm `0.3.0-alpha.1` tarball includes only the first three exports. For example, in Node.js:

```js
import graphSchema from '@cogitatum/core/schemas/graph-ir' with { type: 'json' };
```

Schema `$id` values use `/schemas/0.4.0/`.
After the first official package or schema publication of this format, the released schema set and its versioned URLs are fixed; later incompatible contracts require a new format identifier and schema URLs.
Until then, the [unpublished-candidate policy](#compatibility-and-migration) applies: the shared preview may replace its schema mirrors together with the matching compiler, while earlier deployment snapshots remain archived.
For reproducible or offline validation, use all four schema copies from the exact package or source commit; neither the format identifier nor an unchanged source-envelope schema identifies the complete contract.
This source change does not publish the official schema URLs or update the production compiler; the website and npm remain separate release surfaces.

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
