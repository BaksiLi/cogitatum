# Cogitatum

Cogitatum is a lightweight markup language for making selected reasoning structure explicit inside ordinary prose.

Use it in reading notes, investigations, or the reasons for a decision. Keep the context in words; mark a question, reason, objection, or missing piece when making it explicit helps.

```md cog-check require=answers,supports,challenges
- We noticed slower requests after deployment and are collecting possible causes.
  - [Q] Why are requests timing out?
    - [C?] The database connection pool may be exhausted.
      - [G] Logs show connection acquisition failures.
      - [O] Upstream latency could also explain the timeouts.
  - Compare the traces tomorrow before changing the configuration.
```

Four marked points, three explicit connections. The ordinary body remains in the source. The compiler exposes selected structure without judging whether the explanation is correct.

[Try the playground](https://cogitatum.baksili.codes/playground) · [One-minute introduction](docs/introduction.md) · [Ten-minute quick start](docs/quick-start.md) · [Examples](https://cogitatum.baksili.codes/examples)

## Public Alpha

**Cogitatum 0.3 Public Alpha releases an inquiry markup language and a working compiler.**

Source release: **@cogitatum/core 0.3.0-alpha.1** and **@cogitatum/cli 0.3.0-alpha.1**, with **format 0.3.0**. They are not yet published to npm. Syntax and machine contracts may change before a stable release.

With Node.js 22.12 or newer, from a source checkout:

```sh
npm ci
npm run build:public
npm exec -- cog check examples/getting-started.cog.md
npm exec -- cog graph examples/getting-started.cog.md
```

The core provides a deterministic parser and compiler for Node.js and browser integrations. The CLI checks syntax and references and prints AST or graph JSON. An optional `explain` command shows compiler decisions for debugging a note. The hosted playground lets you try the language without installation.

## Reference

- [Points](docs/points.md): marked material and optional names.
- [Bearings](docs/bearings.md): positive bearing, objections, explicit targets, and joint reasons.
- [Complete syntax](docs/syntax.md): grammar, input modes, resolution, and machine contracts.
- `spec/`: JSON Schemas; `fixtures/`: conformance cases; `examples/`: curated source notes.

Every Point and Bearing has a compilation-local `key`. Only authored Point names populate `id`; only authored route names populate a Bearing's `handle`. Graph references use `{ key, kind }`. This breaks the format 0.2 identity contract; keys must not be used as stable references across edits.

## Participate

Useful contributions include small notes from real work, confusing authoring cases, parser or diagnostic bugs with a minimal source example, documentation improvements, and integrations using the public compiler contract. Include the expected result and package version. Discuss syntax or semantic changes with a concrete example before implementing them.

Run `npm run check` before proposing a change. The syntax reference, schemas, and conformance fixtures describe the compiler contract; report disagreements between them as bugs. Research proposals are not additional language requirements. The public source is licensed under [MIT](LICENSE).

## Work on the project

Develop language, compiler, CLI, schemas, fixtures, examples, and public docs in this repository. Create a branch from `main`, make the change, run the checks, and open a pull request.

```sh
git clone https://github.com/BaksiLi/cogitatum.git cogitatum-public
cd cogitatum-public
git switch -c fix/describe-the-change
```

After `npm ci`, run `npm run build:public` to build both packages. Compiler development needs no website build, API keys, or external model services.

| Location | Responsibility |
| --- | --- |
| `packages/core/src/` | Annotation parsing, outline and host input, Graph IR, compiler traces, and public types |
| `packages/cli/src/` | File commands and exit-status behavior |
| `spec/` | Authoritative JSON Schemas; builds copy them into the Core package |
| `fixtures/` | Language conformance cases, including invalid input and expected diagnostics |
| `examples/` | Public notes registered in the example manifest |
| `docs/` | Introduction, quick start, Points, Bearings, and complete syntax |

For a compiler fix, add a small regression case and run `npx vitest run packages/core`. A [conformance fixture](fixtures/README.md) needs a specific purpose and a reviewed expected result, including diagnostics and the complete surviving graph topology. For a CLI fix, run `npx vitest run packages/cli`. For documentation, run `npm run check:docs` and review the Markdown. Finish with `npm run check`, which also verifies packed packages in an isolated consumer project.

Keep proposals concrete: include the source, the behavior you expected, and the effect on existing notes or integrations. Tests should demonstrate that behavior. Describe any syntax or JSON contract change explicitly; compatibility changes need a format-version decision, while implementation-only fixes can keep the format.

## Project Cogitatum

Project Cogitatum explores inquiry artefacts: writing that keeps questions, reasons, and unresolved work available for further thought. Inquiry markup is its first public part. Its marks are semi-formal: structure has precise rules while prose remains open to interpretation.

Further work under the name **Cogitatio** concerns ongoing inquiry, revision, review, and continuity. Cogitatio and its runtime are not part of this release.

The public source covers the language, compiler, CLI, schemas, conformance fixtures, selected examples, and these usage documents. Website source and brand assets are maintained and deployed separately; the website renders the public documents and uses the compiler. Research essays, benchmarks, prompts, and runtime experiments are outside this source distribution.

`npm run check:publication` checks local licensing and package metadata separately from compiler verification. This repository is the source of truth for subsequent language and compiler development.
