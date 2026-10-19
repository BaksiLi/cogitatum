# Repository guidance

## Compatibility and releases

Follow the public [version policy](README.md#version-policy).
During 0.x, an incompatible change to a published language, API or CLI contract requires the next minor package version; compatible additions and fixes may use a patch.
Assess changes against the published baseline, not only the previous development commit.
Change the format identifier when a published syntax or AST/Graph IR/Explain/source contract becomes incompatible.
Do not bump it for implementation or tooling changes that preserve those contracts, or relabel old JSON as a migration.
Keep parser behavior, public types, schemas, diagnostics, consumers and executable examples aligned with the selected contract.
Retired spellings must retain diagnosed boundaries; do not add compiling compatibility aliases.
Record the migration and the scope of verified consumer compatibility in the changelog and relevant reference docs.

## Verification

Use the checks described in [Work on the project](README.md#work-on-the-project).
Run `npm run check` before delivery, and `npm run check:publication` for release metadata changes.
Public tutorials live in `docs/`; the website consumes the pages listed in `docs/manifest.json`.
Keep runnable language examples marked with `cog-check`, and distinguish implemented commands from research experiments and proposed tools.
