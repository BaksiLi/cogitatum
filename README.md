# Cogitatum

Cogitatum is a lightweight markup language for making selected reasoning structure explicit inside ordinary prose.

Use it while reading, developing or revising an argument: in reading notes, investigations, or the reasons for a decision. Keep the context in words; mark a question, reason, objection, or missing piece when making it explicit helps.

```md cog-check require=supports,challenges points=4 bearings=3 diagnostics=0
- A neighbourhood library is considering later opening hours. This is an imagined discussion.
- [C] The library should stay open until eight on weekdays.
  - [G] Forty people visited after six at last month's evening event.
    - [O] The count included repeat entries, so fewer than forty people may have visited.
    - [O/] People may have come for the special event, not for ordinary evening opening.
```

Four marked points and three explicit connections. One objection questions the attendance count; the other grants the count and questions what it tells us about ordinary evenings. The opening prose remains in the source. The compiler exposes these distinctions without deciding the case.

[Try the playground](https://cogitatum.baksili.codes/playground) · [One-minute introduction](docs/introduction.md) · [Ten-minute quick start](docs/quick-start.md) · [Examples](https://cogitatum.baksili.codes/examples)

## Public Alpha

**Cogitatum 0.4 releases an inquiry markup language and a working compiler.**

Source candidate: **0.5.0 / format 0.5.0**, not yet published.
It unifies negative relations as `challenges` with typed targets, preserves `->` / `/>` target requirements, and keeps explicit `O/` local selection.
See [migration](docs/syntax.md#compatibility-and-migration) before consuming candidate JSON.
Use the local build commands below to try this candidate; the published install commands select the 0.4 contract.

Published packages: **@cogitatum/core 0.4.12** and **@cogitatum/cli 0.4.12**, with **format 0.4.0**, under `latest`.
Install with `npm install @cogitatum/core`, or run the CLI with `npx --package @cogitatum/cli cog check inquiry.cog.md`.
The historical `alpha` tag remains at **0.3.0-alpha.1**, with **format 0.3.0**.
Published schema contracts stay fixed; later incompatible contracts require a new format identifier.

The **0.4.12** release adds:

- literal `[note]` subtrees attached to source occurrences, nonblocking advice for actual implicit attachments through body, and explicit C? retirement;

- Neutral Points, `[.]` or `[. @p]`, and reuse of one identity with `[. use @p]`, `[G use @p]` or `[_ use @route]`;
- [`linked` joint support](docs/bearings.md#local-joint-reasons), and `G/` / `O/` for the Bearing exposed by the nearest constructor;
- explicit Bearings written `[_ ...]` or `[edge ...]`, with every canonical kind name;
- explicit source context: `document` by default, `host` for Markdown fences; content-dependent `auto` is retired.

The production [playground](https://cogitatum.baksili.codes/playground) is deployed separately from npm packages.
When upgrading from 0.3 or an earlier unpublished 0.4 candidate, use the complete schemas from **0.4.12** and [migrate retained source](docs/syntax.md#compatibility-and-migration).

With Node.js 22.12 or newer, from a source checkout:

```sh
npm ci
npm run build:public
npm run cog:dist -- check examples/getting-started.cog.md
npm run cog:dist -- graph examples/getting-started.cog.md
```

The core provides a deterministic parser and compiler for Node.js and browser integrations. The CLI checks syntax and references and prints AST or graph JSON. An optional `explain` command shows compiler decisions for debugging a note. The hosted playground lets you try the language without installation.

## Reference

- [Writing style](docs/writing-style.md): readable notes, distinct voices, deliberate reuse and revision.
- [Changelog](CHANGELOG.md): published releases and unpublished source milestones.
- [Points](docs/points.md): marked material and optional names.
- [Bearings](docs/bearings.md): positive bearing, objections, explicit targets, and joint reasons.
- [English / 繁體中文 glossary](docs/glossary.md): terminology for reading and argument reconstruction.
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

After `npm ci`, run `npm run build:public` to build Core, CLI, and the experimental View. Compiler development needs no website build, API keys, or external model services.

| Location | Responsibility |
| --- | --- |
| `packages/core/src/` | Annotation parsing, outline and host input, Graph IR, compiler traces, and public types |
| `packages/cli/src/` | File commands and exit-status behavior |
| `spec/` | Authoritative JSON Schemas; builds copy them into the Core package |
| `fixtures/` | Language conformance cases, including invalid input and expected diagnostics |
| `examples/` | Public notes registered in the example manifest |
| `docs/` | Introduction, quick start, writing style, Points, Bearings, glossary, and complete syntax |

For a compiler fix, add a small regression case and run `npx vitest run packages/core`. A [conformance fixture](fixtures/README.md) needs a specific purpose and a reviewed expected result, including diagnostics and the complete surviving graph topology. For a CLI fix, run `npx vitest run packages/cli`. For documentation, run `npm run check:docs` and review the Markdown. Finish with `npm run check`, which also verifies packed packages in an isolated consumer project.

Keep proposals concrete: include the source, the behavior you expected, and the effect on existing notes or integrations. Tests should demonstrate that behavior. Describe any syntax or JSON contract change explicitly; compatibility changes need a format-version decision, while implementation-only fixes can keep the format.

## Publish npm packages

Releases use [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) from GitHub Actions.
The `Publish npm` workflow runs the full checks and publishes Core before CLI to `latest`.
A tag must match the package version and point to a commit on `main`.
An already published version is skipped on retry; registry failures and attempts to replace a newer `latest` stop the release.
The experimental View package stays private.

Before the first release, add a GitHub Actions trusted publisher in the npm settings for both [`@cogitatum/core`](https://www.npmjs.com/package/@cogitatum/core/access) and [`@cogitatum/cli`](https://www.npmjs.com/package/@cogitatum/cli/access):

| Field | Value |
| --- | --- |
| Organization or user | `BaksiLi` |
| Repository | `cogitatum` |
| Workflow filename | `publish.yml` |
| Environment name | Leave empty |
| Allowed actions | Enable **Allow npm publish** |

No npm token or GitHub secret is needed.
A new trusted publisher must complete its first successful publish within two days of creation.

Run `Publish npm` manually in the repository's Actions tab to verify and preview the packages without publishing.
After the version and dependency changes pass CI and merge into `main`, create and push the matching tag:

```sh
git tag v0.4.12 <verified-main-commit>
git push origin v0.4.12
```

Use the actual package version for each subsequent release.
To recover a partially completed release, rerun the failed publishing job.

## Project Cogitatum

Project Cogitatum explores inquiry artefacts: writing that keeps questions, reasons, and unresolved work available for further thought. Inquiry markup is its first public part. Its marks are semi-formal: structure has precise rules while prose remains open to interpretation.

Project Cogitatum investigates how people and AI agents can learn this form of expression and work on the same inspectable, revisable artefacts. The language supplies explicit structure and reusable identities; whether it improves reasoning remains a research question.

Further work under the name **Cogitatio** concerns ongoing inquiry, revision, review, and continuity. Cogitatio and its runtime are not part of this release.

The current development checkout also contains an experimental integration package, marked private and not published with the Alpha: [`@cogitatum/view`](packages/view/README.md) provides an embeddable, source-linked graph renderer. It leaves evidence, persistence, review, and application UI with the host. This candidate compiler uses format 0.5.0.

The public source covers the language, compiler, CLI, schemas, conformance fixtures, selected examples, and these usage documents. Website source and brand assets are maintained and deployed separately; the website renders the public documents and uses the compiler. Research essays, benchmarks, prompts, and runtime experiments are outside this source distribution.

`npm run check:publication` checks local licensing and package metadata separately from compiler verification. This repository is the source of truth for subsequent language and compiler development.
