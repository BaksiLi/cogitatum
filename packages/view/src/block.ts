import { explainSource, type BearingTarget, type GraphIR, type SourceSpan } from "@cogitatum/core";
import { createGraphView, type GraphView } from "./index.js";
import { createReadingView } from "./reading.js";
import { projectReading } from "./reading-projection.js";
import { bearingMark, pointMark } from "./marks.js";
import type { GraphNode } from "./projection.js";
import { createProseScope, type ProseRenderer } from "./prose.js";

export type { ProseRenderer } from "./prose.js";

export type BlockMode = "reading" | "map";
export type BlockEditRequest = {
  source: string;
  sourceSpan?: SourceSpan;
  /** Aborted when this source revision is replaced or the view is destroyed. */
  signal: AbortSignal;
};
export type BlockViewOptions = {
  renderProse?: ProseRenderer;
  onEdit?: (request: BlockEditRequest) => void | Promise<void>;
  /** Build provenance supplied by the host, rendered as plain text. */
  version?: { label: string; detail: string };
  /** May be resolved after attachment when a host constructs previews off-DOM. */
  initialMode?: () => BlockMode | undefined;
  onMode?: (mode: BlockMode) => void;
};
export type BlockView = {
  /** Theme and host event boundaries belong on this element. */
  element: HTMLElement;
  update(source: string): void;
  destroy(): void;
};

