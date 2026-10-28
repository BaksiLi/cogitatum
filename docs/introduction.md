---
title: A one-minute introduction
summary: Keep writing ordinary prose. Mark a claim, reason or objection when it helps.
section: learn
order: 1
audience: One minute
---

# A one-minute introduction

Cogitatum is a little markup for seeing the reasoning in your notes.
Keep the context in ordinary prose, then mark the parts you want to examine:

```md cog-check require=supports,challenges,respondsTo points=4 bearings=3 diagnostics=0
- A neighbourhood library is considering later opening hours. This is an imagined discussion.
- [C] The library should stay open until eight on weekdays.
  - [G] Readers have asked for somewhere to study after work.
  - [O] The library cannot afford another staffed shift.
    - [R] Try one evening within the existing staffing budget.
```

`C` marks a Claim, `G` a Ground, `O` an Objection, and `R` a Response.
The indentation connects the reason and objection to the Claim, and the Response to the Objection.
The opening context remains ordinary prose.

A marked piece of content is a **Point**.
A connection between Points is a **Bearing**.
The map shows those connections; Reading keeps your prose in order.
The marks make an argument easier to inspect without deciding whether its reasons are good enough.

Paste the example into the [playground](https://cogitatum.onesimos.net/playground), change a sentence, and inspect the result.
No installation or account is needed.
The [quick start](quick-start.md) walks through a first note; [Bearings](bearings.md#argument-structures) shows separate reasons, joint reasons and chains of reasoning.

These pages describe the **0.6.0 development version**.
For saved notes or an installed compiler, check the [version and migration reference](syntax.md#compatibility-and-migration).
