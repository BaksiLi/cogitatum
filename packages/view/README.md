# @cogitatum/view

Experimental, framework-neutral Map, Reading and Strands views of compiler-produced Cogitatum structure.
Core owns parsing and relation semantics; View owns presentation and temporary selection.
Currently available from this checkout, not the published Core/CLI release.
The 0.6 checkout requires matching Core/format 0.6 projections.
Core selects Bearing construction, reuse or note mode from the first token after `bearing` / `edge` / `_`.
A constructor such as `[_ +> ^]` produces a Bearing from its direct neutral members, or from listed sources in `[_ @a, @b +> ^]`; a singleton is complete and header prose supplies `Bearing.text`.
View consumes AST `kind: "bearing"` with its `members` flag, and Explain `localBearingMember` / `local-bearing-containment` membership classifications.
Convergent, Linked and Serial describe graph structures; source arrays and junctions convey participation, not strength or success.
Reading retains typed notes in source order and provides links to their original passages from declarations and uses.
`ReadingUnit.notes` joins each Core note record to existing source occurrences; reuse creates no copied note.
Map marks show typed note counts, and the block preview's details include their full content and source navigation.
`Point.text` remains the primary content; constructor descriptions remain distinct from typed notes.
Hosts using only `createGraphView` receive `GraphNode.noteCount` and must use the complete source/Reading projection to display note prose.

## Host code blocks

`@cogitatum/view/block` composes Reading, Map and Strands into one optional code-block preview.
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
The chosen mode (`reading`, `map` or `strands`) and the live Map instance survive updates; an empty fragment returns to Reading.
Selection is shared across the three modes; Challenge Focus stays within Strands.
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
Placement uses contest geometry: support stacks beneath its target, which stands centred over what supports it,
while a challenge sits one layer down on the target's right flank, so disagreement reads as an approach from the side.
Unconnected Points wait on their own shelf beneath the connected argument.
Endings (Points that bear on nothing and have something bearing on them) are drawn larger with weighted wording and always get the wide measure.
Below reading scale the overview keeps an ending's wording on one line and every other Point's authored `@name`; anonymous Points show their mark only.
A challenge ends in a bar across its line rather than an arrowhead. A collapsed Bearing rests as a small tone dot on its line
and opens to its full glyph on hover, focus, selection or guidance; its line remains the selection target.
`GraphLink.kind` carries the Bearing's relation for renderers and layouts.
Every Point and junction can then be dragged, or nudged with Alt + arrow keys.
During pointer dragging, only the junctions of the held mark's own Bearings re-centre, so the rest of the Map stays where the reader is inspecting it.
Hold Shift to pull the step instead: those Bearings' other endpoints follow with damped attraction and repulsion, but nothing further than one step.
Earlier manual placements and separate fragments stay fixed.
Motion settles within 900 ms of the last movement and stops scheduling frames; reduced motion and keyboard nudges move only the chosen mark.
Reduced motion keeps neighbours still during direct manipulation.
A press that does not move selects; dragging does not select or clear.
Background drag pans, Ctrl/Command + wheel or a pinch zooms, and the ordinary wheel is left to the page.
During a continuous zoom, wording and its hit areas stay in place, then reflow when the wheel rests or the pinch ends.
A pinch keeps the world point under its midpoint; either finger can leave first, and the other continues panning from that view.
Cancellation, lost capture, camera controls, source update and destruction end the old gesture and release its contacts.
A replacement graph with no continuing named items gets its own fitted view.
Positions are view-local and never modify the compiled graph or source; `resetLayout()` discards the arrangement.

`clear()` clears selection and guidance.
`select(ref)` accepts a ref from the current compilation only and updates `aria-pressed` synchronously; `fit()` and `zoom(factor)` let the host supply controls.
Positions live in world space and the camera maps them to pixels.
Wording retains its CSS reading size (14px wording, 12px names by default); line height follows the host font size, while Point glyphs scale within bounds.
Map wording renders single-backtick inline code in monospace; longer backtick delimiters remain literal.
This presentation preserves full authored text in callbacks, accessible labels and source.
At close zoom, captions allow three lines; farther out, they use two, then hide until focused.
The view frames itself once its container has size, including after being revealed from a hidden panel.
A tall map in a full panel opens at reading scale near its conclusion so the reader can pan through it.
Explicit `fit()` instead includes the complete drawing, even below the manual zoom minimum.
Keyboard focus pans the mark and its wording into view without scrolling the host page.

