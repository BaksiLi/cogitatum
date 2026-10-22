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
    - [C] The connection pool may be exhausted.
      - [G] Logs show connection acquisition failures.
      - [O] An upstream service may be slow.
  - Check the traces before making changes.
```

Q marks a Question, C a Claim or possible answer, G a Ground (a reason), and O an Objection.
C does not certify that the answer is true, accepted, certain or complete.
Indentation connects marked lines according to their roles.
Move one and inspect which connection changes.
Unmarked context stays body.

## Name something when you need to refer to it

Add `@cause` to the claim, then connect an objection elsewhere using `->`:

```md cog-check require=supports,challenges points=3 bearings=2 diagnostics=0
- [C @cause] The connection pool may be exhausted.
  - [G] Logs show connection acquisition failures.
- A separate check of the timeline:
  - [O -> @cause] Some timeouts started before this deployment.
```

A name is optional until a reference needs it. The anonymous reason and objection are still points in the map.

You now have a note with context, an open explanation, a reason, and an objection connected from elsewhere.
That is enough for a first note.
When you need to question a connection itself or combine several reasons, look up [Bearings](bearings.md).

## Writing and reconstruction

When developing your own explanation, keep tentative wording in the Claim's content; ~> can record relevance without a supporting or opposing commitment.
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
If the source leaves a claim tentative, preserve that qualification in its wording.
If its reasoning is unclear, retain the ambiguity in prose or a Question or [Gap](bearings.md#connections-from-indentation), and identify it as your reconstruction question.
Keep your own objections, and any further step you test, in a separately labelled part of the note.
For a Ground with its own support step, `O` beneath it questions what the Ground says, while [`O/`](bearings.md#assess-a-local-attachment) questions that step.

These are writing and reconstruction recommendations, not extra compiler semantics.
Revising a note need not remove tentative wording or turn every ~> into +>.
Neither `C` nor `supports` certifies truth or valid inference.
The [English / 繁體中文 glossary](glossary.md) offers a compact terminology aid.
For habits that make a note easier to read and revise, see [writing style](writing-style.md).

## Optional: use files and the CLI

With Node.js 22.12 or newer, run the current CLI on your saved note:

```sh
npx --package @cogitatum/cli@0.5.0 cog check inquiry.cog.md
npx --package @cogitatum/cli@0.5.0 cog graph inquiry.cog.md
```

The release packages are `@cogitatum/core` and `@cogitatum/cli` at **0.5.0**, with **format 0.5.0**.
Pin this exact version for a reproducible integration; the historical `alpha` tag remains at **0.3.0-alpha.1**.
To work on the compiler itself, see the [public source](https://github.com/BaksiLi/cogitatum).

The release includes Neutral Points (`[.]`), explicit Point reuse, `linked`, local attachment commentary and typed challenges.
Use the complete **0.5.0** compiler and schema set, and review the [migration table](syntax.md#compatibility-and-migration) before upgrading saved source.

Replace the path with your file. `check` reports syntax and reference problems; `graph` prints the marked connections as JSON. For a visual result, use the playground.

In an existing Markdown document, place the outline in a document-level `cog` fence and use `cog check --input host` followed by the file path. Each fence is independent.

Keep editing the source. The compiler checks marks and references; assessing the reasoning remains part of the inquiry. Look up [points](points.md), [connections](bearings.md), or [syntax](syntax.md) as needed.

## Review names before a deliberate edit

Version **0.4.12** offers `cog check --references inquiry.cog.md` to inspect written references before renaming an observation or reviewing which names to retain.
Run it on the complete file; use `--input host` for Markdown.
This is a read-only inventory, not an automatic cleanup rule.

Here both Points participate in a connection, but neither name has a written reference:

```md cog-check points=2 bearings=1 diagnostics=0
- [C @sampling] Wait ten minutes before sampling.
  - [G @measurement; @route] Drift was below 0.1% after ten minutes.
```

The connection comes from indentation.
The inventory lists `sampling`, `measurement` and the Bearing handle `route`, each with an empty reference array.
That does not justify removing them: a host or a later revision may rely on those names.

Conversely, this measurement has a written reference even though it participates in no Bearing:

```md cog-check points=1 bearings=0 diagnostics=1
- [. use @measurement] Revisit the calibration record.
- [. @measurement] Drift was below 0.1% after ten minutes.
```

The inventory records the forward Point use on the first line.
The existing disconnected-material suggestion still applies; it answers a different question.
Ordinary prose mentions and literal note descendants do not count as syntax references.

Point uses, Bearing uses, explicit ordered sources and explicit targets appear separately in the inventory, with their containing block locations.
Each host fence has its own namespace.
If any selected input has errors, including an omitted unclosed or nested fence, the inventory is explicitly unavailable rather than reporting zero references.
Names with no written references generate no new warnings, and the command never edits the source.

## Inspect a step before changing it

Save this example as `inquiry.cog.md` in the source checkout:

```md cog-check require=supports,challenges points=4 bearings=3 diagnostics=0
- [C @sampling] Wait ten minutes before sampling.
  - [G @measurement; @route] Drift was below 0.1% after ten minutes.
    - [O] The log records drift of 1%, not 0.1%.
    - [O/] One stable run may not justify the waiting rule.
```

The first objection questions the measurement; the second questions its use as a reason for waiting.
Both are `challenges`, with different typed targets.
The semicolon names the supporting Bearing `route`; it does not join the two objections or introduce another premise.

After `npm ci` and `npm run build:public`, inspect and preview the same saved source:

```sh
npm run cog:dist -- check inquiry.cog.md
npm run cog:dist -- graph --format text inquiry.cog.md
npm run cog:dist -- explicit-target --line 2 inquiry.cog.md
```

The text view lists four Points and three Bearings, retaining the challenge to the measurement separately from the challenge to its supporting step.
It is an inspection view of compiled structure; ordinary context, notes and use-occurrence prose still need the source.
`cog graph` without `--format text` returns the machine JSON representation of the compilation.
Both commands compile the same source and leave the file unchanged.
The [graph inspection reference](graph-inspection.md) shows a complete output and the information retained by each representation.

The preview proposes `[G @measurement +> @sampling; @route]` on line 2.
It preserves today's relations, including the step-specific objection, while fixing the target for later moves.
Moving the original Ground under another Claim can change its target; moving the proposed explicit form keeps `@sampling`.
Choose which behavior you intend, compare the preview's `originalSource` with the current file, and review the proposed source before applying it.
The command returns a preview; it never applies the edit.
See [checked editing](writing-style.md#preview-an-explicit-target) for declined cases and preservation limits.

All these commands work without an LLM.
A person or assistant can propose a different interpretation, but successful compilation only establishes the marked structure.
For a shared writing workflow, see [work with an assistant](writing-style.md#work-with-an-assistant).
