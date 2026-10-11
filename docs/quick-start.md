---
title: Try a note in ten minutes
summary: Write a note, mark a reason, and connect an objection from elsewhere.
section: learn
order: 2
audience: Ten minutes
---

# Try a note in ten minutes

Open the [playground](https://cogitatum.baksili.codes/playground). Work there without installing anything, or save your source in a file such as `inquiry.cog.md`.

## Start with ordinary writing

```md cog-check points=0 bearings=0 diagnostics=0
- The new deployment has produced intermittent timeouts.
  - We have logs from two servers, but no comparison from last week.
```

Nothing is marked, so no graph entities are created. Your context is still there to read.

## Mark the part you want to examine

```md cog-check require=answers,supports,challenges points=4 bearings=3 diagnostics=0
- The new deployment has produced intermittent timeouts.
  - [Q] What explains the failures?
    - [C?] The connection pool may be exhausted.
      - [G] Logs show connection acquisition failures.
      - [O] An upstream service may be slow.
  - Check the traces before making changes.
```

`Q` marks a Question, `C?` an Open claim, `G` a Ground (a reason), and `O` an Objection.
Open status leaves the claim open; it is not a confidence score.
Indentation connects marked lines according to their roles.
Move one and inspect which connection changes.
Unmarked context stays body.

## Name something when you need to refer to it

Add `@cause` to the claim, then connect an objection elsewhere using `->`:

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=0
- [C? @cause] The connection pool may be exhausted.
  - [G] Logs show connection acquisition failures.
- A separate check of the timeline:
  - [O -> @cause] Some timeouts started before this deployment.
```

A name is optional until a reference needs it. The anonymous reason and objection are still points in the map.

You now have a note with context, an open explanation, a reason, and an objection connected from elsewhere.
That is enough for a first note.
When you need to question a connection itself or combine several reasons, look up [Bearings](bearings.md).

## Writing and reconstruction

When developing your own explanation, `C?` can keep a claim open and `~>` can record relevance without a supporting or opposing commitment.
When reconstructing another person's argument, use the marks to preserve what that person commits to, and distinguish your own questions in prose.
Suppose a report explicitly attributes the timeouts to pool exhaustion and cites the acquisition failures as its reason:

```md cog-check require=supports,about points=3 bearings=2 diagnostics=0
- Reconstructing the report's explanation:
  - [C @cause] Pool exhaustion caused the timeouts.
    - [G] Logs show connection acquisition failures.
- My question about the report:
  - [Q ~> @cause] Did the report rule out a network fault?
```

The Claim and Ground preserve the report's assertion and supporting relation, even if you disagree with it.
Your Question is relevant to the Claim without inventing an objection that the report never made.
If the source leaves a claim open, `C?` can preserve that too.
If its reasoning is unclear, retain the ambiguity in prose or a Question or [Gap](bearings.md#connections-from-indentation), and identify it as your reconstruction question.

These are writing and reconstruction recommendations, not extra compiler semantics.
Revising a note need not turn every `C?` into `C` or every `~>` into `+>`.
Neither `C` nor `supports` certifies truth or valid inference.
The [English / 繁體中文 glossary](glossary.md) offers a compact terminology aid.

## Optional: use files and the CLI

With Node.js 22.12 or newer, run the Alpha CLI on your saved note:

```sh
npx --package @cogitatum/cli@alpha cog check inquiry.cog.md
npx --package @cogitatum/cli@alpha cog graph inquiry.cog.md
```

The published packages are `@cogitatum/core` and `@cogitatum/cli` at **0.3.0-alpha.1**. Use the `alpha` tag, or pin this exact version for a reproducible integration. To work on the compiler itself, see the [public source](https://github.com/BaksiLi/cogitatum).

This checkout is an unpublished **0.4.8** source candidate with neutral `[.]` Points, explicit Point reuse, `linked` and local attachment commentary.
Use the [source build instructions](https://github.com/BaksiLi/cogitatum#public-alpha) to try it; match the exact compiler/schema commit and review the [migration table](syntax.md#compatibility-and-migration) before upgrading saved source.

Replace the path with your file. `check` reports syntax and reference problems; `graph` prints the marked connections as JSON. For a visual result, use the playground.

In an existing Markdown document, place the outline in a document-level `cog` fence and use `cog check --input host` followed by the file path. Each fence is independent.

Keep editing the source. The compiler checks marks and references; assessing the reasoning remains part of the inquiry. Look up [points](points.md), [connections](bearings.md), or [syntax](syntax.md) as needed.
