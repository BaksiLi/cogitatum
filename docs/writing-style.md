---
title: Writing for another reading
summary: Keep the source readable, distinguish voices, and make reuse and revision explicit.
section: learn
order: 3
---

# Writing for another reading

These are working conventions for authors using Cogitatum 0.4.
They help someone read and revise a note, including its future author.
They are recommendations, not additional compiler rules or automatic fixes.
The [syntax reference](syntax.md) defines what the language accepts.

## Keep enough prose to understand the marks

Start with the situation, source and purpose in ordinary body.
Mark the parts whose role or connection helps the reader; leave other prose unmarked.
Within a Cogitatum source unit, both marked material and body use outline bullets.
Two spaces per level is a readable convention, not a language requirement.

Keep a Point focused enough that another passage can refer to it without ambiguity.
Do not split every sentence into a Point, or delete qualifications to make a diagram smaller.
“May explain this case” and “explains every case” are different contents.
`C` does not certify either one, and a `supports` connection does not settle whether a reason is sufficient.

## Separate reconstruction from examination

Identify whose commitments you are reconstructing and where your own examination begins.
Preserve the source's qualifications and attribution.
If a premise or connection is your interpretation, say so; a successful compilation cannot establish source fidelity.

Here is an invented book argument followed by a reader's examination:

```md cog-check require=supports,challenges,undercuts points=4 bearings=3 diagnostics=0
- Reconstructing the book's argument, chapter 2 (worked example).
  - [C @book-claim] This treatment may improve sleep.
    - [G @book-report; @book-step] Participants reported better sleep after treatment.
- My examination of that argument.
  - [. use @book-claim]
    - [O] The comparison group reported the same improvement.
  - [_ use @book-step]
    - [O/] The report alone does not distinguish a treatment effect from expectation.
```

The first objection challenges the shared Claim; the second questions the book's supporting step.
The two sections organise the reading and attribution in prose.
They do not create separate namespaces, isolate assumptions, or make the compiler assign beliefs to the book or reader.
Mutually exclusive candidate reconstructions belong in separately reviewed documents or host units when they must not form one graph.

## Reuse the same content deliberately

An **occurrence** is one appearance of a Point or Bearing in the source: its declaration, construction or use.
It has a position and local context; a Point occurrence may have a local role.
`Q` is such a role, not a container for a discussion.
Use ordinary body to organise a discussion, and Q when an actual question needs marking.

`[. use @p]` brings the same Point into another discussion without importing its declaration's role.
`[G use @p]` uses that same content as a Ground here and may construct a new connection.
Prose following a use is local commentary, not a replacement for the shared text or a new Point.
Put an altered claim in a fresh declaration and explain its relationship to the old one.

`[_ use @step]` brings the same Bearing into discussion with its original sources and target.
Neither kind of use copies a subtree, its notes, or all connected reasoning.
Applying an argument to new material requires new constructions and an account of why the step applies.

## Choose connections for what they express

Separate Grounds normally give separate supporting connections:

```md cog-check require=supports points=3 bearings=2 diagnostics=0
- [C] Check the valve.
  - [G] It is leaking.
  - [G] Its inspection is overdue.
```

Use linked when the reasons are offered together in one step:

```md cog-check require=supports points=3 bearings=1 diagnostics=0
- [C] Inspect the valve under the maintenance rule.
  - [linked] Applying the rule to this valve.
    - [G] Every leaking valve requires inspection under the rule.
    - [G] This valve is leaking.
```

Changing between these forms is an interpretive revision, not a spacing preference.
When questioning a Ground, distinguish its content (`O` beneath it) from its local supporting step (`O/`).
See [Bearings](bearings.md) for the attachment rules and explicit targets.

## Keep literal notes literal

Use `[note]` when a supplementary passage or subtree must remain outside interpretation, including annotation-looking text.
Use ordinary body for context through which active annotated descendants may still connect.
Both retain prose, but they are not interchangeable containers.
In particular, `linked` constructs a Bearing while `note` keeps its whole subtree literal.
Removing a note marker can activate its contents or change attachment; retaining the same graph is not enough to establish the same reading.

## Name for continuity; move with an intention

Use names when references, citations, host records or later revisions need them.
Keep a name when the same authored item continues; allocate a new one for an independent copy.
An unreferenced name may still have a purpose outside the current source unit.
`cog check --references` inventories written references in complete input; it does not justify deleting names.

Moving an implicitly attached Ground can change its target.
Decide whether the move should preserve the old connection or adopt the new local context; use an explicit target when preserving the old connection requires one.
Keep the reason for an interpretive revision in your note or the host's revision record.
Check the resulting source, then reread it: the compiler checks representation, not the adequacy of the interpretation.

These conventions are the first author-facing slice of [source style and checked edits (#29)](https://github.com/BaksiLi/cogitatum/issues/29).
There is no whole-document formatter or automatic style-fix command yet.
