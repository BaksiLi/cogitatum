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

```md cog-check
- The new deployment has produced intermittent timeouts.
  - We have logs from two servers, but no comparison from last week.
```

Nothing is marked, so no graph entities are created. Your context is still there to read.

## Mark the part you want to examine

```md cog-check require=answers,supports,challenges
- The new deployment has produced intermittent timeouts.
  - [Q] What explains the failures?
    - [C?] The connection pool may be exhausted.
      - [G] Logs show connection acquisition failures.
      - [O] An upstream service may be slow.
  - Check the traces before making changes.
```

`Q` marks a question, `C?` a tentative claim, `G` a reason, and `O` an objection. Indentation connects marked lines. Move one and inspect which connection changes. Unmarked context stays body.

## Name something when you need to refer to it

Add `@cause` to the claim, then connect an objection elsewhere using `->`:

```md cog-check require=supports,challenges
- [C? @cause] The connection pool may be exhausted.
  - [G] Logs show connection acquisition failures.
- A separate check of the timeline:
  - [O -> @cause] Some timeouts started before this deployment.
```

A name is optional until a reference needs it. The anonymous reason and objection are still points in the map.

You now have a note with context, a tentative explanation, a reason, and an objection connected
from elsewhere. That is enough for a first note. When you need to question a connection itself
or combine several reasons, look up [Bearings](bearings.md).

## Optional: use files and the CLI

The packages are `@cogitatum/core` and `@cogitatum/cli` at **0.3.0-alpha.1**; they are not yet published to npm. With Node.js 22.12 or newer, clone the [public source](https://github.com/BaksiLi/cogitatum) and run:

```sh
git clone https://github.com/BaksiLi/cogitatum.git cogitatum-public
cd cogitatum-public
npm ci
npm run build:public
npm exec -- cog check examples/getting-started.cog.md
npm exec -- cog graph examples/getting-started.cog.md
```

Replace the example path with your file. `check` reports syntax and reference problems; `graph` prints the marked connections as JSON. For a visual result, use the playground.

In an existing Markdown document, place the outline in a document-level `cog` fence and use `cog check --input host` followed by the file path. Each fence is independent.

Keep editing the source. The compiler checks marks and references; assessing the reasoning remains part of the inquiry. Look up [points](points.md), [connections](bearings.md), or [syntax](syntax.md) as needed.
