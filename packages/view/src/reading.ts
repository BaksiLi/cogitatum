import type { BearingTarget, SourceSpan } from "@cogitatum/core";
import { bearingMark, createBearingChip, createMarkChip, drawBearingGlyph } from "./marks.js";
import { focusNeighborhood, projectExploration, projectGraph, referenceKey, type GraphProjection } from "./projection.js";
import type { ReadingEndpoint, ReadingOccurrence, ReadingProjection } from "./reading-projection.js";

export type ReadingSelection = {
  unitIndex: number;
  occurrenceId: string;
  sourceSpan: SourceSpan;
  ref?: BearingTarget;
};
export type ReadingViewOptions = {
  reducedMotion?: () => boolean;
  onSelect?: (selection: ReadingSelection) => void;
  onClear?: () => void;
  onNavigate?: (selection: ReadingSelection) => void;
};
export type ReadingView = {
  update(projection: ReadingProjection): void;
  /** Silent; a current local occurrence of the same ref is retained. */
  select(ref: BearingTarget, unitIndex?: number): void;
  /** Silent; select an exact occurrence in the current projection, including body or notes. */
  selectOccurrence(occurrenceId: string, ref?: BearingTarget): void;
  /** Silent; user Escape and update notify onClear. */
  clear(): void;
  destroy(): void;
};

type Position = { x: number; y: number };
type Row = { occurrence: ReadingOccurrence; element: HTMLLIElement; mark: HTMLElement };
const NS = "http://www.w3.org/2000/svg";
const sameRef = (a?: BearingTarget, b?: BearingTarget) => !!a && !!b && referenceKey(a) === referenceKey(b);

