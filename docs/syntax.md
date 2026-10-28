---
title: Complete syntax
summary: Format 0.6.0 grammar, indentation, references, input modes, and machine contract.
section: reference
order: 4
---

# Complete syntax

Reference for **format 0.6.0**, implemented by the unreleased Core/CLI **0.6.0** checkout.
Published **0.5.0** is a separate contract; see [migration](#compatibility-and-migration).
Use the complete released compiler and schema set; earlier unpublished 0.4 candidates may report the same format identifier with different contracts.
Examples, schemas, and conformance fixtures are checked against the implementation.

## Outline and body

Write a Markdown-style outline.
Root blocks start at column one.
Use spaces or hard tabs for bullet indentation, keeping one kind per source unit.
With spaces, a child can use any greater width; with tabs, each tab counts as one indentation unit.
A dedent must match an active ancestor level.
The first indented bullet chooses the unit's indentation character.
A later bullet using the other character, or mixing both in its own indentation, produces `MIXED_INDENTATION`.
Mixed indentation, indented roots, and unmatched dedents are diagnosed and their apparent annotations are not compiled.
Recognised annotations on those lines remain failed boundaries: implicit descendants cannot attach past them to an outer Point, while independent explicit relations and valid inner subtrees survive.

Start each block with `- ` after its indentation.
An annotation starts the block's content on that first line; unmarked content remains body.
Continue a block on subsequent nonbullet lines by repeating its exact bullet indentation,
then replacing the marker and its separating whitespace with the same number of spaces.
For the usual `- `, this means two spaces after the bullet's original indentation.
This continuation prefix is removed from the content; additional whitespace remains as prose.
Continuation padding never chooses or changes the unit's bullet indentation character.
Source columns count UTF-16 code units, including one per tab, regardless of an editor's visual tab width.
Blank lines between continuation lines separate paragraphs in the same block.
A newline does not create a note, Point, or Bearing.

```md cog-check require=supports points=2 bearings=1 diagnostics=0
- [C @claim] The method may work
  under the stated conditions.
  - [G; @route] Two trials agreed.
    Both used the same temperature.
    - [_ note] This describes the route.
      It adds no extra premise.

      A second paragraph belongs to the same note.
```

A new bullet starts a new block.
Only the most recent block can continue; after a child bullet, prose cannot resume its ancestor's content.
Use a new body bullet to continue the reading after children.
Nonbullet lines without the required continuation prefix produce `UNSUPPORTED_LINE`.
Annotations are recognised only on bullet headers: `[G]` on a continuation is prose, and a later `]` cannot close a broken header.
Blank lines outside continued content do not produce blocks.
The AST preserves block order, multiline content, raw block lines, body, and source spans; retain the original input for exact line endings.
This is a restricted outline parser, without Markdown lazy continuation or arbitrary block parsing.

```md cog-check require=supports points=2 bearings=1 diagnostics=1
- Ordinary context.
  - [C @claim] A claim.
    - An unmarked explanation.
      - [G] A selected reason.
```

Outlines copied from tools that indent with tabs, such as Logseq or Obsidian, compile to the same graph as their space-indented form:

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=0
- [C @claim] A claim.
  This root continuation does not set the bullet indentation style.
	- [G; @route] A reason, one tab deep.
	  Its continuation repeats the tab, then two spaces.
		- [_ note] A note on the supporting step.
		  Its continuation repeats two tabs, then two spaces.
	- [O] An objection at the same level.
```

## Annotation grammar

```text
annotation := "[" (point | selector | bearing | use | note) "]"
point      := (ROLE | POINT) [REF] [clause] [";" REF]
selector   := SELECTOR [REF] [";" REF]
bearing    := BEARING [SOURCES] clause [";" REF]
            | BEARING ["/"] [";" REF]
            | BEARING "use" REF
            | BEARING "note"
use        := (ROLE | POINT) "use" REF [clause] [";" REF]
            | SELECTOR "use" REF [";" REF]
note       := [POINT] "note"
clause     := (OP | KIND) TARGET
TARGET     := REF | "^" | "^/"
SOURCES    := REF ("," REF)*
ROLE       := "Q" | "C" | "G" | "O" | "R" | "D"
SELECTOR   := "G/" | "O/" | "Q/" | "D/"
POINT      := "." | "point" | "node"
BEARING    := "_" | "bearing" | "edge"
REF        := "@" ID
ID         := [a-z][a-z0-9_-]*
OP         := "+>" | "->" | "~>"
KIND       := "supports" | "challenges" | "concerns"
            | "answers" | "respondsTo" | "clarifies"
```

Token order and case matter; role marks are uppercase and keywords are lowercase.
Relation names are case-sensitive English third-person-singular verbs or verb phrases in lowerCamelCase, read source–relation–target.
Whitespace separates words and reference lists use commas.

Every relation is written the same way: a relation, then one target term.
The target term is a name, `@claim`, or a position.
`^` is the nearest enclosing Point and `^/` is the Bearing that the nearest context exposes.
They are positions, not names: `@^` is malformed, and nothing can be declared as `^`.
The header decides only where the sources come from:
a Point occurrence is the sole source of its own clause,
a constructor with listed sources uses those named Points,
and a constructor without listed sources uses its direct neutral children.

A mark abbreviates a clause toward a position, and the long spelling compiles to the same graph:

| Written | Means | Relation |
| --- | --- | --- |
| `[G]` | `[G +> ^]` | `supports` the nearest Point |
| `[O]` | `[O -> ^]` | `challenges` the nearest Point |
| `[Q]` | `[Q ~> ^]` | `concerns` the nearest Point |
| `[R]` | `[R respondsTo ^]` | `respondsTo` the nearest Point |
| `[D]` | `[D clarifies ^]` | `clarifies` the nearest Point |
| `[G/]`, `[O/]`, `[Q/]`, `[D/]` | the same relation toward `^/` | the exposed Bearing |
| `[_]` | `[_ ~> ^]` | joint `concerns` from the children to the nearest Point |
| `[_/]` | `[_ ~> ^/]` | joint `concerns` from the children to the exposed Bearing |

`C` and `.` abbreviate no relation; write a clause, such as `[C answers @question]`, when one is intended.
There is no `R/`: `respondsTo` and `answers` require a Point target.
A selector abbreviates its clause, so it cannot also write one.
Optional prose follows the closing bracket and may continue on indented lines.
The `point` form declares a Neutral Point; the AST records it as annotation kind `material` and Graph IR as `declaration.form: "material"`.
The Point family (`point`, `node`, `.`) and Bearing family (`bearing`, `edge`, `_`) share all construction, use and note grammar.
Aliases change only written spelling and source coordinates, including failed and unclosed headers.
`node` is a Cogitatum spelling for Point, not a mapping to another system's node categories.
Examples primarily use `.` and `_`.

After a Bearing family spelling, the first token selects what the header does:

| First token after `bearing`, `edge` or `_` | Header | Example |
| --- | --- | --- |
| none, or `/` written against the family | Joint `concerns` from the direct neutral children | `[_; @scope]`, `[_/]` |
| An operator or kind | One relation from the direct neutral children | `[_ +> ^; @route]`, `[_ -> ^/]`, `[_ +> @claim]` |
| `@ref` | One relation from the listed Points | `[_ @a, @b +> @claim; @route]`, `[_ @a, @b +> ^]` |
| `use` | Reuse an existing Bearing with its endpoints unchanged | `[_ use @route]` |
| `note` | Annotate the locally exposed Bearing with a literal subtree | `[_ note]` |

`[bearing +> ^]`, `[edge +> ^]` and `[_ +> ^]` are the same construction.
Any other first token selects no mode: `[_ G]`, `[_ ^]`, `[_ /]` and `[edge cases]` receive `MALFORMED_BEARING_MODE`.
Its message names the header that states the intended relation, such as `[_ +> ^]` for `[_ G]`.
A header with a mode but an incomplete clause, such as `[_ +>]` or `[_ +> ^ @a +> @b]`, receives `MALFORMED_EXPLICIT_BEARING` or `MALFORMED_BEARING_TARGETS`.
Either way the header remains a failed constructor boundary: its descendants cannot attach outward, and no named-target requirement is reported for them.
A mark written against the family spelling, as in `[_G]` or `[bearingG]`, is also a rejected boundary, never ordinary body.
This boundary also holds when the operator's separating spaces are missing, as in `[_G->@claim]`, including an unclosed header.
Ordinary words such as `[_O-ring]` remain body.
The first token fixes the mode before the rest of the header is validated; no other mode is attempted.
There is no active standalone `linked` keyword.

```md
- [C @outer] Outer claim.
  - [_G] The missing space keeps a rejected constructor boundary.
    - [.] This source does not fall back to body.
```

An operator written against its neighbours, as in `[O->@claim]`, receives `MALFORMED_EXPLICIT_BEARING` with the spaced spelling.
The occurrence keeps its mark, name and handle, so its Point or Point use survives, but the clause is rejected and no indentation default replaces it.

| Form | Effect |
| --- | --- |
| `[C]`, `[C @claim]`, `[G]` | A role-bearing Point |
| `[.]`, `[. @passage]` | Neutral Point, optionally named |
| `[O -> @claim]` | Anonymous Point and explicit challenge |
| `[Q @question respondsTo @objection]` | Question Point and one explicit response, replacing any default attachment |
| `[G @reason; @route]` | Named Point and named structural Bearing, if the parent permits it |
| `[_ @a, @b +> @claim; @route]` or `[edge @a, @b +> @claim; @route]` | One joint Bearing between existing Points; no new Point |
| `[_ +> ^; @route]` with direct neutral sources | One structural support to the nearest enclosing Point; sources participate jointly when there are several; no new Point |
| `[. use @p]` | Present an existing Point without creating one or adding a default attachment |
| `[G use @p; @route]` | Reuse an existing Point as a local Ground, with an attachment if the context permits |
| `[_ use @route]` | Present an existing validated Bearing without constructing a relation or changing its endpoints |
| `[note]` and its subtree | Literal supplementary prose, owned by its direct source parent |
| `[. note]` and its subtree | A source-backed note on the locally presented Point |
| `[_ note]` and its subtree | A source-backed note on the locally exposed Bearing |
| Unmarked body or grouping | No Point or Bearing of its own |

Empty brackets, unfinished reserved prefixes, malformed operators, invalid names, repeated sources, and a bare `;` are errors.
Invalid annotations remain inspectable in the AST; a valid Point can survive an error in its attached Bearing.
`[Context for this section]` and its unclosed counterpart are ordinary body.
Annotation parsing starts only with a complete mark or keyword: a role letter, `?`, a Point/Bearing family spelling, `use` or `note`; the retired `linked` and `join` keywords are also recognized so that they are diagnosed.
A role letter is complete when the bracket, whitespace, `;`, `@` or an operator follows it, directly or after a `?`, `/` or `_` suffix; `?` likewise, after an optional `/` or `_`.
Point/Bearing family spellings use the same boundaries, so `[point@p]` and `[_@a+>@b]` are malformed annotations rather than transparent body.
Required spaces are still required; recognizing a failed header never makes its spelling valid.
Incorrect case and retired spellings such as `join`, `C?`, `G_`, `O_`, `[@p]` and `[use @p]` are also recognized, so that they are diagnosed; recognition does not make invalid forms legal.
Words such as `Context`, `joined` and `linked-data` do not select annotation parsing, and neither do words that merely begin with a mark letter, such as `[O-ring]`, `[C-section]`, `[C++]` or `[G/O ratio]`.
Reserving complete marks and keywords is a deliberate trade-off: `[C major]`, `[edge cases]` and `[note to self]` are malformed annotations rather than prose, and their failure boundaries apply.
`[linked list]` and `[join the debate]` receive retirement diagnostics.
To keep such text as ordinary prose, omit the brackets or place prose before them.

## Literal notes

All three note forms preserve their following prose and whole indented subtree outside graph construction.
Inside it, every Cog-looking spelling, including a nested `[note]`, malformed header, anchor or unresolved use, is literal text.
No inner name registers, conflicts with a declaration or satisfies an outside reference.
Dedenting out of that subtree restores normal interpretation.
Outline layout errors still apply; a note does not enable arbitrary Markdown.

The keyword must be lower-case `note`; surrounding header whitespace is allowed.
An empty `[note]` is a valid placeholder, with no warning.
A leading note operation, either bare or after a Point/Bearing family spelling, reserves the literal boundary.
The note token ends at the header end, whitespace, semicolon, @, closing bracket or a symbolic operator.
Recognition includes wrong case so it can be diagnosed.
Parameters, wrong case or a missing closing bracket produce `MALFORMED_NOTE` and retain the literal boundary.
`[note @alias]` therefore never activates its children after failing.
`[notebook]`, `[note-like]`, quoted `"[note]"` and escaped `\[note]` remain ordinary body; the escape backslash remains in authored text.
Native Markdown activation and shortcut-link precedence remain deferred.

A plain `[note]` belongs to its direct source parent or the document root.
Point declarations, Point uses, local and explicit Bearing constructions, Bearing uses and ordinary body all use this same rule.
A Ground can emit both a Point and a Bearing; its note still belongs to that source occurrence without selecting an entity owner.
Multiple sibling notes preserve their order; reuse does not copy them.
Existing inline Point/Bearing-use prose remains separate.

### Local object notes

`[. note]` selects the Point presented by the nearest semantic context.
`[_ note]` selects that context's exposed Bearing.
First choose the nearest context, then its requested slot; an unavailable or invalid slot produces `NO_LOCAL_NOTE_TARGET` or `INVALID_LOCAL_NOTE_TARGET`.
There is no outward fallback and no search through an object's other connections.

| Nearest context | `. note` | `_ note` |
| --- | --- | --- |
| Point declaration or Point use | The presented Point | Only the attachment newly constructed at this occurrence |
| Local or explicit Bearing constructor, or Bearing use | Unavailable | The constructed or reused Bearing |
| Direct local source member | Its Point | Unavailable; the member owns no unary attachment |
| Missing or failed context | Unavailable | Unavailable |

Ordinary body is transparent where existing local selectors permit it.
It does not make an illegal ordinary group under a local Bearing legal, flatten members, or bypass a failed context.
Anonymous objects need no temporary names.
To annotate an object elsewhere, bring it into context with `use` and put a typed note beneath that occurrence.
There is no explicit note target, note anchor or `annotate` keyword.
`use` presents an existing object; `note` selects note mode.
Neither is an alternative way to declare a Point or construct a Bearing.

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=0
- [C @claim] The pump may explain the cluster.
  - [G @cluster; @proximity] Most cases are nearby.
    - [. note] Nearby describes spatial distribution.
    - [_ note] Proximity may reflect access to this water supply.
      - [G] This is quoted text, not another Ground.
    - [O/] Nearby residents with other water supplies had few cases.
- [bearing use @proximity]
  - [bearing note] The original comparison was made yesterday.
```

Notes introduce no Point, Bearing, endpoint, premise or new argumentative context.
Write active `G/`, `O/` and `Q/` beside a note, outside its subtree.
Point text remains its main content; an essential qualification belongs there or in an explicitly retained argument context.
Each authored object note remains a distinct record, even when two notes have identical text.
Uses expose the same records and their original locations; they neither copy the records nor reinterpret “here” or “yesterday” at the use location.
Reading keeps source order; object details and Map provide source links.

Direct valid notes are supplementary local members, excluded from the ordered active sources.
A notes-only local Bearing still fails `EMPTY_LOCAL_BEARING`; a malformed direct note invalidates membership atomically.
Ordinary body under a local Bearing remains invalid and does not flatten nested Points into source members.

Keep a qualification that changes a Claim's scope in its content or a clearly retained argument context.
Moving live argument into note, or promoting note prose to Points, is an explicit authoring change rather than a formatter repair.

## Roles and connections

Roles are `Q` Question, `C` Claim, `G` Ground, `O` Objection, `R` Response, and `D` Distinction.
`[?]` is retired; use a scoped absence Point, a genuine Question or an author task in a note according to the intended content.
C? is retired; use C for a Claim or possible answer, preserving tentative wording.
A dot declares a Neutral Point, optionally named, without a role; it is a separate Point form, recorded as `declaration.form: "material"`.
Roles cannot take `?`.
C certifies neither truth, certainty, acceptance nor completion.
Point content may be a question or fragment; it need not be a declarative sentence or complete proposition.
The marks are authoring choices at an occurrence, not mutually exclusive semantic classes or permanent logical types.

| Operator | Kind | Permitted target |
| --- | --- | --- |
| `+>` | `supports` | Point or Bearing |
| `->` | `challenges` | Point or Bearing |
| `~>` | `concerns` | Point or Bearing |

The operator names the relation; the target term alone decides whether its object is a Point or a Bearing.
`[O -> @claim]` challenges a Point and `[O -> @route]` challenges a Bearing, according to what each name declares.
In `G/`, `O/`, `Q/` and `D/`, `/` writes the position `^/`: the locally exposed Bearing.
They construct `supports`, `challenges`, `concerns` and `clarifies` respectively.
The retired `/>` and `_>` operators are diagnosed with `RETIRED_AUTHORING_SYNTAX` and migrate to `->`.
These are target-selection rules, not degrees of support or opposition.

Point declarations and uses accept all six case-sensitive canonical names:
`supports`, `challenges`, `concerns`, `answers`, `respondsTo` and `clarifies`.
The first three have the symbolic spellings above.
`answers` and `respondsTo` require Point targets; `clarifies`, like the first three, accepts a Point or a Bearing.
For example, `[Q @question respondsTo @objection]` declares a Question and states one response.
`[Q use @question respondsTo @objection]` states the same kind of attachment using an existing Point.
Neither form changes its written role, shared content or child context.
Each Point clause has only that Point as its source; joint sources use a Bearing constructor.
Named clauses and symbolic clauses follow the same handle, target-validation and selector-exclusion rules.

`[_ @a, @b ~> @target]` and `[_ @a, @b concerns @target]` each construct one joint `concerns` Bearing.
The ordered, distinct Point sources participate in one relation of relevance; they do not create independent unary relations or imply support, challenge, necessity, validity or acceptance.
The target may be a Point or a named Bearing.
Invalid sources or targets reject the entire relation, preserving diagnostics rather than silently dropping a source.
See [joint relevance](#joint-relevance) for executable examples and the contrast with two independent `concerns` Bearings.

Outside a constructor's direct membership, without a written clause, the child mark supplies the relation and `^` the target:

| Child | Parent | Derived kind |
| --- | --- | --- |
| `.`, `C` | Any Point | none |
| `G` | Any Point | `supports` |
| `O` | Any Point | `challenges` |
| `Q` | Any Point | `concerns` |
| `R` | Any Point | `respondsTo` |
| `D` | Any Point | `clarifies` |

A Question beneath a Point is about that Point: `[Q]` is `[Q ~> ^]`.
`concerns` records relevance only; it neither supports nor challenges, and it is not an answer.
`C` and `.` state no relation, so a Claim beneath a Question creates no Bearing; to record an answer, state `answers` explicitly.
A root Question has no nearest Point and stays an unattached Point, as before.
A local relation mark states its kind; indentation selects its target.
All six explicit kinds remain available and check references, source uniqueness, shape and target type rather than declaration roles.
Body is transparent, but a Point declaration or Point use establishes a local Point context.
A use presents the existing Point; it does not create a new Point.
Every Point occurrence, including a declaration, has a locally written mark; `.` is the neutral mark and selects no role.
The child occurrence's own mark selects the default kind; the parent's mark never enables or disables it.
A referenced Point's declaration never supplies an occurrence's mark.
An explicit Bearing or Bearing use supplies a Bearing context: its first unsuffixed Point, possibly through body, needs an explicit operator and target.
This includes neutral declarations and neutral uses.
They do not add a source to that Bearing or become unconnected as they can in a Point context; put an unconnected Point outside the Bearing context.
`G/`, `O/`, `Q/` and `D/` may instead select the constructed or referenced Bearing.
Once a Point occurrence establishes its context, its children use the ordinary indentation rules again.
An explicit clause, symbolic or named, overrides the structural default; it does not create a second connection.
`R` is Response and its relation is `respondsTo`: a passage addresses another Point in the artefact,
without requiring a chronological conversation or asserting that an answer succeeds.
Use explicit `answers` when the answer relation itself is intended.

Successful implicit selection across ordinary body adds `IMPLICIT_ATTACHMENT_THROUGH_BODY` at `suggestion` severity.
It names the actual selected target (or its source span if anonymous), the responsible occurrence and the crossed body regions, grouped once per selection.
This includes ordinary `G`, `O`, `Q`, `R` and `D` attachments, constructor target lookup and `G/`, `O/`, `Q/` and `D/` selectors.
`C` and neutral children receive no implicit-attachment effect or advice.
It changes diagnostics only: Points, Bearings, identities, validation and fallback stay unchanged.
Failed selections, complete explicit endpoints, root groups, leaf prose, nearer active contexts and literal notes receive no such success advice.
Its explanation offers existing spellings: keep the grouping deliberately, move the active content beside its target, or name the target.
The advice writes the same header with the target named, as `target-form --to named` would: `[G]` becomes `[G +> @claim]` and `[O/]` becomes `[O -> @route]`.
The named target replaces the positional one rather than adding a second Bearing, and a constructor's sources stay where they are.

There is no automatic note-wrapping fix: that would remove the active subtree from the graph.

Recognized malformed Bearing constructor headers retain this boundary in the AST, including incorrect case, an unclosed bracket, and invalid `;` separators.
Their descendants cannot acquire a default connection to an outer Point because the constructor failed.
Valid descendant Points, their ordinary subtrees, and relations with independent explicit targets remain available in the partial result.
Each exact keyword is reserved: the `edge` alias is recognized, while `[edgeless]` remains ordinary body.

A top-level Objection is legal even without a target:

```md cog-check points=1 bearings=0 diagnostics=0
- [O @draft] A network fault could explain the same observations.
```

It creates one Point and no Bearing or diagnostic.
Similarly, a Claim beneath a Question or Neutral Point creates no default connection.
An intervening Point remains the nearest target for its own relation-marked children; they do not attach to an outer Question through it.
See [connections from indentation](bearings.md#connections-from-indentation) for a worked example and relation table.

`supports` means positive bearing without specifying deductive, inductive, abductive, explanatory, or interpretive method. No kind asserts success or validity. The graph adds no negation from absence or transitive closure. See [Bearings](bearings.md) for examples.

## Bearing constructors

A constructor writes one relation whose sources are other Points.
`[_ +> ^]`, `[_ -> ^]`, `[_ ~> ^]`, `[_ respondsTo ^]`, `[_ clarifies ^]` and `[_ answers ^]` each construct one Bearing of that kind from the direct neutral children to the nearest enclosing Point.
`[_]` abbreviates `[_ ~> ^]`, and `[_/]` abbreviates `[_ ~> ^/]`: a joint relevance whose force is not yet decided.
The `bearing` and `edge` spellings work identically.
An optional `; @route` names it: `[_ +> ^; @route]`.
The target term works as it does on a Point occurrence:
`^` is the nearest enclosing Point, possibly through ordinary body but never past another Point,
`^/` is the Bearing the nearest context exposes, and `@name` fixes the target regardless of position.
The parent's mark imposes no restriction beyond the relation's own target rule.
The operation decides which object is involved: `[_ +> ^]` constructs a new Bearing to that Point, while `[_ note]` annotates the nearest context's exposed Bearing and `[_ use @route]` focuses the named existing Bearing.
Nesting `[_ +> ^]` beneath a Ground supports that Point; `[_ +> ^/]` supports the Ground's attachment instead.

Listing sources changes only where the sources come from: `[_ @a, @b +> ^]` takes `@a` and `@b`, and its target is still positional.
Its children are then ordinary occurrences, not members.

Without listed sources, each direct child has one function, decided by what its header writes rather than how it is spelled:

| Direct child | Function |
| --- | --- |
| `[.]`, `[. @a]`, `[. use @a]` | Source, in outline order |
| Any relation toward `^/`: `[O/]`, `[G +> ^/]`, `[_ -> ^/]` | Commentary on the constructed Bearing |
| A Point relation with a named target, such as `[G +> @claim]` | Independent relation |
| `[note]`, `[. note]`, `[_ note]` | Supplementary note |
| Any relation toward `^`, written by mark or clause: `[G]`, `[G +> ^]`, `[. +> ^]` | Invalid: there is no Point for `^` here |
| A member-sourced constructor, `[_ +> ^]` or `[_ +> @x]` | Invalid nesting |

`[G]` and `[G +> ^]` are therefore the same member, as they are everywhere else.
All Point-family aliases apply, and a source may be a use of an existing Point.
Their roles, content, optional anchors, and individual spans remain intact.
The constructor has no Point of its own, and its Bearing uses `derivedBy: "structural"` when its target is positional, or `"operator"` when it is named.
Its span is the header block's own, including continuations but excluding children.
Optional prose after the header, including continuations, becomes that Bearing's `text`.
It is a description of the connection, not a new Point, member, or parsed argument.
An empty description leaves `text` absent.

A singleton is a complete Bearing construction, with or without a description or commentary.
Source count alone establishes neither an unfinished draft nor sufficient reasoning, so it produces no unfinishedness advice.
An empty group or missing selected target is an error.
Direct body wrappers and the invalid children above are rejected.
Bare `O` in a Bearing context is not an alias for `O/`; `^` and `^/` are different positions.
For a direct `G` or `O`, `INVALID_LOCAL_BEARING_MEMBER` offers neutral `[.]` membership, `G/` or `O/` Bearing commentary, or a named target as distinct authoring choices.
The diagnostic retains an authored name or use reference in its examples; it does not apply a rewrite.
Choosing among these changes the argument and is not a formatter repair.
A constructor toward `^` cannot bypass a listed-source constructor's target boundary.
Direct member-sourced constructor nesting, even through body, is rejected (`NESTED_LOCAL_BEARING_UNSUPPORTED`).
A constructor toward `^/` instead selects that context's exposed Bearing, without searching for an outer Point.
A constructor inside a member Point's subtree is a separate inference and is legal.
Serial structure uses ordinary Point nesting, retaining a real intermediate Point rather than a special keyword.
Use header prose to describe the joint; neutral uses contribute existing Points without unary member attachments.

Any invalid member rejects the whole joint, never a reduced source set.
First Points below the group, including through invalid body wrappers, receive no structural connection to the outer target even after rejection.
Valid Points and their own ordinary subtrees remain available.
A complete explicit Point clause or direct explicit Bearing constructor remains independently authored and does not invalidate otherwise valid sources.
A direct Bearing use is an independent occurrence, never a source, even when its reference fails.
Its selectors discuss its explicitly referenced Bearing, not the surrounding joint.
For example, `[G +> @missing]` rejects its own relation; incomplete `[G +>]` is unclassified and rejects the whole joint.
Clearly retained malformed selector intent remains commentary, receives its own diagnostic, and cannot become a joint source.
A member's handle without an operator produces no default Bearing and receives `BEARING_HANDLE_WITHOUT_BEARING`.
Malformed member operators receive their normal syntax diagnostic and no fallback.
This preserves explicit intent without treating it as a joint source declaration.

Malformed constructor headers receive `MALFORMED_BEARING_MODE` or a clause diagnostic and remain construction boundaries, including an unclosed prefix.
Recovery cannot turn their members into unary support, choose fewer sources or search outward for another target.
Membership/context failure yields no route to reference (`UNKNOWN_TARGET` for a subsequent handle reference).
A candidate rejected during ordinary name/reference validation follows the existing failed-Bearing dependency rules.
Duplicate member anchors invalidate the entire joint rather than deduplicating or dropping a source.
Repeated resolved Point identities, including a declaration and use of that same Point, also reject the entire joint.
Distinct Points with the same prose remain distinct sources.

Positional and named targets are two spellings of the same relation: `target-form` changes one target term and leaves the sources where they are.
Leaving `[G]` children in place and adding a constructor intentionally produces both unary and joint Bearings.
Neither construction adds reasoning closure, validity checks, minimality, or necessary-premise claims.

The old `[linked]`, `[G linked]` and `[linked G]` headers are retired, including their role variants; they receive `RETIRED_LINKED_ANNOTATION` and never compile as compatibility aliases.
`join` remains retired with `RETIRED_JOIN_ANNOTATION`, including malformed reserved prefixes and unclosed headers.
These rejected boundaries retain the original spelling in `raw`; descendants cannot recover as unary supports to an outer Point, and no handle binds.
Ordinary non-reserved text such as `[joining the discussion]` remains body.
Migrate an intended joint support header to `[_ +> ^]`, retaining an optional `; @route`.
For the published bare `[linked]` form, also change direct Ground sources to neutral declarations or uses.
Role-headed drafts already using neutral sources need only the header change, subject to reviewing the intended local target.
Recompile the original source; do not choose source membership or apply a fix automatically.
Unclosed brackets may also receive the outline's malformed-prefix diagnostic, and invalid context or membership remains observable through `INVALID_LOCAL_BEARING_MEMBER` and the related constructor diagnostics.

## Relations to a step

A relation toward `^/` records something further about an existing step; it never becomes a source in that step.

### Ask about a step

`Q/` presents a Question and records that it concerns the selected Bearing.
It adds no premise to that Bearing and records no challenge, answer or resolution.
The Question's ordinary children follow the same rules as any Point's children: `R` responds to the Question.

```md cog-check compare=question-selector caption="Local question" require=supports,concerns,respondsTo points=4 bearings=3 diagnostics=0
- [C @familiar] The visitor may be someone the dog knows.
  - [G @silent; @step] The dog did not bark.
    - [Q/ @conditions; @inquiry] When does silence support familiarity?
      - [R] Check that the dog was awake and usually barks at strangers.
```

```md cog-check compare=question-selector caption="Explicit question" require=supports,concerns,respondsTo points=4 bearings=3 diagnostics=0
- [C @familiar] The visitor may be someone the dog knows.
  - [G @silent; @step] The dog did not bark.
    - [Q @conditions ~> @step; @inquiry] When does silence support familiarity?
      - [R] Check that the dog was awake and usually barks at strangers.
```

The pair records the same selected graph structure, including the original support and the response to the Question.
The local form also works when the step is anonymous.
Spans, `derivedBy`, Explain and original source remain distinct.

| Written beneath the Ground | Recorded relation |
| --- | --- |
| `[Q]`, `[Q ~> ^]` | `concerns` the Ground's Point |
| `[Q/]`, `[Q ~> ^/]` | `concerns` the locally exposed Bearing |
| `[Q ~> @step]` | `concerns` the named Bearing |
| `[Q -> @step]` | `challenges` the named Bearing |

The slash chooses the position `^/`; the relation stays the mark's own.
Asking about an anonymous step therefore needs no handle.
Use an Objection or a `challenges` clause when the content makes a challenge rather than leaving a question open.

`[Q/ use @question]` uses an existing Point with a local Q mark and adds the `concerns` Bearing without changing shared content or declaration metadata.
Like `G/`, `O/` and `D/`, it works under constructors and Bearing uses, and never skips a nearer Point without an attachment.
Under a `Q/` occurrence, another selector addresses the Question's own `concerns` Bearing; `[_ note]` annotates that same local connection.
There is no `C/` or `R/`: C states no relation, and `respondsTo` requires a Point target.

### Several sources about one step

Write a constructor toward `^/` when several neutral Points jointly support, challenge or concern the selected Bearing.
The target term is the same `^/` that a single-Point selector abbreviates.
The constructor creates no Point and adds none of its sources to the selected Bearing.

```md cog-check compare=joint-step-review caption="Local joint challenge" require=supports,challenges points=4 bearings=2 diagnostics=0
- [C @familiar] The visitor may be someone the dog knows.
  - [G @silent; @step] The dog did not bark.
    - [_ -> ^/; @review] These circumstances challenge the step together.
      - [. @sedated] The dog had been sedated.
      - [. @effect] Sedation can suppress barking at strangers.
```

```md cog-check compare=joint-step-review caption="Explicit joint challenge" require=supports,challenges points=4 bearings=2 diagnostics=0
- [C @familiar] The visitor may be someone the dog knows.
  - [G @silent; @step] The dog did not bark.
    - [. @sedated] The dog had been sedated.
    - [. @effect] Sedation can suppress barking at strangers.
    - [_ @sedated, @effect -> @step; @review] These circumstances challenge the step together.
```

`[_ +> ^/]` similarly creates joint support, `[_ clarifies ^/]` a joint clarification, and `[_/]` joint `concerns`.
Each permits one or more direct neutral sources, including uses, followed by notes or further commentary toward `^/`.
They work under a Point with an attachment, a constructor, and a Bearing use.
A nearer Point without an attachment blocks selection; a failed context cannot be bypassed.
`[_ respondsTo ^/]` and `[_ answers ^/]` are rejected because those kinds require Point targets.
The compiler records the selected context and ordered sources in Explain; the [inspection tools](graph-inspection.md#inspect-every-local-decision) expose them without interpreting the prose.

### Explain a step, add a premise, or support the step

These invented examples distinguish three authoring choices.
First, a note describes how the existing connection is understood:

```md cog-check require=supports points=3 bearings=1 diagnostics=0
- [C @familiar] The visitor may be someone the dog knows.
  - [_ +> ^; @recognition]
    - [. @silent] The dog did not bark when the visitor entered.
    - [. @usual] The dog usually barks at strangers.
    - [_ note] Read the silence as a clue to recognition.
```

The note adds no Point, source or Bearing, although it can affect how the passage is read.
If the author offers another observation as a joint premise, it becomes a third source in the original connection:

```md cog-check require=supports points=4 bearings=1 diagnostics=0
- [C @familiar] The visitor may be someone the dog knows.
  - [_ +> ^; @recognition]
    - [. @silent] The dog did not bark when the visitor entered.
    - [. @usual] The dog usually barks at strangers.
    - [. @awake] A recording shows the dog was awake and responding normally to nearby sounds.
```

Alternatively, the author can offer that observation as a positive reason for the existing connection:

```md cog-check require=supports points=4 bearings=2 diagnostics=0
- [C @familiar] The visitor may be someone the dog knows.
  - [_ +> ^; @recognition]
    - [. @silent] The dog did not bark when the visitor entered.
    - [. @usual] The dog usually barks at strangers.
    - [G/ @awake] A recording shows the dog was awake and responding normally to nearby sounds.
```

Here the original Bearing still has two sources.
The new Point supplies a separate `supports` Bearing targeting `recognition`, without a hidden proposition Point.
It need not independently or sufficiently establish the original connection.
The last two versions deliberately use the same observation: its wording alone does not decide whether it is a joint premise or a reason for the step.
These edits record different commitments; they are not automatic formatting alternatives.

## Joint relevance

Use several sources in one `concerns` Bearing when they participate together in one relation of relevance.
For example, two versions of a clause can be common comparison material for a Question:

```md cog-check require=concerns points=3 bearings=1 diagnostics=0
- [. @before] The original clause.
- [. @after] The revised clause.
- [Q @change] Does this revision change the scope of responsibility?
- [_ @before, @after ~> @change; @comparison] Read the two versions together as comparison material.
```

This creates three Points and one `concerns` Bearing with two ordered sources.
The Neutral Points keep their content and identity; the Question receives neither an answer nor a supporting or challenging relation from this spelling.
`~>` and the named kind `concerns` express the same relation in an explicit constructor.
Joint participation does not assert that each source is necessary, that the comparison is valid, or that either version is accepted.
It records no confidence or degree of acceptance.

**Two independent relations express something different.**
Here each version separately concerns the Question:

```md cog-check require=concerns points=3 bearings=2 diagnostics=0
- [. @before] The original clause.
- [. @after] The revised clause.
- [Q @change] Does this revision change the scope of responsibility?
- [_ @before ~> @change] The original version is relevant.
- [_ @after ~> @change] The revised version is relevant.
```

The first example does not also create these two independent Bearings.
Both record that each version bears on the Question; relevance has no force that the versions could share.
The difference is what can be addressed: the first records one relation, `comparison`, that another relation can target, as below.
Force is shared once it is decided: `[_ +> ^]` records Linked support, which separate `[G]` occurrences do not.
Choose between them according to the connection you intend to record, not according to how many source Points are visible.
The source list preserves written order without implying a sequence of inference.
Sources must be distinct existing Points: a missing source, repeated source or Bearing used as a source rejects the whole Bearing rather than leaving a smaller joint relation.

Joint `concerns` can also target a named Bearing.
In the following example, the date and editing record jointly concern the comparison itself:

```md cog-check require=concerns points=5 bearings=2 diagnostics=0
- [. @before] The original clause.
- [. @after] The revised clause.
- [Q @change] Does this revision change the scope of responsibility?
- [_ @before, @after ~> @change; @comparison] Read the two versions together as comparison material.
- [. @date] The versions took effect on different dates.
- [. @record] The editing record also lists moved paragraphs.
- [_ @date, @record concerns @comparison; @context] Context for reading this comparison.
```

The target of `context` is the Bearing `comparison`, not the Question `change`.
This records relevance without asserting that the comparison succeeds or fails.
An unknown or rejected target cannot produce a surviving relation to it.
With member sources, the same joint relevance is `[_]` beneath the Question, or `[_/]` beneath the comparison step.

Reading retains every source in the relation summary and links each name to its source occurrence.
Map draws the joint Bearing as a neutral `concerns` junction with one input per source and one output to its typed target.
Two independent Bearings remain two separately selectable connections.
Neither display turns joint relevance into joint support or an inference.
Keep the original source and matching Explain result for prose and provenance; Map geometry alone does not retain them.

## Reconstruction choices

Linked records joint participation in one step.
Two Points being logically related does not by itself make them joint premises.
The same subject can be reconstructed at different levels of detail, with different explicit commitments.

Here one fact is reused in two support steps, without copying its identity:

```md cog-check require=supports points=3 bearings=2 diagnostics=0
- [. @water-formula] Water's molecular formula is H₂O.
- [C] Each water molecule has three atoms.
  - [G use @water-formula]
- [C] A water molecule contains no carbon atoms.
  - [G use @water-formula]
```

If the author explicitly reasons through the absence of C in the formula, keep that intermediate Point.
These nested and flat presentations retain the same two Serial steps:

```md cog-check compare=water-serial caption="Nested Serial" require=supports points=3 bearings=2 diagnostics=0
- [C @conclusion] A water molecule contains no carbon atoms.
  - [G @no-c] The molecular formula contains no C.
    - [G @formula] Water's molecular formula is H₂O.
```

```md cog-check compare=water-serial caption="Flat Serial" require=supports points=3 bearings=2 diagnostics=0
- [G @formula +> @no-c] Water's molecular formula is H₂O.
- [G @no-c +> @conclusion] The molecular formula contains no C.
- [C @conclusion] A water molecule contains no carbon atoms.
```

If a convention is explicitly offered alongside the formula as a premise, a joint step can represent that choice:

```md cog-check require=supports points=3 bearings=1 diagnostics=0
- [C] A water molecule contains no carbon atoms.
  - [_ +> ^]
    - [.] Water's molecular formula is H₂O.
    - [.] Molecular formulas enumerate the constituent elements; C symbolises carbon.
```

An unstated substantive warrant, a background convention for interpreting notation, and a compressed intermediate inference are different omissions.
The compiler does not invent Points for them or judge the inference invalid without a specified interpretation and consequence relation.
Adding a premise or intermediate step is an explicit reconstruction decision; the examples above are not interchangeable topology.
Serial authoring uses ordinary nesting or explicit relations, preserving intermediate identities, branches and objections to particular steps.
It needs no special constructor.


## Names and resolution

A Point name precedes its operator; a Bearing handle follows `;`. Both share one namespace within a source unit. Forward references work. Sources of an explicit Bearing must resolve to Points; targets must satisfy their operator's kind restriction. Generated compilation keys cannot be used as authored names or references.

Duplicate Point anchors invalidate all Points with that anchor and dependent Bearings. Duplicate handles invalidate those Bearings. A Point/handle collision retains valid Points but rejects the conflicting route and ambiguous references. Bearings targeting a failed Bearing are rejected. A handle on an annotation that produces no Bearing is an error.

## Reference-only occurrences

`[. use @p]` resolves an existing Point, including a forward declaration in the same unit.
`[G @p]` and `[. @p]` always declare; repeating them never silently becomes a use.
`[G use @p]` supplies a local G mark without changing p's declaration role, text or identity.
The same rule applies to Q/C/O/R/D; occurrence status such as `[C? use @p]` is unsupported.
The complete declared Point text, including its continuations and paragraphs, is shared at each use.
Child body and notes are separate source blocks, not part of that shared text.
Prose following the use header, including its continuations, stays on the occurrence's AST block, never on the original Point or the constructed Bearing.
Uses do not copy subtrees, inherit remote roles, create aliases, or enter a declaration's surrounding context.

`[. use @p]` owns no default attachment, even when p has relations elsewhere.
Its children focus p; their own marks select any local relation, without importing p's declaration mark.
An R child replies to p beneath a neutral, Q, O or other Point use alike.
`[Q use @p]` presents the same content as a local inquiry without an automatic relevance relation.
Its neutral and C children remain unattached unless they state an explicit clause.
It does not generate whether/why question text, transform the Point or assign a resolution state.
The author chooses the content/mark fit; declare a separate Question when different question content is intended.

```md cog-check require=answers points=3 bearings=1 diagnostics=0
- [. @scale] How fast is "fast"?
- [. use @scale] A neutral reminder.
  - [C @aside] The instrument may resolve milliseconds.
- [Q use @scale] Consider this question here.
  - [. @answer answers @scale] Seconds.
```

Only `answer` explicitly answers `scale`; the shared Neutral Point keeps `declaration.form: "material"` and its text.
A complete explicit override, such as `[. use @p +> @claim; @step]` or `[Q use @p respondsTo @objection; @step]`, constructs exactly one local attachment.
`G/`, `O/` or `Q/` beneath that occurrence selects `step`; beneath a bare use or local source member they fail.
A handle without a locally constructed attachment is diagnosed.

```md cog-check require=supports,challenges,respondsTo points=4 bearings=3 diagnostics=0
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

The nearest constructor exposes one Bearing for `G/`, `O/` or `Q/`:

| Nearest constructor | Exposed Bearing |
| --- | --- |
| Point declaration or Point use | Only the attachment constructed at this occurrence |
| Local or explicit Bearing constructor | The Bearing constructed there |
| Bearing use | The existing validated Bearing explicitly referenced there |

A referenced Bearing is a focus, not a newly owned attachment.
Point contexts shadow outer Bearing contexts; neutral Point uses and local source members expose no unary attachment.
An ordinary O defaults to a Point; beneath a Bearing use it needs O/ or an explicit clause, whose target may be a Point or Bearing.
An O beneath O/ challenges that new O Point, while a sibling O/ selects its local attack Bearing.
R beneath O/ replies to that O Point.
Likewise, R beneath Q/ replies to that Question Point, while a further Q/ concerns its locally constructed `concerns` Bearing.
G, O, Q and D have selectors; C states no relation, and `respondsTo` requires a Point target.
Existing explicit graph cycles remain possible; references never recursively expand source.

```md cog-check require=supports,challenges points=5 bearings=4 diagnostics=0
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
The three symbolic operators retain their meanings.
Constructors, Point declarations and Point uses may use any case-sensitive canonical kind name, including `answers`, `respondsTo` and `clarifies`, toward a named or positional target.
A constructor writes a relation, never a role letter: `[_ +> ^]` or `[_ supports ^]`, not `[_ G]`.

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

### Language name and files

The language is Cogitatum, with `cog` as its short technical name, as in the CLI and fence info word; Project Cogitatum is the wider research programme around it.
A dedicated Cogitatum document uses the `.cog.md` suffix and is compiled in `document` mode.
An ordinary Markdown note keeps its .md name; select `host` mode explicitly to compile its `cog` fences, leaving the surrounding prose as host content.
The suffix is a naming convention only: it does not select the parser, and the owned outline does not accept arbitrary Markdown.
Cogitatum's literate presentation, inspired by literate programming, keeps explanation and structure in one document; its prose is not executable, and any computation over Cogitatum artefacts is a separate concern.

## Machine contract and CLI

Recognized failed Point declarations retain an AST annotation with kind "invalid" and their original annotation raw text.
They emit no Point, remain source boundaries in Explain, and prevent implicit descendants from attaching to a more distant outer Point.
Valid descendant Points, their own subtrees, and independent explicit relations survive; the first implicit Point receives FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET.
Ordinary bracket prose remains transparent body, including the pre-0.3 `scope` prefix, which now receives no diagnostic.
Match the complete compiler and schema set for the producing version when storing or consuming compiler results.

`parseDocument` returns an ordered AST; `compileGraph` produces `GraphIR`. `parseSource` and `compileSource` expose envelopes for the input modes.

For debugging, `compileGraphWithExplain` and `explainSource` add a compiler trace: how a block was recognized, which points or connections were emitted or rejected, and why an indentation rule applied or no connection was produced. The CLI exposes this as `cog explain`.
Every constructor has AST annotation and Explain recognition `kind: "bearing"`.
`members: true` records that its direct children are its sources, including on a failed header; `members: false` that it lists them.
`[_/]` adds `selector: "attachment"`, and `[_]` and `[_/]` write no `operatorClause`.
Selector roles are G, O, Q and D, with this correlation enforced in types and schemas.
Explain `localBearingMember` effects identify the constructor's span (`localBearingSpan`), syntactic eligibility and function: source, commentary, independent, supplementary or unclassified.
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
A constructor toward a position emits with `local-bearing-containment`, toward a name with `operator-clause`; a membership failure rejects it with `invalid-local-bearing`, and later name/reference rejection uses `validation-error`.
A source member skips its own attachment with `local-bearing-membership`, and the first Point beneath a listed-source constructor without its own target rejects with `explicit-bearing-descendant-requires-target`.
Membership eligibility does not certify that the whole constructed Bearing survived validation.
It explains compilation decisions, not the truth of the prose, the strength of a reason, or a history of the author's thinking.
The trace is an experimental interface with a versioned schema; ordinary integrations can use AST and Graph IR alone.
`cog explain --format text` renders all decisions, including non-emissions and failed candidates.
It also accepts `--input host`, retaining each independent unit and source-selection diagnostics.
Core exposes the same projection as `formatExplain(explainSource(source, mode))`.
Use `cog target-form --line N --to named|positional` for a checked preview that names one relation's target, or makes it positional again,
including selectors and constructors; see [the preservation limits](graph-inspection.md#preview-named-and-positional-targets).

A Graph IR Point holds `key`, optional `id`, shared `text`, its canonical declaration `sourceSpan`, and `declaration`.
`declaration` records how the Point was introduced: `form` (`role` or `material`), with `role` required only for the role form.
Neither form carries a resolution status, and no use changes the declaration.
Marks written at uses, including neutral and selector marks, live only in the AST annotation and Explain recognition; derive them from there, never from `declaration`.
An attachment created at an occurrence is an ordinary Bearing.

An AST block holds its text, raw source, children, span, and optional `annotation`.
Role, anchor, operator, handle, and annotation errors live only inside `annotation`; there are no mirrored block-level semantic fields.
A Point name appears as `annotation.anchor` in the AST and `id` in Graph IR.
Ordinary body has no annotation.
An `operatorClause` contains `op`, `sources`, and one `target` term: `{ id }` for a name, or `{ local: "point" | "bearing" }` for `^` or `^/`.
Point annotations use `sources: "self"`; a constructor uses `sources: "members"` or a nonempty array of authored source references.
Which targets a relation admits follows from `op` alone; there is no separate target requirement.
A mark's default relation is not written into the AST: `[G]` has no `operatorClause`, and consumers expand it from the mark.
Block `text` joins header prose and continuation content with LF, preserving intervening blank paragraphs.
Block `raw` joins those physical source lines with LF, retaining the bullet and indentation but excluding child blocks.
For exact original line endings and surrounding content, retain the original input.
The distinct use annotation holds ref: {id}, never a declaration anchor.
The separate bearingUse annotation also holds ref: {id}, with no role, handle, anchor or operatorClause.
Its operand can be absent only on a diagnosed malformed use; original raw text and occurrence prose remain inspectable.

A note has `annotation: { kind: "note", targetKind?: "point" | "bearing", raw, syntaxErrors?: ["note"] }`.
Absent `targetKind` means ordinary occurrence-local `[note]`.
Its children retain complete literal text, raw lines, order, nesting and source spans, with no annotations at any depth.
Explain emits one `note` recognition and `preserveNote` effect for the header; `parentSpan` locates its direct source parent and is absent at document root.
Read the whole subtree from AST: literal children do not receive separate Explain entries.
This also applies to a malformed reserved note, which retains its error and literal boundary.
Direct notes in a local construction have `localBearingMember` function `supplementary` and `eligible: false`.

Graph IR has a required `notes` array in authored source order.
Each record contains `origin: "note" | "constructor-description"`, a typed resolved `target`, and `sourceSpan`.
Within its source unit, that span addresses the AST block that owns the text.
For a typed note it also owns the entire literal subtree; for a local or explicit Bearing description it owns the constructor's prose and continuations, not its active children.
Plain `[note]`, use tail prose, malformed notes and unresolved typed notes produce no object-note record.
Explain emits `selectNoteTarget` with the requested type, nearest `contextSpan` when present, `crossedBodySpans`, and a `target` only on success.
Successful typed notes and constructor descriptions emit `attachNote` with the corresponding record.
`preserveNote` and its direct `parentSpan` still describe written location, independently of the selected target.

The AST/source owns authored text; Graph IR and Explain are derived projections.
`Bearing.text` is derived only from its own accepted local or explicit Bearing constructor description.
It never concatenates notes, selects a note arbitrarily, or changes when a use adds a note.
Graph-only JSON preserves note origins and targets but omits note prose and literal descendants.
Both `compileSource` and `explainSource` export the complete source units, AST and graphs needed to recover them.
`cog export` emits the complete `explainSource` envelope in document or host mode.
Host envelopes preserve selected Cogitatum units; keep the original file for surrounding Markdown outside those fences.
Never treat graph-only JSON or `structure-v1` graph text as a complete source export.

Every successfully emitted structural Bearing has an `implicitAttachment` Explain effect recording the typed `target`, its canonical `targetSpan` when available, the selected occurrence's `contextSpan` and ordered `crossedBodySpans`.
`crossedBodySpans` is empty for direct attachment; only a nonempty list produces the advisory diagnostic.
This covers ordinary containment, local Bearing construction and local selectors, including selection through a Point or Bearing use.
Explicit clauses and rejected Bearings do not receive this effect.
The entry span identifies the responsible source occurrence.
For a reused target, its remote declaration span and local context span may differ; neither substitutes for the other.
Unavailable target spans are omitted, never manufactured.
Rejected Bearings receive no successful-attachment effect or suggestion.

`compileGraph` and `compileGraphWithExplain` consume parser-produced ASTs of the current format and reject other format versions. They interpret `annotation`, not `raw`; changing an annotation does not rewrite the retained source text. To edit a note, change the source and parse it again. Importing arbitrary AST JSON requires validation first; compilation is not a general JSON validator.
An `operatorClause` may be absent from an `edge` only when `syntaxErrors` records the failure; the AST schema rejects a clean edge without one, and compilation throws rather than deriving a relation from it.

| Entity | Compilation identity | Authored identity |
| --- | --- | --- |
| Point | Required `key` | Optional `id` |
| Bearing | Required `key` | Optional `handle` |

Graph references use `{ key, kind }`; AST references remain `{ id }`. Keys are opaque, nonempty strings, deterministic for one compilation and local to one graph, with no cross-revision promise. The current compiler emits keys such as `_p1` and `_b1`; consumers must not parse their prefixes or numbers, infer array indexes from them, or use them as authored references. Use `kind` to distinguish Point and Bearing references. A Bearing has `kind`, Point `sources`, one `target`, and `derivedBy: "operator" | "structural"`; optional text describes a route.

Explain emission references use graph keys; Bearing emissions also have a graph index and optional handle. The index addresses this compilation's Bearing array only. Emitted summaries obey the same kind/target restrictions as canonical Bearings. Rejected candidates can retain unresolved authored `{ id }` references or a resolved target of the wrong kind: that mismatch can explain the rejection. They can also retain repeated sources when explaining a rejected joint; emitted summaries and Graph IR still require unique sources.
They are not graph entities. An entry's `diagnosticCodes` lists, once each, the codes of diagnostics whose span shares a line with the entry's span.
A block span starts at the content after the bullet and its separating whitespace, using the actual separator width.
It ends after the block's last continuation, excluding children and any trailing blank lines.
A child's diagnostics therefore appear on the child's entry, not on its parent's.
Diagnostics without a span, or on a line that forms no block, appear only in the top-level list, which retains their actual spans.

## Compatibility and migration

This edition documents the unreleased package 0.6.0 / format 0.6.0.
Published 0.5.0 / format 0.5.0 schemas remain byte-for-byte in `spec/0.5.0/`.
Published 0.4.12 / format 0.4.0 remains a separate contract.

Indented nonbullet continuation lines, previously rejected, now belong to the preceding block.
Review retained drafts with `UNSUPPORTED_LINE` errors before recompiling: their complete Point text or Bearing description may now include that prose.
Consumers must handle multiline block spans and raw text, while annotation recognition still uses the first line only.

### From published 0.5

Review these language changes before recompiling:

- Replace named `about` with `concerns`; `~>` keeps its spelling and neutral relevance meaning.
  All six named constructors remain available, including `answers`, `respondsTo` and `clarifies`.
- Point declarations and uses now accept all six canonical names as explicit clauses.
  `[Q @question respondsTo @objection]` retains Q and states one response; it does not require re-presenting the Point as R.
  AST consumers must admit all six kinds with `sources: "self"`.
  Malformed clauses remain rejected without an implicit replacement.
- Every relation is a relation plus one target term: a name, `^` for the nearest enclosing Point, or `^/` for the locally exposed Bearing.
  A mark abbreviates its default clause: `[G]` is `[G +> ^]` and `[O/]` is `[O -> ^/]`.
  The target term alone decides whether the object is a Point or a Bearing; the operator never does.
- `->` accepts a Point or a Bearing, like named `challenges`.
  The `/>` operator, and the earlier `_>`, are retired: they receive `RETIRED_AUTHORING_SYNTAX` and migrate to `->` with the same target.
  `CHALLENGE_REQUIRES_POINT_TARGET` and `CHALLENGE_REQUIRES_BEARING_TARGET` are retired and no longer emitted.
  The AST `operatorClause.targetKind` field is removed; `target` is `{ id }` or `{ local: "point" | "bearing" }`.
- `clarifies` accepts a Point or a Bearing, and `D/` selects the locally exposed Bearing.
  `answers` and `respondsTo` still require Point targets, so there is no `R/`.
- Replace published bare `[linked]` with `[_ +> ^]` and its direct `G` members with neutral declarations or uses.
  Replace draft `[G linked]`, `[O linked]`, `[R linked]` and `[D linked]` headers with `[_ +> ^]`, `[_ -> ^]`, `[_ respondsTo ^]` and `[_ clarifies ^]`, preserving their already neutral sources.
  The reversed draft spellings such as `[linked G]` are also retired; none is a compiling alias.
  The header owns the relation; `R` and `[_ respondsTo ^]` both respond to the nearest Point regardless of its mark.
  Keep handles, descriptions, source order, member subtrees and intended targets.
  Removing the header alone does not turn neutral members into independent Grounds.
  `RETIRED_LINKED_ANNOTATION` diagnoses the retired keyword; `MALFORMED_BEARING_MODE` diagnoses a constructor that writes a role instead of a relation, such as `[_ G]` or `[_G]`.
  The retired `join` boundary remains.
- A constructor without listed sources takes its direct neutral children as sources; `[_ @a, @b +> ^]` lists them and keeps a positional target.
  `[_]` and `[_/]` record joint `concerns` toward `^` and `^/`.
  A direct child with any relation toward `^`, by mark or by clause, is an invalid member; a relation toward `^/` is commentary, and a named target is independent.
- Machine names follow constructors rather than the retired keyword:

  | Published 0.5 | 0.6 |
  | --- | --- |
  | AST / Explain `kind: "linked"` and `kind: "edge"` | `kind: "bearing"` with `members: true` or `false` |
  | `syntaxErrors` value `"linked"` | `"mode"` for a header that selects no mode |
  | Explain `linkedMember` / `linkedSpan` | `localBearingMember` / `localBearingSpan` |
  | Explain `linked-containment`, `invalid-linked`, `linked-membership` | `local-bearing-containment`, `invalid-local-bearing`, `local-bearing-membership` |
  | Explain `edge-descendant-requires-explicit-target` | `explicit-bearing-descendant-requires-target` |
  | `EMPTY_LINKED`, `INVALID_LINKED_MEMBER`, `NESTED_LINKED_UNSUPPORTED` | `EMPTY_LOCAL_BEARING`, `INVALID_LOCAL_BEARING_MEMBER`, `NESTED_LOCAL_BEARING_UNSUPPORTED` |
  | `LINKED_REQUIRES_POINT_TARGET` | `LOCAL_BEARING_REQUIRES_POINT_TARGET` |
  | `EDGE_DESCENDANT_REQUIRES_EXPLICIT_TARGET` | `EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET` |
  | `MALFORMED_EDGE_ANNOTATION` | `MALFORMED_EXPLICIT_BEARING` or `MALFORMED_BEARING_TARGETS` for an incomplete clause; otherwise `MALFORMED_BEARING_MODE` with `syntaxErrors: ["mode"]` |
  | CLI `explicit-target --line N` | `target-form --line N --to named`; the old command receives `RETIRED_COMMAND` |
  | `previewExplicitTarget` | `previewTargetForm(source, { line, form: "named" })` |

  `RETIRED_LINKED_ANNOTATION` keeps its name because it diagnoses the retired keyword itself.
- `[?]` is retired, along with Gap declarations and `status: "open"`.
  Choose a Point for an absence claim, a Q for an inquiry, or a note for an editorial task.
  Preserve the original scope: an unavailable record does not establish that no record exists.
  A neutral Point has no default attachment; preserve an intended topical connection with `~>`.
  Moving content into a note removes its addressable identity, while choosing G or O adds a commitment.
- `C` beneath `Q` no longer creates `answers`.
  Preserve an intended answer with `[C answers @question]`, `[. answers @question]` or an explicit Bearing.
- `Q` beneath a Point now `concerns` that Point, as `[Q ~> ^]`; in 0.5 it created no Bearing.
  Review nested Questions: one that should stay unattached can move to the root or above its context, and one that challenges should be an Objection.
  `R` and `[_ respondsTo ^]` now respond to any nearest Point, so review previously unattached R occurrences.
  `DISCONNECTED_ANCHORED_MATERIAL` is retired: an isolated neutral Point is complete.
  Draft `LOCAL_BEARING_REPLY_REQUIRES_OBJECTION` and `LINKED_REPLY_REQUIRES_OBJECTION` are no longer emitted.
  Notes and failed or Bearing contexts retain their boundaries.
- Rename Response and `respondsTo` from Reply and `repliesTo`, retaining `R`.
  Replace active named `repliesTo` clauses with `respondsTo`, keeping sources, Point targets, handles and prose.
  The retired spelling receives `RETIRED_BEARING_KIND` on constructors, Point declarations and Point uses; it never falls back to a default.
  Regenerate AST, Graph IR and Explain from retained source rather than renaming JSON.

New reserved words can activate former prose and change descendants' implicit connections.
For example, in 0.5 the G below targets `outer`; in 0.6, `[point @p]` declares a Point and the G targets `p`:

```md cog-check require=supports points=3 bearings=1 diagnostics=0
- [C @outer] Outer claim.
  - [point @p] Previously ordinary body.
    - [G @g] Reason.
```

Review leading `point`, `node` and `bearing` headers, `edge use`, and typed note headers before recompiling.
If an old header was intended as prose, remove its brackets or place prose before it.
If it was intended as a literal subtree, deliberately write `[note]`; this also removes active descendants from the graph and requires review.
Adopting a typed note similarly changes the literal boundary and needs review of every descendant.
Do not migrate use tail prose into shared notes automatically.

Retain the original input and mode, recompile with the complete 0.6 compiler/schema set, and review diagnostics, targets and literal subtrees.
Do not relabel 0.5 AST/Graph IR/Explain/source JSON as 0.6.
Consumers must handle target terms, the revised declaration and target constraints, `GraphIR.notes`, and the new Explain effects, and rebuild Reading from the same source revision.
Selector-bearing AST and Explain marks now admit Q and D as well as G and O; they emit existing kinds and typed Bearing targets without a new Graph relation or entity.
Match on the `bearing` kind, Explain effects, reasons and diagnostic codes above; the 0.5 names are not accepted by the 0.6 schemas.
Written-reference inventory counts only written named operands; `^`, `^/` and a local note selector are not written `@references`.
The target-form preview checks exact note origins and resolved targets as well as source and topology.

### From 0.4 to published 0.5

This section records the 0.5 migration contract; apply the 0.6 changes above afterwards.
In particular, 0.5 used named `about` and restricted symbolic `->` to Point targets.

Format 0.5 unifies canonical `undercuts` into `challenges` while retaining each Bearing's identity, ordered sources and typed target.
A challenge to a Point and a challenge to a Bearing remain distinguishable by `target.kind`.
Neither records defeat, success or acceptability.

| Authored clause | AST `op` | AST `targetKind` | Accepted target |
| --- | --- | --- | --- |
| `-> @x` | `challenges` | `point` | Point |
| `/> @x` | `challenges` | `bearing` | Bearing |
| `challenges @x` in an edge | `challenges` | `either` | Point or Bearing |
| `undercuts @x` in an edge | Rejected: `RETIRED_BEARING_KIND` | — | — |
| `+>` / `supports`, `~>` / `about` | Corresponding kind | `either` | Point or Bearing |
| `answers`, `repliesTo`, `clarifies` | Corresponding kind | `point` | Point |

Every explicit AST clause requires `targetKind`; compilation carries this constraint until reference validation and never recovers it from `raw`.
Canonical Graph IR and emitted Explain summaries contain the resolved typed target, without an extra target constraint.
Named `undercuts` is retired, with no compiling alias.
In 0.5, `/>` preserved its Bearing-only target requirement; in 0.6 write `->`, whose target name already decides the kind.
Replacing it with named `challenges` instead broadens the authored target requirement to either kind.
A retired constructor retains its boundary and handle in AST but emits no Bearing; descendants and dependent references cannot fall back to an outer target.
In 0.5, `CHALLENGE_REQUIRES_BEARING_TARGET` replaced the old `UNDERCUT_REQUIRES_BEARING_TARGET` diagnostic, while `CHALLENGE_REQUIRES_POINT_TARGET` diagnosed `->` against a Bearing.
The latter is retired in 0.6; see the migration above.
The word undercut has no active core kind or spelling; a future theory-specific use requires its own explicit, versioned contract.

For example, the 0.4 clause `[_ @objection undercuts @route; @challenge]` became `[_ @objection /> @route; @challenge]` in 0.5 and is `[_ @objection -> @route; @challenge]` in 0.6.
Keep the sources, their order, target name, handle and occurrence prose; change the retired operator only.
The complete migrated document, in its 0.6 spelling:

```md cog-check require=supports,challenges points=4 bearings=2 diagnostics=0
- [C @claim] The bridge is safe.
- [G @inspection] Yesterday's inspection found no defects.
- [G @record] The maintenance record reports no damage.
- [edge @inspection, @record +> @claim; @route] Joint grounds for the claim.
- [O @objection] Neither check covered the underside.
- [_ @objection -> @route; @challenge] Challenge this joint step.
```

This migration applies to the operator in an active `edge` or `_` annotation.
Do not replace ordinary prose, authored names or literal `[note]` descendants merely because they contain `undercuts`.

Bare `O` continues to challenge the nearest Point; directly beneath `linked`, `edge` or a Bearing use, write `O/` or a complete target.
This keeps local Bearing selection explicit and avoids adding a second indentation-default table.
A malformed or failed constructor still prevents outward fallback, and invalid linked sources still reject the whole joint.

Recompile retained source with the complete 0.5 compiler and schema set; do not relabel saved 0.4 AST, Graph IR, Explain or source envelopes.
Existing symbolic negative forms retain their endpoints, source order and individual relation instances after recompilation; named `undercuts` requires the source migration above.
The newly accepted case is named `challenges` targeting a Bearing; symbolic `->` still rejects that target.
Consumers should replace canonical `undercuts` branches with `challenges` and inspect `target.kind` when the distinction matters.
The format change does not add bare-O defaults, Serial sugar, hidden premises or transitive support.

For a consumer upgrade:

1. Retain the complete original input and its explicit `document` or `host` mode, alongside the producing package version and schemas.
   Keep historical output with its original format identifier.
2. Migrate active retired clauses, then recompile with the 0.5 compiler and load all four schemas from that compiler's bundle.
   Use `explainSource` when retaining Explain or feeding Reading; otherwise `compileSource` suffices.
   Regenerate every retained projection from that same source revision; review aggregate diagnostics even when surviving graphs are available.
3. Update negative-kind consumers and diagnostic-code handling, then verify both Point- and Bearing-targeted challenges, ordered joint sources and distinct parallel Bearings.
   Update stored-schema pins and test actual host integrations against that same compiler revision.
4. Rebuild Reading and Map projections from the new compilation.
   Discard old compilation keys, occurrence addresses and saved edit previews; authored names can be resolved again within the correct source unit.

If only old Graph IR remains, the original source, local occurrence prose and authored target requirements cannot be recovered from it.
Retain it as a historical snapshot for its matching consumer; changing `version` or renaming `undercuts` in JSON is not a supported upgrade.
The [graph preservation limits](graph-inspection.md#what-structure-v1-preserves) explain why a graph migration alone cannot establish source or application compatibility.

### Tab indentation in 0.6

The 0.6 candidate accepts hard tabs for bullet indentation alongside multiline content.
A source unit whose bullet indentation uses only tabs, previously rejected line by line with `TAB_INDENTATION_UNSUPPORTED`, now compiles.
Space-only bullet indentation retains its rules.
`TAB_INDENTATION_UNSUPPORTED` is retired and no longer emitted.
A unit that mixes both characters in bullet indentation still fails closed at offending bullets,
but reports `MIXED_INDENTATION`; consumers matching the old code must handle the new one.
The first indented bullet chooses the style, so the diagnosed lines and surviving partial graph may differ from 0.5.
Continuation padding is checked against its owning block, not against this unit-wide bullet rule.
These diagnostic and source-interpretation changes are included in package and format 0.6.0; they are not a 0.5 patch.

### Earlier migrations

The following notes describe migration into the published 0.4.12 baseline before recompilation with 0.5 and then 0.6.
Their Gap and bare-linked contracts are historical; use the 0.6 migration above for the current language.
Match the exact producing commit with its compiler, schemas and consumers; the retained format identifier alone does not distinguish earlier unpublished candidates.
Reparse the retained original document with explicit document or host context.
Relabelling older AST/Explain/source JSON cannot establish corrected selection, use mappings or new constructor shapes.
This release reserves previously transparent `[note]` and retires `C?` with `RETIRED_CLAIM_OPENNESS`.
Keep the original source and producing version, review every affected region, then explicitly migrate and reparse.
C? to C preserves the written content and may preserve topology, but intentionally removes Claim open metadata.
C certifies neither truth, acceptance, certainty nor completion; Q and the always-open Gap remain distinct.
A retired C? is a failed constructor, never an alias or ordinary body; independent explicit clauses retain normal recovery.
JSON from earlier unpublished 0.4.0 candidates is not silently interchangeable with this released schema set.
Historical 0.3 research records remain evidence of that version's behaviour.

Package 0.4.11 retains failed boundaries at invalid indentation, corrects content columns after wider bullet separators, and keeps malformed-use error categories unique.
Its Explain schema permits repeated sources only in rejected summaries and rejects the unsupported `derivedBy: "retired"` value.
Reparse affected source and validate against this complete schema bundle; a matching format label alone does not identify these corrections.

Package 0.4.10 changes recognition and some partial graphs, so reparse retained source rather than reusing stored AST, Graph IR or Explain.
Bracketed words that merely begin with a mark letter, such as `[O-ring]`, `[C++]` or `[G/O ratio]`, are now body.
Published 0.3 kept most of them as body with a `MALFORMED_ANNOTATION` error, and earlier 0.4 candidates made them failed contexts; Points beneath them now attach through them as through other body.
`[G/O ratio]`, body in 0.3, no longer emits the diagnosed Ground of earlier 0.4 candidates.
An operator without its spaces, such as `[O->@claim]`, previously failed as a whole annotation; it now keeps its Point and rejects only the clause, so the partial graph gains that Point and its children's ordinary attachments.
The pre-0.3 `scope` prefix is body without a diagnostic, matching its existing graph effect; other retired spellings keep their errors and failure boundaries.
Existing diagnostic codes keep their names and severities, but these source cases can now produce a different set of diagnostics; several messages and explanations are also more specific.
The AST schema now requires `operatorClause` on an `edge` without `syntaxErrors`; parser output already satisfied this.

| Earlier source | Historical 0.4.12 migration target | Meaning and recovery |
| --- | --- | --- |
| [@p] | [. @p] | Neutral Point declaration; old annotation is a rejected boundary, never a lookup |
| [use @p] (unpublished candidate) | [. use @p] | Neutral reference occurrence; no default attachment |
| [G_] / [O_] (unpublished candidate) | [G/] / [O/] | Same strict nearest-owner selector; old intent stays rejected commentary |
| _> @b | /> @b (retired in 0.6) | Historical Bearing-only challenge; write `-> @b` for 0.6 |
| `[join; @b]` (unpublished candidate) | `[linked; @b]` (retired in 0.6) | Historical ordered joint support; migrate to `[_ +> ^; @b]` with neutral sources for 0.6, never a compiling `join` alias |
| [edge @p KIND @c; @b] | Unchanged, or [_ @p KIND @c; @b] | Two spellings of ONE explicit constructor, with six canonical kinds |
| source API auto | Explicit document or host | Host never falls back to parsing unselected prose as an outline |
| Graph IR Point `form` / `role` / `status` (0.3 and earlier 0.4 candidates) | Point `declaration: { form, role?, status? }` | Retain Gap openness; deliberately remove retired Claim openness when migrating source. `key`, `id`, `text` and `sourceSpan` stay on the Point |

Perform source spelling changes on annotations, not arbitrary prose, and compile before comparing the intended graph.
For that historical migration, replacing a candidate `[join]` with `[linked]` preserved one joint support; removing the wrapper instead created independent supports.
For current 0.6 source, use `[_ +> ^]` with neutral members instead; neither historical header compiles.
Published format 0.3.0 treated [join; @b] as ordinary body, so migration from published 0.3 requires reviewing intended grouping rather than blindly renaming a word.
Old anchor AST kind becomes material with optional anchor; use retains a distinct ref operand.
Explain uses linked recognition, linkedMember with source/commentary/independent/supplementary/unclassified function, attachment selection and focusPoint/rejectFocus.
Previous join variants/reasons and anchor-annotation emit reasons are not current machine contracts; material-annotation now explains neutral Point emissions.
Retired source receives migration errors and retains its failed boundary; valid unrelated content remains available in the partial graph.
An old anchor-only declaration emits no Point, a retired selector stays commentary, and a retired operator rejects only its attachment when the Point/use operand itself is valid.
Canonical GraphIR stays {version, points, bearings, diagnostics}; typed refs stay {key, kind}.
The nested Point `declaration` is an incompatible JSON-shape change from 0.3 and earlier source candidates: compiler, schemas and consumers must match, and stored graphs must be reparsed from source rather than relabelled.
For 0.5, the compiled negative-kind mapping is challenges → challenges (Point target), undercuts → challenges (Bearing target).
This is a comparison of compiled relations, not permission to relabel JSON or accept the retired named source spelling.
In 0.5 the authored -> and /> checks were distinct; 0.6 retires /> and lets the target decide.

Consumers address entities by `(unit index, ref.kind, ref.key)` within one compilation; the unit index selects the corresponding `graphs[]` entry.
Explain's emission `graphIndex` instead indexes that selected graph's Bearing array.
Each document or fence unit has its own authored namespace; the same name in another unit is unrelated.
AST block order preserves reader order; its `sourceSpan` and Explain entry spans locate the original occurrence using one-based UTF-16 line/column positions.
A constructor header's span can identify its Bearing, and a Point annotation can identify both its Point and its attached Bearing.
One span therefore need not select only one entity; inspect the typed emission references rather than choosing the first match.
Point and Bearing occurrence spans map through focusPoint or focusBearing to the original entity key; canonical spans stay at declarations/constructions.
Valid use block text holds the local note separately from shared entity text.
Address an occurrence by source-unit index and Explain entry index; address its entity by source-unit index and (kind,key), scoped to that compilation.
Within one compiler-produced source unit, each nonliteral AST block has exactly one Explain entry with the same full `sourceSpan`, in AST preorder.
A note header has an entry; its literal descendants do not.
An entry's span covers its own source line, not its subtree.
Join AST and Explain only within that unit and compilation; neither spans, entry indexes nor generated keys identify an occurrence after editing.
Retain the original source to display host prose, blank lines and malformed lines that are absent from the selected AST.
Several occurrences may match one entity; return their distinct locations instead of silently choosing a single span.
Optional missing canonical spans do not justify inventing source positions or extracting narrative from Graph IR.
An occurrence can both focus a Point and emit an attached Bearing; neither operation creates a GraphIR occurrence entity.
Document integrations select (ref.kind, ref.key) within their document scope; host integrations additionally need the selected-unit index and separate namespace.
Keys are local to each compilation and do not promise cross-revision identity.
These mappings preserve reader order and original UTF-16 positions without reconstructing narrative from the graph.
Missing GraphIR spans cannot be reconstructed from a key or handle; declaration navigation requires a real declaration span even when mapped occurrence spans remain available.
GraphIR contains no additional occurrence entity and cannot reproduce the authored document from its topology.
Executable consumer cases live in the source checkout's `fixtures/`: `core/local-bearing.cog.md`, the host local-bearing case, and `diagnostics/retired-join.cog.md`.
`core/narrative-reference-reuse.cog.md` checks Serial reuse, ordered local sources, owned objections and replies, with no subtree copying.
`core/bearing-reference-reading.cog.md` preserves quoted context, a separate reconstruction, stronger occurrence prose and repeated route discussion without changing shared content.
`diagnostics/retired-authoring-spellings.cog.md` checks rejected migration spellings, failure boundaries and the retained independent partial graph.

Format 0.3.0 replaced generated Point IDs, optional Bearing IDs, ID-based graph references, mirrored AST block fields, and the AST operator's single-element `targets` array (now `target`). Consumers must migrate together; reparse older source rather than relabelling old JSON with the new version.

### Schemas for integrations

The source distribution's `spec/` directory contains JSON Schemas using draft 2020-12.
Core 0.6.0 builds AST, Graph IR, Explain, and source-envelope contracts through `@cogitatum/core/schemas/{ast,graph-ir,explain,source}`.
The source-envelope schema refers to the other three by `$id`; load those sibling schemas too when validating it.
The published npm `0.3.0-alpha.1` tarball includes only the first three exports.
For example, in Node.js:

```js
import graphSchema from '@cogitatum/core/schemas/graph-ir' with { type: 'json' };
```

Schema `$id` values use `/schemas/0.6.0/`.
The published 0.5.0 bundle fixes format 0.5.0; this incompatible revision uses a new identifier and schema URLs.
Use the schema files from this checkout to validate format 0.6; the 0.5 bundle cannot validate it.
For reproducible or offline validation, use all four schema copies from the exact package or source commit; neither the format identifier nor an unchanged source-envelope schema identifies the complete contract.
The 0.6 package build includes all four schemas.
Deployment of the official schema URLs and production playground is separate; use the exact package copies for validation until the matching website release is deployed.

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
cog export inquiry.cog.md
cog check --input host notebook.md
cog --version
```

Commands output JSON by default; help and version output text.
`cog graph --format text inquiry.cog.md` prints the [single-graph inspection view](graph-inspection.md).
Text inspection requires document input; host text is rejected rather than dropping source units or selection diagnostics.
In `document` mode, `ast`, `graph` and `explain` print one AST, Graph IR and Explain projection, and `check` prints `{ version, diagnostics }`.
In either mode, `export` prints the complete `explainSource` envelope, including note source/target records and the AST that owns their prose.
With `--input host`, `ast` and `graph` print the `parseSource` and `compileSource` envelopes and `check` prints `{ version, mode, diagnostics }`.
Host `explain` prints `{ version, mode, units, explanations, diagnostics }`, a command-specific projection without `documents` or `graphs` that is not a source-envelope schema instance; validate each `explanations[i]` with the Explain schema, or call `explainSource` for the complete envelope.
Exit status is `0` without error diagnostics, `1` for source or I/O errors, and `2` for invalid arguments. `--` ends option parsing for a filename starting with `-`. Warnings and suggestions do not fail a command. Diagnostics provide compiler evidence, not substantive review.

Native editor adapters, execution semantics, collaboration state, and Cogitatio runtime are outside this prerelease. For a working note, return to the [quick start](quick-start.md) or [examples](https://cogitatum.onesimos.net/examples).
