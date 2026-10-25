---
title: Bearings — make a connection explicit
summary: Connect reasons, questions, objections, and gaps; name a route when it needs attention.
section: reference
order: 2
---

# Bearings

A Bearing is a connection from one or more marked Points to a Point or to another Bearing.
It records how selected material bears on its target in this inquiry.
It can be written explicitly, with an operator or `_`, or derived from indentation; a local selector can target a Bearing that has no name.

## Representation, interpretation and assessment

Bearings record the relations asserted or reconstructed in an inquiry without certifying their success.
Choosing a relation already represents a reading of the material; the core does not claim to be free of interpretation.
An explicit theoretical interpretation can map selected Points and Bearings to theoretical constructs under stated assumptions.
An assessment reports what follows under that interpretation; failure does not erase the recorded relation or establish that every other reading fails.
Keep introduced assumptions and results separate from the original source, and retain the selected instances and source version when reporting a check.
The core currently provides no theory-specific interpretation or assessment API.

`supports` includes explanatory and interpretive reasons as well as inferences.
`answers`, `repliesTo` and `clarifies` can describe discourse within one person's inquiry as well as a dialogue.
They do not establish utterance events, speakers, dialogue protocols, or a one-to-one mapping to another theory's node types.
`about` records relevance without choosing a positive or negative position.
These are useful distinctions in reading, not new mutually exclusive families in the core type system.

## Positive bearing

`+>` compiles as `supports`: the source bears positively on the target. This can express deductive or inductive reasoning, an abductive hypothesis, an explanation, or an interpretive reason. It does not declare which method is in use, guarantee validity, or certify sufficient grounds.

Describe the method in ordinary prose or a Bearing constructor's description when it matters. This version has no inference-method annotation or subtype taxonomy. Future typed methods would need explicit definitions and a versioned contract; tools must not silently infer them from `supports`.

