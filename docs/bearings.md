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
- [@hesitation] The speaker interrupts and revises the same sentence twice.
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
- [@load] Peak load exceeds current capacity.
- [@forecast] The forecast predicts further growth.
- [edge @load, @forecast +> @conclusion; @capacity-route] These reasons bear on the conclusion jointly.
- [O _> @capacity-route] The forecast assumes a campaign that was cancelled.
```

Two separate `[G]` children create two independent connections. One `edge` with two sources creates one joint connection without also creating the independent ones.

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

Use `join` when nearby Grounds belong to one supporting connection.
Use `edge` when connecting existing Points by reference, including shared premises or distant targets.
Both construct Bearings; neither is a new Point role or a measure of reasoning strength.

Both original notes below keep the same Claim and two Grounds, including their names, roles, and content.
Each creates exactly one joint `supports` Bearing named `route`.
In the explicit version, the Grounds sit outside the Claim's indentation, so they create no extra default supports.

```md cog-check compare=joint-reasons caption="Local join" require=supports points=3 bearings=1 diagnostics=0
- [C @mortality] Socrates is mortal.
  - [join; @route]
    - [G @humans] All humans are mortal.
    - [G @socrates] Socrates is human.
```

```md cog-check compare=joint-reasons caption="Explicit edge" require=supports points=3 bearings=1 diagnostics=0
- [C @mortality] Socrates is mortal.
- [G @humans] All humans are mortal.
- [G @socrates] Socrates is human.
- [edge @humans, @socrates +> @mortality; @route]
```

The two Grounds keep their own content and roles.
They produce one joint `supports`, with no additional single-source supports to the Claim and no intermediate Point.
A joint connection does not assert that its sources are minimal, that each is necessary, or that the inference is valid.
An objection beneath a Ground targets that premise; an undercut of the handle targets the route.

**Counterexample: ordinary sibling Grounds are independent.**
Removing the `join` creates two single-source Bearings, rather than the one joint Bearing above.
This is a different topology, not an equivalent spelling.

```md cog-check require=supports points=3 bearings=2 diagnostics=0
- [C @mortality] Socrates is mortal.
  - [G @humans] All humans are mortal.
  - [G @socrates] Socrates is human.
```

The handle is optional, and one member is allowed.
The nearest enclosing Point supplies the target, regardless of its role.
Members must be direct `G` children without operators or Bearing handles; put commentary outside the group.
Invalid membership rejects the whole join without falling back to single-source connections.
Member subtrees retain their ordinary behavior, including a further join below a real intermediate Point.
For complete restrictions and partial-output behavior, see [local joins](syntax.md#local-joins).

## Connections from indentation

Outside a `join`, without an operator, the nearest enclosing Point and the child's role determine whether a connection is produced:

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
They do not express every relationship interchangeably: `answers`, `repliesTo`, and `clarifies` have indentation rules but no explicit operators in this version.
Explicit references can point forward or backward, but are not a complete graph serialization syntax.

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
