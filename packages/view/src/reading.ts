import type { BearingTarget, SourceSpan } from "@cogitatum/core";
import { bearingMark, createBearingChip, createMarkChip, drawBearingGlyph } from "./marks.js";
import { focusNeighborhood, projectExploration, projectGraph, referenceKey, type GraphProjection } from "./projection.js";
import type { ReadingEndpoint, ReadingOccurrence, ReadingProjection } from "./reading-projection.js";
import { createProseScope, type ProseRenderer } from "./prose.js";

export type ReadingSelection = {
  unitIndex: number;
  occurrenceId: string;
  sourceSpan: SourceSpan;
  ref?: BearingTarget;
};
export type ReadingViewOptions = {
  /** Only compiler-selected prose is passed to this host renderer. */
  renderProse?: ProseRenderer;
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
type Row = { occurrence: ReadingOccurrence; element: HTMLLIElement; mark: HTMLElement; control: HTMLButtonElement };
const NS = "http://www.w3.org/2000/svg";
const sameRef = (a?: BearingTarget, b?: BearingTarget) => !!a && !!b && referenceKey(a) === referenceKey(b);
/** Gap between the text column and the innermost lane, corner radius, and the narrowest useful rail. */
const INSET = 14, CORNER = 6, RAIL_MIN = 28;

/**
 * Arc-diagram lanes: shorter spans nest inside longer ones, so spans that share a row never share a lane.
 * Intervals are row indices, so lanes are known before anything is measured.
 */
export function readingLanes(spans: readonly (readonly [number, number])[]): number[] {
  const order = spans.map((span, index) => ({ index, lo: Math.min(...span), hi: Math.max(...span) }))
    .sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo) || a.lo - b.lo);
  const taken: [number, number][][] = [], lanes = new Array<number>(spans.length).fill(0);
  for (const span of order) {
    let lane = 0;
    while (taken[lane]?.some(([lo, hi]) => span.lo <= hi && lo <= span.hi)) lane++;
    (taken[lane] ??= []).push([span.lo, span.hi]); lanes[span.index] = lane;
  }
  return lanes;
}

/**
 * Port order where several connectors meet one row: those leaving upward sit above those leaving
 * downward, and inner lanes sit furthest out, so no stub crosses another connector's vertical run.
 */
