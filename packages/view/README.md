# @cogitatum/view

Experimental, framework-neutral Map and Reading views of compiler-produced Cogitatum structure.
Core owns parsing and relation semantics; View owns presentation and temporary selection.
Currently available from this checkout, not the published Core/CLI release.

## Host code blocks

`@cogitatum/view/block` composes Reading and Map into one optional code-block preview.
It owns the toolbar, diagnostics, local-occurrence selection, lazy Map, full wording, expansion and cleanup.
Use the lower-level views below for other workflows such as a full document editor.

```ts
import { createBlockView } from '@cogitatum/view/block';
import '@cogitatum/view/style.css';

const block = createBlockView(container, {
  async onEdit({ source, sourceSpan, signal }) {
    await openNativeEditor({ source, sourceSpan, signal });
  }
});
block.element.classList.add('my-host-theme');
block.update(source);
// On unmount:
block.destroy();
```

Supply one document-mode inquiry fragment, without its host Markdown fence.
Each changed source is compiled once and clears selection and pending navigation from the old revision.
Reading/Map mode and the live Map instance survive updates; an empty fragment returns to Reading.
`initialMode` is resolved again after DOM attachment for hosts that construct previews off-DOM.
`onMode` reports user choices so the host can remember a view preference across render-child replacement.
Optional `version: { label, detail }` adds a quiet, expandable build stamp below the preview.
The host supplies installed package versions and source provenance at build time; the shell displays plain text without inferring release status.

Edit and Enter request native source navigation; omitting `onEdit` removes the edit action.
The callback receives the exact source revision, its optional local occurrence span, and a cancellation signal.
Check that signal after asynchronous work, then validate the live native buffer before selecting or focusing it.
Repeated requests are ignored while the same block is opening; revisions and destruction abort that request.
Expansion moves the existing views into a native dialog and returns them before invoking the editor callback.
The shell never writes source, persists selection or creates an editor buffer.
Hosts own native editor reuse, file identity, persistence, theme tokens and host-specific event boundaries.
The shell uses the same `--cog-*` tokens as the views, plus optional `--cog-error`, and adapts to its container width.
An optional `logo` image URL adds a decorative mark that inherits the host's ink through an alpha mask.
Hosts supply and bundle their own approved brand asset.
With `onEdit`, each diagnostic that has a source span also offers Source navigation through the same cancellable editor callback.
Opening source from an expanded preview closes its modal before handing focus to the native editor.

