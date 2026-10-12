# Changelog

The 0.4 entries below are unpublished source milestones, not npm releases; a shared preview is not a package release either.
As of 12 October 2026, npm provides only Core and CLI **0.3.0-alpha.1**, under both `alpha` and `latest`.
The current **0.4.9** candidate retains **format 0.4.0**: match compiler, schemas and consumers to the same source revision, and [migrate retained source](docs/syntax.md#compatibility-and-migration) rather than relabelling old JSON.

## 0.4.9 — 12 October 2026

- Add literal `[note]` subtrees for quotations and supplementary prose, owned by their source occurrence.
  Markup inside them stays literal and creates no Points or connections; reusing an identity does not copy its notes.
- Suggest making an implicit attachment explicit when it crosses ordinary prose, only after validating the actual connection.
  These suggestions do not block compilation.
- **Breaking:** reserve `[note]` and retire `C?`.
  Review existing note regions; deliberately replace `C?` with `C` where appropriate, removing Claim openness without asserting certainty.
  Invalid constructors still prevent accidental attachment to an outer Point; Gap remains open.
- Add a worked reconstruction of the cyclical argument in Plato's *Phaedo*.
  See [#28](https://github.com/BaksiLi/cogitatum/pull/28).

## 0.4.8 — 11 October 2026

- Distinguish how a Point was declared from how it is used locally: a Claim can later serve as a Ground without changing its declaration.
- **Breaking for integrations:** move Graph IR Point `form`, `role` and `status` into `declaration`.
  Update consumers and reparse stored source; local use marks remain in AST and Explain data.
  See [#24](https://github.com/BaksiLi/cogitatum/pull/24).

## 0.4.0-alpha.7 → 0.4.0 — 11 October 2026

- Extend the experimental, unpublished `@cogitatum/view` with reading layouts, shared Point and Bearing marks, and source-linked navigation while preserving joint support.
- Rework the API timeout and assay examples to show evidence reuse and joint reasons, and correct the source-checkout CLI commands.
  See [#22](https://github.com/BaksiLi/cogitatum/pull/22).
- Change package numbering from `0.4.0-alpha.7` to `0.4.0` without changing language semantics or schemas.
  Subsequent candidates use ordinary patch numbers; historical alpha labels are not releases `0.4.1`–`0.4.7`.

## Earlier 0.4 development — grouped history, 25 September–11 October 2026

This groups changes after the published 0.3 baseline through `0.4.0-alpha.6`, including the `0.4.0-alpha.1`–`0.4.0-alpha.6` development labels.

- Add neutral Points (`[.]`, `[. @p]`) and Point or Bearing reuse (`[. use @p]`, `[G use @p]`, `[_ use @route]`), keeping shared content separate from local prose.
- Add joint reasons with `linked`, local connection selectors `G/` and `O/`, and all canonical Bearing kinds through `[_ ...]` or `[edge ...]`.
- Add a source-envelope schema and an experimental graph renderer for integrations.
  Make source context explicit: `document` by default or `host` for selected Markdown fences, preserving original source locations; remove content-dependent `auto`.
- Reject invalid operators and preserve failed constructor boundaries, so malformed structure cannot silently attach descendants to an outer Point.
  Valid independent content remains available in the partial graph.
- **Migration:** replace anchor-only `[@p]` with `[. @p]` and `_>` with `/>`.
  Earlier candidates' `join`, `[use @p]` and `G_` / `O_` become `linked`, `[. use @p]` and `G/` / `O/`; these are not accepted aliases.
  Published 0.3 treated `join` as ordinary prose, so review intended grouping before migrating.
  See [#13](https://github.com/BaksiLi/cogitatum/pull/13).

## 0.3.0-alpha.1 — 8 September 2026 · published Public Alpha

- Publish `@cogitatum/core` and `@cogitatum/cli` with format `0.3.0`: mark selected reasoning inside ordinary prose and compile documents or Markdown host input.
- Provide AST, Graph IR, diagnostics and their public schemas, with CLI `check`, `ast`, `graph` and optional `explain` output for compiler decisions.
- Give every Point and Bearing a compilation-local `key`; authored names populate Point `id` or Bearing `handle`, and references use `{ key, kind }`.
  **Migration from format 0.2:** reparse source and do not persist compilation keys as stable identities across edits.
