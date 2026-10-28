import type { BearingTarget, GraphIR, Point, PointRef } from "@cogitatum/core";
import { bearingMark, createBearingChip, createMarkChip, drawBearingGlyph, drawPointGlyph } from "./marks.js";
import { createProseScope, isProseInteraction, type ProseRenderer } from "./prose.js";
import { projectContest, projectStrands, strandRootOf, type StrandKnot, type StrandRow, type StrandsProjection } from "./strands-projection.js";

export type StrandsViewOptions = {
  renderProse?: ProseRenderer;
  reducedMotion?: () => boolean;
  onSelect?: (ref: BearingTarget) => void;
  onClear?: () => void;
  onNavigate?: (ref: BearingTarget) => void;
};
export type StrandsView = {
  update(graph: GraphIR): void;
  /** Silent. An entity in these strands is selected in place; otherwise follow its target to a focus Point. */
  select(ref: BearingTarget): void;
  /** Silent; also leaves Challenge Focus. */
  clear(): void;
  destroy(): void;
};

const NS = "http://www.w3.org/2000/svg";
/** Lane pitch, left inset, Point glyph radius (focus larger) and the first line's centre within a row. */
const LANE = 20, PAD = 12, NODE = 7, FOCUS = 9.5, FIRST = 15;
const sameRef = (a?: BearingTarget, b?: BearingTarget) => !!a && !!b && a.kind === b.kind && a.key === b.key;

/**
 * Strands: the lines of reasoning that end at one focus Point, as lanes, with every other relation
 * placed as a knot on the Point or step it addresses. Selecting a challenge knot enters Challenge Focus,
 * which keeps the contested step, the path to the focus and what the step rests on in view.
 */