## Map

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
view.resetLayout(); // Discard the local arrangement and restore the automatic reading arrangement.
view.clear();
// On unmount:
view.destroy();
```

Callbacks receive a projected node with its typed compilation `ref`, optional authored `name`, full text and source span. The renderer neither accepts nor stores evidence. A host resolves evidence against its own proposal or accepted revision, then shows it beside the diagram. Names are scoped to a source unit; compilation keys are not persistent IDs. Compiler spans and transcript/audio evidence remain separate.

Mount once in a React effect, call `update` for each compiled revision, and return `destroy` from cleanup. Recreate the view or use current refs when callback closures change. Each instance appends/removes only its own SVG and has independent markers and event handlers. No DOM access occurs at module import, so server-side imports work.

`update(graph, scope)` takes **one** source unit and requires a host-owned scope identifier. Change `scope` when switching units or artefacts. Named selection is retained within a scope and `onSelect` receives the refreshed node; otherwise `onClear` clears obsolete details. Anonymous keys never retain selection or positions across updates. Initial layouts are deterministic. Same-scope updates may preserve a user-adjusted camera when the previous layout has authored names; otherwise the view fits the graph. It also re-frames when the revised graph would no longer read in view. Map is one workflow: automatic placement puts what is borne upon above what bears on it, keeping siblings in source order.
Every Point and junction can then be dragged, or nudged with Alt + arrow keys.
During pointer dragging, the connected component follows with damped attraction and repulsion, including across joint Bearings.
Earlier manual placements and separate fragments stay fixed.
Motion settles within 900 ms of the last movement and stops scheduling frames; reduced motion and keyboard nudges move only the chosen mark.
Reduced motion keeps neighbours still during direct manipulation.
A press that does not move selects; dragging does not select or clear.
Background drag pans, Ctrl/Command + wheel or a pinch zooms, and the ordinary wheel is left to the page. Positions are view-local and never modify the compiled graph or source; `resetLayout()` discards the arrangement.

`clear()` clears selection and guidance. `select(ref)` accepts a ref from the current compilation only and updates `aria-pressed` synchronously; `fit()` and `zoom(factor)` let the host supply controls. Positions live in world space and the camera maps them to pixels, so marks and wording keep a fixed, readable size at every zoom (14px wording, 12px names); the view frames itself once its container has size, including after being revealed from a hidden panel. Hover/focus/selection highlights a **focus neighborhood**: whole incident Bearings, including all joint sources.
For a Point, it also includes the relations directly targeting those incident Bearings, so a step challenge remains visible alongside a content challenge.
This adds exactly one level of context, regardless of relation kind or source order; it does not follow further assessments or relations of neighbouring Points.
For a Bearing, focus includes its own endpoints and direct incoming relations without further expansion. Guidance only dims temporarily; the declared shapes remain visible. Nodes support arrow-key navigation in source order, Space selection, Enter/double-click navigation and Escape to clear. A Bearing with one source is drawn as its own line with a circular kind symbol, so independent supports stay separate lines even when they reach the same target; a joint Bearing (several sources), an addressed Bearing (the target of a Bearing-directed `challenges`, `supports` or `about`), or a parallel/self-directed one keeps a diamond junction with one input line per source. Lines are never merged into a shared trunk. Motion respects system reduced-motion and an optional host `reducedMotion()` callback. Callbacks and accessible labels retain full text, including collapsed Bearings.

`projectGraph` exposes the incidence graph, and `layoutGraph` its deterministic reading arrangement for alternate renderers. The default direction is `down`; pass `direction: 'right'` to the view or `layoutGraph` options for horizontal flow. The incidence projection represents each Bearing as a node: multiple input links mean joint sources, and output links can target other Bearings. This is a view representation of Core's first-class relationship object, not a new Core Point. `projectExploration` provides the simplified visual topology and its `inlineBearings`; collapsed output links retain their original `bearingKey`. Use `focusNeighborhood` against the complete incidence projection, including collapsed Bearings. These pure view helpers neither invent transitive connections nor flatten joint support. Core owns typed identities and relation semantics; the view owns visual topology, neighborhood guidance and geometry. Host code should surface compiler diagnostics when rendering a partial graph.

`marks` is the shared vocabulary for every surface: `POINT_MARKS`, `BEARING_MARKS`, `pointMark(label)`, `declarationMark(point.declaration)` and `bearingMark(kind)` give canonical names (docs/glossary.md), auxiliary Chinese readings, glyph shapes and kind symbols; `drawPointGlyph`, `drawBearingGlyph`, `createMarkChip` and `createBearingChip` draw the same glyphs for host chips and lists; `MARK_TYPE` is the type scale. Display names follow the glossary: the `Material` key, matching Graph IR `declaration.form: "material"`, displays as Neutral Point (中性點); keys, label unions and shapes are unchanged identifiers. Shape carries meaning (filled Point, dashed ring for Gap, square for Neutral Point); colour only distinguishes authored support from objection and never judges correctness. `layoutGraph` owns automatic placement; `relaxLayout` owns bounded local adjustment.
The pre-release layout selector, `GraphLayout`, `setLayout`, `layoutFlow`, `layoutConstellation` and `layoutGraphSettled` have been removed; hosts use the single Map and `resetLayout()`.

Map CSS is scoped to `.cog-graph` and `.cog-chip`, themed only through `--cog-ink`, `--cog-surface`, `--cog-canvas`, `--cog-muted`, `--cog-line`, `--cog-focus`, `--cog-support` and `--cog-objection` (`--cog-bearing-surface` and `--cog-accent` are no longer read). The host controls container size, full-text/evidence UI and diagnostics. This is a small renderer for inquiry fragments, not a graph editor or a large-workspace layout engine.


## Reading

Reading presents the original source in order, with connections at the occurrences where they are used.
Supply the complete original string and its `explainSource` result from the **same revision**:

```ts
import { explainSource } from '@cogitatum/core';
import { createReadingView, projectReading } from '@cogitatum/view';
import '@cogitatum/view/style.css';