Optional `entrance: true` reveals the first drawing when it comes into view, with marks followed by traced connections.
Inspection or a camera gesture completes that decoration immediately, so selection guidance and complete routes remain available.
System reduced motion skips or ends entrance; a host `reducedMotion()` callback is checked on each frame.
An uninterrupted entrance becomes idle when finished, and destruction cancels pending frames and observation.

Selection highlights a **focus neighborhood**: whole incident Bearings, including all joint sources.
Selection is what the reader is examining, so it keeps the guidance until it changes or is cleared (Escape or a background press).
Hover and keyboard focus preview a neighborhood only while nothing is selected; during a selection a pointed or focused unrelated mark only lifts itself so it stays readable and selectable.
`guidanceSubject(selected, previewed)` is that shared rule, used by both Map and Reading.
For a Point, it also includes the relations directly targeting those incident Bearings, so a step challenge remains visible alongside a content challenge.
This adds exactly one level of context, regardless of relation kind or source order; it does not follow further assessments or relations of neighbouring Points.
For a Bearing, focus includes its own endpoints and direct incoming relations without further expansion.
Selecting one of several alternative Bearings to the same target therefore shows that route, all its sources, and only the challenges or assessments addressed to it.
Membership is by Bearing identity, so parallel Bearings of the same kind between the same endpoints remain separate routes.
Emphasis means only "currently examined"; it expresses no confidence, acceptance or outcome, and does not depend on how many sources or objections a route has.
Guidance only dims; the declared shapes remain visible and selectable.
Nodes support arrow-key navigation in source order, Space selection, Enter/double-click navigation and Escape to clear. A Bearing with one source is drawn as its own line with a circular kind symbol, so independent supports stay separate lines even when they reach the same target; a joint Bearing (several sources), an addressed Bearing (the target of a Bearing-directed `challenges`, `supports` or `concerns`), or a parallel/self-directed one keeps a diamond junction with one input line per source. Lines are never merged into a shared trunk. Motion respects system reduced-motion and an optional host `reducedMotion()` callback. Callbacks and accessible labels retain full text, including collapsed Bearings.

`projectGraph` exposes the incidence graph, and `layoutGraph` its deterministic reading arrangement for alternate renderers. The default direction is `down`; pass `direction: 'right'` to the view or `layoutGraph` options for horizontal flow. The incidence projection represents each Bearing as a node: multiple input links mean joint sources, and output links can target other Bearings. This is a view representation of Core's first-class relationship object, not a new Core Point. `projectExploration` provides the simplified visual topology and its `inlineBearings`; collapsed output links retain their original `bearingKey`. Use `focusNeighborhood` against the complete incidence projection, including collapsed Bearings. These pure view helpers neither invent transitive connections nor flatten joint support. Core owns typed identities and relation semantics; the view owns visual topology, neighborhood guidance and geometry. Host code should surface compiler diagnostics when rendering a partial graph.

`marks` is the shared vocabulary for every surface: `POINT_MARKS`, `BEARING_MARKS`, `pointMark(label)`, `declarationMark(point.declaration)` and `bearingMark(kind)` give canonical names, auxiliary Chinese readings, glyph shapes and kind symbols.
`drawPointGlyph`, `drawBearingGlyph`, `createMarkChip` and `createBearingChip` draw the same glyphs for host chips and lists; `MARK_TYPE` is the type scale.
Display names follow the [glossary](../../docs/glossary.md): the `Material` key, matching Graph IR `declaration.form: "material"`, displays as Neutral Point (中性點).
Role-marked Points use circles; Neutral Points use squares.
Colour distinguishes authored support from objection and never judges correctness.
`layoutGraph` owns automatic placement; `relaxLayout` owns bounded local adjustment.
The pre-release layout selector, `GraphLayout`, `setLayout`, `layoutFlow`, `layoutConstellation` and `layoutGraphSettled` have been removed; hosts use the single Map and `resetLayout()`.

Map CSS is scoped to `.cog-graph` and `.cog-chip`, themed only through `--cog-ink`, `--cog-surface`, `--cog-canvas`, `--cog-muted`, `--cog-line`, `--cog-focus`, `--cog-support` and `--cog-objection` (`--cog-bearing-surface` and `--cog-accent` are no longer read). The host controls container size, full-text/evidence UI and diagnostics. This is a small renderer for inquiry fragments, not a graph editor or a large-workspace layout engine.


