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
view.setLayout('constellation'); // Optional exploration layout; nodes can be rearranged.
view.resetLayout(); // Discard the local arrangement and fit a freshly settled layout.
view.clear();
// On unmount:
view.destroy();
```

Callbacks receive a projected node with its typed compilation `ref`, optional authored `name`, full text and source span. The renderer neither accepts nor stores evidence. A host resolves evidence against its own proposal or accepted revision, then shows it beside the diagram. Names are scoped to a source unit; compilation keys are not persistent IDs. Compiler spans and transcript/audio evidence remain separate.

Mount once in a React effect, call `update` for each compiled revision, and return `destroy` from cleanup. Recreate the view or use current refs when callback closures change. Each instance appends/removes only its own SVG and has independent markers and event handlers. No DOM access occurs at module import, so server-side imports work.

`update(graph, scope)` takes **one** source unit and requires a host-owned scope identifier. Change `scope` when switching units or artefacts. Named selection is retained within a scope and `onSelect` receives the refreshed node; otherwise `onClear` clears obsolete details. Anonymous keys never retain selection or positions across updates. Initial layouts are deterministic. Same-scope updates may preserve a user-adjusted camera when the previous layout has authored names; otherwise the view fits the graph. It also re-frames when the revised graph would no longer read in view. `setLayout('flow' | 'constellation')` switches and fits without losing selection. Flow (default) is a reading layout: what is borne upon sits above what bears on it and siblings keep source order. Constellation is a settled force layout; while a mark is dragged its neighbours follow (a bounded live relaxation that stops on release). Every Point and every junction can be dragged in both layouts, and Alt + arrow keys nudge it; a press that does not move is a click (select), so dragging never selects or clears. Background drag pans, Ctrl/Command + wheel or a pinch zooms, and the ordinary wheel is left to the page. Positions are view-local and never modify the compiled graph or source; `resetLayout()` discards the arrangement.

`clear()` clears selection and guidance. `select(ref)` accepts a ref from the current compilation only and updates `aria-pressed` synchronously; `fit()` and `zoom(factor)` let the host supply controls. Positions live in world space and the camera maps them to pixels, so marks and wording keep a fixed, readable size at every zoom (14px wording, 12px names); the view frames itself once its container has size, including after being revealed from a hidden panel. Hover/focus/selection highlights a **focus neighborhood**: whole incident Bearings, including all joint sources, without transitive traversal or inference. Guidance only dims temporarily; the declared shapes remain visible. Nodes support arrow-key navigation in source order, Space selection, Enter/double-click navigation and Escape to clear. A Bearing with one source is drawn as its own line with a circular kind symbol, so independent supports stay separate lines even when they reach the same target; a joint Bearing (several sources), an addressed Bearing (the target of `undercuts`/`about`), or a parallel/self-directed one keeps a diamond junction with one input line per source. Lines are never merged into a shared trunk. Motion respects system reduced-motion and an optional host `reducedMotion()` callback. Callbacks and accessible labels retain full text, including collapsed Bearings.

`projectGraph` exposes the incidence graph, and `layoutGraph` / `layoutConstellation` its deterministic layouts for alternate renderers. The default direction is `down`; pass `direction: 'right'` to the view or a second `layoutGraph` argument for horizontal flow. The incidence projection represents each Bearing as a node: multiple input links mean joint sources, and output links can target other Bearings. This is a view representation of Core's first-class relationship object, not a new Core Point. `projectExploration` provides the simplified visual topology and its `inlineBearings`; collapsed output links retain their original `bearingKey`. Use `focusNeighborhood` against the complete incidence projection, including collapsed Bearings. These pure view helpers neither invent transitive connections nor flatten joint support. Core owns typed identities and relation semantics; the view owns visual topology, neighborhood guidance and geometry. Host code should surface compiler diagnostics when rendering a partial graph.

`marks` is the shared vocabulary for every surface: `POINT_MARKS`, `BEARING_MARKS`, `pointMark(label)`, `declarationMark(point.declaration)` and `bearingMark(kind)` give canonical names (docs/glossary.md), auxiliary Chinese readings, glyph shapes and kind symbols; `drawPointGlyph`, `drawBearingGlyph`, `createMarkChip` and `createBearingChip` draw the same glyphs for host chips and lists; `MARK_TYPE` is the type scale. Display names follow the glossary: the `Material` key, matching Graph IR `declaration.form: "material"`, displays as Neutral Point (中性點); keys, label unions and shapes are unchanged identifiers. Shape carries meaning (filled Point, dashed ring for Gap, square for Neutral Point); colour only distinguishes authored support from objection and never judges correctness. `layoutFlow`, `relaxLayout` and `layoutGraphSettled` are the pure layouts the view uses.

CSS is scoped to `.cog-graph` and `.cog-chip`, themed only through `--cog-ink`, `--cog-surface`, `--cog-canvas`, `--cog-muted`, `--cog-line`, `--cog-focus`, `--cog-support` and `--cog-objection` (`--cog-bearing-surface` and `--cog-accent` are no longer read). The host controls container size, full-text/evidence UI and diagnostics. This is a small renderer for inquiry fragments, not a graph editor or a large-workspace layout engine.
