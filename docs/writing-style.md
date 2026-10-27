---
title: Writing for another reading
summary: Keep the source readable, distinguish voices, and revise with a clear intention.
section: learn
order: 3
---

# Writing for another reading

Write so that someone can follow the note before opening its map.
These conventions help another reader, including your future self; they are recommendations rather than additional compiler rules.

## Keep enough prose to understand the marks

Start with the situation, source and purpose in ordinary body.
Mark a passage when its identity, role or connection helps the reader.
Keep each Point focused enough to refer to without stripping away its qualifications.
“May explain this case” and “explains every case” say different things.

Within a Cogitatum outline, start each item with a bullet.
Indent its continuation lines to the text column without adding another bullet.
Two spaces per level is a readable convention.
The complete block is the Point's content; Map may shorten it for display, but the first line is not a separate title.

## Separate reconstruction from examination

Identify whose commitments you are recording and where your own examination begins.
Preserve the source's qualifications and attribution.
If a premise or connection is your interpretation, say so.

```md cog-check require=supports,challenges points=4 bearings=3 diagnostics=0
- The book's argument, chapter 2 (invented example).
  - [C @book-claim] This treatment may improve sleep.
    - [G; @book-step] Participants reported better sleep after treatment.
- My examination.
  - [O -> @book-claim] The comparison group reported the same improvement.
  - [O -> @book-step] The report alone does not distinguish a treatment effect from expectation.
```

The first Objection challenges the Claim; the second challenges its supporting step.
The prose identifies their voices.
It does not create separate namespaces or make the compiler assign beliefs to the book or reader.

## Choose connections for what they express

Separate Grounds give separate supporting connections.
Use `[_ G]` with neutral `[.]` members when the reasons participate together in one step.
Nest a reason beneath another reason when the intermediate Point matters.
[Bearings](bearings.md#argument-structures) shows these Convergent, Linked and Serial arrangements.

Changing between them changes the recorded argument.
Similarly, `O` beneath a Ground challenges its content, while `O/` challenges its supporting step.
Keep the original route when recording a challenge; an Objection does not automatically remove it.

## Keep content, reuse and notes distinct

Use the same name when another passage should refer to the same Point.
`[G use @observation]` presents that Point as a Ground here without copying its content or children.
The words after a use are commentary at this appearance.
If the claim changes, give the altered content a fresh Point.

Use `[note]` for supplementary prose, such as source details or an author's task.
Its entire subtree remains literal, including anything that looks like Cog syntax.
Ordinary unmarked body instead allows active marked descendants.

A note can explain the reading without adding a premise or relation.
Keep a qualification that changes the claim in the Point's content.
Give a further reason its own Point and the connection you intend.
For notes addressed to an object, see [local object notes](syntax.md#local-object-notes).

## Name for continuity; move with an intention

Names help references, citations and later revisions identify the same item.
An unreferenced name may still have a purpose outside the current note.

Moving a Ground can change which Point its indentation selects.
Choose an explicit target when the connection should survive that move.
Check the resulting source, then reread it: successful compilation does not establish an adequate interpretation.
The CLI can [inspect names](graph-inspection.md#review-names-before-a-deliberate-edit) or [preview an explicit target](graph-inspection.md#preview-an-explicit-target) before a deliberate edit.

## Work with an assistant

An assistant can help interpret prose, propose a reconstruction or identify a possible missing premise.
Its output remains a proposal.
Keep the original passage, ask it to preserve attribution and qualifications, and distinguish supplied premises from what the source actually says.

Keep three questions separate:

| Question | Evidence |
| --- | --- |
| Did we represent the source faithfully? | The original passage and a reviewed interpretation |
| Does the markup express the intended structure? | The source, compiler diagnostics and recorded connections |
| Is the reasoning sound under a particular reading? | Stated assumptions and an appropriate assessment |

The compiler and CLI work without an LLM.
Compile a proposal, inspect the result and reread the full prose before accepting an edit.
A smaller graph or a passing check does not by itself make a better reconstruction.

## Use Cog in design discussions

An issue or pull request can use a short Cog fence where the disputed step benefits from an explicit connection.
Keep status, reproduction steps and verification in ordinary Markdown:

```md cog-check require=supports,challenges,respondsTo points=4 bearings=3 diagnostics=0
- [C] A single-source local Bearing can be complete.
  - [G] Its source, target and intended connection can already be fully specified.
  - [O] Readers may expect a group to contain several sources.
    - [R] Explain that the constructor records one connection and permits one source.
```

For a syntax proposal, state the compiler version and distinguish implemented examples from proposed spellings.
Use inline code when mentioning concrete syntax such as `[_ G]`, `use`, `+>` or `@route`.
Use quotation marks when discussing a word as a word: “support” has several ordinary meanings.
Write Point, Bearing and Linked normally when referring to the concepts.

The [syntax reference](syntax.md) supplies the complete rules; [graph inspection](graph-inspection.md) covers the CLI and checked edits.
