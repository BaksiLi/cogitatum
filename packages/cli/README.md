# @cogitatum/cli

Check Cogitatum inquiry markup and inspect the reasoning connections marked in ordinary prose.

Source candidate: **0.5.0**, format **0.5.0** (unpublished), with local `linked` support and optional linked header descriptions.
Explicit `edge` clauses accept all canonical kind names, including `answers`, `repliesTo`, and `clarifies`.
The historical npm `alpha` tag provides **0.3.0-alpha.1** without linked.
Build this checkout to use the 0.5 candidate API and syntax.
The published 0.4.12 install command below selects the earlier contract. Requires Node.js 22.12 or newer.

Run without a global installation:

```sh
npx --package @cogitatum/cli@0.4.12 cog check inquiry.cog.md
npx --package @cogitatum/cli@0.4.12 cog graph inquiry.cog.md
```

Or, from a source checkout:

```sh
npm ci
npm run build:public
npm run cog:dist -- check examples/getting-started.cog.md
npm run cog:dist -- graph examples/getting-started.cog.md
```

`check` reports syntax and reference diagnostics; `ast` and `graph` print JSON projections. Use `--input host` for mixed Markdown with `cog` fences. Exit status is 0 for success, 1 for source or I/O errors, and 2 for invalid arguments. Diagnostics check the markup, not whether the reasoning succeeds.

Input defaults to `document` independently of file contents; `--input auto` is retired and reports `INVALID_INPUT_MODE`.
Explicit `host` mode selects actual document-level Markdown fences, leaves comments/raw HTML/literal code inactive, and never falls back to parsing the host as an outline.
A host without active regions succeeds with empty projections; actual fences nested in lists or blockquotes are diagnosed and omitted.

For debugging a note, `cog explain inquiry.cog.md` prints an optional Alpha compiler trace: recognition, emitted or rejected points and connections, and the compilation rules involved. This command explains how the markup was compiled. It does not explain the prose or evaluate an argument.

In `document` mode, `ast`, `graph` and `explain` print one AST, Graph IR and Explain projection; `check` prints `{ version, diagnostics }`.
With `--input host`, `ast` and `graph` print the `parseSource` and `compileSource` envelopes, while `check` prints `{ version, mode, diagnostics }`.
Host `explain` prints `{ version, mode, units, explanations, diagnostics }`: a command-specific projection without `documents` or `graphs`, so it is not a source-envelope schema instance.
Validate each `explanations[i]` with the Explain schema, or call `explainSource` for the complete envelope.

In version 0.4.12, opt in to a written-name inventory before reviewing a rename or deciding which names to retain:

```sh
npm run cog:dist -- check --references inquiry.cog.md
npm run cog:dist -- check --references --input host notes.md
```

This option prints the same result as Core's [`analyzeSourceReferences`](../core/README.md#written-name-references): `{ version, mode, units, diagnostics, references }` in either input mode.
When `references.status` is `complete`, `references.units[i]` lists declared names in `units[i]`, their typed entities and declaration locations, and written reference occurrences.
It distinguishes Point/Bearing uses, explicit sources with their zero-based source order, and explicit targets.
Locations cover the containing blocks, not individual name tokens.
Any source or selection error returns `references: { status: 'unavailable', reason: 'source-errors' }`, without misleading empty inventories.

Pass the whole document or host: the inventory cannot discover references outside the supplied input.
An empty reference array is not an unused-name warning or permission to delete the name; external hosts may still rely on it.
The option adds no diagnostics, changes no source, and retains the ordinary `check` exit status.
Without the option, all command output remains unchanged; using it with `ast`, `graph` or `explain` is an argument error.
The inventory is an additional analysis projection, not an extension to any of the four existing JSON Schemas.

Read the [quick start](https://cogitatum.baksili.codes/docs/quick-start), browse [examples](https://cogitatum.baksili.codes/examples), or try the [playground](https://cogitatum.baksili.codes/playground).

## Text inspection (0.5 candidate)

`cog graph --format text inquiry.cog.md` prints one document's compiled structure as an entity table and relation list.
`p1` and `b1` are output-local labels; authored names remain separate fields.
Partial graphs are marked and all graph diagnostics are displayed, retaining the normal 0/1 exit status.
`--format json` is explicit default behavior; existing JSON output is unchanged.
Text output is not a source formatter or interchange decoder.
Host text output is an argument error (exit 2); use host JSON to retain all units and aggregate diagnostics.

## Explicit target preview (0.5 candidate)

`cog explicit-target --line 3 inquiry.cog.md` previews one checked insertion that fixes an ordinary implicit attachment to its current named Point target.
For Markdown, use `cog explicit-target --input host --line 12 notes.md`; the line refers to the complete file.
Output is JSON and the input file is never overwritten.
The same operation is available as Core `previewExplicitTarget`.

A ready preview retains prose, names, occurrence ownership and current relations, but deliberately changes future editing: moving the occurrence retains the explicit target, and changing its role retains the explicit operator.
Compare `originalSource` with the current complete file before applying `proposedSource`; regenerate the preview if the file changed.
The single `edit.offset` uses UTF-16 code units.
Unnamed targets, selectors, Linked constructions, already explicit clauses and relations without a Point-attached operator receive an unavailable result with no proposed source.
Errors anywhere in the complete input also withhold the edit.
Exit 0 means ready; 1 means unavailable or an I/O failure; 2 means invalid options.
`--line` is required and accepts one positive integer; `--format` and `--references` do not apply to this command.
