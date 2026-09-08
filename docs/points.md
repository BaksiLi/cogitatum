---
title: Points — mark something worth examining
summary: Questions, claims, reasons, objections, replies, distinctions, and gaps; names are optional.
section: reference
order: 1
---

# Points

A Point is a marked part of your writing. Use one when a sentence, passage, or missing piece needs an explicit role or a reference. Ordinary body does not become a Point automatically.

| Mark | Local role |
| --- | --- |
| `[Q]` | Question or issue |
| `[C]` | Claim, position, or possible answer |
| `[C?]` | A claim left explicitly open |
| `[G]` | Ground or reason |
| `[O]` | Objection or alternative |
| `[R]` | Reply |
| `[D]` | Distinction |
| `[?]` | Open gap or missing piece |
| `[@passage]` | Named material without a role |

A role describes what the material does here. `C` does not certify truth; `R` does not certify a successful reply. Only `C?` is an open role form; `Q?`, `G?`, `O?`, `R?`, and `D?` are invalid. A gap, `[?]`, is its own form.

## Leave context as body

```md cog-check require=supports
- [C @claim] The current explanation is incomplete.
  - This paragraph supplies context without another marked point.
    - [G] It does not account for the second observation.
```

The reason connects to the enclosing claim through the body. Body itself creates no Point or connection. An intervening Point, however, becomes the nearest target candidate; the compiler does not skip it to find a more convenient ancestor.

## Identity

```md cog-check require=supports,challenges
- [C @claim] The current explanation is incomplete.
  - [G] It does not account for the second observation.
- [O -> @claim] That observation may be a measurement error.
```

The claim has the authored name `claim`. The reason and objection are anonymous: they remain full Points, and the objection can have an explicit target without naming itself.

Names match `[a-z][a-z0-9_-]*` and share a namespace with named [connections](bearings.md). Prose can use any language. Keep a name across edits when the same authored item should remain identifiable; renaming requires updating references.

For integrations, every compiled Point has a `key`; `id` is present only when the author supplied a name. Graph references use `{ key, kind: "point" }`. Keys are local to one compilation and one graph, including one host fence. They are not stable cross-revision identifiers, source names, or global IDs. Source spans are locations, not identity.