export function createStrandsView(container: HTMLElement, options: StrandsViewOptions = {}): StrandsView {
  const doc = container.ownerDocument, win = doc.defaultView;
  const html = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: Element) => {
    const element = doc.createElement(tag);
    element.className = className; parent?.append(element); return element;
  };
  const svgElement = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, parent: Element) => {
    const element = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) element.setAttribute(k, v);
    parent.append(element); return element;
  };
  const root = html("div", "cog-strands", container);
  const header = html("div", "cog-strands-header", root);
  const page = html("div", "cog-strands-page", root);
  const svg = svgElement("svg", { class: "cog-strands-lanes", "aria-hidden": "true" }, page);
  const list = html("ol", "cog-strands-rows", page);
  list.setAttribute("aria-label", "Strands. Up and Down move between rows; Left and Right choose a Point or Bearing in the row; Enter opens the source; Escape clears focus.");
  const footer = html("p", "cog-strands-outside", root);
  const prose = createProseScope(options.renderProse, () => schedule());
  const abort = new AbortController(), on = { signal: abort.signal };
  let graph: GraphIR | undefined, projection: StrandsProjection | undefined, focus: PointRef | undefined;
  let selected: BearingTarget | undefined, contest: string | undefined, frame = 0, destroyed = false;
  let items: { element: HTMLLIElement; row: StrandRow; refs: BearingTarget[] }[] = [];

  const pointLabel = (point: Point) => point.id ? `@${point.id}` : `L${point.sourceSpan?.startLine ?? "?"}`;
  const pointOf = (key: string) => graph!.points.find(point => point.key === key)!;
  const label = (point: Point) => point.declaration.form === "role" ? point.declaration.role : "Material";
  const targetLabel = (ref: BearingTarget) => {
    if (ref.kind === "point") return pointLabel(pointOf(ref.key));
    const bearing = graph!.bearings.find(item => item.key === ref.key)!;
    return bearing.handle ? `the step @${bearing.handle}` : `the step at L${bearing.sourceSpan?.startLine ?? "?"}`;
  };
  /** A strand Point's mark is drawn on its lane, so only knot passages carry an inline chip. */
  function passage(parent: HTMLElement, point: Point, className: string, chip = true): HTMLElement {
    const line = html("div", className, parent);
    line.dataset.point = point.key;
    if (chip) line.append(createMarkChip(doc, label(point), 14));
    prose.render(html("div", "cog-strands-text", line), point.text);
    if (point.id) html("span", "cog-strands-name", line).textContent = `@${point.id}`;
    return line;
  }
  /** Every displayed object, including relations within the knot, can be selected independently. */
  const knotRefs = (value: StrandKnot): BearingTarget[] => [value.bearing, ...value.relations]
    .flatMap(bearing => [{ kind: "bearing" as const, key: bearing.key },
      ...bearing.sources.map(source => ({ kind: "point" as const, key: source.key }))]);
  function knot(parent: HTMLElement, value: StrandKnot): void {
    const box = html("div", "cog-strands-knot", parent);
    box.dataset.polarity = value.polarity; box.dataset.bearing = value.bearing.key;
    const head = html("div", "cog-strands-knot-head", box);
    head.append(createBearingChip(doc, value.bearing.kind, 14));
    const on = value.on.kind === "bearing" ? graph!.bearings.find(b => b.key === value.on.key) : undefined;
    const subject = !on ? "" : on.handle ? `@${on.handle}`
      : `${on.sources.map(source => pointLabel(pointOf(source.key))).join(" + ")} → ${pointLabel(pointOf(on.target.key))}`;
    html("span", "cog-strands-kind", head).textContent = `${value.bearing.sources.length > 1 ? "jointly " : ""}${bearingMark(value.bearing.kind).name} ${on ? "the step" : "this Point"}`;
    // Authored names keep their case; only the relation words are set in small capitals.
    if (subject) { head.append(doc.createTextNode(" ")); html("span", "cog-strands-subject", head).textContent = subject; }
    for (const source of value.bearing.sources) passage(box, pointOf(source.key), "cog-strands-knot-source");
    if (value.bearing.text) html("div", "cog-strands-description", box).textContent = value.bearing.text;
    for (const relation of value.relations) {
      const item = html("div", "cog-strands-relation", box);
      item.dataset.bearing = relation.key;
      const head = html("div", "cog-strands-knot-head", item);
      head.append(createBearingChip(doc, relation.kind, 12));
      const target = targetLabel(relation.target), step = target.startsWith("the step ");
      html("span", "cog-strands-kind", head).textContent =
        `${relation.sources.length > 1 ? "jointly " : ""}${bearingMark(relation.kind).name}${step ? " the step" : ""}`;
      head.append(doc.createTextNode(" "));
      html("span", "cog-strands-subject", head).textContent = step ? target.slice("the step ".length) : target;
      for (const source of relation.sources) passage(item, pointOf(source.key), "cog-strands-relation-source");
      if (relation.text) html("div", "cog-strands-description", item).textContent = relation.text;
    }
    if (value.further) html("div", "cog-strands-further", box).textContent = `${value.further} further relation${value.further === 1 ? "" : "s"} below these; see Reading or Map.`;
  }

  function build(): void {
    prose.reset(); list.replaceChildren(); header.replaceChildren(); svg.replaceChildren(); items = [];
    projection = graph ? projectStrands(graph, focus) : undefined;
    root.dataset.empty = String(!projection);
    if (!projection) { footer.textContent = "No Points to follow."; return; }
    focus = { kind: "point", key: projection.focus.key };
    const endings = projection.roots;
    const atEnding = endings.some(point => point.key === projection!.focus.key);
    const candidates = atEnding ? endings : [projection.focus, ...endings];
    if (candidates.length) {
      html("span", "cog-strands-label", header).textContent = atEnding ? "Strands ending at" : "Strands focused at";
      for (const candidate of candidates) {
        const chip = html("button", "cog-strands-root", header);
        chip.type = "button"; chip.dataset.point = candidate.key;
        chip.setAttribute("aria-pressed", String(candidate.key === projection.focus.key));
        chip.append(createMarkChip(doc, label(candidate), 13));
        chip.append(doc.createTextNode(pointLabel(candidate)));
        chip.title = candidate.text;
      }
    }
    const clear = html("button", "cog-strands-clear", header);
    clear.type = "button"; clear.textContent = "Show all"; clear.hidden = true;
    clear.title = "Leave Challenge Focus"; clear.setAttribute("aria-keyshortcuts", "Escape");
    setGutter();
    projection.rows.forEach((row, index) => {
      const element = html("li", `cog-strands-row cog-strands-row-${row.kind}`, list);
      element.dataset.index = String(index); element.tabIndex = -1;
      const refs: BearingTarget[] = [];
      if (row.kind === "point") {
        element.dataset.point = row.point.key;
        refs.push({ kind: "point", key: row.point.key }, ...row.steps.map(step => ({ kind: "bearing" as const, key: step.bearing.key })));
        if (index === 0) element.classList.add("cog-strands-row-focus");
        passage(element, row.point, "cog-strands-point-line", false);
        if (row.via.length) {
          // How this Point carries upward: the relation, its handle, and where it lands when that is not the row above.
          const via = html("div", "cog-strands-via", element);
          // One upward step is already drawn by the lane; a merge into several is worth stating.
          via.dataset.single = String(row.via.length === 1);
          for (const [index, bearing] of row.via.entries()) {
            if (index) via.append(doc.createTextNode(" · "));
            const step = html("span", "cog-strands-via-step", via);
            step.dataset.bearing = bearing.key;
            step.textContent = `${bearing.sources.length > 1 ? "jointly " : ""}${bearingMark(bearing.kind).name}${bearing.handle ? " @" + bearing.handle : ""} ${pointLabel(pointOf(bearing.target.key))}`;
          }
        }
        for (const step of row.steps) if (step.bearing.text) {
          const description = html("div", "cog-strands-step", element);
          description.dataset.bearing = step.bearing.key;
          description.append(createBearingChip(doc, step.bearing.kind, 13, step.bearing.sources.length > 1));
          html("span", "", description).textContent = step.bearing.text;
          description.title = `${step.bearing.sources.map(source => pointLabel(pointOf(source.key))).join(" + ")} ${bearingMark(step.bearing.kind).name} ${pointLabel(row.point)}`;
        }
        if (row.cycles.length) html("div", "cog-strands-cycle", element).textContent =
          `Also connects to ${row.cycles.map(pointLabel).join(", ")} above, closing a cycle.`;
        for (const value of row.knots) { knot(element, value); refs.push(...knotRefs(value)); }
      } else {
        element.dataset.bearing = row.knot.bearing.key;
        knot(element, row.knot); refs.push(...knotRefs(row.knot));
      }
      items.push({ element, row, refs: [...new Map(refs.map(ref => [`${ref.kind}:${ref.key}`, ref])).values()] });
    });
    const { points, bearings } = projection.outside;
    footer.textContent = points || bearings
      ? `Outside these strands: ${points} Point${points === 1 ? "" : "s"}, ${bearings} Bearing${bearings === 1 ? "" : "s"}. Choose another ending above, or use Reading or Map.`
      : "";
    footer.hidden = !footer.textContent;
    observer?.disconnect(); observer?.observe(page);
    for (const item of items) observer?.observe(item.element);
  }

  function guide(): void {
    const scope = contest && projection ? projectContest(projection, contest) : undefined;
    const lit = scope?.rows;
    root.dataset.contest = String(!!lit?.size);
    const clear = header.querySelector<HTMLButtonElement>(".cog-strands-clear");
    if (clear) clear.hidden = !lit?.size;
    for (const [index, item] of items.entries()) {
      item.element.dataset.lit = String(!lit || lit.has(index));
      item.element.dataset.selected = String(item.refs.some(ref => sameRef(ref, selected)));
      for (const node of item.element.querySelectorAll<HTMLElement>("[data-bearing]")) {
        node.dataset.selected = String(sameRef({ kind: "bearing", key: node.dataset.bearing! }, selected));
        node.dataset.contested = String(node.dataset.bearing === contest);
        node.dataset.lit = String(!scope || scope.bearingKeys.has(node.dataset.bearing!));
      }
    }
    const tab = items.find(item => item.element.dataset.selected === "true") ?? items[0];
    for (const item of items) item.element.tabIndex = item === tab ? 0 : -1;
    // A lane segment belongs to the Points it joins, not to the row it passes through.
    const litPoints = scope?.pointKeys;
    for (const segment of svg.querySelectorAll<SVGGElement>("[data-row]")) {
      const rowLit = !lit || lit.has(Number(segment.dataset.row));
      for (const mark of segment.children) {
        const { to, bearing, through } = (mark as SVGElement).dataset;
        (mark as SVGElement).dataset.lit = String(!scope || (bearing ? scope.bearingKeys.has(bearing)
          : to ? litPoints!.has(to) && (rowLit || through === "true") : rowLit));
      }
    }
  }

  function setGutter(): number {
    const width = root.clientWidth || 720, gaps = (projection?.laneCount ?? 1) - 1;
    const pitch = Math.min(width < 480 ? 15 : LANE, Math.max(0, width * .35 - PAD * 2 - 8) / Math.max(1, gaps));
    const gutter = `${PAD * 2 + gaps * pitch + 8}px`;
    if (root.style.getPropertyValue("--cog-strands-lanes") !== gutter) root.style.setProperty("--cog-strands-lanes", gutter);
    return pitch;
  }
  /** Lanes are drawn after layout, from the measured top, first line and bottom of every row. */
  function paint(): void {
    frame = 0;
    if (destroyed || !projection) return;
    svg.replaceChildren();
    const pitch = setGutter(), x = (lane: number) => PAD + lane * pitch;
    const box = page.getBoundingClientRect();
    svg.setAttribute("width", String(box.width)); svg.setAttribute("height", String(box.height));
    const curve = (x1: number, y1: number, x2: number, y2: number) => {
      if (x1 === x2) return `M${x1} ${y1}V${y2}`;
      const m = (y1 + y2) / 2;
      return `M${x1} ${y1}C${x1} ${m} ${x2} ${m} ${x2} ${y2}`;
    };
    // A lane takes the colour of the step it carries: support, or a neutral answer.
    const carried = new Map<string, string>();
    for (const row of projection.rows) if (row.kind === "point") for (const step of row.steps) {
      for (const source of step.bearing.sources) if (!carried.has(source.key)) carried.set(source.key, step.bearing.kind);
    }
    const laneClass = (to?: string, kind = to ? carried.get(to) : undefined) =>
      `cog-strands-lane cog-strands-lane-${kind ?? "neutral"}${kind && bearingMark(kind).dashed ? " cog-strands-dashed" : ""}`;
    items.forEach(({ element, row }, index) => {
      const rect = element.getBoundingClientRect();
      // Centre the mark on the first line of the row's own wording, whatever its type size.
      const text = element.querySelector<HTMLElement>(":scope > .cog-strands-point-line > .cog-strands-text");
      const textTop = text ? text.getBoundingClientRect().top - box.top : undefined;
      const lineHeight = text ? parseFloat(win?.getComputedStyle(text).lineHeight ?? "") || 22 : 22;
      const top = rect.top - box.top, bottom = rect.bottom - box.top, mid = textTop !== undefined ? textTop + lineHeight / 2 : top + FIRST;
      const group = svgElement("g", { "data-row": String(index), class: "cog-strands-segment" }, svg);
      const path = (d: string, className = "cog-strands-lane", to?: string, through = false, bearing?: string) => {
        const element = svgElement("path", { d, class: className }, group);
        if (to) element.dataset.to = to;
        if (bearing) element.dataset.bearing = bearing;
        if (through) element.dataset.through = "true";
        return element;
      };
      // A knot sits on the lane where it bears, drawn with the Bearing glyph Map uses on a line,
      // and reaches its card with a hairline.
      const knotMarks = (lane: number, stub: boolean) => {
        for (const card of element.querySelectorAll<HTMLElement>(":scope > .cog-strands-knot")) {
          const head = card.querySelector(".cog-strands-knot-head")!.getBoundingClientRect();
          const y = head.top - box.top + head.height / 2, left = card.getBoundingClientRect().left - box.left;
          const kind = graph!.bearings.find(b => b.key === card.dataset.bearing)!.kind;
          const mark = svgElement("g", { class: `cog-strands-knot-mark cog-tone-${bearingMark(kind).tone}`, "data-bearing": card.dataset.bearing! }, group);
          if (stub) svgElement("path", { d: `M${x(lane)} ${mid + NODE}V${y}`, class: "cog-strands-knot-stub" }, mark);
          svgElement("path", { d: `M${x(lane) + 7} ${y}H${left}`, class: "cog-strands-knot-reach" }, mark);
          const glyph = svgElement("g", { transform: `translate(${x(lane)} ${y})` }, mark);
          drawBearingGlyph(glyph, kind, false, 6);
        }
      };
      if (row.kind === "knot") {
        row.before.forEach((slot, lane) => { if (slot) path(`M${x(lane)} ${top}V${bottom}`, laneClass(slot), slot, true); });
        knotMarks(row.lane, false);
        return;
      }
      row.before.forEach((slot, lane) => {
        if (!slot) return;
        // The focus has nothing above it to continue.
        if (slot === row.point.key) { if (index) path(curve(x(lane), top, x(row.lane), mid - NODE), laneClass(slot)); }
        else path(`M${x(lane)} ${top}V${bottom}`, laneClass(slot), slot, true);
      });
      for (const step of row.steps) {
        const joint = step.lanes.length > 1;
        const from = joint ? mid + NODE + 11 : mid + NODE;
        if (joint) {
          path(`M${x(row.lane)} ${mid + NODE}V${from - 4}`, laneClass(undefined, step.bearing.kind), undefined, false, step.bearing.key);
          const junction = svgElement("g", { transform: `translate(${x(row.lane)} ${from})`, class: "cog-strands-junction", "data-bearing": step.bearing.key }, group);
          drawBearingGlyph(junction, step.bearing.kind, true, 2.6);
        }
        step.lanes.forEach((lane, i) => path(curve(x(row.lane), joint ? from + 5 : from, x(lane), bottom),
          laneClass(undefined, step.bearing.kind),
          step.bearing.sources.filter(source => !row.cycles.some(p => p.key === source.key))[i]?.key, false, step.bearing.key));
      }
      knotMarks(row.lane, !row.steps.length);
      // The Point's own mark sits on its lane; the focus is larger and ringed.
      const node = svgElement("g", { transform: `translate(${x(row.lane)} ${mid})`, class: `cog-strands-node${index === 0 ? " cog-strands-focus" : ""}` }, group);
      if (index === 0) svgElement("circle", { r: String(FOCUS + 4), class: "cog-strands-focus-ring" }, node);
      drawPointGlyph(node, label(row.point), index === 0 ? FOCUS : NODE);
    });
    guide();
  }
  const schedule = () => { if (!destroyed && !frame) { if (win) frame = win.requestAnimationFrame(paint); else paint(); } };

  function choose(ref: BearingTarget | undefined, notify = true): void {
    selected = ref;
    const bearing = ref?.kind === "bearing" ? graph?.bearings.find(b => b.key === ref.key) : undefined;
    // A selected challenge knot is the contest; selecting anything else inside it keeps it.
    if (bearing?.kind === "challenges" && items.some(item => item.row.kind === "knot" ? item.row.knot.bearing.key === bearing.key
      : item.row.knots.some(k => k.bearing.key === bearing.key))) contest = bearing.key;
    else if (!ref) contest = undefined;
    guide();
    if (notify) { if (ref) options.onSelect?.(ref); else options.onClear?.(); }
  }
  const refFrom = (target: Element): BearingTarget | undefined => {
    const object = target.closest<HTMLElement>("[data-bearing], [data-point]");
    if (object?.dataset.bearing) return { kind: "bearing", key: object.dataset.bearing };
    return object?.dataset.point ? { kind: "point", key: object.dataset.point } : undefined;
  };
  const proseInteraction = (target: Element) => isProseInteraction(target, ".cog-strands-root, .cog-strands-clear");
  root.addEventListener("click", event => {
    const target = event.target as Element;
    if (proseInteraction(target)) return;
    if (target.closest(".cog-strands-clear")) { choose(undefined); items[0]?.element.focus({ preventScroll: true }); return; }
    const chip = target.closest<HTMLElement>(".cog-strands-root");
    if (chip) { focus = { kind: "point", key: chip.dataset.point! }; contest = undefined; build(); schedule(); choose(focus); return; }
    if (doc.getSelection()?.type === "Range") return;
    const ref = refFrom(target);
    if (ref) choose(ref);
  }, on);
  root.addEventListener("dblclick", event => { if (proseInteraction(event.target as Element)) return; const ref = refFrom(event.target as Element); if (ref) { choose(ref); options.onNavigate?.(ref); } }, on);
  root.addEventListener("keydown", event => {
    if (proseInteraction(event.target as Element)) return;
    const row = (event.target as Element).closest<HTMLElement>(".cog-strands-row");
    if (event.key === "Escape" && (contest || selected)) { event.preventDefault(); contest = undefined; choose(undefined); return; }
    if (!row) return;
    const index = Number(row.dataset.index);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
      next.element.focus({ preventScroll: false }); choose(next.refs[0]);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const refs = items[index].refs, at = refs.findIndex(ref => sameRef(ref, selected));
      choose(refs[(at + (event.key === "ArrowRight" ? 1 : -1) + refs.length) % refs.length]);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const refs = items[index].refs, ref = refs.find(ref => sameRef(ref, selected)) ?? refs[0];
      choose(ref); if (event.key === "Enter") options.onNavigate?.(ref);
    }
  }, on);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : undefined;

  return {
    update(next) {
      if (destroyed) throw new Error("This strands view has been destroyed.");
      const name = focus ? graph?.points.find(point => point.key === focus!.key)?.id : undefined;
      graph = next; selected = undefined; contest = undefined;
      // Compilation keys are revision-local; only an authored name can retain the focus.
      const retained = name ? next.points.find(point => point.id === name) : undefined;
      focus = retained ? { kind: "point", key: retained.key } : undefined;
      build(); guide(); schedule();
    },
    select(ref) {
      if (destroyed || !graph) return;
      if (!items.some(item => item.refs.some(r => sameRef(r, ref)))) {
        let target: BearingTarget | undefined = ref;
        const seen = new Set<string>();
        while (target?.kind === "bearing" && !seen.has(target.key)) {
          seen.add(target.key);
          target = graph.bearings.find(bearing => bearing.key === target!.key)?.target;
        }
        const owner = target?.kind === "point" ? strandRootOf(graph, target) : undefined;
        if (owner) { focus = { kind: "point", key: owner.key }; contest = undefined; build(); schedule(); }
      }
      // A relation deeper than the bounded knot preview may not be on an ending's page.
      // A selected Point can always be inspected as its own focus.
      if (ref.kind === "point" && !items.some(item => item.refs.some(r => sameRef(r, ref))) && graph.points.some(point => point.key === ref.key)) {
        focus = ref; contest = undefined; build(); schedule();
      }
      choose(ref, false);
      const reduced = options.reducedMotion?.() || win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      items.find(item => item.refs.some(r => sameRef(r, ref)))?.element.scrollIntoView?.({ block: "nearest", behavior: reduced ? "instant" : "smooth" });
    },
    clear() { if (!destroyed) { contest = undefined; choose(undefined, false); } },
    destroy() {
      if (destroyed) return;
      destroyed = true; abort.abort(); observer?.disconnect(); if (frame) win?.cancelAnimationFrame(frame);
      prose.destroy(); root.remove(); items = []; graph = undefined; projection = undefined;
    }
  };
}
