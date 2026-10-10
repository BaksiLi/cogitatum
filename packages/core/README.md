# @cogitatum/core

Cogitatum is a lightweight markup language for making selected reasoning structure explicit inside ordinary prose. This package provides its deterministic parser and compiler for Node.js and browsers.

Source candidate: **0.4.0-alpha.6**, format **0.4.0**, with local `linked` support and optional linked header descriptions.
Explicit `edge` clauses can use any canonical kind name; Point-attached clauses retain the four symbolic operators.
Reference-only `[. use @p]` or locally marked `[G use @p]` occurrences resolve an existing Point without copying its subtree or changing declaration metadata.
Bare use focuses without a default attachment; G/ and O/ select only the nearest constructor's owned attachment.
Occurrence prose, local marks and original UTF-16 spans remain in AST/Explain; focusPoint maps each use to a typed Point ref, and rejectFocus explains lookup failure.
Canonical Point spans remain declaration spans; several uses may map to the same Point.
This candidate is not yet published; npm `alpha` currently provides **0.3.0-alpha.1** without linked.

```sh
npm install @cogitatum/core@alpha
```

```js
import { parseDocument, compileGraph } from '@cogitatum/core';

const source = `- We are checking the deployment before changing the database.
  - [C @cause] The connection pool may be exhausted.
    - [G] The logs show connection acquisition failures.
`;
const graph = compileGraph(parseDocument(source));
console.log(graph.points, graph.bearings, graph.diagnostics);
```

Ordinary body stays in the source AST; only marked structure produces graph entities. `supports` records a positive bearing without certifying an inference or choosing its method.

Every Point and Bearing has a compilation-local `key`. Only authored Point anchors populate `id`; only authored route names populate a Bearing's `handle`. Graph references use `{ key, kind }`. Keys must not be persisted as stable references across revisions or source units.

`parseSource`, `compileSource`, `explainSource`, and `extractCogitatumSourceUnits` default to the owned `document` context.
Pass `host` explicitly for Markdown: actual document-level `cog`/`cogitatum` fences compile independently; comments, raw HTML, and literal code remain inactive.
Nested active fences are diagnosed and omitted; a host with no active regions returns empty projections without parsing host prose as an outline.
`auto` is retired and explicit JavaScript uses receive a `TypeError` with migration guidance.
Keep the original host and pair selected units with AST/Graph/Explain by array index; source spans refer to original one-based UTF-16 positions.
ESM; Node.js 22.12 or newer for development and CLI use.

Optional Alpha debugging APIs, `compileGraphWithExplain` and `explainSource`, add a compiler trace of recognition, emitted or rejected entities, and diagnostics. This trace explains compilation decisions; it does not assess reasoning or record inquiry history. Use AST and Graph IR for integrations that do not need it.

AST blocks keep their semantic fields only in `annotation`; source `raw` and block text are retained separately. Reparse older source to migrate from format 0.2.0. The compiler rejects ASTs with a different format version.

`OperatorClause.op` holds the canonical selected `BearingKind`; edge sources are existing Point references, and self-sourced Point annotations admit only symbolic `BearingOp` kinds.
Using a Point as an explicit source preserves its declaration metadata; indentation defaults do not add global role restrictions to explicit construction.
Match this unpublished candidate's schemas and source ref even when an older candidate also reports format `0.4.0`.

The package includes self-contained draft 2020-12 JSON Schemas for offline integration:

```js
import astSchema from '@cogitatum/core/schemas/ast' with { type: 'json' };
import graphSchema from '@cogitatum/core/schemas/graph-ir' with { type: 'json' };
import explainSchema from '@cogitatum/core/schemas/explain' with { type: 'json' };
import sourceSchema from '@cogitatum/core/schemas/source' with { type: 'json' };
```

The current source checkout also includes `sourceSchema`, which covers the `parseSource`, `compileSource`, and `explainSource` result envelopes and refers to the AST, Graph IR, and Explain schemas by their `$id`; load those sibling schemas into a validator before compiling it. The envelope keeps source units and projections in parallel arrays, paired by index. Schemas check data shapes; array alignment, reference integrity, and agreement with source remain compiler guarantees. Keys are opaque strings: their numbering is not an integration contract. Store application metadata separately from canonical compiler output. This envelope export is new in the development branch and is not in the published npm `0.3.0-alpha.1` tarball.

Read the [introduction](https://cogitatum.baksili.codes/docs/introduction), [syntax](https://cogitatum.baksili.codes/docs/syntax), or try the [playground](https://cogitatum.baksili.codes/playground).
