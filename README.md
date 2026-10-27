# <a href="https://cogitatum.onesimos.net"><img src="https://cogitatum.onesimos.net/mark.svg" alt="" width="32" height="32"> Cogitatum</a>

**Keep the prose. See the reasoning.**

Cogitatum is a lightweight markup language for making selected reasoning structure explicit inside ordinary prose.

Use it while reading, developing or revising an argument: in reading notes, investigations, or the reasons for a decision. Keep the context in words; mark a question, reason, objection, or missing piece when making it explicit helps.

```md cog-check require=supports,challenges,respondsTo points=4 bearings=3 diagnostics=0
- A neighbourhood library is considering later opening hours. This is an imagined discussion.
- [C] The library should stay open until eight on weekdays.
  - [G] Readers have asked for somewhere to study after work.
  - [O] The library cannot afford another staffed shift.
    - [R] Try one evening within the existing staffing budget.
```

Four marked Points and three connections: a reason for the Claim, an Objection and a Response.
The opening context remains ordinary prose.
The compiler makes these connections inspectable without deciding whether the reasons are good enough.

[Try the playground](https://cogitatum.onesimos.net/playground) · [One-minute introduction](docs/introduction.md) · [Ten-minute quick start](docs/quick-start.md) · [Examples](https://cogitatum.onesimos.net/examples)

## Release status

This checkout prepares **Core/CLI 0.6.0 / format 0.6.0**, not yet published.
It includes multiline content, local Bearing construction such as `[_ G]`, object notes, and revised local relation rules.
The Docs describe this development version.
See the [migration from 0.5](docs/syntax.md#from-published-05) and [changelog](CHANGELOG.md) before recompiling saved notes.

Published packages remain **@cogitatum/core 0.5.0** and **@cogitatum/cli 0.5.0**, with **format 0.5.0**.
Install with `npm install @cogitatum/core@0.5.0`, or run `npx --package @cogitatum/cli@0.5.0 cog check inquiry.cog.md`.
Build this checkout to try 0.6.

The production [playground](https://cogitatum.onesimos.net/playground) is deployed separately from npm packages.
The experimental View remains private; publishing Core/CLI does not deploy the website or release host adapters.

With Node.js 22.12 or newer, from a source checkout:

```sh
npm ci
npm run build:public
npm run cog:dist -- check examples/getting-started.cog.md
npm run cog:dist -- graph examples/getting-started.cog.md
```

The core provides a deterministic parser and compiler for Node.js and browser integrations. The CLI checks syntax and references, prints AST or graph JSON, and offers a text graph inspection view. An optional `explain` command shows compiler decisions for debugging a note. The hosted playground lets you try the language without installation.

## Reference

- [Writing style](docs/writing-style.md): readable notes, distinct voices, deliberate reuse and revision.
- [Changelog](CHANGELOG.md): published releases and unpublished source milestones.
- [Points](docs/points.md): marked material and optional names.
- [Bearings](docs/bearings.md): positive bearing, objections, explicit targets, and joint reasons.
- [English / 繁體中文 glossary](docs/glossary.md): terminology for reading and argument reconstruction.
- [Graph inspection](docs/graph-inspection.md): readable structure, diagnostics and preservation limits.
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

For folding and other editor features, retain the original source and use the AST's `children` for outline nesting.
A block's `sourceSpan` covers its own header and continuation lines, excluding its children.
Graph IR records the selected connections and cannot recover the whole source outline.
See the [source contract](packages/core/README.md#compiler-contracts) for coordinates and projection boundaries.

For a compiler fix, add a small regression case and run `npx vitest run packages/core`. A [conformance fixture](fixtures/README.md) needs a specific purpose and a reviewed expected result, including diagnostics and the complete surviving graph topology. For a CLI fix, run `npx vitest run packages/cli`. For documentation, run `npm run check:docs` and review the Markdown. Finish with `npm run check`, which also verifies packed packages in an isolated consumer project.

Keep proposals concrete: include the source, the behavior you expected, and the effect on existing notes or integrations. Tests should demonstrate that behavior. Describe any syntax or JSON contract change explicitly; compatibility changes need a format-version decision, while implementation-only fixes can keep the format.

## Version policy

During 0.x, an incompatible change to a published language, Core API or CLI contract advances the minor package version, for example 0.4.x to 0.5.0.
Compatible additions and fixes may advance the patch within that line.
This is the project's compatibility policy for initial development; it does not claim the post-1.0 SemVer rule that patches contain only fixes.
Assess compatibility against the last published contract, including source interpretation, exported types, machine output, diagnostic codes and exit behavior.
Correcting behavior that violates that contract is a fix; changing the contract itself requires a new compatibility boundary.
Publish Core and CLI together with matching versions and an exact Core dependency.

The format identifier versions the language and AST, Graph IR, Explain and source-envelope contracts.
An incompatible change to those published contracts needs a new identifier and matching schema set.
Package releases that preserve them retain the format version.
Graph-text notation has its own version; changing CLI help or adding a checked edit does not by itself change the graph format.
New API and command results remain public contracts even when they are not instances of the four schema families.

Never overwrite a published package or relabel stored JSON to cross a format boundary.
Migrate retained source, recompile it, and review the diagnostics with the matching compiler and schemas.
The [changelog](CHANGELOG.md) distinguishes published releases from older unpublished development milestones; those milestones are not a precedent for changing an already published contract in place.
Experimental interfaces are identified explicitly and still need a documented migration when they change.
Website deployments and the private experimental View have separate readiness checks; a Core/CLI release does not establish their adoption.

## Contract boundaries

| Layer | Owns | Does not establish |
| --- | --- | --- |
| Language and Core | Authored constructors, target requirements, name resolution, diagnostics, versioned AST/Graph IR/Explain/source envelopes | Truth, defeat, acceptability or resolution of the inquiry |
| Graph IR and graph-text inspection | Individual typed entities, ordered sources and resolved targets; the text view follows its bounded `structure-v1` projection | Original prose, literal notes, local use marks or the source constraint distinguishing `/>` from named `challenges` |
| Experimental Reading, Map and Strands | Source occurrences projected from the exact input plus one `explainSource` result; visual topology, selection and local geometry | A new language or persisted inquiry model; moving a mark never edits source or a Bearing |
| Host application | Input revision and mode, source navigation, native editing, storage, evidence and build provenance | Consumer compatibility merely because the public compiler's CI passed |
| Future Cogitatio | Ongoing inquiry, revision, review and continuity require separate contracts | A runtime, resolution protocol or theory API delivered by this Core/CLI release |

Reading needs original source, AST and Explain as well as Graph IR.
Its occurrence addresses and Map's compilation keys belong to the current projection; neither is a durable application identity.
The private View package and site-specific reading interfaces are separate consumers, even when their controls present the same compiled entities.
See the [migration procedure](docs/syntax.md#compatibility-and-migration) and [graph preservation limits](docs/graph-inspection.md#what-structure-v1-preserves).

## Publish npm packages

Releases use [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) from GitHub Actions.
The `Publish npm` workflow runs the full checks and publishes Core before CLI to `latest`.
A tag must match the package version and point to a commit on `main`.
An already published version is skipped on retry; registry failures and attempts to replace a newer `latest` stop the release.
The experimental View package stays private.

Verify the GitHub Actions trusted publisher in the npm settings for both [`@cogitatum/core`](https://www.npmjs.com/package/@cogitatum/core/access) and [`@cogitatum/cli`](https://www.npmjs.com/package/@cogitatum/cli/access); create it if missing:

| Field | Value |
| --- | --- |
| Organization or user | `BaksiLi` |
| Repository | `cogitatum` |
| Workflow filename | `publish.yml` |
| Environment name | Leave empty |
| Allowed actions | Enable **Allow npm publish** |

No npm token or GitHub secret is needed.
A new trusted publisher must complete its first successful publish within two days of creation.

For the 0.6 release, review migration against published 0.5.0 / format 0.5.0, including local Bearing constructors, Q/C relation defaults, retired Gap syntax and regenerated source projections.
Run `npm run check` and `npm run check:publication` on the final integrated commit, with matching Core/CLI versions and the CLI's exact Core dependency.
Passing stacked-PR checks applies to those checked commits and bases; it does not verify a later combined or retargeted head.
Record downstream adoption against the exact public source pin and schema bundle, and rerun affected consumer checks when that pin changes.
Packed-package checks verify the tested API/CLI consumer cases; local publication checks verify licensing and metadata.
Neither establishes npm permissions, native-host readiness or deployed website compatibility.
Core/CLI publication, private View adoption, host releases and website deployment remain separate decisions.

Run `Publish npm` manually in the repository's Actions tab to verify and preview the packages without publishing.
After the version and dependency changes pass CI and merge into `main`, create and push the matching tag:

```sh
git tag v0.6.0 <verified-main-commit>
git push origin v0.6.0
```

Use the actual package version for each subsequent release.
To recover a partially completed release, rerun the failed publishing job.

## Project Cogitatum

Project Cogitatum explores inquiry artefacts: writing that keeps questions, reasons, and unresolved work available for further thought. Inquiry markup is its first public part. Its marks are semi-formal: structure has precise rules while prose remains open to interpretation.

Project Cogitatum investigates how people and AI agents can learn this form of expression and work on the same inspectable, revisable artefacts. The language supplies explicit structure and reusable identities; whether it improves reasoning remains a research question.

Further work under the name **Cogitatio** concerns ongoing inquiry, revision, review, and continuity. Cogitatio and its runtime are not part of this release.

The current development checkout also contains an experimental integration package, marked private and not published with Core/CLI: [`@cogitatum/view`](packages/view/README.md) provides an embeddable, source-linked graph renderer.
It leaves evidence, persistence, review, and application UI with the host.
The checkout compiler uses format 0.6.0; publishing, site deployment and host adoption remain separate.

The public source covers the language, compiler, CLI, schemas, conformance fixtures, selected examples, and these usage documents. Website source and brand assets are maintained and deployed separately; the website renders the public documents and uses the compiler. Research essays, benchmarks, prompts, and runtime experiments are outside this source distribution.

`npm run check:publication` checks local licensing and package metadata separately from compiler verification. This repository is the source of truth for subsequent language and compiler development.
