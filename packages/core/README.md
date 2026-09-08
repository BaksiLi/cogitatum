# @cogitatum/core

Cogitatum is a lightweight markup language for making selected reasoning structure explicit inside ordinary prose. This package provides its deterministic parser and compiler for Node.js and browsers.

Public Alpha source release: **0.3.0-alpha.1**, format **0.3.0**. Installation from npm becomes available after publication.

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

`parseSource` and `compileSource` support input modes; host mode compiles document-level Markdown `cog` fences independently. ESM; Node.js 22.12 or newer for development and CLI use.

Optional Alpha debugging APIs, `compileGraphWithExplain` and `explainSource`, add a compiler trace of recognition, emitted or rejected entities, and diagnostics. This trace explains compilation decisions; it does not assess reasoning or record inquiry history. Use AST and Graph IR for integrations that do not need it.

AST blocks keep their semantic fields only in `annotation`; source `raw` and block text are retained separately. Reparse older source to migrate from format 0.2.0. The compiler rejects ASTs with a different format version.

The package includes self-contained draft 2020-12 JSON Schemas for offline integration:

```js
import astSchema from '@cogitatum/core/schemas/ast' with { type: 'json' };
import graphSchema from '@cogitatum/core/schemas/graph-ir' with { type: 'json' };
import explainSchema from '@cogitatum/core/schemas/explain' with { type: 'json' };
```

Schemas describe individual projections, not multi-unit envelopes. They check data shapes; reference integrity and agreement with source require compiler-level checks. Keys are opaque strings: their numbering is not an integration contract. Store application metadata separately from canonical compiler output.

Read the [introduction](https://cogitatum.baksili.codes/docs/introduction), [syntax](https://cogitatum.baksili.codes/docs/syntax), or try the [playground](https://cogitatum.baksili.codes/playground).