For an indented Ground's attachment, put `[_ note]` beneath that Ground to explain the connection without naming or reconstructing it.
`[. note]` at the same location annotates the Ground's Point; `[note]` stays local to the written occurrence.
All three have literal subtrees.
Use `[_ use @route]` to bring an existing route into context, then `[_ note]` to add a source-backed note on it.
The full family spellings are `bearing` / `edge` / `_` and `point` / `node` / `.`, with the same construction, use and note grammar.
See [local object notes](syntax.md#local-object-notes) for selection, provenance and failure boundaries.

```md cog-check require=supports points=2 bearings=1 diagnostics=0
- [C @reading] The passage presents the speaker as uncertain.
- [G @hesitation] The speaker interrupts and revises the same sentence twice.
- [_ @hesitation +> @reading; @reading-route] This is an interpretive reason for the reading.
```

## Explicit connections

| Mark | Compiled kind | Target |
| --- | --- | --- |
| `+>` | `supports`: positive bearing | Point or named Bearing |
| `->` | `challenges`: objection to the target | Point |
| `/>` | `challenges`: objection to a connection | Named Bearing |
| `~>` | `about`: relevance without positive or negative commitment | Point or named Bearing |

A Point annotation with an operator uses that Point as its source. A `[_ ...]` constructor connects existing Points and creates no Point of its own.

Use `~>` when the intended connection is relevance without taking a positive or negative position toward the target.
It is useful both while developing an inquiry and while reconstructing one.
In reconstruction, preserve an author's explicit supporting or opposing relation when the source warrants it; uncertainty about your analysis does not by itself make that relation `about`.
If the relation is unclear, describe that uncertainty in prose or mark your own Question or Gap without attributing a new position to the author.
You need not classify every relevant passage as support or challenge.

```md cog-check require=supports,challenges points=4 bearings=2 diagnostics=0
- [C @conclusion] The service needs more capacity.
- [G @load] Peak load exceeds current capacity.
- [G @forecast] The forecast predicts further growth.
- [_ @load, @forecast +> @conclusion; @capacity-route] These reasons bear on the conclusion jointly.
- [O /> @capacity-route] The forecast assumes a campaign that was cancelled.
```

The names are needed for the Bearing's references; ordinary body cannot serve as a Bearing source.
Two separate `[G]` children create two independent connections. One `[_ ...]` constructor with two sources creates one joint connection without also creating the independent ones.

### Named canonical kinds

A `[_ ...]` constructor can name any canonical kind directly: `[_ @sources KIND @target; @optional-handle]`.
Use the exact spellings below, including the capital T in `repliesTo`:

| Kind | Target |
| --- | --- |
| `supports`, `about` | Point or named Bearing |
| `answers`, `repliesTo`, `clarifies` | Point |
| `challenges` | Point or Bearing |

Each source is an existing Point; its declaration information (form, role and status), content, and identity remain unchanged.
Sources are ordered and duplicate-free, and there is exactly one target.
The indentation defaults do not impose global source or target roles on explicitly authored relations.
A Question can reply to an objection, and a concession can reply without challenging it:
`repliesTo` records the direction of a reply; it does not imply `answers`, `challenges`, or that an objection has been defeated.
Its explicit target is a Point and need not carry O; the R-under-O rule is a local authoring default.

```md cog-check require=repliesTo points=3 bearings=2 diagnostics=0
- [O @objection] The explanation lacks a time scale.
- [Q @question] Which time scale do you mean?
- [C @concession] The timing is uncertain.
- [_ @question repliesTo @objection; @clarification-question]
- [_ @concession repliesTo @objection; @conceding]
```

The following original sources preserve the same Point declarations and selected graph structure.
The comparison ignores local keys, source locations, narrative organization, Explain, and structural/operator provenance; it is not source round-trip equality.

```md cog-check compare=complete-explicit caption="Local defaults" require=answers,clarifies,challenges,repliesTo points=5 bearings=4 diagnostics=0
- [Q @question] Why did the measurement change?
  - [C @answer] Calibration may have shifted.
    - [D @distinction] Drift and noise are different hypotheses.
    - [O @objection] That does not explain the timing.
      - [R @reply] Recalibration happened immediately before the change.
```

```md cog-check compare=complete-explicit caption="Named constructors" require=answers,clarifies,challenges,repliesTo points=5 bearings=4 diagnostics=0
- [Q @question] Why did the measurement change?
- [C @answer] Calibration may have shifted.
- [D @distinction] Drift and noise are different hypotheses.
- [O @objection] That does not explain the timing.
- [R @reply] Recalibration happened immediately before the change.
- [_ @answer answers @question]
- [_ @distinction clarifies @answer]
- [_ @objection challenges @answer]
- [_ @reply repliesTo @objection]
```

Identity reuse can follow the explanation's order without copying content or importing an earlier subtree:

```md cog-check require=supports,challenges,repliesTo points=4 bearings=3 diagnostics=0
- [. @measurement] Two independent retries timed out.
- The sample is small; we discuss that limitation before using the observation.
- [C @cause] A persistent configuration fault may explain the timeouts.
- [_ @measurement supports @cause; @support] Reuse the earlier observation in this step.
- [O @limitation] The two retries may share a transient fault.
- [_ @limitation /> @support] Object to this attachment rather than copying the observation.
- [Q @followup] Which environment did the retries share?
- [_ @followup repliesTo @limitation]
```

Unknown/case-mismatched kinds, incomplete clauses, duplicate sources, multiple targets, and kind/target mismatches are diagnosed without partial relations or implicit fallback.
For example, `[_ @answer answers @support]` fails when `support` names a Bearing.
Named Point-attached forms such as `[Q @question repliesTo @objection]` are not supported.
Prose after an `_` annotation describes that individual Bearing and is not parsed as another clause.
An automatic flat-source formatter is deferred; these constructors do not reconstruct the original document.

### One reason, two ways to write it

These original notes compile to the same Claim, Ground, and single `supports` connection.
The explicit operator keeps the Ground's role, name, and content while moving it out of the Claim's indentation.
On the website, choose either source's **View structure** to edit it and see the compiler's result.
Edits belong to the chosen note; they do not translate into the other note or preserve equivalence automatically.

```md cog-check compare=one-reason caption="Indentation" require=supports points=2 bearings=1 diagnostics=0
- [C @reading] The passage presents the speaker as uncertain.
  - [G @hesitation] The speaker interrupts and revises the same sentence twice.
```

```md cog-check compare=one-reason caption="Explicit operator" require=supports points=2 bearings=1 diagnostics=0
- [C @reading] The passage presents the speaker as uncertain.
- [G @hesitation +> @reading] The speaker interrupts and revises the same sentence twice.
```

## Local joint reasons

Use `linked` when nearby Grounds belong to one supporting connection.
Use `_` when connecting existing Points by reference, including shared premises or distant targets.
Both construct Bearings; neither is a new Point role or a measure of reasoning strength.

Both original notes below keep the same Claim and two Grounds, including their names, roles, and content.
Each creates exactly one joint `supports` Bearing named `route`.
In the explicit version, the Grounds sit outside the Claim's indentation, so they create no extra default supports.
The prose after each header describes the same connection.

```md cog-check compare=joint-reasons caption="Local linked block" require=supports points=3 bearings=1 diagnostics=0
- [C @mortality] Socrates is mortal.
  - [linked; @route] Apply the general rule to this case.
    - [G @humans] All humans are mortal.
    - [G @socrates] Socrates is human.
```

```md cog-check compare=joint-reasons caption="Explicit Bearing" require=supports points=3 bearings=1 diagnostics=0
- [C @mortality] Socrates is mortal.
- [G @humans] All humans are mortal.
- [G @socrates] Socrates is human.
- [_ @humans, @socrates +> @mortality; @route] Apply the general rule to this case.
```

The two Grounds keep their own content and roles.
They produce one joint `supports`, with no additional single-source supports to the Claim and no intermediate Point.
A joint connection does not assert that its sources are minimal, that each is necessary, or that the inference is valid.
An objection beneath a Ground targets that premise; a challenge to the handle targets the route.

**Counterexample: ordinary sibling Grounds are independent.**
Removing the `linked` creates two single-source Bearings, rather than the one joint Bearing above.
This is a different topology, not an equivalent spelling.

```md cog-check require=supports points=3 bearings=2 diagnostics=0
- [C @mortality] Socrates is mortal.
  - [G @humans] All humans are mortal.
  - [G @socrates] Socrates is human.
```

The handle is optional, and one member is allowed.
The authoring construct is a linked block; its name does not classify every instance as a multi-premise Linked argument structure.
A singleton linked block gives a single support step an explicit position, while a multi-source `_` can express a Linked structure without the `linked` keyword.
The nearest enclosing Point supplies the target, regardless of its role.
Header prose is optional and becomes the joint Bearing's description, just like `_` prose.
It creates no Point and changes neither membership nor the source and target references.
Members must be direct `G` children without operators or Bearing handles; an unmarked body child is not a member.
Invalid source or unclassified intent rejects the whole linked block without falling back to single-source connections.
G/ and O/ and complete explicit clauses are commentary or independent relations, separate from the ordered joint sources.
Member subtrees retain their ordinary behavior, including a further linked block below a real intermediate Point.
For complete restrictions and partial-output behavior, see [local linked blocks](syntax.md#local-linked-blocks).

## Assess a local attachment

Use G/ to support and O/ to object to the Bearing exposed by the nearest ancestor constructor.
That is a Point occurrence's local attachment, an explicit Bearing or linked block's constructed Bearing, or the existing Bearing explicitly referenced by `[_ use @route]`.
These are ordinary G and O Points with a retained local selector, not new roles.
Body is transparent; another Point, linked, explicit Bearing or Bearing use is a boundary even when its attachment or focus is missing or rejected.
Selection never scans a Point's other outgoing Bearings, crosses an unattached Point, or selects the commentary relation being created by the same annotation.

```md cog-check require=supports,challenges,repliesTo points=6 bearings=4 diagnostics=0
- [C @claim] A persistent fault may explain the timeouts.
  - [linked; @step]
    - [G @first] Two retries timed out.
    - [G @second] Both loaded the same configuration.
    - [G/] The configuration connects these observations.
    - [O/ @objection] A transient environment fault may explain both.
      - [R] A control run found the environment stable.
```

In a Point context the ordinary table remains G supports, O challenges, D clarifies, Gap about, C answers only a locally Q-marked parent, and R repliesTo only a locally O-marked parent.
Q and Neutral Points have no default.
Unsuffixed roles have no default in a Bearing context; direct linked G instead contributes one source without an individual unary attachment.
G/ and O/ select only that nearest constructor's exposed Bearing.
Bearing reuse adds no attachment or entity; its prose stays occurrence-local.
See [Bearing occurrences and reading](syntax.md#bearing-occurrences-and-reading) for recursive objections and the separation of shared content from notes.
An explicit clause overrides the ordinary default, and combining one with a selector is diagnosed.

One Point can support two conclusions through two uses, each creating its own named attachment:

```md cog-check require=supports,challenges points=5 bearings=4 diagnostics=0
- [C @retries] Two retries timed out.
- [C @config] The configuration is faulty.
  - [G use @retries; @to-config]
    - [O/ @transient] A transient fault explains the retries equally well.
- [C @monitoring] The service needs monitoring.
  - [G use @retries; @to-monitoring]
    - [O @miscount] Only one retry actually timed out.
```

`O/` challenges only `to-config`, the route constructed by the enclosing `G use`; `to-monitoring` is not addressed.
The plain `O` challenges the shared Point `retries`, not either route.
Neither relation records that a route or Point has failed, and nothing propagates from one Bearing to another.

The following pair preserves selected graph structure, declaration metadata, individual instances, ordered sources and typed targets.
Spans, derivedBy, Explain and original source remain separate from that comparison.

```md cog-check compare=local-attachment caption="Local selector" require=supports,challenges points=3 bearings=2 diagnostics=0
- [C @claim] Claim.
  - [G @premise; @step] Premise.
    - [O/ @objection; @attack] This step assumes a stable environment.
```

```md cog-check compare=local-attachment caption="Complete target" require=supports,challenges points=3 bearings=2 diagnostics=0
- [C @claim] Claim.
  - [G @premise; @step] Premise.
    - [O @objection /> @step; @attack] This step assumes a stable environment.
```

A G/ and O/ below a linked member fails: the member owns no unary Bearing.
Move commentary to the linked context or specify a complete target.
A comments-only linked is invalid; commentary cannot invent its target.
Unknown references in complete independent clauses fail independently; incomplete G +> rejects the whole joint.
Only G/ and O/ are supported; no Q_, C_, R_, D_, suffixed Gap or targetless /> is introduced.
The canonical kind is `challenges` for both Point and Bearing targets.
The typed target preserves which object is challenged; `->` still requires a Point and `/>` still requires a Bearing.
Named `challenges` accepts either target.
The former named `undercuts` spelling is rejected; use `/>` to retain its Bearing-only target requirement.
Challenging a Bearing does not by itself classify a theory-specific undercut.
Bare `O` keeps its Point-context default; use `O/` to select a local Bearing.

### Why keep O/ in a Bearing context?

An ordinary Ground occurrence exposes two different objects: the Point's content and the step by which it supports something else.
`O` beneath it questions the content; `O/` questions that particular step.
In a `linked` block, direct `G` children supply the joint premises, while `G/` and `O/` comment on the joint Bearing.
The slash makes the choice of object visible across these constructions, including an explicit `_` and a Bearing use.
It is a selector, not a claim that the objection is a theory-specific undercut.

Letting bare `O` automatically select a Bearing beneath `linked`, `_` or a Bearing use would be a possible alternative language design, and would save one character in those contexts.
It would also make the unsuffixed mark select a different kind of object according to the enclosing constructor, while direct `G` under `linked` would still mean a premise rather than support for the Bearing.
The current language chooses an explicit selector for relation commentary.
Bare `O` under a Bearing constructor is diagnosed, not redirected to an outer Point; changing that rule would be a language change requiring its own examples and migration decision.

The semicolon in `[linked; @step]` has a separate purpose: it introduces an optional handle naming the joint Bearing.
`[linked]` already creates a joint step; `[linked] Applying the sampling rule.` also gives it a description without naming it.
Use a handle when something elsewhere must refer to the step, and `O/` when the local context already identifies it.

## Argument structures

Linked, Convergent, and Serial describe composable argument structures.
A premise is content serving as a source in a particular support step; its Point role need not change when it later serves as a conclusion.
These names describe the graph's arrangement, not the success of the reasoning.

| Structure | Arrangement |
| --- | --- |
| Linked / 聯結 | Several premises participate in one multi-source supporting Bearing. |
| Convergent / 匯聚 | Separate supporting Bearings target the same conclusion. |
| Serial / 串聯 | One step's conclusion becomes a premise in a later step. |

The two-premise linked block and the ordinary sibling Grounds above illustrate Linked and Convergent respectively.
Serial authoring uses a real intermediate Point:

```md cog-check require=supports points=3 bearings=2 diagnostics=0
- [C @conclusion] The incident needs investigation.
  - [G @intermediate] The timeouts are reproducible.
    - [G @observation] Two independent retries timed out.
```

Structures can combine: p and q jointly support i; i and r jointly support c; s and t separately form another joint route to c.
The two routes into c form a Convergent arrangement, while the path through i is Serial.
The explicit references reuse i's identity without copying its subtree or changing its role:

```md cog-check require=supports points=7 bearings=3 diagnostics=0
- [G @p] First observation.
- [G @q] Second observation.
- [C @i] Intermediate conclusion.
- [G @r] Additional reason.
- [G @s] Independent observation.
- [G @t] Corroborating observation.
- [C @c] Final conclusion.
- [_ @p, @q +> @i; @first]
- [_ @i, @r +> @c; @second]
- [_ @s, @t +> @c; @third]
```

Argumentation includes developing, presenting, and examining arguments; it is not limited to debate between people.
No additional Convergent or Serial keyword is required.

### Shared evidence, intermediate steps and joint premises

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
  - [linked]
    - [G] Water's molecular formula is H₂O.
    - [G] Molecular formulas enumerate the constituent elements; C symbolises carbon.
```

An unstated substantive warrant, a background convention for interpreting notation, and a compressed intermediate inference are different omissions.
The compiler does not invent Points or Gaps for them or judge the inference invalid without a specified interpretation and consequence relation.
Adding a premise or intermediate step is an explicit reconstruction decision; the examples above are not interchangeable topology.
A possible Serial block would be sugar for several Bearings and would need to preserve intermediate identities, branches and objections to particular steps.
It remains an authoring experiment, not a missing graph primitive.

## Connections from indentation

Outside a linked block, without an operator, the nearest enclosing Point and the child's role determine whether a connection is produced:

| Child | Enclosing Point | Connection |
| --- | --- | --- |
| `C` | `Q` | `answers` |
| `G` | Any Point | `supports` |
| `O` | Any Point | `challenges` |
| `R` | `O` | `repliesTo` |
| `D` | Any Point | `clarifies` |
| `?` | Any Point | `about` |

Other combinations create no default connection. Ordinary body can be crossed while finding the nearest Point; an ineligible Point cannot. The first Point beneath an `_`, possibly through body, must provide an explicit target. Its own children can then use ordinary indentation: for example, a reply beneath an explicitly targeted objection replies to that objection.

Derived connections still have meaning. `derivedBy: "structural"` describes their source; `"operator"` means an operator was written. Neither measures confidence. An answer can be wrong, a reply ineffective, and a positive reason weak. The graph adds no transitive links, proof rules, or conclusions from missing connections.

For example, either Claim form beneath a Question produces an answer:

```md cog-check require=answers points=3 bearings=2 diagnostics=0
- [Q] What caused the timeouts?
  - [C] Pool exhaustion caused the timeouts.
  - [C] A network fault caused the timeouts.
```

A Gap changes the nearest enclosing Point:

```md cog-check require=about points=3 bearings=1 diagnostics=0
- [Q] What caused the timeouts?
  - [?] My reconstruction: the report leaves the causal step unexplained.
    - [C] The report says connection acquisition failed.
```

This produces three Points and one `about` Bearing from the Gap to the Question.
The Claim is retained but has no default Bearing to the Gap, and does not answer the outer Question through it.
A legal absence of a connection is not a lost Point or a syntax error.
If you intend a connection, choose the placement or an explicit operator that expresses it.

Indentation-based authoring and explicit-relation authoring can be mixed in one note.
They are writing techniques, distinct from the [input modes](syntax.md#input-modes) and from each Bearing's `derivedBy` value.
Every adopted canonical kind has an explicit `_` constructor, while local shorthand still follows its lexical context.
Explicit references can point forward or backward; generated source would remain separate from the authored document and needs its own formatter contract.

## Naming routes

Sometimes the weak part is how a reason bears on a claim. Name that connection with `; @route`, then use `/>` to question it:

```md cog-check require=supports,challenges,about points=4 bearings=3 diagnostics=0
- [C @cause] The connection pool may be exhausted.
  - [G; @log-route] Logs show connection acquisition failures.
- [O /> @log-route] The same log message can result from a network failure.
- [? ~> @log-route] We need a trace separating these two causes.
```

`[G @reason; @route]` names the Point `reason` and its connection `route`. `[G; @route]` leaves the Point anonymous. A handle is valid only if the annotation produces a Bearing.

A Gap can be about what a Ground says or about the step it supports.
Beneath the Ground, `[?]` uses the indentation default and targets the Ground's Point; `[? ~> @step]` names the step instead:

```md cog-check require=supports,about points=4 bearings=3 diagnostics=0
- [C @cause] The connection pool may be exhausted.
  - [G @logs; @step] Logs show connection acquisition failures.
    - [?] Which service wrote these log lines?
    - [? ~> @step] Do these failures distinguish exhaustion from a network fault?
```

The first Gap questions the content of `logs`; the second questions whether that content bears on `cause`.
Both remain open Gaps; neither changes the Ground, the step or the Claim.

Every Bearing has a compilation-local `key`; only authored route names populate `handle`. Graph references use `{ key, kind: "bearing" }`. Persisted references need the authored handle and document context. Keys have no stability guarantee across edits or different graphs. See [syntax](syntax.md) for all forms and error boundaries.