const reading = createReadingView(container, {
  onSelect(selection) { showOccurrence(selection.unitIndex, selection.sourceSpan, selection.ref); },
  onClear() { clearDetails(); },
  onNavigate(selection) { openSource(selection.sourceSpan); },
  onNavigateDiagnostic(diagnostic) { openSource(diagnostic.sourceSpan); }
});
const projection = projectReading(originalSource, explainSource(originalSource, 'host'));
reading.update(projection);
// After an edit, recompile and project the entire input again.
// On unmount:
reading.destroy();
```

For editor-to-Reading navigation, call `reading.selectOccurrence(occurrence.id, optionalRef)` using the current projection.
This silently selects the exact local use, body or note; an unknown occurrence clears selection, and a ref belonging to another occurrence throws.
Do not retain occurrence IDs across updates.

`projectReading` is a pure projection, with no DOM access or additional parsing.
It retains every source line, including blank lines, host prose, fences, literal note descendants and malformed lines, alongside the original string.
Occurrences expose their local text, recognition, diagnostics and typed `declares`, `uses` or `constructs` references.
A rejected summary never becomes a selectable graph identity.
Every compiler diagnostic remains available even when it belongs to an omitted host region.
The diagnostic disclosure includes compiler explanations.
Supplying `onNavigateDiagnostic` adds a Source button for each diagnostic with a source span;
updates and destruction retire navigation from the previous projection.
Source and compiler mismatches detectable from the supplied evidence throw; this is not a revision authentication mechanism.
The host must pair the exact input and output, including host text outside selected units.

For an implicit target, the endpoint is the occurrence identified by Core's `implicitAttachment.contextSpan`.
For an explicit target or source operand, it is the canonical declaration/construction.
Joint sources use their own Linked member occurrences.
A local Bearing use remains a local row; a target at the Bearing's construction reaches its junction.
These display locations do not create extra graph entities, independent evidence or inferred relations.
Repeated names and keys in different source units remain separate.

Rendering uses safe plain text by default.
An optional `renderProse` hook on Reading and Block lets a host render the compiler-selected prose with its Markdown engine.
It receives `{ text, container, signal }`; `container` is a block-compatible `div`, initially detached.
It may return a cleanup function, synchronously or asynchronously.
The rendered container is installed only while its revision remains current; updates and destruction abort the signal and release completed renderers.
An asynchronous renderer must observe cancellation and release its host resources; a late result is discarded and its cleanup is still called.
Rendering failure keeps the original plain text.
The host owns supported inline Markdown, link safety and any extensions such as math; backticks remain code and do not imply math.
Raw source, malformed annotations, compiler diagnostics, marks and names never enter this renderer.
Ordinary body prose and note prose may be rendered, including literal note descendants; rendering them cannot create Cogitatum entities.
The complete `raw` line and original source remain in the projection and raw lines are available on occurrence tooltips.
The reading surface presents authored Point names and structured Bearing summaries separately from prose.
A summary names the relationship, its complete source set and its target; multi-source Bearings remain one joint relationship.
Named references are typed controls, with source line and excerpt fallbacks for anonymous endpoints.
A separate reference line quotes shared Point/Bearing content without replacing local wording.
Rejected lines retain their annotation for inspection.
Ordinary structural arcs are faint until selected, and reference-free prose does not dim the document on hover.
This is a reading surface, not a source editor or reconstruction of prose from Graph IR.
There is no drag-to-edit or source-writing operation.

`select(ref, unitIndex = 0)` and `clear()` are silent programmatic operations.
User selection invokes `onSelect` with `{ unitIndex, occurrenceId, sourceSpan, ref? }`; a body or note occurrence may have no graph ref.
`onNavigate` receives the same shape.
Up/Down and Home/End move through occurrences in source order; Left/Right choose among the Point and Bearing references at one occurrence.
Space selects, Enter or double-click navigates to source, and Escape clears.
Each row is a focusable group with a separate selection control; prose links and native controls retain their own mouse and keyboard behavior.
Hover/focus guides the same immediate neighborhood as Map; it does not infer a chain or hide the remaining source.
An occurrence ID, unit index and typed key address only the current projection.
`update` clears occurrence selection and calls `onClear`; it never carries a local occurrence across edits by line number or generated key.
Call `update` on Reading before updating the Map if the host then wants to restore a named Map selection.

For synchronization, let the host track the active unit.
Reading's `onSelect` can call `map.select(selection.ref)` after choosing that unit's graph under a callback guard; Map's `onSelect` can call `reading.select(node.ref, activeUnit)`.
If the same ref returns from Map, Reading keeps the selected local occurrence instead of jumping to its declaration.
Map's programmatic `clear` emits `onClear`, whereas Reading's is silent; connect Map's `onClear` to `reading.clear`, and Reading's user/update `onClear` to `map.clear`.
While switching units, guard Map's `update` callbacks so its synchronous `onClear` cannot erase the just-selected Reading occurrence.
For a Reading selection without a ref, guard Map's `clear` callback for the same reason.
No shared global selection store is required.

Each instance owns its DOM, resize observation and event listeners.
`destroy()` removes only that instance, cancels pending rendering and releases listeners.
Importing the module on a server is safe; creating a view requires a browser DOM.
Reading styles are scoped to `.cog-reading` and use the same `--cog-*` theme properties and shared glyphs as Map.
The host controls available width, surrounding scrolling, active-unit Map state and source navigation.
