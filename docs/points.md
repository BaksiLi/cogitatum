---
title: Points — mark something worth examining
summary: Mark a question, claim or reason; keep its wording and refer to it when needed.
section: reference
order: 1
---

# Points

A Point is content you identify for independent discussion.
It can be a question, sentence, fragment or passage.
Use a mark to say how you are presenting it here:

| Mark | Name | Use here |
| --- | --- | --- |
| `[Q]` | Question | A question or issue to examine |
| `[C]` | Claim | A claim, position or possible answer |
| `[G]` | Ground | A reason for another Point |
| `[O]` | Objection | An objection or opposing explanation |
| `[R]` | Response | A response to another Point |
| `[D]` | Distinction | A distinction that helps clarify another Point |
| `[.]` | Neutral Point | Content without a specified role |

A role describes this presentation, rather than a permanent type or a judgment of truth.
The same content can be a Claim in one discussion and a Ground in another.
A response may also answer or clarify something; its mark need not catalogue everything the passage does.

## Keep the complete content

```md cog-check require=supports points=2 bearings=1 diagnostics=0
- [C] The method may work
  under the same calibration conditions.
  - [G] Both runs used the same temperature.
```

The Claim includes its continuation line.
Keep qualifications in the content even when Map shortens the display.
A Point need not be a complete declarative sentence, and a new line does not turn its continuation into a note.

Ordinary context can stay unmarked.
It remains in Reading without becoming another Point.

## Questions do not prescribe their children

```md cog-check points=3 bearings=0 diagnostics=0
- [Q @scale] How fast is "fast" here?
  - [.] Seconds, rather than minutes.
  - [C] The record does not describe the measurement method.
```

All three are complete Points.
The nesting organizes the discussion without automatically recording an answer or relevance relation.
A neutral Point leaves its role unspecified; it need not be impartial or unfinished.

When you want to record an answer explicitly:

```md cog-check require=answers points=2 bearings=1 diagnostics=0
- [Q @scale] How fast is "fast" here?
  - [. answers @scale] Seconds, rather than minutes.
```

`[R]` beneath the Question instead records a response.
Neither a response nor an answer relation certifies that the question is resolved.
See [connections from indentation](bearings.md#connections-from-indentation) for the other local relations.

## Name a Point for later reference

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=0
- [C @claim] The current explanation is incomplete.
  - [G] It does not account for the second observation.
- [O -> @claim] That observation may be a measurement error.
```

`@claim` names the Claim.
The anonymous Ground and Objection remain full Points.
Names use lowercase letters, digits, hyphens or underscores, beginning with a letter.
Keep a name when later references should continue to identify the same content.

## Reuse without copying

```md cog-check require=supports points=2 bearings=1 diagnostics=0
- [C @observation] Two retries timed out.
- [C @cause] A shared configuration fault may explain the failures.
  - [G use @observation] Consider these retries in this step.
```

`use` presents the existing Point as a Ground here.
Its content and original declaration remain shared; this appearance adds its own supporting connection.
The words after the use are commentary at this appearance, rather than a replacement for “Two retries timed out.”

Use `[. use @observation]` to present the same Point without a default connection.
It does not copy the Point's children or notes.
If you change what the claim says, declare a new Point instead.

## Keep supplementary prose in a note

```md cog-check require=supports points=2 bearings=1 diagnostics=0
- [C] The measurements can be compared.
  - [G] Both runs used the same calibration procedure.
  - [note] Source: laboratory record, section 2.
    - Check the archived worksheet before revising.
```

A note and its whole indented subtree remain supplementary prose.
They add no Points or connections, even if a quoted line looks like an annotation.
Keep a qualification that changes the Claim in its content; give a separate reason its own Point.

For alias spellings, object notes and precise reference boundaries, consult the [syntax reference](syntax.md).
The [English / 繁體中文 glossary](glossary.md) gives suggested Chinese readings.