## Strands

Strands follows one focus Point through its supporting and answering paths.

```ts
import { createStrandsView } from '@cogitatum/view';

const strands = createStrandsView(container, {
  onSelect(ref) { showDetails(ref); },
  onClear() { clearDetails(); },
  onNavigate(ref) { openSource(ref); }
});
strands.update(compiled.graphs[0]);
strands.select(ref); // Silent; follows an unseen entity's target to the appropriate focus Point.
```

A strand follows `supports` and `answers` Bearings with a Point target, downward from the focus Point.
Each Point occupies one row, above the sources that support or answer it; a lane carries each path, a shared Point merges lanes,
and a joint step meets at one junction. A cycle is reported on the row instead of repeating a Point.
Every other Bearing that bears on a strand is a **knot** placed where it bears: a challenge, concern or support of a step sits
on that step's lane, directly above its source; a relation to a Point sits on that Point's row.
A knot lists direct relations one level deep, naming the Point or step each addresses, and counts distinct further relations.
Each displayed Point and Bearing can be selected independently; Left and Right cycle through the objects within a row.
Selecting a challenge enters **Challenge Focus**: the contested Point or step, its sources and the paths to the focus stay lit,
including lane segments through other rows. Everything else dims until Escape or the contextual Show all control.
Focus tracks Bearing identities as well as Points: sharing a Ground does not put an alternative route under the same objection.
The header offers each Point that bears on nothing and has something bearing on it as an ending; the footer counts what lies outside.
A closed cycle starts at its first Point, labelled as a focus rather than an ending.
Only authored Point names retain the focus across updates; compilation-local keys do not carry identity between revisions.
`projectStrands(graph, focus?)`, `strandRoots`, `strandRootOf` and `projectContest` are the pure projections behind the view.
Each Point's own mark sits on its lane, and the focus is drawn larger as the heading. A lane takes its relation's tone.
A knot appears on its lane with the same Bearing glyph Map draws on a line, joined to its card by a hairline.
Below 480px the lanes draw closer together; dense inquiries cap the lane gutter to preserve a usable text column.
An externally selected objection or response follows its actual relation targets to the ending it concerns.
Strands adds no weight, strength, resolution or outcome; its layout is a reading aid like Map's.

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
One multiline block occupies one occurrence row, with a span from header content through its last continuation.
Its `raw` contains the complete original physical lines joined with LF; continuation lines are not repeated as separate rows.
Flattening each row's `raw.split("\n")` recovers the input's physical lines, while the original source retains exact line endings.
Selection, Edit and note-source navigation use the full occurrence span.
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
Member sources use their own direct neutral occurrences.
A neutral use presents the existing Point at that source location without creating another Point.
Listed sources use their named operands' canonical declarations.
A local Bearing use remains a local row; a target at the Bearing's construction reaches its junction.
These display locations do not create extra graph entities, independent evidence or inferred relations.
Repeated names and keys in different source units remain separate.

`ReadingUnit.commitments` records active occurrences' relation and note decisions, taken from Explain alone:
`indentation` (the nearest context selected the target, with that context row and any crossed body rows),
`explicit` (a named target fixed it), `member` (a constructor's member source, adding no relation of its own), `note`,
`none` (for example C or a neutral Point, which state no relation) or `failed` (no surviving Bearing, with Core's reason).
A member constructor's header also lists its ordered source rows. A failed candidate never supplies a target.
An eligible member of a rejected constructor is identified as such; it is not presented as an established joint relation.
The view draws a **commitment rail** for the hovered or selected row: a guide in the indentation from the selected context row,
marking each crossed body row and bracketing a constructor's member sources; a failed selection is dashed.
The selected row also shows an **inspection line**, `describeCommitment(unit, commitment)`, linked by `aria-describedby`.
It restates Core's decision, including a failed row's own error message, and does not assess the prose or propose another target.
The line leads with the relation's glyph. A row's diagnostic badge reads as words, and the exact code stays in its tooltip and the diagnostics list.

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
The complete `raw` block and original source remain in the projection and raw lines are available on occurrence tooltips.
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
Selection guides the same immediate neighborhood as Map, and hover/focus preview it only while nothing with a graph reference is selected; it does not infer a chain or hide the remaining source.
Object notes on the focused Point or Bearing keep their complete literal subtrees in that emphasis, without creating extra graph references.
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