/** Render compiler-owned occurrences; all temporary state belongs to this instance. */
export function createReadingView(container: HTMLElement, options: ReadingViewOptions = {}): ReadingView {
  const doc = container.ownerDocument, win = doc.defaultView;
  const html = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: Element) => {
    const element = doc.createElement(tag);
    element.className = className; parent?.append(element); return element;
  };
  const svgElement = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, parent: Element) => {
    const element = doc.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    parent.append(element); return element;
  };
  const root = html("div", "cog-reading", container);
  const diagnostics = html("details", "cog-reading-diagnostics", root);
  const page = html("div", "cog-reading-page", root);
  const svg = svgElement("svg", { class: "cog-reading-connections", "aria-hidden": "true" }, page);
  const lines = html("ol", "cog-reading-lines", page);
  lines.setAttribute("aria-label", `Source reading. Up and Down move between occurrences; Left and Right choose a reference; Enter ${options.onNavigate ? "opens source" : "selects"}; Escape clears.`);
  let projection: ReadingProjection | undefined, rows = new Map<string, Row>();
  let full: GraphProjection[] = [], inline: Set<string>[] = [];
  let selected: ReadingSelection | undefined, hovered: ReadingSelection | undefined;
  let destroyed = false, frame = 0;
  const abort = new AbortController(), on = { signal: abort.signal };
  const alive = () => { if (destroyed) throw new Error("This reading view has been destroyed."); };
  const selectionFor = (occurrence: ReadingOccurrence, ref?: BearingTarget): ReadingSelection => ({
    unitIndex: occurrence.unitIndex, occurrenceId: occurrence.id, sourceSpan: occurrence.sourceSpan,
    ref: ref ?? occurrence.references.find(reference => reference.kind !== "constructs")?.ref ?? occurrence.references[0]?.ref
  });
  const reduced = () => !!options.reducedMotion?.() || !!win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const reveal = (row: Row) => row.element.scrollIntoView?.({ block: "nearest", behavior: reduced() ? "instant" : "smooth" });

  function guide(): void {
    const active = hovered ?? selected;
    const focus = active?.ref ? focusNeighborhood(full[active.unitIndex], active.ref) : undefined;
    const bearingKeys = new Set(focus?.bearingKeys);
    const relevant = new Set(active ? [active.occurrenceId] : []);
    if (active) for (const bearing of projection?.units[active.unitIndex].bearings ?? []) {
      if (!bearingKeys.has(bearing.bearing.key)) continue;
      relevant.add(bearing.occurrenceId); relevant.add(bearing.target.occurrenceId);
      bearing.sources.forEach(source => relevant.add(source.occurrenceId));
    }
    root.dataset.guided = String(!!active?.ref);
    for (const [id, row] of rows) {
      const same = row.occurrence.unitIndex === active?.unitIndex &&
        row.occurrence.references.some(reference => sameRef(reference.ref, active?.ref));
      row.element.dataset.related = String(!active || same || relevant.has(id));
      row.element.dataset.same = String(same && id !== active?.occurrenceId);
      row.element.setAttribute("aria-pressed", String(id === selected?.occurrenceId));
      row.element.setAttribute("aria-label", `Line ${row.occurrence.line}: ${row.occurrence.raw.trim()}${id === selected?.occurrenceId && selected.ref ? ` (${selected.ref.kind} selected)` : ""}`);
      row.element.dataset.selectedReference = id === selected?.occurrenceId ? selected.ref?.kind ?? "text" : "";
      row.element.tabIndex = id === (selected?.occurrenceId ?? rows.keys().next().value) ? 0 : -1;
    }
    for (const group of svg.querySelectorAll<SVGGElement>("[data-bearing]")) {
      group.dataset.active = String(!active || Number(group.dataset.unit) === active.unitIndex && bearingKeys.has(group.dataset.bearing!));
    }
  }
  function choose(selection?: ReadingSelection, notify = true): void {
    selected = selection; hovered = undefined; guide();
    if (notify) {
      if (selection) options.onSelect?.(selection); else options.onClear?.();
    }
  }
  function mark(occurrence: ReadingOccurrence, parent: HTMLElement): void {
    const recognized = occurrence.recognition;
    if (recognized.kind === "role") parent.append(createMarkChip(doc, recognized.role));
    else if (recognized.kind === "gap") parent.append(createMarkChip(doc, "Gap"));
    else if (recognized.kind === "material") parent.append(createMarkChip(doc, "Material"));
    else if (recognized.kind === "use") {
      parent.append(createMarkChip(doc, recognized.role ?? "Material"));
    } else if (recognized.kind === "edge" || recognized.kind === "linked" || recognized.kind === "bearingUse") {
      const ref = occurrence.references.find(reference => reference.ref.kind === "bearing")?.ref;
      const bearing = ref && projection?.units[occurrence.unitIndex].graph.bearings.find(bearing => bearing.key === ref.key);
      if (bearing) parent.append(createBearingChip(doc, bearing.kind, 16, !inline[occurrence.unitIndex].has(bearing.key)));
    }
  }
  function build(): void {
    lines.replaceChildren(); svg.replaceChildren(); diagnostics.replaceChildren(); rows = new Map();
    if (!projection) return;
    diagnostics.hidden = projection.diagnostics.length === 0;
    const summary = html("summary", "", diagnostics);
    const errors = projection.diagnostics.filter(diagnostic => diagnostic.severity === "error").length;
    const count = projection.diagnostics.length;
    summary.textContent = `${count} compiler diagnostic${count === 1 ? "" : "s"}${errors ? ` · ${errors} error${errors === 1 ? "" : "s"} · partial structure` : ""}`;
    const diagnosticList = html("ul", "", diagnostics);
    for (const diagnostic of projection.diagnostics) {
      const item = html("li", "", diagnosticList);
      item.textContent = `${diagnostic.severity} · ${diagnostic.code}${diagnostic.sourceSpan ? ` · L${diagnostic.sourceSpan.startLine}` : ""}: ${diagnostic.message}`;
    }
    for (const source of projection.rows) {
      const row = html("li", "cog-reading-row", lines);
      row.dataset.line = String(source.line);
      row.dataset.kind = source.kind === "source" ? "source" : source.recognition.kind;
      const number = html("span", "cog-reading-number", row); number.textContent = String(source.line); number.setAttribute("aria-hidden", "true");
      const glyph = html("span", "cog-reading-mark", row);
      const content = html("span", "cog-reading-content", row);
      if (source.kind === "occurrence") {
        row.dataset.occurrence = source.id; row.dataset.unit = String(source.unitIndex);
        if ((source.recognition.kind === "role" || source.recognition.kind === "use") && source.recognition.role) row.dataset.role = source.recognition.role;
        row.style.setProperty("--cog-reading-depth", String(source.depth));
        row.setAttribute("role", "button"); row.setAttribute("aria-pressed", "false");
        row.title = source.raw;
        mark(source, glyph);
        const authored = source.raw.slice(source.sourceSpan.startColumn - 1, source.sourceSpan.endColumn - 1);
        const failed = source.diagnostics.some(diagnostic => diagnostic.severity === "error");
        if (["linked", "edge", "note"].includes(source.recognition.kind)) {
          html("span", "cog-reading-tag", content).textContent = source.recognition.kind === "edge" ? "bearing" : source.recognition.kind;
        }
        // Reading presents prose and authored names; raw syntax remains available for inspection.
        // Failed lines keep their complete annotation so the defect is never hidden by presentation.
        html("span", "cog-reading-text", content).textContent = failed ? authored : source.text;
        if (!failed) for (const reference of source.references) {
          if (reference.kind !== "uses" && reference.name) {
            html("span", "cog-reading-name", content).textContent = `${reference.kind === "constructs" ? ";" : ""}@${reference.name}`;
          }
        }
        for (const reference of source.references) if (reference.kind === "uses") {
          const graph = projection.units[source.unitIndex].graph;
          const entity = reference.ref.kind === "point" ? graph.points.find(point => point.key === reference.ref.key) :
            graph.bearings.find(bearing => bearing.key === reference.ref.key);
          const citation = html("span", "cog-reading-use", content);
          citation.textContent = `↗ @${reference.name}${entity?.text ? ` · ${entity.text}` : ""}`;
          citation.title = `Referenced ${reference.ref.kind}; the local note above does not replace its content.`;
        }
        if ((source.recognition.kind === "use" || source.recognition.kind === "bearingUse") &&
          !source.references.some(reference => reference.kind === "uses")) {
          html("span", "cog-reading-use", content).textContent = `@${source.recognition.ref?.id ?? "?"} unresolved`;
        }
        rows.set(source.id, { occurrence: source, element: row, mark: glyph });
      } else content.textContent = source.raw || "\u00a0";
      if (source.diagnostics.length) {
        row.dataset.error = String(source.diagnostics.some(diagnostic => diagnostic.severity === "error"));
        const badge = html("span", "cog-reading-diagnostic", content);
        badge.textContent = source.diagnostics.map(diagnostic => diagnostic.code).join(" · ");
        badge.title = source.diagnostics.map(diagnostic => diagnostic.message).join("\n");
      }
    }
  }

  function paint(): void {
    frame = 0;
    if (destroyed || !projection) return;
    svg.replaceChildren();
    root.dataset.compact = String(root.getBoundingClientRect().width < 600);
    const box = page.getBoundingClientRect();
    svg.setAttribute("width", String(box.width)); svg.setAttribute("height", String(box.height));
    const positions = new Map<string, Position>();
    for (const [id, row] of rows) {
      const mark = row.mark.getBoundingClientRect();
      // A separate margin keeps arcs and their hit areas out of the line-number and text columns.
      positions.set(id, { x: row.element.getBoundingClientRect().left - box.left - 4, y: mark.top - box.top + mark.height / 2 });
    }
    projection.units.forEach((unit, unitIndex) => {
      // Precompute all junctions; Bearing cycles never require recursive geometry.
      const junctions = new Map<string, Position>();
      for (const route of unit.bearings) {
        const at = positions.get(route.occurrenceId);
        if (at && !inline[unitIndex].has(route.bearing.key)) junctions.set(route.bearing.key, { x: at.x - 34, y: at.y });
      }
      const endpoint = (end: ReadingEndpoint) => {
        const occurrence = rows.get(end.occurrenceId)?.occurrence;
        const constructs = occurrence?.references.some(reference => reference.kind === "constructs" && sameRef(reference.ref, end.ref));
        if (end.ref.kind === "bearing" && constructs) {
          const junction = junctions.get(end.ref.key);
          // Stop outside the diamond, independent of which Bearing is painted first.
          return junction && { x: junction.x - 12, y: junction.y };
        }
        return positions.get(end.occurrenceId);
      };
      for (const route of unit.bearings) {
        const bearing = route.bearing, target = endpoint(route.target);
        if (!target) continue;
        const tone = bearingMark(bearing.kind);
        const group = svgElement("g", {
          class: `cog-reading-bearing cog-tone-${tone.tone}`, "data-bearing": bearing.key, "data-unit": String(unitIndex),
          "data-subtle": String(bearing.derivedBy === "structural" && inline[unitIndex].has(bearing.key))
        }, svg);
        const curve = (from: Position, to: Position, output: boolean, lane: number): Position => {
          const span = Math.abs(to.y - from.y);
          const bend = Math.max(12, Math.min(from.x, to.x) - 16 - span * .3 - lane * 3);
          const c1 = { x: bend, y: from.y }, c2 = { x: bend, y: to.y };
          if (Math.abs(from.y - to.y) < 1) { c1.y -= 15; c2.y += 15; }
          const d = `M${from.x} ${from.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}`;
          svgElement("path", { d, class: `cog-reading-arc${tone.dashed ? " cog-reading-dashed" : ""}` }, group);
          const hit = svgElement("path", { d, class: "cog-reading-hit" }, group);
          hit.dataset.occurrence = route.occurrenceId; hit.dataset.ref = bearing.key;
          if (output) {
            const dx = to.x - c2.x, dy = to.y - c2.y, length = Math.hypot(dx, dy) || 1, x = dx / length, y = dy / length;
            svgElement("path", { class: "cog-reading-arrow", d: `M${to.x} ${to.y}L${to.x - 6*x - 3*y} ${to.y - 6*y + 3*x}L${to.x - 6*x + 3*y} ${to.y - 6*y - 3*x}Z` }, group);
          }
          return { x: (from.x + to.x + 3*c1.x + 3*c2.x) / 8, y: (from.y + to.y + 3*c1.y + 3*c2.y) / 8 };
        };
        let glyph = junctions.get(bearing.key);
        if (glyph) {
          route.sources.forEach((source, i) => { const from = endpoint(source); if (from) curve(from, glyph!, false, i); });
          curve(glyph, target, true, route.sources.length);
        } else {
          const source = endpoint(route.sources[0]);
          if (!source) continue;
          glyph = curve(source, target, true, 0);
        }
        const symbol = svgElement("g", { transform: `translate(${glyph.x} ${glyph.y})`, class: "cog-reading-symbol" }, group);
        symbol.dataset.occurrence = route.occurrenceId; symbol.dataset.ref = bearing.key;
        svgElement("circle", { r: "12", fill: "transparent" }, symbol);
        drawBearingGlyph(symbol, bearing.kind, junctions.has(bearing.key));
        svgElement("title", {}, symbol).textContent = `${tone.name}${bearing.handle ? ` @${bearing.handle}` : ""}; line ${rows.get(route.occurrenceId)!.occurrence.line}`;
        // Selection is delegated below, so redraws do not accumulate listeners.
      }
    });
    guide();
  }
  const schedule = () => { if (!destroyed && !frame) { if (win) frame = win.requestAnimationFrame(paint); else paint(); } };
  const fromEvent = (event: Event): ReadingSelection | undefined => {
    const element = (event.target as Element).closest<HTMLElement | SVGElement>("[data-occurrence]");
    const row = element?.dataset.occurrence && rows.get(element.dataset.occurrence);
    return row ? selectionFor(row.occurrence, element?.dataset.ref ? { kind: "bearing", key: element.dataset.ref } : undefined) : undefined;
  };
  root.addEventListener("click", event => {
    if (doc.getSelection()?.type === "Range") return;
    const next = fromEvent(event); if (next) choose(next);
  }, on);
  root.addEventListener("dblclick", event => { const next = fromEvent(event); if (next) { choose(next); options.onNavigate?.(next); } }, on);
  root.addEventListener("pointerover", event => { hovered = fromEvent(event); guide(); }, on);
  root.addEventListener("pointerleave", () => { hovered = undefined; guide(); }, on);
  root.addEventListener("focusin", event => { hovered = fromEvent(event); guide(); }, on);
  root.addEventListener("focusout", () => { hovered = undefined; guide(); }, on);
  root.addEventListener("keydown", event => {
    const current = fromEvent(event);
    if (event.key === "Escape" && selected) { event.preventDefault(); choose(); return; }
    if (!current) return;
    const order = [...rows.keys()], index = order.indexOf(current.occurrenceId);
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? order.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + order.length) % order.length;
      const row = rows.get(order[next])!;
      choose(selectionFor(row.occurrence)); row.element.focus({ preventScroll: true }); reveal(row);
    } else if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const row = rows.get(current.occurrenceId)!, refs = row.occurrence.references;
      if (!refs.length) return;
      const at = refs.findIndex(reference => sameRef(reference.ref, selected?.occurrenceId === current.occurrenceId ? selected.ref : current.ref));
      choose(selectionFor(row.occurrence, refs[(at + (event.key === "ArrowRight" ? 1 : -1) + refs.length) % refs.length].ref));
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      const next = selected?.occurrenceId === current.occurrenceId ? selected : current;
      choose(next); if (event.key === "Enter") options.onNavigate?.(next);
    }
  }, on);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : undefined;
  observer?.observe(page);
  return {
    update(next) {
      alive(); const hadFocus = root.contains(doc.activeElement);
      projection = next; selected = undefined; hovered = undefined;
      full = next.units.map(unit => projectGraph(unit.graph));
      inline = full.map(graph => new Set(projectExploration(graph).inlineBearings.map(node => node.ref.key)));
      build(); guide(); schedule(); options.onClear?.();
      if (hadFocus) root.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
    },
    select(ref, unitIndex = 0) {
      alive();
      if (selected?.unitIndex === unitIndex && sameRef(selected.ref, ref)) return;
      const candidates = [...rows.values()].filter(row => row.occurrence.unitIndex === unitIndex);
      const row = candidates.find(row => row.occurrence.references.some(reference => reference.kind !== "uses" && sameRef(reference.ref, ref))) ??
        candidates.find(row => row.occurrence.references.some(reference => sameRef(reference.ref, ref)));
      choose(row && selectionFor(row.occurrence, ref), false);
      if (row) reveal(row);
    },
    selectOccurrence(occurrenceId, ref) {
      alive();
      const row = rows.get(occurrenceId);
      if (ref && row && !row.occurrence.references.some(reference => sameRef(reference.ref, ref))) {
        throw new Error("The reference does not belong to this occurrence.");
      }
      choose(row && selectionFor(row.occurrence, ref), false);
      if (row) reveal(row);
    },
    clear() { if (!destroyed) choose(undefined, false); },
    destroy() {
      if (destroyed) return;
      destroyed = true; abort.abort(); observer?.disconnect(); if (frame) win?.cancelAnimationFrame(frame);
      root.remove(); rows.clear(); projection = undefined; full = []; inline = []; selected = undefined; hovered = undefined;
    }
  };
}
