---
title: Bearings — connect the reasoning
summary: Connect Points with separate reasons, joint reasons and chains of reasoning.
section: reference
order: 2
---

# Bearings

A Bearing is a connection from one or more source Points to a target.
The target can be a Point or another Bearing.
For example, a reason can support a Claim, and an Objection can challenge that supporting step.

Choosing a connection records how you read or present the material.
It does not certify that the reason is sufficient or the objection succeeds.

## Connections from indentation

```md cog-check require=supports,challenges,respondsTo points=4 bearings=3 diagnostics=0
- [C] The service needs inspection.
  - [G] Two independent retries timed out.
  - [O] The failures may have been transient.
    - [R] The same failure recurred this morning.
```

The Ground supports the Claim, the Objection challenges it, and the Response responds to the Objection.
The child's mark selects the relation; indentation supplies the nearest enclosing Point:

| Child mark | Connection to the enclosing Point |
| --- | --- |
| `G` | `supports` |
| `O` | `challenges` |
| `R` | `respondsTo` |
| `D` | `clarifies` |
| `Q` | `concerns` |
| `.`, `C` | No connection |

The enclosing Point's mark does not change these rules.
For example, `R` beneath a Question responds to that Question.
Ordinary body can supply context between them; an intervening Point becomes the nearer target.

## Argument structures

Three common arrangements help distinguish how reasons are being used:

| Structure | Arrangement |
| --- | --- |
| **Convergent / 匯聚** | Separate reasons give separate supporting steps toward one conclusion. |
| **Linked / 聯結** | Several reasons participate together in one supporting step. |
| **Serial / 串聯** | One step's conclusion becomes a reason in a later step. |

These are structures made from Points and Bearings, rather than three kinds of Point or three judgments of strength.

### Convergent: separate reasons

```md cog-check require=supports points=3 bearings=2 diagnostics=0
- [C] Inspect the valve.
  - [G] It is leaking.
  - [G] Its inspection is overdue.
```

Each Ground has its own supporting Bearing.
Recording one reason does not require the other to participate in the same step.
This says how the reasons are offered, without asserting that either is enough on its own.

<a id="local-joint-reasons"></a>

### Linked: joint reasons

For a **Linked** structure, use one `[_ +> ^]` header with neutral source Points:

```md cog-check require=supports points=3 bearings=1 diagnostics=0
- [C] Inspect the valve under the maintenance rule.
  - [_ +> ^] Apply the rule to this valve.
    - [.] Every leaking valve requires inspection under the rule.
    - [.] This valve is leaking.
```

The header constructs one supporting Bearing.
Its direct `[.]` children supply the sources together; they do not create separate supporting steps.
The words after `[_ +> ^]` describe that connection without adding another Point.

The same constructor permits a single source.
It is still a complete Bearing; the source count does not tell us whether the author has finished.
The [local construction reference](syntax.md#bearing-constructors) covers other relation roles and member restrictions.

### Serial: a reason for a reason

```md cog-check require=supports points=3 bearings=2 diagnostics=0
- [C] The incident needs investigation.
  - [G] The timeouts are reproducible.
    - [G] Two independent retries failed in the same way.
```

The observation supports reproducibility, which in turn supports investigating the incident.
Keep the intermediate Point: it is the target of one step and a source in the next.
Ordinary nesting expresses the chain without a `serial` keyword or an automatically added shortcut.

These structures can combine.
Two joint routes can converge on one conclusion, and a conclusion from one route can become a premise in another.
Adding a premise or an intermediate step changes the reconstruction; see [reconstruction choices](syntax.md#reconstruction-choices) for worked comparisons.

## Explicit connections

Name a target when the connection should not depend on placement:

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=0
- [C @inspection] Inspect the valve.
- [G +> @inspection] It is leaking.
- [O -> @inspection] The sensor may be misreading.
```

| Operator | Meaning |
| --- | --- |
| `+>` | `supports`: a positive reason for the target |
| `->` | `challenges`: an objection to the target |
| `~>` | `concerns`: relevance without recording support or opposition |

A clause on a Point uses that Point as its source.
To connect existing Points, put their names in a Bearing constructor:

```md cog-check require=supports points=3 bearings=1 diagnostics=0
- [. @rule] Every leaking valve requires inspection under the rule.
- [. @leak] This valve is leaking.
- [C @inspection] Inspect the valve under the maintenance rule.
- [_ @rule, @leak +> @inspection] Apply the rule to this valve.
```

This is the same Linked arrangement as the local joint example.
The explicit version names its sources and target, so their positions do not supply the connection.
Use the form that makes your note easier to read and revise.

## Assess a local attachment

A Ground presents two things: its content and the step by which that content supports something else.
Use `O` to object to its content, or `O/` to object to its local supporting step:

```md cog-check require=supports,challenges points=4 bearings=3 diagnostics=0
- [C] The library should stay open until eight on weekdays.
  - [G] Forty people visited after six at last month's evening event.
    - [O] The count included repeat entries, so fewer than forty people may have visited.
    - [O/] People may have come for the special event, not for ordinary evening opening.
```

The first Objection challenges the attendance count.
The second questions what that attendance tells us about ordinary evenings.
Neither removes the original support or records that it has failed.

### Ask about a step

`Q/` records a question concerning that local step, without supporting or challenging it.
Its relation is `concerns`, as for bare `Q`, which concerns the nearest Point instead.
See the [selector reference](syntax.md#ask-about-a-step) for examples, reuse and the distinction from explicit operators.

## Naming routes

Name a Bearing when another passage needs to refer to that particular connection.
The semicolon introduces its name:

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=0
- [C @safe] The bridge is safe.
  - [G; @inspection-step] Yesterday's inspection found no defects.
- [O -> @inspection-step] The inspection omitted the underside.
```

`@inspection-step` identifies the Bearing, not the Ground's content.
The Objection targets that inspection step.
The anonymous Ground is still a Point; use `[G @inspection; @inspection-step]` if both need names.

Describe a locally created step with `[_ note]` when the explanation should remain supplementary:

```md cog-check require=supports points=2 bearings=1 diagnostics=0
- [C] The pump may explain the outbreak.
  - [G] Most cases are nearby.
    - [_ note] Proximity may reflect access to this water supply.
```

The note adds no premise or supporting relation.
If the passage itself offers a further reason, make it a Point and choose the intended connection.
The [selector reference](syntax.md#explain-a-step-add-a-premise-or-support-the-step) compares a note, an added joint premise and a reason for the step.

## Further reference

The [complete syntax](syntax.md#roles-and-connections) lists every relation, target restriction and alternative spelling.
[Joint relevance](syntax.md#joint-relevance) covers sources that concern a target together.
For content, naming and reuse, see [Points](points.md); for preserving the original author's commitments, see [writing style](writing-style.md).