export function readingPorts(ends: readonly { lane: number; up: boolean }[]): number[] {
  const order = ends.map((end, index) => ({ ...end, index }))
    .sort((a, b) => Number(b.up) - Number(a.up) || (a.up ? a.lane - b.lane : b.lane - a.lane));
  const ports = new Array<number>(ends.length);
  order.forEach((end, slot) => { ports[end.index] = slot - (ends.length - 1) / 2; });
  return ports;
}

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
  let projection: ReadingProjection | undefined, rows = new Map<string, Row>(), order: string[] = [];
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
  const prose = createProseScope(options.renderProse, () => schedule());

  function guide(): void {
    const active = hovered ?? selected;
    const focused = root.contains(doc.activeElement) ?
      doc.activeElement?.closest<HTMLElement>("[data-occurrence]")?.dataset.occurrence : undefined;
    const tabStop = selected?.occurrenceId ?? focused ?? rows.keys().next().value;
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
      row.element.dataset.selected = String(id === selected?.occurrenceId);
      const label = `Line ${row.occurrence.line}: ${row.occurrence.raw.trim()}${id === selected?.occurrenceId && selected.ref ? ` (${selected.ref.kind} selected)` : ""}`;
      row.element.setAttribute("aria-label", label);
      row.control.setAttribute("aria-label", `Select ${label}`);
      row.control.setAttribute("aria-pressed", String(id === selected?.occurrenceId));
      row.element.dataset.selectedReference = id === selected?.occurrenceId ? selected.ref?.kind ?? "text" : "";
      row.element.tabIndex = id === tabStop ? 0 : -1;
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
  function reference(parent: HTMLElement, unitIndex: number, endpoint: ReadingEndpoint, authoredName?: string): void {
    const unit = projection!.units[unitIndex], ref = endpoint.ref;
    const entity = ref.kind === "point" ? unit.graph.points.find(point => point.key === ref.key) :
      unit.graph.bearings.find(bearing => bearing.key === ref.key);
    const name = authoredName ?? (entity && ("id" in entity ? entity.id : "handle" in entity ? entity.handle : undefined));
    const occurrence = unit.occurrences.find(item => item.id === endpoint.occurrenceId)!;
    const excerpt = Array.from(entity?.text ?? occurrence.text).slice(0, 42).join("");
    const label = name ? `@${name}` : `L${occurrence.line}${excerpt ? ` · ${excerpt}` : ""}`;
    const control = html("button", "cog-reading-reference", parent);
    control.type = "button";
    control.dataset.readingReference = endpoint.occurrenceId;
    control.dataset.ref = ref.key; control.dataset.refKind = ref.kind;
    control.textContent = label;
    control.title = `${ref.kind === "point" ? "Point" : "Bearing"} ${label}; select passage at line ${occurrence.line}. Enter ${options.onNavigate ? "opens source" : "selects"}.`;
    control.setAttribute("aria-label", `${ref.kind === "point" ? "Point" : "Bearing"} ${label}, line ${occurrence.line}`);
  }
  function relation(source: ReadingOccurrence, parent: HTMLElement, bearingKey?: string): void {
    const unit = projection!.units[source.unitIndex];
    for (const route of unit.bearings.filter(route => bearingKey ? route.bearing.key === bearingKey : route.occurrenceId === source.id)) {
      const summary = html("div", "cog-reading-relation", parent);
      summary.dataset.kind = route.bearing.kind;
      html("span", "cog-reading-relation-kind", summary).textContent =
        `${route.sources.length > 1 ? "jointly " : ""}${bearingMark(route.bearing.kind).name}`;
      if (route.bearing.handle) {
        reference(summary, source.unitIndex, {
          occurrenceId: source.id, ref: { kind: "bearing", key: route.bearing.key }, basis: "self"
        }, route.bearing.handle);
      }
      const endpoints = html("span", "cog-reading-endpoints", summary);
      route.sources.forEach((endpoint, index) => {
        if (index) endpoints.append(doc.createTextNode(" + "));
        reference(endpoints, source.unitIndex, endpoint);
      });
      endpoints.append(doc.createTextNode(" → "));
      reference(endpoints, source.unitIndex, route.target);
    }
  }
  function build(): void {
    prose.reset();
    lines.replaceChildren(); svg.replaceChildren(); diagnostics.replaceChildren(); rows = new Map(); order = [];
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
    const last = projection.rows.at(-1);
    for (const source of projection.rows) {
      // A file's final newline ends the last line; it is not an empty line of the document.
      if (source === last && source.kind === "source" && !source.raw && !source.diagnostics.length && projection.rows.length > 1) continue;
      const row = html("li", "cog-reading-row", lines);
      row.dataset.line = String(source.line);
      row.style.setProperty("--cog-reading-order", String(lines.childElementCount - 1));
      row.dataset.kind = source.kind === "source" ? "source" : source.recognition.kind;
      const number = html("span", "cog-reading-number", row); number.textContent = String(source.line); number.setAttribute("aria-hidden", "true");
      const glyph = html("span", "cog-reading-mark", row);
      const content = html("div", "cog-reading-content", row);
      if (source.kind === "occurrence") {
        row.dataset.occurrence = source.id; row.dataset.unit = String(source.unitIndex);
        if ((source.recognition.kind === "role" || source.recognition.kind === "use") && source.recognition.role) row.dataset.role = source.recognition.role;
        row.style.setProperty("--cog-reading-depth", String(source.depth));
        row.setAttribute("role", "group");
        row.title = source.raw;
        const control = html("button", "cog-reading-select", glyph);
        control.type = "button"; control.tabIndex = -1;
        mark(source, control);
        const authored = source.raw.slice(source.sourceSpan.startColumn - 1, source.sourceSpan.endColumn - 1);
        const failed = source.diagnostics.some(diagnostic => diagnostic.severity === "error");
        if (source.recognition.kind === "note") html("span", "cog-reading-tag", content).textContent = "note";
        if (!failed) {
          const declarations = source.references.filter(reference => reference.kind === "declares" && reference.name);
          if (declarations.length) {
            const names = html("div", "cog-reading-names", content);
            for (const declared of declarations) reference(names, source.unitIndex, {
              occurrenceId: source.id, ref: declared.ref, basis: "self"
            }, declared.name);
          }
          if (["edge", "linked"].includes(source.recognition.kind)) relation(source, content);
        }
        // Reading presents prose and authored names; raw syntax remains available for inspection.
        // Failed lines keep their complete annotation so the defect is never hidden by presentation.
        const text = html("div", "cog-reading-text", content);
        if (failed) text.textContent = authored;
        else prose.render(text, source.text);
        if (!failed && !["edge", "linked"].includes(source.recognition.kind)) relation(source, content);
        for (const used of source.references) if (!failed && used.kind === "uses") {
          const graph = projection.units[source.unitIndex].graph;
          const entity = used.ref.kind === "point" ? graph.points.find(point => point.key === used.ref.key) :
            graph.bearings.find(bearing => bearing.key === used.ref.key);
          const citation = html("div", "cog-reading-use", content);
          if (used.ref.kind === "bearing") relation(source, citation, used.ref.key);
          else reference(citation, source.unitIndex, { occurrenceId: source.id, ref: used.ref, basis: "self" }, used.name);
          citation.title = `Referenced ${used.ref.kind}; the local note above does not replace its content.`;
          if (entity?.text) prose.render(html("div", "cog-reading-shared-text", citation), entity.text);
        }
        if ((source.recognition.kind === "use" || source.recognition.kind === "bearingUse") &&
          !source.references.some(reference => reference.kind === "uses")) {
          html("span", "cog-reading-use", content).textContent = `@${source.recognition.ref?.id ?? "?"} unresolved`;
        }
        rows.set(source.id, { occurrence: source, element: row, mark: glyph, control }); order.push(source.id);
      } else content.textContent = source.raw || "\u00a0";
      if (source.diagnostics.length) {
        row.dataset.error = String(source.diagnostics.some(diagnostic => diagnostic.severity === "error"));
        const badge = html("span", "cog-reading-diagnostic", content);
        badge.textContent = source.diagnostics.map(diagnostic => diagnostic.code).join(" · ");
        badge.title = source.diagnostics.map(diagnostic => diagnostic.message).join("\n");
      }
    }
    observer?.disconnect();
    observer?.observe(page);
    for (const row of lines.children) observer?.observe(row);
  }

  /** One drawn connector between two rows; `junction` ends meet at the Bearing's diamond on its own row. */
  type Connector = { route: number; from: ReadingEndpoint | "junction"; to: ReadingEndpoint | "junction"; rows: [number, number] };
  /** Sources on their constructor's row meet the adjacent diamond; every output remains visible, including self-targets. */
  function connectorsOf(unitIndex: number): Connector[] {
    const unit = projection!.units[unitIndex], row = (id: string) => order.indexOf(id), out: Connector[] = [];
    const add = (connector: Connector) => {
      if (connector.rows[0] !== connector.rows[1] || connector.to !== "junction") out.push(connector);
    };
    unit.bearings.forEach((route, index) => {
      if (inline[unitIndex].has(route.bearing.key)) {
        const source = route.sources[0];
        if (source) add({ route: index, from: source, to: route.target, rows: [row(source.occurrenceId), row(route.target.occurrenceId)] });
        return;
      }
      const at = row(route.occurrenceId);
      for (const source of route.sources) add({ route: index, from: source, to: "junction", rows: [row(source.occurrenceId), at] });
      add({ route: index, from: "junction", to: route.target, rows: [at, row(route.target.occurrenceId)] });
    });
    return out;
  }
  /**
   * Reading draws an arc diagram in the left margin: each connector leaves its row horizontally,
   * runs vertically in its own lane and enters the other row horizontally. Lanes nest, and ports
   * order the stubs on a shared row, so connectors never overlap or cross on a row.
   */
  function paint(): void {
    frame = 0;
    if (destroyed || !projection) return;
    svg.replaceChildren();
    const compact = root.getBoundingClientRect().width < 600;
    root.dataset.compact = String(compact);
    const units = projection.units.map((unit, unitIndex) => {
      const connectors = connectorsOf(unitIndex);
      return { connectors, lanes: readingLanes(connectors.map(connector => connector.rows)) };
    });
    const hasJunction = projection.units.some((unit, unitIndex) => unit.bearings.some(route => !inline[unitIndex].has(route.bearing.key)));
    const laneCount = Math.max(0, ...units.flatMap(unit => unit.lanes.map(lane => lane + 1)));
    const inset = INSET + (hasJunction ? 12 : 0);
    const maxRail = compact ? 96 : 200;
    const step = laneCount ? Math.min(compact ? 7 : 10, (maxRail - inset - 8) / laneCount) : 0;
    const rail = laneCount ? Math.max(RAIL_MIN, Math.ceil(inset + (laneCount - 1) * step + 10)) : hasJunction ? inset + 10 : 0;
    root.style.setProperty("--cog-reading-rail", `${rail}px`);
    const box = page.getBoundingClientRect();
    svg.setAttribute("width", String(box.width)); svg.setAttribute("height", String(box.height));
    const ys: number[] = [];
    let edge = 0;
    order.forEach((id, index) => {
      const row = rows.get(id)!, mark = row.mark.getBoundingClientRect();
      edge = row.element.getBoundingClientRect().left - box.left - 2;
      ys[index] = mark.top - box.top + mark.height / 2;
    });
    const laneX = (lane: number) => edge - inset - lane * step, diamondX = edge - 10, DIAMOND = 6.5;
    projection.units.forEach((unit, unitIndex) => {
      const { connectors, lanes } = units[unitIndex];
      const junctionRow = new Map<string, number>();
      for (const route of unit.bearings) if (!inline[unitIndex].has(route.bearing.key)) junctionRow.set(route.bearing.key, order.indexOf(route.occurrenceId));
      // An endpoint that is the Bearing constructed on that row meets its diamond; anything else meets the row.
      const onDiamond = (end: ReadingEndpoint | "junction") => {
        if (end === "junction") return true;
        if (end.ref.kind !== "bearing" || !junctionRow.has(end.ref.key)) return false;
        return !!rows.get(end.occurrenceId)?.occurrence.references.some(reference => reference.kind === "constructs" && sameRef(reference.ref, end.ref));
      };
      // Ports: every connector end on a row gets its own vertical offset.
      const ends = new Map<number, { connector: number; side: 0 | 1; lane: number; up: boolean }[]>();
      connectors.forEach((connector, index) => connector.rows.forEach((row, side) => {
        const other = connector.rows[1 - side];
        ends.set(row, [...ends.get(row) ?? [], { connector: index, side: side as 0 | 1, lane: lanes[index], up: other < row }]);
      }));
      const offset = new Map<string, number>();
      for (const list of ends.values()) {
        const spacing = list.length > 1 ? Math.min(4.5, 14 / (list.length - 1)) : 0;
        readingPorts(list).forEach((port, i) => offset.set(`${list[i].connector}:${list[i].side}`, port * spacing));
      }
      const groups = unit.bearings.map(route => svgElement("g", {
        class: `cog-reading-bearing cog-tone-${bearingMark(route.bearing.kind).tone}`, "data-bearing": route.bearing.key, "data-unit": String(unitIndex),
        "data-subtle": String(route.bearing.derivedBy === "structural" && inline[unitIndex].has(route.bearing.key))
      }, svg));
      const glyphs = new Map<number, Position>();
      connectors.forEach((connector, index) => {
        const route = unit.bearings[connector.route], bearing = route.bearing, group = groups[connector.route];
        const lx = laneX(lanes[index]);
        const [a, b] = ([0, 1] as const).map(side => {
          const end = side ? connector.to : connector.from;
          // Separate the two ends of a self-target so its loop has an observable direction.
          const dy = connector.rows[0] === connector.rows[1] ? (side ? 4 : -4) : offset.get(`${index}:${side}`) ?? 0;
          // A diamond end stops on its edge; the diamond is drawn once, after every connector.
          return { x: onDiamond(end) ? diamondX - Math.max(1.5, DIAMOND - Math.abs(dy)) : edge, y: ys[connector.rows[side]] + dy };
        });
        const r = Math.min(CORNER, Math.abs(b.y - a.y) / 2, (Math.min(a.x, b.x) - lx) / 2), down = Math.sign(b.y - a.y);
        const d = `M${a.x} ${a.y}H${lx + r}Q${lx} ${a.y} ${lx} ${a.y + down * r}V${b.y - down * r}Q${lx} ${b.y} ${lx + r} ${b.y}H${b.x}`;
        svgElement("path", { d, class: `cog-reading-arc${bearingMark(bearing.kind).dashed ? " cog-reading-dashed" : ""}` }, group);
        const hit = svgElement("path", { d, class: "cog-reading-hit" }, group);
        hit.dataset.occurrence = route.occurrenceId; hit.dataset.ref = bearing.key;
        if (connector.to !== "junction") {
          svgElement("path", { class: "cog-reading-arrow", d: `M${b.x} ${b.y}L${b.x - 6} ${b.y - 3}L${b.x - 6} ${b.y + 3}Z` }, group);
        }
        if (inline[unitIndex].has(bearing.key)) glyphs.set(connector.route, { x: lx, y: (a.y + b.y) / 2 });
      });
      unit.bearings.forEach((route, index) => {
        const bearing = route.bearing, row = junctionRow.get(bearing.key);
        const glyph = row !== undefined ? { x: diamondX, y: ys[row] } : glyphs.get(index);
        if (!glyph) return;
        const symbol = svgElement("g", { transform: `translate(${glyph.x} ${glyph.y})`, class: "cog-reading-symbol" }, groups[index]);
        symbol.dataset.occurrence = route.occurrenceId; symbol.dataset.ref = bearing.key;
        svgElement("circle", { r: "11", fill: "transparent", stroke: "none" }, symbol);
        drawBearingGlyph(symbol, bearing.kind, row !== undefined, row !== undefined ? DIAMOND - 2.5 : 5.5);
        svgElement("title", {}, symbol).textContent = `${bearingMark(bearing.kind).name}${bearing.handle ? ` @${bearing.handle}` : ""}; line ${rows.get(route.occurrenceId)!.occurrence.line}`;
        // Selection is delegated below, so redraws do not accumulate listeners.
      });
    });
    guide();
  }
  const schedule = () => { if (!destroyed && !frame) { if (win) frame = win.requestAnimationFrame(paint); else paint(); } };
  const fromEvent = (event: Event): ReadingSelection | undefined => {
    const reference = (event.target as Element).closest<HTMLElement>("[data-reading-reference]");
    if (reference) {
      const row = rows.get(reference.dataset.readingReference!);
      return row && selectionFor(row.occurrence, { kind: reference.dataset.refKind as BearingTarget["kind"], key: reference.dataset.ref! });
    }
    const element = (event.target as Element).closest<HTMLElement | SVGElement>("[data-occurrence]");
    const row = element?.dataset.occurrence && rows.get(element.dataset.occurrence);
    return row ? selectionFor(row.occurrence, element?.dataset.ref ? { kind: "bearing", key: element.dataset.ref } :
      selected?.occurrenceId === row.occurrence.id ? selected.ref : undefined) : undefined;
  };
  // Native prose links and controls keep their own mouse and keyboard behavior.
  const proseInteraction = (event: Event) => {
    const control = (event.target as Element).closest("a, button, input, select, textarea, summary, [contenteditable], [role='button'], [role='link']");
    return !!control && !control.matches(".cog-reading-select, [data-reading-reference]");
  };
  root.addEventListener("click", event => {
    if (proseInteraction(event)) return;
    if (!(event.target as Element).closest(".cog-reading-select, [data-reading-reference]") && doc.getSelection()?.type === "Range") return;
    const next = fromEvent(event);
    if (next) {
      choose(next);
      if ((event.target as Element).closest("[data-reading-reference]")) reveal(rows.get(next.occurrenceId)!);
    }
  }, on);
  root.addEventListener("dblclick", event => { if (proseInteraction(event)) return; const next = fromEvent(event); if (next) { choose(next); options.onNavigate?.(next); } }, on);
  root.addEventListener("pointerover", event => { hovered = fromEvent(event); guide(); }, on);
  root.addEventListener("pointerleave", () => { hovered = undefined; guide(); }, on);
  root.addEventListener("focusin", event => { hovered = fromEvent(event); guide(); }, on);
  root.addEventListener("focusout", () => { hovered = undefined; guide(); }, on);
  root.addEventListener("keydown", event => {
    if (proseInteraction(event)) return;
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
      const reference = (event.target as Element).closest("[data-reading-reference]");
      const next = !reference && selected?.occurrenceId === current.occurrenceId ? selected : current;
      choose(next); if (event.key === "Enter") options.onNavigate?.(next);
    }
  }, on);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : undefined;
  observer?.observe(page);
  return {
    update(next) {
      alive(); const hadFocus = root.contains(doc.activeElement);
      root.dataset.entering = String(!projection && !options.reducedMotion?.());
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
      prose.destroy();
      root.remove(); rows.clear(); projection = undefined; full = []; inline = []; selected = undefined; hovered = undefined;
    }
  };
}
