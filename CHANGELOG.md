# Changelog

Published Core and CLI **0.5.0** use **format 0.5.0**.
This checkout prepares **0.6.0 / format 0.6.0**.
The historical `alpha` tag remains at **0.3.0-alpha.1**.
Earlier 0.4 entries below are unpublished source milestones included in this first 0.4 npm release.
Use the complete released schema set and [migrate retained source](docs/syntax.md#compatibility-and-migration) rather than relabelling old JSON.

## Unreleased

**Migration from published 0.5.0:** review newly reserved `point`, `node`, `bearing`, `edge use`, and typed note headers before recompiling retained source.
Former body can become a Point and change a descendant's implicit target; notes make their entire subtree literal.
Keep intended prose outside leading reserved brackets, and do not automatically promote use tail prose into object notes.
Recompile all projections with the complete 0.6 bundle; changing a JSON version is not migration.
The original published schemas remain unchanged in `spec/0.5.0/`.

- Share one family/operation grammar across `point` / `node` / `.`, and `bearing` / `edge` / `_`, including construction, use, notes and malformed boundaries.
- Add `[. note]` and `[_ note]`, selecting one slot from the nearest semantic context.
  Reject missing or failed local targets without outward fallback; direct linked Grounds own no unary attachment.
  Preserve literal note subtrees, anonymous objects, fixed Bearing use endpoints and separate equal-text records.
- Add source-backed `GraphIR.notes` records and Explain selection/attachment effects.
  The AST owns prose and literal subtrees; existing edge/linked descriptions use the same provenance projection.
  `Bearing.text` derives only from constructor prose.
  Complete source exports preserve all note content; graph-only exports omit note prose and graph-text `structure-v1` omits note records too.
  Add `cog export` for the complete selected-source/AST/graph/Explain envelope in document and host modes.
- Keep source order in private View Reading, with links to original notes from declarations and uses.
  Show note counts on Map marks and note content/source navigation in block details.
  Explicit-target previews preserve exact note origins and targets; written-reference analysis ignores literal descendants.
- Accept contiguous indented continuation lines and paragraphs in Points, body, use prose, Bearing descriptions and notes.
  Newlines preserve existing content ownership and never create an implicit note.
  Parse annotations only on bullet headers, keep note subtrees literal, and reject continuation that would reopen an ancestor after a child.
  Extend block spans through their own continuations; Reading presents one complete occurrence without duplicate lines.
  Explicit-target previews selected from a continuation edit the owning header.
  Recompile retained drafts and adapt consumers that assume one physical line per occurrence.
- Consumer verification is scoped to the checkout Core/CLI, packed packages and private View.
  No npm publication, website deployment or installed Obsidian migration is included.
  The finite interpretation fixture is rechecked against 0.6 without extending its theory or changing its source.

- Keep a selected Point or Bearing as the private View's guided focus in Reading and Map; hover and keyboard focus preview only while nothing is selected.
  Selecting one of several alternative Bearings to a target shows that route, its sources and only the relations addressed to it, by Bearing identity.
  Emphasis marks only what is being examined, adds no confidence or outcome state, and leaves source, Graph IR and the published contracts unchanged.
- Explain invalid outline levels before suggesting an independent explicit attachment.
  Preserve diagnostic codes, spans, partial graphs and failed-constructor boundaries.
- Present typed Point references and Bearing summaries separately from prose in the private View.
  Retain joint sources, Bearing targets and local reference occurrences without leaking constructor punctuation into reading text.
- Add an optional host prose renderer for Reading and full Map passages, with plain-text fallback, cancellation and cleanup.
  Keep native prose interactions separate from Cogitatum selection; raw source, diagnostics and compact Map labels remain plain text.
  These presentation changes preserve the published 0.5 language and format contracts.
- Show compiler explanations in Reading's diagnostic disclosure, with optional source navigation.
  Retire diagnostic navigation when the source projection changes or the view is destroyed.
- Connect code-block diagnostic Source actions to the host's cancellable editor callback.
  Allow hosts to supply a decorative logo mask that follows their theme ink.

## 0.5.0 — 23 October 2026

**Migration from published 0.4.12 / format 0.4.0:** replace active named `undercuts` clauses with `/>` to retain their Bearing-only requirement, then recompile original source with the complete 0.5 compiler and schema bundle.
Do not rename kinds or relabel versions in saved JSON as an upgrade.
Consumers now distinguish negative targets through `challenges` plus `target.kind`; update the renamed target diagnostic and rebuild source/Reading projections.
See the [migration procedure and executable example](docs/syntax.md#compatibility-and-migration).

The npm release comprises Core and CLI.
View remains private and experimental; its inclusion below records source changes, not a published package, host adoption or website deployment.
Interpretation research does not introduce a Cogitatio runtime or a public theory API.

- Add the optional `@cogitatum/view/block` preview shell for native host adapters.
  Share Reading/Map controls, diagnostics, expansion and cancellable Edit requests while native editors and storage remain host-owned.
  Keep the Playground Lens independent of this code-block preview.
- Preserve Unicode line and paragraph separators inside prose and fence metadata.
  Keep literal note boundaries and exact edit-preview content intact, and project the same source in Reading.
- Retain the selected reference and keyboard entry when refocusing or clearing Reading and Map.
  Accept assistive Map activation without a pointer gesture, and discard hover addresses from older compilations.
- Let unheld nodes in a dragged Map component settle with bounded damping, including through joint Bearings.
  Keep held and unrelated nodes fixed; reduced motion and keyboard nudges move only the chosen mark.
  Cancel settling and captured pointer gestures when the source revision changes.
- Unify the private View package’s Flow and Constellation into one Map: deterministic reading order, direct movement with bounded neighbour adjustment, and reset to automatic placement.
  Point wording, its line gaps and named Bearing labels share the node’s selection and drag behavior, with measured hit areas that disappear when wording is hidden.
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
  Formalize the per-unit AST / Explain occurrence correspondence for the 0.5 contract.

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
