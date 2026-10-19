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

## Choose a command

Every command reads one source file, runs locally without an LLM and leaves that file unchanged.
An agent can call the same commands as a person; no model account, API key or model inference is involved.

| Command | Purpose |
| --- | --- |
| `check` | Check syntax and references, returning diagnostics |
| `check --references` | Also inventory written names and their resolved references |
| `ast` | Inspect ordered source blocks, annotations and occurrence prose |
| `graph` | Compile source and return its Point-Bearing structure as JSON |
| `graph --format text` | Present one compiled document as readable entity and relation tables |
| `explain` | Inspect why the compiler emitted or rejected a construction |
| `explicit-target --line N` | Preview one checked source edit, including its consequences |

`graph` consumes Cogitatum source, not a saved Graph IR JSON file.
`--format` chooses how the result is printed; it does not format source or change the relations being compiled.
Use `--input host` for mixed Markdown with `cog` fences.
Use `--` before a filename beginning with a dash.
The CLI accepts one file; it has no stdin or batch-input mode.

## Output and exit status

Results and structured source/option diagnostics go to stdout.
An I/O failure writes a message to stderr and may produce no JSON; check the exit status before assuming stdout contains a result.
Missing command/file usage is printed to stderr; requested help is printed to stdout.
Exit status is 0 for successful checks/inspection or a ready preview, 1 for source/I/O errors or an unavailable preview, and 2 for invalid or missing arguments.
An unavailable preview may have valid source; inspect its `reason` and `message`.
Warnings and suggestions do not fail ordinary checks, and an error-bearing graph is only the surviving partial structure.
Diagnostics check the markup, not whether the reasoning succeeds.

Input defaults to `document` independently of file contents; `--input auto` is retired and reports `INVALID_INPUT_MODE`.
Explicit `host` mode selects actual document-level Markdown fences, leaves comments/raw HTML/literal code inactive, and never falls back to parsing the host as an outline.
A host without active regions succeeds with empty projections; actual fences nested in lists or blockquotes are diagnosed and omitted.

For debugging a note, `cog explain inquiry.cog.md` prints an experimental compiler trace: recognition, emitted or rejected points and connections, and the compilation rules involved.
Experimental describes this interface's maturity, not the installed package's release tag; its current data still follows the matching Explain schema.
This command explains how the markup was compiled, without interpreting the prose or evaluating an argument.

| JSON command | `document` output | `host` output |
| --- | --- | --- |
| `check` | `{ version, diagnostics }` | `{ version, mode, diagnostics }` |
| `ast` | One AST | `parseSource` envelope with units and documents |
| `graph` | One Graph IR | `compileSource` envelope with units, documents and graphs |
| `explain` | One Explain trace | `{ version, mode, units, explanations, diagnostics }` |
| `check --references` | Reference-analysis result | Reference-analysis result, with independent units |
| `explicit-target` | Ready/unavailable preview | Ready/unavailable preview, using complete-file line numbers |

Host `explain` is a command-specific projection without `documents` or `graphs`, so it is not a source-envelope schema instance.
Validate each `explanations[i]` with the Explain schema, or call Core `explainSource` for the complete envelope.
The reference-analysis and preview result contracts are documented below and exported as Core TypeScript types; they are not additional instances of the four existing JSON Schemas.

## Written-name inventory

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

## Using the CLI from an assistant

An LLM can propose a reconstruction, a wording revision or a reading of a passage, then call `check`, `graph` and `explain` to inspect the represented result.
`check --references` helps it locate written dependencies; `explicit-target` provides one deterministic edit with its own preservation checks.
Keep original source and complete command results, and distinguish a valid compilation from a faithful reconstruction or sound inference.
Graph text omits ordinary body, notes and occurrence-local prose, so it cannot substitute for the source when reviewing meaning.

Interpretation, supplying an unstated premise or deciding whether to move a reason to another conclusion remains an attributable authoring choice.
A future model-assisted workflow should expose its source selection, assumptions and proposed change separately from deterministic checks; no such model command is currently shipped.
The repository-only `npm run probe:interpretation` checks explicit finite interpretations without an LLM and is not an installed `cog` command.
See [writing with an assistant](../../docs/writing-style.md#work-with-an-assistant) for the authoring boundary.
