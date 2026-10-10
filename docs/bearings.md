---
title: Bearings — make a connection explicit
summary: Connect reasons, questions, objections, and gaps; name a route when it needs attention.
section: reference
order: 2
---

# Bearings

A Bearing is an explicit connection from one or more marked points to another point or a named connection. It records how selected material bears on its target in this inquiry.

## Positive bearing

`+>` compiles as `supports`: the source bears positively on the target. This can express deductive or inductive reasoning, an abductive hypothesis, an explanation, or an interpretive reason. It does not declare which method is in use, guarantee validity, or certify sufficient grounds.

Describe the method in ordinary prose or an `edge` description when it matters. This version has no inference-method annotation or subtype taxonomy. Future typed methods would need explicit definitions and a versioned contract; tools must not silently infer them from `supports`.

```md cog-check require=supports points=2 bearings=1 diagnostics=0
- [C @reading] The passage presents the speaker as uncertain.
- [G @hesitation] The speaker interrupts and revises the same sentence twice.
- [edge @hesitation +> @reading; @reading-route] This is an interpretive reason for the reading.
```

## Explicit connections

| Mark | Compiled kind | Target |
| --- | --- | --- |
| `+>` | `supports`: positive bearing | Point or named Bearing |
| `->` | `challenges`: objection to the target | Point |
| `_>` | `undercuts`: pressure on a connection | Named Bearing |
| `~>` | `about`: relevance without positive or negative commitment | Point or named Bearing |

A Point annotation with an operator uses that Point as its source. An `edge` connects existing Points and creates no Point of its own.

Use `~>` when the intended connection is relevance without taking a positive or negative position toward the target.
It is useful both while developing an inquiry and while reconstructing one.
In reconstruction, preserve an author's explicit supporting or opposing relation when the source warrants it; uncertainty about your analysis does not by itself make that relation `about`.
If the relation is unclear, describe that uncertainty in prose or mark your own Question or Gap without attributing a new position to the author.
You need not classify every relevant passage as support or challenge.

```md cog-check require=supports,undercuts points=4 bearings=2 diagnostics=0
- [C @conclusion] The service needs more capacity.
- [G @load] Peak load exceeds current capacity.
- [G @forecast] The forecast predicts further growth.
- [edge @load, @forecast +> @conclusion; @capacity-route] These reasons bear on the conclusion jointly.
- [O _> @capacity-route] The forecast assumes a campaign that was cancelled.
```

The names are needed for the edge's references; ordinary body cannot serve as an edge source.
Two separate `[G]` children create two independent connections. One `edge` with two sources creates one joint connection without also creating the independent ones.

### Named canonical kinds

An `edge` can name any canonical kind directly: `[edge @sources KIND @target; @optional-handle]`.
Use the exact spellings below, including the capital T in `repliesTo`:

| Kind | Target |
| --- | --- |
| `supports`, `about` | Point or named Bearing |
| `challenges`, `answers`, `repliesTo`, `clarifies` | Point |
| `undercuts` | Named Bearing |

Each source is an existing Point; its role, form, status, content, and identity remain unchanged.
Sources are ordered and duplicate-free, and there is exactly one target.
The indentation defaults do not impose global source or target roles on explicitly authored relations.
A Question can reply to an objection, and a concession can reply without challenging it:
`repliesTo` records the direction of a reply; it does not imply `answers`, `challenges`, or that an objection has been defeated.
Its explicit target is a Point and need not carry O; the R-under-O rule is a local authoring default.

```md cog-check require=repliesTo points=3 bearings=2 diagnostics=0
- [O @objection] The explanation lacks a time scale.
- [Q @question] Which time scale do you mean?
- [C @concession] The timing is uncertain.
- [edge @question repliesTo @objection; @clarification-question]
- [edge @concession repliesTo @objection; @conceding]
```

The following original sources preserve the same Point declarations and selected graph structure.
The comparison ignores local keys, source locations, narrative organization, Explain, and structural/operator provenance; it is not source round-trip equality.

