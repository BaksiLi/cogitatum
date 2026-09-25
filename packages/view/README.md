# @cogitatum/view

Experimental, framework-neutral SVG rendering of compiler-produced Cogitatum Graph IR. No source parsing, inference, application state or persistence. Currently available from this checkout, not the published Core/CLI release.

```ts
import { createGraphView } from '@cogitatum/view';
import '@cogitatum/view/style.css';

const view = createGraphView(container, {
  onSelect(node) { showDetails(node.text, hostEvidenceFor(node.ref.kind, node.name)); },
  onClear() { clearDetails(); },
  onNavigate(node) { highlightGeneratedSource(node.sourceSpan); }
});
view.update(compiled.graphs[0], 'inquiry-1:unit-1');
view.fit();
// On unmount:
view.destroy();
```

Callbacks receive a projected node with its typed compilation `ref`, optional authored `name`, full text and source span. The renderer neither accepts nor stores evidence. A host resolves evidence against its own proposal or accepted revision, then shows it beside the diagram. Names are scoped to a source unit; compilation keys are not persistent IDs. Compiler spans and transcript/audio evidence remain separate.

Mount once in a React effect, call `update` for each compiled revision, and return `destroy` from cleanup. Recreate the view or use current refs when callback closures change. Each instance appends/removes only its own SVG and has independent markers and event handlers. No DOM access occurs at module import, so server-side imports work.

`update(graph, scope)` takes **one** source unit and requires a host-owned scope identifier. Change `scope` when switching units or artefacts. Named selection is retained within a scope and `onSelect` receives the refreshed node; otherwise `onClear` clears obsolete details. Anonymous keys never retain selection across updates. The deterministic layout avoids simulation jitter; the camera is retained within a scope. `select(ref)` accepts a ref from the current compilation only; `fit()` and `zoom(factor)` let the host supply controls. Nodes support arrow-key navigation, Space selection, and Enter/double-click navigation; background drag pans, Ctrl/Command + wheel zooms. Labels may be shortened in the diagram; callbacks and accessible labels retain full text.

`projectGraph` exposes the incidence graph and `layoutGraph` its deterministic layout for alternate renderers. The default direction is `down`; pass `direction: 'right'` to the view or a second `layoutGraph` argument for horizontal flow. Each Bearing is a node: multiple input links mean joint sources, and output links can target other Bearings. Neither function invents transitive connections or flattens joint support. Host code should surface compiler diagnostics when rendering a partial graph.

CSS is scoped to `.cog-graph`, with `--cog-surface`, `--cog-bearing-surface`, `--cog-ink`, `--cog-line`, and `--cog-accent` theme properties. The host controls container size and full-text/evidence UI. This is a small renderer for inquiry fragments, not a graph editor or a large-workspace layout engine.