/** A shared code-block preview; native editors and storage remain host-owned. */
export function createBlockView(container: HTMLElement, options: BlockViewOptions = {}): BlockView {
  const doc = container.ownerDocument, win = doc.defaultView!;
  const abort = new AbortController(), on = { signal: abort.signal };
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, name: string, parent: HTMLElement) => {
    const node = doc.createElement(tag);
    node.className = `cog-block-${name}`;
    parent.append(node);
    return node;
  };
  const button = (parent: HTMLElement, label: string, action: () => void, title = label) => {
    const node = element("button", "button", parent);
    node.type = "button"; node.textContent = label; node.title = title;
    node.addEventListener("click", action, on);
    return node;
  };
  const root = element("section", "root", container);
  root.className = "cog-block"; root.setAttribute("aria-label", "Cogitatum");
  const toolbar = element("header", "toolbar", root);
  element("span", "title", toolbar).textContent = "Cogitatum";
  const modes = element("div", "modes", toolbar);
  modes.setAttribute("role", "group"); modes.setAttribute("aria-label", "View");
  const modeButtons = new Map<BlockMode, HTMLButtonElement>();
  for (const [mode, label] of [["reading", "Reading"], ["map", "Map"]] as const) {
    modeButtons.set(mode, button(modes, label, () => showMode(mode)));
  }
  const issues = button(toolbar, "", () => {
    showMode("reading");
    const diagnostics = readingSurface.querySelector<HTMLDetailsElement>(".cog-reading-diagnostics");
    if (diagnostics) { diagnostics.open = true; diagnostics.querySelector("summary")?.focus(); }
  });
  issues.classList.add("cog-block-issues"); issues.hidden = true;
  const actions = element("div", "actions", toolbar);
  const edit = options.onEdit ? button(actions, "Edit", () => { void revealSource(selectedSpan); }, "Edit source beside this preview") : undefined;
  const expand = button(actions, "Expand", () => dialog ? closeExpanded() : openExpanded(), "Expand preview");
  expand.setAttribute("aria-haspopup", "dialog");
  const status = element("p", "status", root);
  status.setAttribute("role", "status"); status.hidden = true;
  const failure = element("p", "error", root);
  failure.setAttribute("role", "alert"); failure.hidden = true;
  const body = element("div", "body", root);
  const readingSurface = element("div", "reading", body);
  const mapPanel = element("div", "map-panel", body);
  const mapToolbar = element("div", "map-toolbar", mapPanel);
  mapToolbar.setAttribute("role", "group"); mapToolbar.setAttribute("aria-label", "Map controls");
  button(mapToolbar, "Fit", () => map?.fit(), "Fit the whole map");
  button(mapToolbar, "-", () => map?.zoom(1 / 1.25), "Zoom out").setAttribute("aria-label", "Zoom out");
  button(mapToolbar, "+", () => map?.zoom(1.25), "Zoom in").setAttribute("aria-label", "Zoom in");
  button(mapToolbar, "Arrange", () => map?.resetLayout(), "Restore automatic arrangement");
  const mapSurface = element("div", "map", mapPanel);
  const detail = element("div", "detail", mapPanel);
  detail.hidden = true;
  detail.setAttribute("aria-live", "polite");
  const detailContent = element("div", "detail-content", detail);
  const detailHeading = element("p", "detail-heading", detailContent);
  const detailText = element("div", "detail-text", detailContent);
  const detailProse = createProseScope(options.renderProse);
  const clearDetail = () => { detailProse.reset(); detailText.replaceChildren(); detail.hidden = true; };
  button(detail, "Read passage", () => {
    showMode("reading");
    readingSurface.querySelector<HTMLElement>('.cog-reading-row[data-selected="true"]')?.focus({ preventScroll: true });
  });
  element("p", "hint", mapPanel).textContent = "Drag marks to arrange; drag the canvas to pan. Ctrl / Cmd + scroll to zoom." + (edit ? " Enter to edit the selected passage." : "");
  if (options.version) {
    const version = element("details", "version", root);
    const summary = element("summary", "version-label", version);
    summary.textContent = options.version.label;
    summary.title = "Build information";
    element("p", "version-detail", version).textContent = options.version.detail;
  }

  let mode: BlockMode = "reading", source: string | undefined, graph: GraphIR | undefined, map: GraphView | undefined;
  let projection: ReturnType<typeof projectReading> | undefined;
  let selected: BearingTarget | undefined, selectedSpan: SourceSpan | undefined;
  let syncing = false, destroyed = false, interacted = false;
  let dialog: HTMLDialogElement | undefined, reservedHeight = "", editing: AbortController | undefined;
  const sync = (action: () => void) => { syncing = true; try { action(); } finally { syncing = false; } };
  const updateEditTitle = () => {
    if (edit) edit.title = selectedSpan ? `Edit selected passage at line ${selectedSpan.startLine}` : "Edit source beside this preview";
  };
  const reading = createReadingView(readingSurface, {
    renderProse: options.renderProse,
    onSelect(selection) {
      selected = selection.ref; selectedSpan = selection.sourceSpan; updateEditTitle();
      if (!syncing) sync(() => { if (selected) map?.select(selected); else map?.clear(); });
    },
    onClear() {
      selected = undefined; selectedSpan = undefined; clearDetail(); updateEditTitle();
      if (!syncing) sync(() => map?.clear());
    },
    onNavigate: options.onEdit ? selection => { void revealSource(selection.sourceSpan); } : undefined
  });
  function selectNode(node: GraphNode) {
    if (!selected || selected.kind !== node.ref.kind || selected.key !== node.ref.key) selectedSpan = node.sourceSpan;
    selected = node.ref; updateEditTitle();
    const name = node.ref.kind === "point" ? pointMark(node.label).name : bearingMark(node.label).name;
    detailHeading.textContent = `${name}${node.name ? ` @${node.name}` : ""}`;
    clearDetail();
    const prose = node.ref.kind === "point" ? node.text : graph?.bearings.find(bearing => bearing.key === node.ref.key)?.text;
    const occurrence = projection?.units[0]?.occurrences.find(row => row.references.some(reference =>
      reference.kind !== "uses" && reference.ref.kind === node.ref.kind && reference.ref.key === node.ref.key));
    if (prose !== undefined) {
      if (!occurrence || occurrence.diagnostics.some(diagnostic => diagnostic.severity === "error")) detailText.textContent = prose;
      else detailProse.render(detailText, prose);
    }
    detail.hidden = false;
    if (!syncing) sync(() => reading.select(node.ref));
  }
  async function revealSource(span?: SourceSpan) {
    if (!options.onEdit || source === undefined || destroyed || editing) return;
    const request = editing = new AbortController();
    edit!.disabled = true; edit!.setAttribute("aria-busy", "true"); status.hidden = true;
    // Reattach synchronously before handing focus to a native editor outside the modal.
    closeExpanded(false);
    try { await options.onEdit({ source, sourceSpan: span, signal: request.signal }); }
    catch (error) {
      if (!request.signal.aborted) {
        status.textContent = error instanceof Error ? error.message : String(error);
        status.hidden = false;
      }
    } finally {
      if (editing === request) {
        editing = undefined; edit!.disabled = false; edit!.removeAttribute("aria-busy");
      }
    }
  }
  function cancelEdit() {
    editing?.abort(); editing = undefined;
    if (edit) { edit.disabled = false; edit.removeAttribute("aria-busy"); }
    status.hidden = true;
  }
  function showMode(next: BlockMode, remember = true) {
    mode = next === "map" && modeButtons.get("map")!.disabled ? "reading" : next;
    root.dataset.mode = mode;
    if (remember) { interacted = true; options.onMode?.(mode); }
    for (const [key, node] of modeButtons) node.setAttribute("aria-pressed", String(key === mode));
    readingSurface.hidden = mode !== "reading"; mapPanel.hidden = mode !== "map";
    if (mode === "map" && !map && graph) {
      map = createGraphView(mapSurface, {
        onSelect: selectNode,
        onClear() {
          clearDetail();
          if (!syncing) { selected = undefined; selectedSpan = undefined; updateEditTitle(); sync(() => reading.clear()); }
        },
        onNavigate: options.onEdit ? () => { void revealSource(selectedSpan); } : undefined
      });
      sync(() => { map!.update(graph!, "code-block"); if (selected) map!.select(selected); });
    }
  }
  function openExpanded() {
    dialog = element("dialog", "dialog", doc.body);
    dialog.setAttribute("aria-label", "Cogitatum expanded view");
    dialog.addEventListener("cancel", event => { event.preventDefault(); event.stopPropagation(); closeExpanded(); }, on);
    dialog.addEventListener("close", () => { if (dialog && !dialog.open) closeExpanded(); }, on);
    reservedHeight = container.style.minHeight;
    container.style.minHeight = `${root.getBoundingClientRect().height}px`;
    dialog.append(root); root.dataset.expanded = "true";
    expand.textContent = "Close"; expand.title = "Close expanded view"; expand.setAttribute("aria-label", "Close expanded view");
    dialog.showModal(); expand.focus({ preventScroll: true });
  }
  function closeExpanded(focus = true) {
    if (!dialog) return;
    const previous = dialog; dialog = undefined;
    previous.close(); container.append(root); previous.remove();
    container.style.minHeight = reservedHeight; delete root.dataset.expanded;
    expand.textContent = "Expand"; expand.title = "Expand preview"; expand.removeAttribute("aria-label");
    if (focus) expand.focus({ preventScroll: true });
  }
  root.addEventListener("keydown", event => {
    if (event.key === "Escape" && dialog) { event.preventDefault(); event.stopPropagation(); closeExpanded(); }
  }, on);
  const restoreMode = () => showMode(options.initialMode?.() ?? mode, false);
  showMode("reading", false);
  const readyFrame = win.requestAnimationFrame(() => { if (!destroyed && !interacted) restoreMode(); });

  return {
    element: root,
    update(next) {
      if (destroyed) throw new Error("This Cogitatum block has been destroyed.");
      if (source === next) return;
      const first = source === undefined;
      source = next; cancelEdit();
      selected = undefined; selectedSpan = undefined; clearDetail(); updateEditTitle();
      try {
        const explained = explainSource(next, "document");
        graph = explained.graphs[0];
        projection = projectReading(next, explained);
        if (!graph) { map?.destroy(); map = undefined; }
        sync(() => { reading.update(projection!); map?.clear(); if (graph) map?.update(graph, "code-block"); });
        modeButtons.get("map")!.disabled = !graph || (!graph.points.length && !graph.bearings.length);
        issues.textContent = `${explained.diagnostics.length} issue${explained.diagnostics.length === 1 ? "" : "s"}`;
        issues.hidden = !explained.diagnostics.length;
        failure.hidden = true; body.hidden = false;
        if (first) restoreMode(); else showMode(mode, false);
      } catch (error) {
        graph = undefined; projection = undefined; map?.destroy(); map = undefined;
        modeButtons.get("map")!.disabled = true; issues.hidden = true; showMode("reading", false);
        failure.textContent = `Could not render this block: ${error instanceof Error ? error.message : String(error)}`;
        failure.hidden = false; body.hidden = true;
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; cancelEdit(); abort.abort(); win.cancelAnimationFrame(readyFrame);
      closeExpanded(false); detailProse.destroy(); map?.destroy(); reading.destroy(); root.remove();
    }
  };
}