```md cog-check compare=complete-explicit caption="Local defaults" require=answers,clarifies,challenges,repliesTo points=5 bearings=4 diagnostics=0
- [Q @question] Why did the measurement change?
  - [C? @answer] Calibration may have shifted.
    - [D @distinction] Drift and noise are different hypotheses.
    - [O @objection] That does not explain the timing.
      - [R @reply] Recalibration happened immediately before the change.
```

```md cog-check compare=complete-explicit caption="Named constructors" require=answers,clarifies,challenges,repliesTo points=5 bearings=4 diagnostics=0
- [Q @question] Why did the measurement change?
- [C? @answer] Calibration may have shifted.
- [D @distinction] Drift and noise are different hypotheses.
- [O @objection] That does not explain the timing.
- [R @reply] Recalibration happened immediately before the change.
- [edge @answer answers @question]
- [edge @distinction clarifies @answer]
- [edge @objection challenges @answer]
- [edge @reply repliesTo @objection]
```

Identity reuse can follow the explanation's order without copying content or importing an earlier subtree:

```md cog-check require=supports,undercuts,repliesTo points=4 bearings=3 diagnostics=0
- [@measurement] Two independent retries timed out.
- The sample is small; we discuss that limitation before using the observation.
- [C? @cause] A persistent configuration fault may explain the timeouts.
- [edge @measurement supports @cause; @support] Reuse the earlier observation in this step.
- [O @limitation] The two retries may share a transient fault.
- [edge @limitation undercuts @support] Object to this attachment rather than copying the observation.
- [Q @followup] Which environment did the retries share?
- [edge @followup repliesTo @limitation]
```

Unknown/case-mismatched kinds, incomplete clauses, duplicate sources, multiple targets, and kind/target mismatches are diagnosed without partial relations or implicit fallback.
For example, `[edge @answer answers @support]` fails when `support` names a Bearing.
Named Point-attached forms such as `[Q @question repliesTo @objection]` are not supported.
Prose after an `edge` annotation describes that individual Bearing and is not parsed as another clause.
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
Use `edge` when connecting existing Points by reference, including shared premises or distant targets.
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

```md cog-check compare=joint-reasons caption="Explicit edge" require=supports points=3 bearings=1 diagnostics=0
- [C @mortality] Socrates is mortal.
- [G @humans] All humans are mortal.
- [G @socrates] Socrates is human.
- [edge @humans, @socrates +> @mortality; @route] Apply the general rule to this case.
```

