---
title: Writing for another reading
summary: Keep the source readable, distinguish voices, and make reuse and revision explicit.
section: learn
order: 3
---

# Writing for another reading

These are working conventions for authors using Cogitatum.
They help someone read and revise a note, including its future author.
They are recommendations, not additional compiler rules or automatic fixes.
The [syntax reference](syntax.md) defines what the language accepts.

## Keep enough prose to understand the marks

Start with the situation, source and purpose in ordinary body.
Mark the parts whose role or connection helps the reader; leave other prose unmarked.
Within a Cogitatum source unit, both marked material and body use outline bullets.
Two spaces per level is a readable convention, not a language requirement.
Hard tabs also work, one per level, so outlines pasted from Logseq or Obsidian compile unchanged; keep one kind of indentation within a source unit.

Keep a Point focused enough that another passage can refer to it without ambiguity.
Do not split every sentence into a Point, or delete qualifications to make a diagram smaller.
“May explain this case” and “explains every case” are different contents.
`C` does not certify either one, and a `supports` connection does not settle whether a reason is sufficient.

## Separate reconstruction from examination

Identify whose commitments you are reconstructing and where your own examination begins.
Preserve the source's qualifications and attribution.
If a premise or connection is your interpretation, say so; a successful compilation cannot establish source fidelity.

Here is an invented book argument followed by a reader's examination:

```md cog-check require=supports,challenges points=4 bearings=3 diagnostics=0
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


## Preview an explicit target

Use `cog explicit-target --line 3 inquiry.cog.md` to preview fixing the currently selected target of one occurrence.
The line is one-based in the complete input file; add `--input host` for a selected Cogitatum fence in Markdown.
The command prints JSON and does not write to the input file.

Before the edit, the Ground below selects the Claim through ordinary body:

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=1
- [C @claim] The service needs inspection.
  - Evidence collected this morning
    - [G; @route] Two independent retries timed out.
      - [O/] Both may share a transient fault.
```

The preview inserts a clause into the selected annotation:

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=0
- [C @claim] The service needs inspection.
  - Evidence collected this morning
    - [G +> @claim; @route] Two independent retries timed out.
      - [O/] Both may share a transient fault.
```

The same three Points and two individual Bearings remain, including the objection to this particular route.
The source prose, occurrence ownership, note boundaries, indentation, names, handles and line endings are retained.
The change removes this occurrence's implicit-attachment advice and changes its attachment provenance from structural to explicit.
It does not decide whether the observations are independent or sufficient.

**This deliberately changes future editing behavior.**
Moving the Ground under another Claim will retain `@claim` as its target.
Changing its role will retain the explicit operator rather than select a new relation from local defaults.
Choose this operation when that is the intended commitment; it is not an automatic formatting fix.
The inserted operators retain their normal target requirements: `->` requires a Point, while `+>` and `~>` permit either kind.
Later changes to the target declaration therefore need their own review.

The first operation handles ordinary implicit `supports`, `challenges` and `about` attachments on Point declarations and uses, with an already named Point target.
It declines anonymous targets, local G/ or O/ selectors, Linked headers/members and relations without a Point-attached symbolic spelling, including `answers`, `repliesTo` and `clarifies`.
Already explicit clauses are reported as unavailable rather than receiving a duplicate clause.
Any error anywhere in the complete input withholds a preview, including an invalid or unclosed separate host fence.

A ready result includes `originalSource`, `proposedSource`, one insertion in `edit`, the original and proposed diagnostic lists, and the consequence for future moves and role changes.
The insertion offset counts UTF-16 code units in `originalSource`, not UTF-8 bytes.
Before applying a saved preview, an editor or caller must compare the complete current source with `originalSource`; any difference requires a new preview.
The command provides no delayed apply or file overwrite mode.
An unavailable result contains a reason and message, with no edit or proposed source.
Exit status is 0 for a ready preview, 1 for an unavailable preview or I/O failure, and 2 for invalid command options.

The Core implementation reparses the proposed complete input in the same mode.
It checks the ordered AST including occurrence text and note subtrees, allowing only the selected clause and source metadata to change.
It checks every graph's identities, entity order, contents, declarations, ordered sources, typed targets and names, allowing only the selected Bearing's provenance and source positions to change.
Diagnostics retain their ordered severity, code and starting location, except that the selected implicit-attachment suggestion may disappear.
Full messages are returned for review because they may embed changed source columns.
These checks establish the stated structural and source preservation conditions; they do not certify an interpretation of the prose.

## Work with an assistant

The current Core and CLI are deterministic tools: parsing, reference analysis, graph inspection, compiler explanation and explicit-target previews require no LLM.
An assistant can use them to inspect a draft and propose edits through the same contracts available to a human or editor.
An LLM is useful when the task involves interpreting prose, proposing a reconstruction, finding a possible missing premise or drafting an explanation; its output remains a proposal that can be mistaken.

Keep three questions separate:

| Question | Evidence |
| --- | --- |
| Did we represent the selected source faithfully? | Original passage, attribution, qualifications and a reviewed interpretation |
| Does the markup express the intended structure? | `check`, `ast`, `graph`, `explain` and source review |
| Does a conclusion follow under a particular theory? | Explicit assumptions, a stated mapping and a suitable proof or counterexample |

Start with an attributable passage and retain the original source.
Ask the assistant to distinguish the passage's commitments from its own interpretations, including any supplied premise.
Compile the proposal, inspect its graph and diagnostics, and reread the source and occurrence-local notes.
Apply only changes covered by the author's chosen operation or standing policy; a compiler success does not itself authorize adoption.
When applying a saved explicit-target preview, first verify that its complete original source still matches.

A logical checker need not use an LLM either: the repository's finite interpretation experiment checks explicitly supplied readings mechanically.
That experiment is not a public general-purpose reasoning command.
Future interpretation assistance can propose a reading and pass it to an independent checker while retaining assumptions and the original Bearings.
A successful check of the formal reading does not establish that it faithfully translates the prose.

Useful distinctions to retain in a revision include a declaration versus one use, shared text versus occurrence-local commentary, and a new copy versus another use of the same identity.
Likewise, deriving a conclusion, hiding proof detail and deleting a premise are different operations with different obligations.
For example, an extra observation may be unnecessary to prove one conclusion yet still record information worth keeping in the inquiry.
Graph size and token count alone do not establish that a shorter note is a better or equivalent one.
