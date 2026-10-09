---
title: Points — mark something worth examining
summary: Mark a role or a gap; name content when a reference needs it.
section: reference
order: 1
---

# Points

A Point is a marked part of your writing.
Use one when a sentence, passage, or missing piece needs an explicit role or a reference.
Ordinary body does not become a Point automatically.
Points can be questions, gaps, or source material; they need not all be propositions that can be true or false.

| Mark | Name | Use here |
| --- | --- | --- |
| `[Q]` | Question | A question or issue to examine |
| `[C]` | Claim | A claim, position, or possible answer |
| `[C?]` | Open claim | A claim left explicitly open |
| `[G]` | Ground | A reason bearing positively on a target |
| `[O]` | Objection | An objection or alternative raised against a target |
| `[R]` | Reply | A response to an objection |
| `[D]` | Distinction | A distinction that helps clarify a target |
| `[?]` | Gap | An open gap or missing piece |

A role describes what the material does here.
The six roles are `Q`, `C`, `G`, `O`, `R`, and `D`.
`C?` is a Claim with open status; Gap is a separate Point form, not an additional role.
Only Claim admits open status among the roles; `Q?`, `G?`, `O?`, `R?`, and `D?` are invalid.
See the [English / 繁體中文 glossary](glossary.md) for suggested Chinese readings.

## Leave a claim open deliberately

Use `C?` when the claim is explicitly left open in the inquiry.
It does not assign a low confidence score, and `C` without open status does not mean accepted or true.
Likewise, `R` does not certify a successful reply.

Wording such as “possibly P” is part of the claim's content, and does not automatically require `C?`.
When reconstructing, preserve whether the source asserts the claim or leaves it open.
Distinguish the author's commitment, your uncertainty about the reading, and your evaluation in prose; `C?` has no speaker field.
See the [quick start](quick-start.md#writing-and-reconstruction) for an example.

## Leave context as body

```md cog-check require=supports points=2 bearings=1 diagnostics=0
- [C @claim] The current explanation is incomplete.
  - This paragraph supplies context without another marked point.
    - [G] It does not account for the second observation.
```

The reason connects to the enclosing claim through the body. Body itself creates no Point or connection. An intervening Point, however, becomes the nearest target candidate; the compiler does not skip it to find a more convenient ancestor.

## Identity

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=0
- [C @claim] The current explanation is incomplete.
  - [G] It does not account for the second observation.
- [O -> @claim] That observation may be a measurement error.
```

The claim has the authored name `claim`. The reason and objection are anonymous: they remain full Points, and the objection can have an explicit target without naming itself.

Names match `[a-z][a-z0-9_-]*` and share a namespace with named [connections](bearings.md). Prose can use any language. Keep a name across edits when the same authored item should remain identifiable; renaming requires updating references.

Content can also be named without assigning a role: `[@passage]`.
This is a Point form, not another role; the machine contract retains `form: "material"`.
See the [complete syntax](syntax.md#annotation-grammar) for this and all other naming forms.

For integrations, every compiled Point has a `key`; `id` is present only when the author supplied a name. Graph references use `{ key, kind: "point" }`. Keys are local to one compilation and one graph, including one host fence. They are not stable cross-revision identifiers, source names, or global IDs. Source spans are locations, not identity.
