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

```md cog-check require=supports
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

```md cog-check require=supports,undercuts
- [C @conclusion] The service needs more capacity.
- [@load] Peak load exceeds current capacity.
- [@forecast] The forecast predicts further growth.
- [edge @load, @forecast +> @conclusion; @capacity-route] These reasons bear on the conclusion jointly.
- [O _> @capacity-route] The forecast assumes a campaign that was cancelled.
```

Two separate `[G]` children create two independent connections. One `edge` with two sources creates one joint connection without also creating the independent ones.

## Connections from indentation

Without an operator, the nearest enclosing Point and the child's role determine whether a connection is produced:

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

## Naming routes

Sometimes the weak part is how a reason bears on a claim. Name that connection with `; @route`, then use `_>` to question it:

```md cog-check require=supports,undercuts,about
- [C? @cause] The connection pool may be exhausted.
  - [G; @log-route] Logs show connection acquisition failures.
- [O _> @log-route] The same log message can result from a network failure.
- [? ~> @log-route] We need a trace separating these two causes.
```

`[G @reason; @route]` names the Point `reason` and its connection `route`. `[G; @route]` leaves the Point anonymous. A handle is valid only if the annotation produces a Bearing.

Every Bearing has a compilation-local `key`; only authored route names populate `handle`. Graph references use `{ key, kind: "bearing" }`. Persisted references need the authored handle and document context. Keys have no stability guarantee across edits or different graphs. See [syntax](syntax.md) for all forms and error boundaries.