The two Grounds keep their own content and roles.
They produce one joint `supports`, with no additional single-source supports to the Claim and no intermediate Point.
A joint connection does not assert that its sources are minimal, that each is necessary, or that the inference is valid.
An objection beneath a Ground targets that premise; an undercut of the handle targets the route.

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
A singleton linked block gives a single support step an explicit position, while a multi-source `edge` can express a Linked structure without the `linked` keyword.
The nearest enclosing Point supplies the target, regardless of its role.
Header prose is optional and becomes the joint Bearing's description, just like `edge` prose.
It creates no Point and changes neither membership nor the source and target references.
Members must be direct `G` children without operators or Bearing handles; an unmarked body child is not a member.
Invalid source or unclassified intent rejects the whole linked block without falling back to single-source connections.
G_/O_ and complete explicit clauses are commentary or independent relations, separate from the ordered joint sources.
Member subtrees retain their ordinary behavior, including a further linked block below a real intermediate Point.
For complete restrictions and partial-output behavior, see [local linked blocks](syntax.md#local-linked-blocks).

## Assess a local attachment

Use G_ to support and O_ to object to the Bearing owned by the nearest ancestor constructor.
These are ordinary G and O Points with a retained local selector, not new roles.
Body is transparent; another Point, linked, or edge is a boundary even when its attachment is missing or rejected.
Selection never scans a Point's other outgoing Bearings, crosses an unattached Point, or selects the commentary relation being created by the same annotation.

```md cog-check require=supports,undercuts,repliesTo points=6 bearings=4 diagnostics=0
- [C @claim] A persistent fault may explain the timeouts.
  - [linked; @step]
    - [G @first] Two retries timed out.
    - [G @second] Both loaded the same configuration.
    - [G_] The configuration connects these observations.
    - [O_ @objection] A transient environment fault may explain both.
      - [R] A control run found the environment stable.
```

In a Point context the ordinary table remains G supports, O challenges, D clarifies, Gap about, C answers only a locally Q-marked parent, and R repliesTo only a locally O-marked parent.
Q and Material have no default.
Unsuffixed roles have no default in a Bearing context; direct linked G instead contributes one source without an individual unary attachment.
G_/O_ select the nearest constructor's attachment in either context.
An explicit clause overrides the ordinary default, and combining one with a selector is diagnosed.

The following pair preserves selected graph structure, declaration metadata, individual instances, ordered sources and typed targets.
Spans, derivedBy, Explain and original source remain separate from that comparison.

```md cog-check compare=local-attachment caption="Local selector" require=supports,undercuts points=3 bearings=2 diagnostics=0
- [C @claim] Claim.
  - [G @premise; @step] Premise.
    - [O_ @objection; @attack] This step assumes a stable environment.
```

```md cog-check compare=local-attachment caption="Complete target" require=supports,undercuts points=3 bearings=2 diagnostics=0
- [C @claim] Claim.
  - [G @premise; @step] Premise.
    - [O @objection _> @step; @attack] This step assumes a stable environment.
```

A G_/O_ below a linked member fails: the member owns no unary Bearing.
Move commentary to the linked context or specify a complete target.
A comments-only linked is invalid; commentary cannot invent its target.
Unknown references in complete independent clauses fail independently; incomplete G +> rejects the whole joint.
Only G_/O_ are supported; no Q_, C_, R_, D_, suffixed Gap or targetless _> is introduced.
The canonical negative mapping remains challenges for Point targets and undercuts for Bearing targets.

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
- [edge @p, @q +> @i; @first]
- [edge @i, @r +> @c; @second]
- [edge @s, @t +> @c; @third]
```

Argumentation includes developing, presenting, and examining arguments; it is not limited to debate between people.
No additional Convergent or Serial keyword is required.

## Connections from indentation

Outside a linked block, without an operator, the nearest enclosing Point and the child's role determine whether a connection is produced:

| Child | Enclosing Point | Connection |
| --- | --- | --- |
| `C` or `C?` | `Q` | `answers` |
| `G` | Any Point | `supports` |
| `O` | Any Point | `challenges` |
| `R` | `O` | `repliesTo` |
| `D` | Any Point | `clarifies` |
| `?` | Any Point | `about` |

Other combinations create no default connection. Ordinary body can be crossed while finding the nearest Point; an ineligible Point cannot. The first Point beneath an `edge`, possibly through body, must provide an explicit target. Its own children can then use ordinary indentation: for example, a reply beneath an explicitly targeted objection replies to that objection.

Derived connections still have meaning. `derivedBy: "structural"` describes their source; `"operator"` means an operator was written. Neither measures confidence. An answer can be wrong, a reply ineffective, and a positive reason weak. The graph adds no transitive links, proof rules, or conclusions from missing connections.

For example, either Claim form beneath a Question produces an answer:

```md cog-check require=answers points=3 bearings=2 diagnostics=0
- [Q] What caused the timeouts?
  - [C] Pool exhaustion caused the timeouts.
  - [C?] A network fault caused the timeouts.
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
Every adopted canonical kind has an explicit `edge` constructor, while local shorthand still follows its lexical context.
Explicit references can point forward or backward; generated source would remain separate from the authored document and needs its own formatter contract.

## Naming routes

Sometimes the weak part is how a reason bears on a claim. Name that connection with `; @route`, then use `_>` to question it:

```md cog-check require=supports,undercuts,about points=4 bearings=3 diagnostics=0
- [C? @cause] The connection pool may be exhausted.
  - [G; @log-route] Logs show connection acquisition failures.
- [O _> @log-route] The same log message can result from a network failure.
- [? ~> @log-route] We need a trace separating these two causes.
```

`[G @reason; @route]` names the Point `reason` and its connection `route`. `[G; @route]` leaves the Point anonymous. A handle is valid only if the annotation produces a Bearing.

Every Bearing has a compilation-local `key`; only authored route names populate `handle`. Graph references use `{ key, kind: "bearing" }`. Persisted references need the authored handle and document context. Keys have no stability guarantee across edits or different graphs. See [syntax](syntax.md) for all forms and error boundaries.
