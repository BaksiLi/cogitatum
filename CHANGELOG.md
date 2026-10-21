# Changelog

Core and CLI **0.4.12** are published under `latest`, with **format 0.4.0**.
The historical `alpha` tag remains at **0.3.0-alpha.1**.
Earlier 0.4 entries below are unpublished source milestones included in this first 0.4 npm release.
Use the complete released schema set and [migrate retained source](docs/syntax.md#compatibility-and-migration) rather than relabelling old JSON.

## 0.5.0 (unreleased)

- Unify the private View package’s Flow and Constellation into one Map: deterministic reading order, direct movement with bounded neighbour adjustment, and reset to automatic placement.
  Remove the pre-release layout selector and duplicate layout algorithms; geometry remains local and never changes source or Bearings.
  Place shared sources among their targets, reserve room for named junctions, fit labels within the viewport, and route links around marks and wording.

- Add source-aware Reading to the private View package, retaining every original line and distinguishing entity declarations, local uses and Bearing constructions.
  Join source, AST, Explain and Graph IR from one compilation; derive local endpoints from compiler evidence instead of guessing from indentation.
  Share Map's marks, first-class Bearing topology and neighborhood guidance, with silent programmatic Reading selection for host-owned synchronization.
  Include direct relations targeting a Point's incident Bearings in its focus neighborhood, keeping step challenges visible without recursive expansion.
  Nest margin connectors in compact lanes, retain same-line target loops, and keep first-render animation from shifting measured endpoints.
  Enable the Reading entrance fade only when the system permits motion, including preference changes after mounting.
- Record the selected occurrence for every successful structural Bearing in Explain's `implicitAttachment`, including direct containment with an empty `crossedBodySpans`.
  Only crossings of ordinary body produce the existing advisory; explicit and rejected relations do not acquire implicit-selection evidence.
  Formalize the per-unit AST / Explain occurrence correspondence for the unpublished 0.5 contract.

- **Breaking:** unify canonical negative relations as `challenges`, with Point or Bearing targets.
  Preserve authored `->` and `/>` constraints in AST `operatorClause.targetKind` through validation.
  Named `challenges` accepts either target; named `undercuts` is retired with an error and migration guidance to `/>`.
  `CHALLENGE_REQUIRES_BEARING_TARGET` replaces the old undercut-specific target diagnostic.
  Align public AST TypeScript unions with schema target constraints, including Point declarations and uses.
- Reject invalid or overflowing parser source offsets with `RangeError`, keeping malformed coordinates out of AST, Graph and Explain.
  Document the public source-mapping options and retain zero defaults for missing offsets.
- Explain why explicit-target previews decline Linked headers and source members while retaining their existing machine-readable refusal reasons.
- Propagate failed Bearing targets through their dependents without repeatedly scanning the complete graph.
  Preserve independent relations, valid cycles and the existing diagnostic order.
- Align Explain's Point-use selector type with AST and schema: only local G and O roles may select a Bearing attachment.
  Check both accepted and rejected combinations in the installed package's TypeScript contract.
- Advance AST, Graph IR, Explain and source envelopes to format 0.5.0 with matching schemas and View marks.
  Recompile original source rather than relabelling 0.4 JSON; consumers distinguish negative targets through `target.kind`.
  See the [migration reference](docs/syntax.md#compatibility-and-migration) and [version policy](README.md#version-policy).
- Keep suffix-only local Bearing commentary through `O/`; bare `O` retains its Point-context default.
- Align release checks with independent package and format versions, retaining schema identity, dependency and lockfile consistency checks.
- Add Core `formatGraph` and opt-in `cog graph --format text` for single-document structural inspection.
  The versioned structure-v1 projection preserves individual entities, declaration metadata, names, text, ordered sources and typed targets, and visibly marks partial graphs with diagnostics.
  This formatter adds no further JSON/schema change; host text, source reconstruction and rewriting remain outside its scope.
- Add `previewExplicitTarget` and `cog explicit-target --line` for one checked, source-preserving target-clause preview.
  The operation retains current relations and occurrence prose while explicitly changing future move/role-edit behavior.
  It refuses unsupported or erroneous input and never overwrites files.
  Locate host edits using Markdown's LF, CRLF and CR line endings, preserving the original separators and UTF-16 offsets.
- Clarify CLI input/output, exit status, the distinction between output formatting and source editing, and the boundary between deterministic tools and interpretation assistance.
  Expand executable tutorials for Point versus Bearing challenges, Linked, Serial, reused evidence and deliberate edits without inventing implicit premises.
- Add a repository-only interpretation experiment that preserves original Bearings under two explicitly assumed readings.
  It is research evidence, not a public theory API, an LLM command or a general reasoning validator.

## 0.4.12 — 13 October 2026 · published

- Publish the first 0.4 Core and CLI packages through GitHub Actions trusted publishing, with provenance.
  Syntax and JSON contracts differ from published 0.3 and earlier source candidates; reparse retained source against the released compiler and schemas.
- Add opt-in written-name reference inventories through Core's `analyzeSourceReferences` and `cog check --references`.
  Point and Bearing declarations retain their typed identities and locations; references distinguish uses, ordered explicit sources and explicit targets within each source unit.
- Decline the inventory on any source or selection error, without introducing an unused-name diagnostic or removing names.
  Literal notes, prose mentions and implicit connections do not count as written references.
- **Compatibility:** this is an additive API and CLI option; ordinary command output, diagnostics, syntax and all four existing schema contracts are unchanged.
  Published packages advance together to 0.4.12; format remains 0.4.0.
  This release fixes the published 0.4.0 schema contract; later incompatible contracts need a new format identifier.

## 0.4.11 — 13 October 2026

- Retain recognised annotations at invalid indentation as failed boundaries, preventing implicit descendants from attaching to an outer Point.
  Independent explicit relations and valid inner subtrees still survive.
- Map block, diagnostic and graph spans to the actual content column after variable bullet spacing, including host fences.
- Keep malformed-use error categories unique so parser output satisfies the AST schema, without dropping diagnostics or retirement guards.
- Allow repeated sources in rejected Explain summaries while continuing to reject them in emitted Bearings; remove the unsupported `retired` derivation value from the Explain schema.
- **Migration:** reparse affected source and use the complete schema bundle from this candidate.
  Format remains unpublished 0.4.0; these corrections do not make earlier candidate JSON interchangeable.

## 0.4.10 — 13 October 2026

- Treat bracketed words that merely begin with a mark letter, such as `[O-ring]`, `[C++]` or `[G/O ratio]`, as ordinary body; the pre-0.3 `scope` prefix is also body, without a diagnostic.
  Complete marks and keywords stay reserved, so `[C major]` or `[edge cases]` remain diagnosed.
- Keep the Point when an operator lacks its spaces, as in `[O->@claim]`, rejecting only the clause; this changes some partial graphs.
- Make diagnostics more actionable, including explicit spellings that preserve the selected target; codes and severities are unchanged, but the affected sources can produce a different set of diagnostics.
- Require `operatorClause` on an undiagnosed `edge` in the AST schema, and align the docs and View display names with the glossary, such as Neutral Point; machine keys are unchanged.
- **Migration:** reparse retained source; do not reuse stored AST, Graph IR or Explain.
  See [#31](https://github.com/BaksiLi/cogitatum/pull/31).

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
