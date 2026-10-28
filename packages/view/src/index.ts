import type { BearingTarget, GraphIR } from "@cogitatum/core";
import { endingPoints, focusNeighborhood, guidanceSubject, projectExploration, projectGraph, referenceKey, type GraphLink, type GraphNode, type GraphProjection } from "./projection.js";
import { layoutGraph, type Point2 } from "./layout.js";
import { createDragMotion, type DragReach } from "./motion.js";
import { labelWidth, wrapMapLabel, type LabelLine } from "./map-label.js";
import { bearingMark, drawBearingGlyph, drawPointGlyph, MARK_TYPE, pointMark } from "./marks.js";
export * from "./projection.js";
export * from "./layout.js";
export * from "./marks.js";
export * from "./reading-projection.js";
export * from "./reading.js";
export * from "./commitment.js";
export * from "./strands-projection.js";
export * from "./strands.js";
export type { ProseRenderer, ProseRenderRequest } from "./prose.js";

export type GraphViewOptions = {
  direction?: "down" | "right";
  /** The host may additionally disable motion; system reduced-motion is always respected. */
  reducedMotion?: () => boolean;
  /** Draw the first drawing in when it comes into view: points in reading order, then each line traced to its mark. */
  entrance?: boolean;
  onSelect?: (node: GraphNode) => void;
  onClear?: () => void;
  onNavigate?: (node: GraphNode) => void;
};
export type GraphView = {
  /** Scope identifies one source unit; anonymous keys never survive an update. */
  update(graph: GraphIR, scope: string): void;
  resetLayout(): void;
  select(ref: BearingTarget): void;
  clear(): void;
  fit(): void;
  zoom(factor: number): void;
  destroy(): void;
};

const NS = "http://www.w3.org/2000/svg";
/** An ending's mark is drawn this much larger, so the conclusions anchor the drawing. */
const ENDING = 1.3;
const POINT_R = 9, FOCUS_R = 15, RING_GAP = 3.2, JUNCTION_R = 10, LABEL_K = .6, READ_K = .78, DRAG_SLOP = 4, MIN_K = .3, MAX_K = 2.2;
type Camera = { k: number; tx: number; ty: number };
type Shape = { id: string; node: GraphNode; g: SVGGElement; glyph?: SVGGElement; label?: SVGTextElement; labelHit?: SVGRectElement; inline: boolean };

/**
 * Framework-neutral mount/update/destroy lifecycle. Positions live in a world space; the camera maps
 * them to pixels; wording keeps its reading size while Point glyphs scale within bounds.
 */
export function createGraphView(container: HTMLElement, options: GraphViewOptions = {}): GraphView {
  const doc = container.ownerDocument, win = doc.defaultView;
  const element = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string> = {}, parent?: Element) => {
    const node = doc.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    parent?.append(node);
    return node;
  };
  const svg = element("svg", { class: "cog-graph", role: "group",
    "aria-label": `Inquiry graph. Select a mark to follow its connections. Arrow keys move; ${options.onNavigate ? "Enter opens source" : "Enter selects"}; Escape clears.` });
  const edgeLayer = element("g", { class: "cog-edges" }, svg), glyphLayer = element("g", { class: "cog-bearings" }, svg), nodeLayer = element("g", { class: "cog-nodes" }, svg);
  container.append(svg);

  let full: GraphProjection = { nodes: [], links: [] }, topology: GraphProjection = { nodes: [], links: [] };
  let inline = new Map<string, GraphLink>(), shapes = new Map<string, Shape>(), order: string[] = [];
  /** Points that bear on nothing yet have something bearing on them: the inquiry's conclusions. */
  let endings = new Set<string>();
  let world = new Map<string, Point2>(), camera: Camera = { k: 1, tx: 0, ty: 0 }, size = { w: 0, h: 0 };
  let scope = "", selected: string | undefined, hovered: string | undefined;
  let destroyed = false, cameraTouched = false, frame = 0, settleFrame = 0;
  /**
   * While a pinch or wheel zoom is in motion, wording keeps the line breaks it had when the zoom began and
   * links keep their curves, so nothing reflows under the fingers; both settle once, when the zoom rests.
   */
  let zoomHold = false, zoomRest = 0;
  const bends = new Map<string, number>();
  /** Positions to restore after an update; `held` are the marks the reader placed directly. */
  const arrangement = new Map<string, Point2>();
  const held = new Set<string>();
  const abort = new AbortController(), on = { signal: abort.signal };
  const positionKey = (node: GraphNode) => node.name ? `${node.ref.kind}:@${node.name}` : node.id;
  const motionPreference = win?.matchMedia?.("(prefers-reduced-motion: reduce)");
  const reduced = () => !!options.reducedMotion?.() || !!motionPreference?.matches;
  const nodeById = (id?: string) => id ? full.nodes.find(node => node.id === id) : undefined;
  const screen = (p: Point2) => ({ x: p.x * camera.k + camera.tx, y: p.y * camera.k + camera.ty });

  // ── entrance: once, the first time a drawing is seen, like a constellation being traced ──
  // `pending` waits for the drawing to come into view; `began` is when tracing started.
  const POINT_DELAY = 110, POINT_IN = 520, LINE_IN = 640;
  let entrance: { pending: boolean; began: number } | undefined = options.entrance ? { pending: true, began: 0 } : undefined;
  // Each point and line starts at once and settles slowly, as a pen sets down and a star steadies (quartic ease-out).
  const entranceEase = (t: number) => 1 - (1 - t) ** 4;
  const entranceAt = (delay: number, length: number) =>
    !entrance ? 1 : entrance.pending ? 0 : entranceEase(Math.max(0, Math.min(1, ((win?.performance.now() ?? 0) - entrance.began - delay) / length)));

  // ── text measurement (fixed CSS pixel sizes from the shared mark type scale) ──
  // Line height follows the host's label type, so a host may set the wording larger than the shared scale.
  let measure: CanvasRenderingContext2D | null | undefined, font = "", codeFont = "", lineHeight: number = MARK_TYPE.lineHeight;
  const wrapCache = new Map<string, LabelLine[]>();
  function textWidth(s: string, code = false): number {
    measure ??= doc.createElement("canvas").getContext?.("2d") ?? null;
    if (measure) { measure.font = code ? codeFont : font; return measure.measureText(s).width; }
    return s.length * MARK_TYPE.text * (code ? .6 : .55);
  }
  const lineWidth = (line: LabelLine) => labelWidth(line, textWidth);
  const literalLine = (text: string): LabelLine[] => [[{ text }]];
  function wrap(text: string, width: number, lines: number): LabelLine[] {
    const key = `${width}|${lines}|${text}`;
    if (!wrapCache.has(key)) wrapCache.set(key, wrapMapLabel(text, width, lines, textWidth));
    return wrapCache.get(key)!;
  }

  // ── build DOM for the current topology ──
  function build(): void {
    nodeLayer.replaceChildren(); glyphLayer.replaceChildren(); shapes = new Map();
    // Measure with the host's resolved text style so wrapping matches what is painted.
    const probe = element("text", { class: "cog-text" }, nodeLayer), style = win?.getComputedStyle(probe);
    const fontSize = style?.fontSize || `${MARK_TYPE.text}px`;
    font = `${fontSize} ${style?.fontFamily || "serif"}`;
    const codeStyle = win?.getComputedStyle(element("tspan", { class: "cog-code" }, probe));
    codeFont = `${codeStyle?.fontSize || fontSize} ${codeStyle?.fontFamily || "monospace"}`;
    lineHeight = Math.max(MARK_TYPE.lineHeight, Math.round(parseFloat(fontSize) * 1.28));
    probe.remove(); wrapCache.clear();
    for (const node of topology.nodes) {
      const isPoint = node.ref.kind === "point";
      const g = element("g", { class: `cog-node ${isPoint ? "point" : "bearing cog-junction-node"} cog-${node.label.replace("?", "-open")}`, role: "button", tabindex: "-1", "data-node": node.id }, nodeLayer);
      element("circle", { class: "cog-hit", r: isPoint ? "22" : "16" }, g);
      const ring = element("circle", { class: "cog-focus-ring", r: String(isPoint ? FOCUS_R : 16) }, g);
      // A point's glyph and focus ring scale together with the drawing; see pointScale.
      const glyph = isPoint ? element("g", { class: "cog-point-scale" }, g) : undefined;
      // A marked point is drawn as a star on an engraved chart: the disc, and a hairline ring a little apart.
      if (glyph) { glyph.append(ring); if (pointMark(node.label).shape === "filled") element("circle", { class: "cog-glyph-halo", r: String(POINT_R + RING_GAP) }, glyph); drawPointGlyph(glyph, node.label, POINT_R); } else drawBearingGlyph(g, node.label, true, JUNCTION_R - 2.5);
      // A junction's name sits beside its diamond, so links may enter it from below without detouring.
      const labelHit = element("rect", { class: "cog-hit cog-label-hit", width: "0", height: "0", "aria-hidden": "true" }, g);
      const label = element("text", { class: isPoint ? "cog-text" : "cog-label", "text-anchor": isPoint ? "middle" : "start" }, g);
      describe(g, node);
      shapes.set(node.id, { id: node.id, node, g, glyph, label, labelHit, inline: false });
    }
    for (const [id] of inline) {
      const node = nodeById(id)!;
      const g = element("g", { class: `cog-node bearing cog-inline-bearing cog-${node.label}`, role: "button", tabindex: "-1", "data-node": id }, glyphLayer);
      element("circle", { class: "cog-hit", r: "13" }, g);
      element("circle", { class: "cog-focus-ring", r: "12" }, g);
      drawBearingGlyph(g, node.label, false);
      describe(g, node);
      shapes.set(id, { id, node, g, inline: true });
    }
    const line = (id: string) => nodeById(id)?.sourceSpan?.startLine ?? Number.MAX_SAFE_INTEGER;
    order = [...shapes.keys()].sort((a, b) => line(a) - line(b));
    for (const id of endings) shapes.get(id)?.g.classList.add("cog-ending");
  }
  function describe(g: SVGGElement, node: GraphNode): void {
    const name = node.ref.kind === "point" ? pointMark(node.label).name : bearingMark(node.label).name;
    const sources = node.ref.kind === "bearing" ? full.links.filter(link => link.target === node.id && link.segment === "input").length : 0;
    const shape = node.ref.kind === "bearing" ? (sources > 1 ? `joint, ${sources} sources` : "one source") : "";
    const text = node.text === node.label ? "" : `: ${node.text}`;
    const notes = node.noteCount ? `; ${node.noteCount} source note${node.noteCount === 1 ? "" : "s"}` : "";
    g.setAttribute("aria-label", `${name}${shape ? ` (${shape})` : ""}${node.name ? ` @${node.name}` : ""}${text}${notes}`);
    const title = element("title", {}, g); title.textContent = `${name}${node.name ? ` @${node.name}` : ""}${text}${notes}`;
    if (node.noteCount) {
      element("text", { class: "cog-note-count", x: "11", y: "-10", "aria-hidden": "true" }, g).textContent = String(node.noteCount);
    }
  }

  // ── geometry ──
  function baseLayout(): Map<string, Point2> {
    const positioned = layoutGraph(topology, { direction: options.direction, wrapWidth: Math.max(380, (size.w || 900) / .8) });
    return new Map(positioned.map(node => [node.id, { x: node.x, y: node.y }]));
  }
  function applyArrangement(positions: Map<string, Point2>): Map<string, Point2> {
    for (const node of topology.nodes) { const saved = arrangement.get(positionKey(node)); if (saved) positions.set(node.id, { ...saved }); }
    return positions;
  }
  // At full scale or larger there is room between layers, so wording gets a reading measure: three lines at
  // up to 200px. A dense inquiry drawn smaller keeps the caption measure of two lines, so wording never meets a junction.
  const roomy = (k: number) => k >= .95;
  // Points grow and shrink with the drawing, within bounds, so zooming in brings them closer as a whole;
  // wording keeps its reading size. Every point is the same size at any one zoom.
  const pointScale = (k = camera.k) => Math.max(.85, Math.min(1.45, k));
  const pointR = (k = camera.k) => POINT_R * pointScale(k);
  /** Links stop at a marked point's ring, not its disc, so arrowheads touch the ring. */
  const ringR = (k = camera.k) => (POINT_R + RING_GAP) * pointScale(k);
  const pointLabelWidth = (k: number) => roomy(k) ? Math.min(200, 200 * k - 14) : Math.max(96, Math.min(150, 168 * k - 14));
  function labelLines(shape: Shape, k = camera.k, focused = shape.id === selected || shape.id === hovered): LabelLine[] {
    const node = shape.node;
    if (shape.inline) return [];
    if (node.ref.kind === "bearing") return node.name && (k >= LABEL_K || focused) ? literalLine(`@${node.name}`) : [];
    // The overview keeps a conclusion's wording, the subject of the drawing, and every other authored name,
    // so a wide inquiry is still navigable without all of its wording.
    if (k < LABEL_K && !focused) return endings.has(shape.id) ? wrap(node.text, 240, 1) : node.name ? literalLine(`@${node.name}`) : [];
    // A conclusion always gets the wide measure, with as many lines as the layers below leave room for.
    if (endings.has(shape.id)) return wrap(node.text, 200, k >= .75 ? 3 : 2);
    const width = pointLabelWidth(k);
    // Three lines once the layers have room for them beneath a point; two in a denser drawing.
    return wrap(node.text, focused ? Math.max(width, roomy(k) ? 200 : 150) : width, k >= .75 ? 3 : 2);
  }
  /** Screen-pixel reach of a mark and its unfocused wording on either side of the mark's centre. */
  function reach(shape: Shape, k: number): { left: number; right: number } {
    const lines = labelLines(shape, k, false);
    if (!lines.length) return { left: 13, right: 13 };
    if (shape.node.ref.kind === "bearing") return { left: 13, right: JUNCTION_R + 7 + lineWidth(lines[0]) };
    const half = Math.max(14, ...lines.map(line => lineWidth(line) / 2 + 4));
    return { left: half, right: half };
  }
  /** The drawn baseline remains authoritative while a zoom holds the wording in place. */
  const wordingBottom = (shape?: Shape) => {
    const last = shape?.label?.lastElementChild;
    return last ? Number(last.getAttribute("y")) + 5 : undefined;
  };
  /**
   * Route links around a Point's wording whenever the other endpoint lies below it.
   * `port` shifts the end sideways so links sharing a side of one mark fan out instead of bundling.
   */
  function anchor(id: string, toward: Point2, port = 0): Point2 {
    const p = screen(world.get(id)!), shape = shapes.get(id);
    const isPoint = shape?.node.ref.kind === "point", r = isPoint ? ringR() * (endings.has(id) ? ENDING : 1) + 1.5 : JUNCTION_R + 1;
    if (isPoint && shape?.label && toward.y > p.y + r) {
      return { x: p.x + port, y: p.y + (wordingBottom(shape) ?? Math.sqrt(r * r - port * port)) };
    }
    if (port && Math.abs(toward.y - p.y) > r) return { x: p.x + port, y: p.y + Math.sign(toward.y - p.y) * Math.sqrt(r * r - port * port) };
    const dx = toward.x - p.x, dy = toward.y - p.y, d = Math.hypot(dx, dy) || 1;
    return { x: p.x + dx / d * r, y: p.y + dy / d * r };
  }

  function paint(): void {
    frame = 0;
    if (destroyed) return;
    // Inspection takes precedence over decorative opacity and partially traced routes.
    if (entrance && (reduced() || selected || hovered)) finishEntrance();
    const focus = focusNeighborhood(full, guidanceSubject(nodeById(selected), nodeById(hovered))?.ref);
    const related = new Set(focus.nodeIds), active = new Set(focus.bearingKeys), guided = related.size > 0;
    svg.dataset.guided = String(guided);
    const rank = new Map(order.filter(id => !shapes.get(id)?.inline).map((id, index) => [id, index]));
    const pointIn = (id: string) => entranceAt((rank.get(id) ?? 0) * POINT_DELAY, POINT_IN);
    const lineIn = (source: string, target: string) => entranceAt(Math.max(rank.get(source) ?? 0, rank.get(target) ?? 0) * POINT_DELAY + POINT_IN * .6, LINE_IN);
    for (const shape of shapes.values()) {
      if (shape.inline) continue;
      const p = screen(world.get(shape.id)!);
      const shown = pointIn(shape.id);
      shape.g.style.opacity = entrance ? String(shown) : "";
      if (shape.glyph) shape.glyph.style.scale = entrance ? String(.4 + .6 * shown) : "";
      shape.g.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
      shape.glyph?.setAttribute("transform", `scale(${(pointScale() * (endings.has(shape.id) ? ENDING : 1)).toFixed(3)})`);
      if (!zoomHold) {
        const lines = labelLines(shape), label = shape.label!, isPoint = shape.node.ref.kind === "point";
        label.replaceChildren();
        const overview = isPoint && camera.k < LABEL_K && shape.id !== selected && shape.id !== hovered;
        label.classList.toggle("cog-overview", overview && !endings.has(shape.id));
        label.classList.toggle("cog-overview-ending", overview && endings.has(shape.id));
        const top = FOCUS_R * pointScale() * (endings.has(shape.id) ? ENDING : 1) + (overview ? 14 : lineHeight);
        lines.forEach((runs, i) => {
          const line = element("tspan", isPoint ? { x: "0", y: String(top + i * lineHeight) } : { x: String(JUNCTION_R + 5), y: "4" }, label);
          for (const run of runs) {
            if (run.code) element("tspan", { class: "cog-code" }, line).textContent = run.text;
            else line.append(doc.createTextNode(run.text));
          }
        });
      }
      shape.g.dataset.related = String(!guided || related.has(shape.id));
    }
    edgeLayer.replaceChildren();
    const pairs = new Map<string, number>();
    // Marks and their wording are obstacles; a link prefers the candidate curve that crosses fewest.
    const obstacles = [...shapes.values()].filter(shape => !shape.inline).map(shape => {
      const p = screen(world.get(shape.id)!), lines = shape.label?.childNodes.length ?? 0;
      if (shape.node.ref.kind === "bearing") {
        const right = lines ? JUNCTION_R + 7 + textWidth(shape.label!.textContent ?? "") : 13;
        return { id: shape.id, x0: p.x - 13, x1: p.x + right, y0: p.y - 13, y1: p.y + 13 };
      }
      const half = lines ? Math.max(14, ...[...shape.label!.children].map(line => (line as SVGTSpanElement).getComputedTextLength() / 2 + 4)) : 13;
      return { id: shape.id, x0: p.x - half, x1: p.x + half, y0: p.y - pointR() - 4, y1: p.y + (wordingBottom(shape) ?? pointR() + 5) };
    });
    const at = (a: Point2, c1: Point2, c2: Point2, t: Point2, s: number) => {
      const u = 1 - s;
      return { x: u*u*u*a.x + 3*u*u*s*c1.x + 3*u*s*s*c2.x + s*s*s*t.x, y: u*u*u*a.y + 3*u*u*s*c1.y + 3*u*s*s*c2.y + s*s*s*t.y };
    };
    const crossings = (ends: string[], a: Point2, c1: Point2, c2: Point2, t: Point2) => {
      let hits = 0;
      for (const box of obstacles) {
        if (ends.includes(box.id)) continue;
        for (let i = 1; i < 16; i++) { const p = at(a, c1, c2, t, i / 16); if (p.x > box.x0 && p.x < box.x1 && p.y > box.y0 && p.y < box.y1) { hits++; break; } }
      }
      return hits;
    };
    // Ports: tails leaving one side of a mark are ordered by where they go, so they fan instead of bundling.
    // Arrowheads keep converging on the mark; side-by-side heads would read as a doubled arrow.
    const ports = new Map<string, number>(), sides = new Map<string, { key: string; x: number }[]>();
    topology.links.forEach((link, index) => ([link.source, link.target] as const).forEach((id, end) => {
      if (end && link.segment === "output") return;
      const p = screen(world.get(id)!), other = screen(world.get(end ? link.source : link.target)!);
      if (Math.abs(other.y - p.y) <= 24) return;
      const side = `${id}|${other.y < p.y ? "up" : "down"}`;
      sides.set(side, [...sides.get(side) ?? [], { key: `${index}:${end}`, x: other.x }]);
    }));
    for (const [side, list] of sides) {
      if (list.length < 2) continue;
      const r = nodeById(side.split("|")[0])?.ref.kind === "point" ? pointR() : JUNCTION_R - 2;
      const spacing = Math.min(4, (r * 1.4) / (list.length - 1));
      list.sort((a, b) => a.x - b.x).forEach((item, i) => ports.set(item.key, (i - (list.length - 1) / 2) * spacing));
    }
    topology.links.forEach((link, index) => {
      const bearingId = referenceKey({ kind: "bearing", key: link.bearingKey }), bearing = nodeById(bearingId)!;
      const mark = bearingMark(bearing.label), isInline = inline.has(bearingId);
      const A0 = screen(world.get(link.source)!), T0 = screen(world.get(link.target)!);
      const pair = [link.source, link.target].sort().join("|"), nth = pairs.get(pair) ?? 0; pairs.set(pair, nth + 1);
      const tail = ports.get(`${index}:0`) ?? 0, head = ports.get(`${index}:1`) ?? 0;
      const a = anchor(link.source, T0, tail), t = anchor(link.target, A0, head);
      const dx = t.x - a.x, dy = t.y - a.y, len = Math.hypot(dx, dy) || 1;
      const curveFor = (bend: number): [Point2, Point2] => {
        // Layered links leave and enter vertically, as an S; parallel links and detours bow sideways.
        if (!bend && Math.abs(dy) > 24) {
          const h = Math.sign(dy) * Math.max(Math.abs(dy) * .5, Math.min(60, Math.abs(dx) * .3));
          // Fanned ends splay along their port so neighbouring tails part at once instead of running parallel.
          // The head end arrives straight, so every arrowhead sits square to its mark.
          return [{ x: a.x + tail * 4, y: a.y + h }, { x: t.x, y: t.y - h }];
        }
        const c = { x: (a.x + t.x) / 2 - dy / len * bend * len, y: (a.y + t.y) / 2 + dx / len * bend * len };
        return [c, c];
      };
      let [c1, c2] = curveFor(nth ? (nth % 2 ? 1 : -1) * Math.ceil(nth / 2) * .22 : 0);
      if (!nth) {
        const key = `${link.source}>${link.target}`;
        let bend = zoomHold ? bends.get(key) : undefined;
        if (bend === undefined) {
          bend = 0;
          let best = crossings([link.source, link.target], a, c1, c2, t);
          for (const option of [.2, -.2, .38, -.38]) {
            if (!best) break;
            const [d1, d2] = curveFor(option), hits = crossings([link.source, link.target], a, d1, d2, t);
            if (hits < best) { best = hits; bend = option; }
          }
          bends.set(key, bend);
        }
        if (bend) [c1, c2] = curveFor(bend);
      }
      const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${t.x.toFixed(1)} ${t.y.toFixed(1)}`;
      const on = !guided || active.has(link.bearingKey);
      const path = element("path", { d, class: `cog-link ${link.segment} cog-tone-${mark.tone}${mark.dashed ? " cog-dashed" : ""}`, "data-active": String(on), "data-bearing": link.bearingKey, "aria-hidden": "true" }, edgeLayer);
      const traced = lineIn(link.source, link.target);
      if (entrance && traced < 1) {
        // Traced from its source to its mark; a dashed relation simply fades in, keeping its dashes.
        if (mark.dashed) path.style.opacity = String(traced);
        else { path.setAttribute("pathLength", "1"); path.style.strokeDasharray = "1 1"; path.style.strokeDashoffset = String(1 - traced); }
      }
      if (link.segment === "output") {
        const hx = t.x - c2.x, hy = t.y - c2.y, hl = Math.hypot(hx, hy) || 1, ux = hx / hl, uy = hy / hl;
        // Support arrives as a slim engraved barb, notched where the line enters it.
        // A challenge ends in a bar across its line, the notation for a check rather than a push.
        const contest = bearing.label === "challenges";
        const head = element("path", { class: `cog-arrow${contest ? " cog-arrow-bar" : ""} cog-tone-${mark.tone}`, "data-active": String(on), "aria-hidden": "true",
          d: contest
            ? `M${t.x - ux * 1.5 - uy * 5.5} ${t.y - uy * 1.5 + ux * 5.5}L${t.x - ux * 1.5 + uy * 5.5} ${t.y - uy * 1.5 - ux * 5.5}`
            : `M${t.x} ${t.y}L${t.x - ux * 9 - uy * 3.2} ${t.y - uy * 9 + ux * 3.2}L${t.x - ux * 6.4} ${t.y - uy * 6.4}L${t.x - ux * 9 + uy * 3.2} ${t.y - uy * 9 - ux * 3.2}Z` }, edgeLayer);
        if (entrance) head.style.opacity = String(Math.max(0, traced * 4 - 3));
      }
      if (isInline) {
        element("path", { d, class: "cog-link-hit", "data-node": bearingId, "aria-hidden": "true" }, edgeLayer);
        const m = { x: .125 * a.x + .375 * c1.x + .375 * c2.x + .125 * t.x, y: .125 * a.y + .375 * c1.y + .375 * c2.y + .125 * t.y };
        const shape = shapes.get(bearingId)!;
        shape.g.setAttribute("transform", `translate(${m.x.toFixed(1)} ${m.y.toFixed(1)})`);
        shape.g.style.opacity = entrance ? String(traced) : "";
        shape.g.dataset.related = String(!guided || related.has(bearingId));
      }
    });
    const focused = svg.contains(doc.activeElement) ?
      doc.activeElement?.closest<SVGElement>("[data-node]")?.dataset.node : undefined;
    const tabStop = selected ?? focused ?? order[0];
    for (const shape of shapes.values()) {
      shape.g.setAttribute("aria-pressed", String(shape.id === selected));
      shape.g.setAttribute("tabindex", shape.id === tabStop ? "0" : "-1");
    }
    // Measure after all text and selected font weights are applied. Batch reads before writes
    // so label hit areas include actual host fonts and line gaps without a layout flush per node.
    // Held wording keeps its hit areas; measuring forces a layout, which a zoom cannot afford on every frame.
    const visible = svg.getClientRects().length > 0;
    const labelHits = zoomHold ? [] : [...shapes.values()].flatMap(shape => shape.labelHit ? [{
      hit: shape.labelHit,
      bounds: visible && shape.label!.childNodes.length ? shape.label!.getBBox() : undefined,
    }] : []);
    for (const { hit, bounds } of labelHits) {
      const box = bounds
        ? { x: bounds.x - 4, y: bounds.y - 4, width: bounds.width + 8, height: bounds.height + 8 }
        : { x: 0, y: 0, width: 0, height: 0 };
      for (const [name, value] of Object.entries(box)) hit.setAttribute(name, String(value));
    }
    if (entrance && !entrance.pending) {
      const last = Math.max(0, rank.size - 1) * POINT_DELAY + POINT_IN * .6 + LINE_IN;
      if ((win?.performance.now() ?? Infinity) - entrance.began >= last) { entrance = undefined; schedule(); }
      else schedule();
    }
  }
  const schedule = () => { if (!frame && !destroyed) frame = win?.requestAnimationFrame(paint) ?? (paint(), 0); };

  // ── camera ──
  function bounds() {
    const ps = [...world.values()];
    if (!ps.length) return { x: 0, y: 0, w: 1, h: 1 };
    const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(1, Math.max(...xs) - Math.min(...xs)), h: Math.max(1, Math.max(...ys) - Math.min(...ys)) };
  }
  function fitCamera(readingScale = true): Camera {
    // Wording keeps its pixel size while the drawing scales, so the fit must include it:
    // the widest scale at which every mark keeps `room` for links bowing around it and its wording stays inside.
    // Below LABEL_K, endings and authored names remain as compact orientation labels.
    const b = bounds(), room = size.w < 600 ? 40 : 96, margin = size.w < 600 ? 16 : 48, padTop = 40, padBottom = 76;
    const placed = [...world].flatMap(([id, p]) => { const shape = shapes.get(id); return shape && !shape.inline ? [{ shape, x: p.x }] : []; });
    const span = (k: number) => {
      let x0 = Infinity, x1 = -Infinity;
      for (const { shape, x } of placed) {
        const r = reach(shape, k);
        x0 = Math.min(x0, x * k - Math.max(room, r.left + margin)); x1 = Math.max(x1, x * k + Math.max(room, r.right + margin));
      }
      return placed.length ? { x0, x1 } : { x0: b.x * k - room, x1: (b.x + b.w) * k + room };
    };
    const fits = (k: number) => { const s = span(k); return s.x1 - s.x0 <= size.w; };
    // A small inquiry may be drawn larger than life so it fills its frame; text keeps its size.
    // A tall one in a full panel is not shrunk past reading: it opens on its conclusion at the top, worded,
    // and pans down. Explicit Fit instead includes the whole map, even below the manual zoom limit.
    const floor = readingScale ? (size.w >= 600 && size.h >= 480 ? READ_K : MIN_K) : 0;
    let k = Math.max(floor, Math.min(1.6, (size.h - padTop - padBottom) / b.h));
    if (!fits(k)) {
      let lo = readingScale ? MIN_K : 0, hi = k;
      for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
      k = lo;
    }
    const s = span(k);
    return { k, tx: (size.w - (s.x1 - s.x0)) / 2 - s.x0, ty: Math.max(padTop, (size.h - padBottom + padTop - b.h * k) / 2) - b.y * k };
  }
  function fit(): void {
    finishEntrance(); stopMotion(); resetGesture(); finishZoom();
    cameraTouched = true; camera = fitCamera(false); schedule();
  }
  // Fit may use a smaller scale than manual zoom; zooming out must never jump inward from it.
  const clampK = (k: number, from = camera.k) => Math.max(Math.min(MIN_K, from), Math.min(MAX_K, k));
  function finishZoom(): void {
    win?.clearTimeout(zoomRest); zoomRest = 0; zoomHold = false;
  }
  /** A wheel settles after a pause; a pinch keeps its wording until a finger leaves. */
  function holdWording(untilRelease = false): void {
    if (!win) return;
    zoomHold = true;
    win.clearTimeout(zoomRest); zoomRest = 0;
    if (!untilRelease) zoomRest = win.setTimeout(() => { finishZoom(); schedule(); }, 180);
  }
  function zoomAt(factor: number, x: number, y: number, continuous = false): void {
    finishEntrance(); stopMotion(); resetGesture();
    if (continuous) holdWording(); else finishZoom();
    const k = clampK(camera.k * factor);
    camera = { k, tx: x - (x - camera.tx) * (k / camera.k), ty: y - (y - camera.ty) * (k / camera.k) };
    cameraTouched = true; schedule();
  }
  /** Keep the focused mark and its wording visible without changing zoom or scrolling the host. */
  function revealShape(shape: Shape): void {
    const box = shape.g.getBoundingClientRect(), viewport = svg.getBoundingClientRect(), margin = 16;
    if (!viewport.width || !viewport.height) return;
    const shift = (start: number, end: number, low: number, high: number) =>
      end - start > high - low ? (low + high - start - end) / 2 : start < low ? low - start : end > high ? high - end : 0;
    const dx = shift(box.left, box.right, viewport.left + margin, viewport.right - margin);
    const dy = shift(box.top, box.bottom, viewport.top + margin, viewport.bottom - margin);
    if (!dx && !dy) return;
    camera = { ...camera, tx: camera.tx + dx, ty: camera.ty + dy };
    cameraTouched = true; schedule();
  }
  /** Re-frame when new content would no longer read inside the current view. */
  function needsRefit(next: Map<string, Point2>): boolean {
    if (!cameraTouched) return true;
    const ps = [...next.values()].map(screen);
    if (!ps.length) return false;
    const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
    const outside = Math.min(...xs) < -40 || Math.min(...ys) < -40 || Math.max(...xs) > size.w + 40 || Math.max(...ys) > size.h + 40;
    const lost = ps.length > 3 && (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) < size.w * size.h * .04;
    return outside || lost;
  }

  // ── transitions ──
  function moveTo(next: Map<string, Point2>, refit: boolean): void {
    stopMotion();
    const from = new Map([...next.keys()].map(id => [id, world.get(id) ?? next.get(id)!]));
    const camFrom = camera;
    world = new Map([...next].map(([id, p]) => [id, { ...p }]));
    const camTo = refit ? fitCamera() : camera;
    if (reduced() || !win) { camera = camTo; schedule(); return; }
    world = new Map([...from].map(([id, p]) => [id, { ...p }]));
    const start = win.performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 420), e = 1 - Math.pow(1 - t, 3);
      for (const [id, to] of next) { const f = from.get(id)!; world.set(id, { x: f.x + (to.x - f.x) * e, y: f.y + (to.y - f.y) * e }); }
      camera = { k: camFrom.k + (camTo.k - camFrom.k) * e, tx: camFrom.tx + (camTo.tx - camFrom.tx) * e, ty: camFrom.ty + (camTo.ty - camFrom.ty) * e };
      paint();
      if (t < 1) settleFrame = win.requestAnimationFrame(step);
    };
    settleFrame = win.requestAnimationFrame(step);
  }

  // ── selection ──
  function select(id: string | undefined, notify = true): void {
    finishEntrance(); finishZoom();
    selected = id;
    // Selection state is announced synchronously (aria-pressed), not on the next frame.
    if (frame) { win?.cancelAnimationFrame(frame); frame = 0; }
    paint();
    const node = nodeById(id);
    if (!notify) return;
    if (node) options.onSelect?.(node); else options.onClear?.();
  }
  function focusShape(id: string): void { const shape = shapes.get(id); if (shape) { selected = id; paint(); shape.g.focus({ preventScroll: true }); } }

  let motion: ReturnType<typeof createDragMotion> | undefined, motionReach: DragReach = "junctions";
  function stopMotion(): void {
    win?.cancelAnimationFrame(settleFrame);
    settleFrame = 0; motion = undefined;
  }
  function settle(now: number): void {
    if (!motion || reduced() || destroyed) { stopMotion(); return; }
    const { active, moved } = motion.step(now);
    for (const node of moved) {
      arrangement.set(positionKey(node), { ...world.get(node.id)! });
    }
    paint();
    if (active) settleFrame = win!.requestAnimationFrame(settle);
    else { settleFrame = 0; motion = undefined; }
  }

  /**
   * The held mark follows the pointer exactly. Only its own junctions re-centre, so the rest of the
   * Map stays still for inspection; with Shift, the step's other endpoints follow too.
   */
  function moveNode(node: GraphNode, position: Point2, follow: boolean, reach: DragReach = "junctions"): void {
    if (!follow) stopMotion();
    const before = world.get(node.id);
    if (before && before.x === position.x && before.y === position.y) return;
    world.set(node.id, position); arrangement.set(positionKey(node), { ...position }); held.add(positionKey(node));
    if (!follow || reduced() || !win) return;
    if (motion && motionReach !== reach) stopMotion();
    if (!motion) {
      motionReach = reach;
      motion = createDragMotion(topology, world, node.id,
        new Set(topology.nodes.filter(n => held.has(positionKey(n))).map(n => n.id)), options.direction, reach);
      settleFrame = win.requestAnimationFrame(settle);
    }
    motion.reheat(win.performance.now());
  }

  // ── pointer: drag a mark, pan the background, pinch to zoom; a click is a press that did not move ──
  const pointers = new Map<number, Point2>();
  let gesture: { start: Point2; moved: boolean; target?: string; node?: string; origin?: Point2; camera: Camera; pinch?: { d: number; k: number; at: Point2 } } | undefined;
  let suppressClick = false;
  const local = (event: PointerEvent | WheelEvent | MouseEvent) => { const r = svg.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; };
  /** Retire every captured contact before replacement nodes or a different camera action can receive it. */
  function resetGesture(): void {
    suppressClick ||= !!gesture?.moved;
    gesture = undefined; delete svg.dataset.dragging;
    const captured = [...pointers.keys()]; pointers.clear();
    for (const id of captured) if (svg.hasPointerCapture?.(id)) svg.releasePointerCapture(id);
  }
  svg.addEventListener("pointerdown", event => {
    if (event.button !== 0 || pointers.size >= 2 || pointers.has(event.pointerId)) return;
    if (entrance) { finishEntrance(); schedule(); }
    stopMotion(); // A new gesture supersedes the previous settling or Arrange transition.
    const at = local(event);
    pointers.set(event.pointerId, at);
    svg.setPointerCapture?.(event.pointerId);
    if (gesture) {
      const [p, q] = [...pointers.values()];
      // The world point under the fingers' midpoint stays under it, so a pinch zooms and pans as one motion.
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      gesture = { start: gesture.start, moved: true, camera: { ...camera },
        pinch: { d: Math.hypot(p.x - q.x, p.y - q.y) || 1, k: camera.k,
          at: { x: (mid.x - camera.tx) / camera.k, y: (mid.y - camera.ty) / camera.k } } };
      hovered = undefined; svg.dataset.dragging = "camera"; holdWording(true);
      return;
    }
    finishZoom();
    const target = (event.target as Element).closest<SVGElement>("[data-node]")?.dataset.node;
    const draggable = target && shapes.has(target) && !shapes.get(target)!.inline ? target : undefined;
    gesture = { start: at, moved: false, target, node: draggable, origin: draggable ? { ...world.get(draggable)! } : undefined, camera: { ...camera } };
    suppressClick = false;
  }, on);
  svg.addEventListener("pointermove", event => {
    if (!gesture) {
      if (event.pointerType === "touch") return;
      const target = (event.target as Element).closest<SVGElement>("[data-node]")?.dataset.node;
      if (target !== hovered) { hovered = target; schedule(); }
      return;
    }
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, local(event));
    if (gesture.pinch) {
      const [p, q] = [...pointers.values()], { at } = gesture.pinch;
      const k = clampK(gesture.pinch.k * Math.hypot(p.x - q.x, p.y - q.y) / gesture.pinch.d, gesture.pinch.k);
      camera = { k, tx: (p.x + q.x) / 2 - at.x * k, ty: (p.y + q.y) / 2 - at.y * k };
      cameraTouched = true; schedule(); return;
    }
    const at = local(event), dx = at.x - gesture.start.x, dy = at.y - gesture.start.y;
    if (!gesture.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    if (!gesture.moved) { gesture.moved = true; svg.dataset.dragging = gesture.node ? "node" : "camera"; }
    if (gesture.node) {
      const node = shapes.get(gesture.node)!.node, p = { x: gesture.origin!.x + dx / camera.k, y: gesture.origin!.y + dy / camera.k };
      moveNode(node, p, true, event.shiftKey ? "step" : "junctions");
      schedule();
    } else { camera = { ...gesture.camera, tx: gesture.camera.tx + dx, ty: gesture.camera.ty + dy }; cameraTouched = true; schedule(); }
  }, on);
  const end = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    if (event.type !== "pointerup") {
      stopMotion(); resetGesture(); finishZoom(); schedule(); return;
    }
    const { moved, target, pinch } = gesture;
    pointers.delete(event.pointerId);
    if (pinch) { finishZoom(); schedule(); }
    const remaining = pointers.entries().next().value;
    // Either finger can leave first. The survivor pans from the pinched camera, never drags the original mark.
    if (remaining) gesture = { start: remaining[1], moved: true, camera: { ...camera } };
    else { gesture = undefined; delete svg.dataset.dragging; }
    // Clear ownership before releasing capture: lostpointercapture must not cancel the surviving finger.
    if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (remaining) return;
    if (moved) { suppressClick = true; return; }
    // With pointer capture the event target is the svg; the press target decides what a click selects.
    const pressed = target && shapes.has(target) ? target : undefined;
    if (!pressed) hovered = undefined;
    select(pressed);
  };
  svg.addEventListener("pointerup", end, on);
  svg.addEventListener("pointercancel", end, on);
  svg.addEventListener("lostpointercapture", end, on);
  svg.addEventListener("pointerleave", () => { if (!gesture && hovered) { hovered = undefined; schedule(); } }, on);
  svg.addEventListener("click", event => {
    if (suppressClick && event.detail !== 0) { event.stopPropagation(); suppressClick = false; return; }
    suppressClick = false;
    // Assistive activation has no preceding pointerup; a pointer click is already handled there.
    if (event.detail === 0) {
      const id = (event.target as Element).closest<SVGElement>("[data-node]")?.dataset.node;
      if (id && shapes.has(id)) select(id);
    }
  }, { capture: true, signal: abort.signal });
  svg.addEventListener("dblclick", event => {
    const target = (event.target as Element).closest<SVGElement>("[data-node]")?.dataset.node, node = nodeById(target);
    if (node) { select(node.id); options.onNavigate?.(node); }
  }, on);
  svg.addEventListener("wheel", event => {
    if (!(event.ctrlKey || event.metaKey)) return; // ordinary wheel scrolls the host page
    event.preventDefault(); const p = local(event); zoomAt(Math.exp(-event.deltaY * .01), p.x, p.y, true);
  }, { passive: false, signal: abort.signal });
  svg.addEventListener("focusin", event => {
    const id = (event.target as Element).closest<SVGElement>("[data-node]")?.dataset.node, shape = id && shapes.get(id);
    if (!shape) return;
    stopMotion(); finishZoom(); hovered = id;
    if (frame) { win?.cancelAnimationFrame(frame); frame = 0; }
    paint(); revealShape(shape);
  }, on);
  svg.addEventListener("focusout", () => { hovered = undefined; schedule(); }, on);
  svg.addEventListener("keydown", event => {
    const id = (event.target as Element).closest<SVGElement>("[data-node]")?.dataset.node;
    if (!id) return;
    const node = nodeById(id)!, shape = shapes.get(id)!;
    if (event.altKey && event.key.startsWith("Arrow") && !shape.inline) {
      event.preventDefault();
      const p = world.get(id)!, step = 20 / camera.k;
      const next = { x: p.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0), y: p.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0) };
      moveNode(node, next, false); select(id); revealShape(shape); return;
    }
    if (event.key === "Enter") { event.preventDefault(); select(id); options.onNavigate?.(node); }
    else if (event.key === " ") { event.preventDefault(); select(id); }
    else if (event.key === "Escape") { event.preventDefault(); select(undefined); }
    else {
      const dir = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
      if (!dir) return;
      event.preventDefault();
      const next = order[(order.indexOf(id) + dir + order.length) % order.length];
      focusShape(next); options.onSelect?.(nodeById(next)!);
    }
  }, on);

  // Hosts may mount while hidden (e.g. a lazily revealed comparison side): frame once there is room.
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(entries => {
    const box = entries[0].contentRect, wasEmpty = !size.w || !size.h;
    size = { w: box.width, h: box.height };
    if (!size.w || !size.h) return;
    if (wasEmpty || !cameraTouched) camera = fitCamera();
    schedule();
  }) : undefined;
  observer?.observe(svg);
  const measureSize = () => { const r = svg.getBoundingClientRect(); if (r.width && r.height) size = { w: r.width, h: r.height }; };

  // The entrance starts the first time the drawing is on screen with something in it; reduced motion skips it.
  let sighted = false;
  function finishEntrance(): void {
    entrance = undefined;
    sighting?.disconnect();
  }
  const beginEntrance = () => {
    if (!entrance?.pending || !sighted || !shapes.size) return;
    sighting?.disconnect();
    if (reduced()) { entrance = undefined; schedule(); return; }
    entrance = { pending: false, began: win?.performance.now() ?? 0 };
    schedule();
  };
  const sighting = entrance && win && "IntersectionObserver" in win
    ? new win.IntersectionObserver(entries => { sighted = entries.some(entry => entry.isIntersecting); beginEntrance(); }, { threshold: .35 })
    : undefined;
  if (entrance && !sighting) entrance = undefined;
  sighting?.observe(svg);
  abort.signal.addEventListener("abort", () => sighting?.disconnect());
  motionPreference?.addEventListener("change", () => {
    if (entrance && reduced()) { finishEntrance(); schedule(); }
  }, on);

  const view: GraphView = {
    update(graph, nextScope) {
      if (destroyed) throw new Error("This graph view has been destroyed.");
      stopMotion(); resetGesture(); finishZoom(); bends.clear(); hovered = undefined;
      const previous = nodeById(selected), hadFocus = svg.contains(doc.activeElement);
      const sameScope = nextScope === scope;
      if (!sameScope) { arrangement.clear(); held.clear(); world = new Map(); cameraTouched = false; }
      scope = nextScope;
      // Only authored names carry identity across revisions; anonymous keys never do.
      const carried = new Map<string, Point2>();
      if (sameScope) for (const node of topology.nodes) { const p = world.get(node.id); if (p && node.name) carried.set(positionKey(node), p); }
      full = projectGraph(graph);
      endings = new Set(endingPoints(graph).map(point => referenceKey({ kind: "point", key: point.key })));
      const exploration = projectExploration(full);
      topology = { nodes: exploration.nodes, links: exploration.links };
      inline = new Map(exploration.inlineBearings.map(node => [node.id, exploration.links.find(link => link.bearingKey === node.ref.key)!]));
      const names = new Set(full.nodes.map(positionKey));
      for (const key of [...arrangement.keys()]) if (!names.has(key) || !key.includes(":@")) arrangement.delete(key);
      for (const key of [...held]) if (!arrangement.has(key)) held.delete(key);
      build(); measureSize();
      const next = applyArrangement(baseLayout());
      const retained = sameScope && previous?.name ? full.nodes.find(node => node.ref.kind === previous.ref.kind && node.name === previous.name) : undefined;
      selected = retained?.id;
      if (!topology.nodes.some(node => carried.has(positionKey(node)))) { world = next; camera = fitCamera(); paint(); }
      else {
        world = new Map(topology.nodes.map(node => [node.id, { ...(carried.get(positionKey(node)) ?? next.get(node.id)!) }]));
        moveTo(next, needsRefit(next));
      }
      beginEntrance();
      if (retained) options.onSelect?.(retained); else options.onClear?.();
      if (hadFocus) (svg.querySelector<SVGGElement>('[tabindex="0"]'))?.focus({ preventScroll: true });
    },
    resetLayout() {
      if (destroyed) throw new Error("This graph view has been destroyed.");
      finishEntrance(); resetGesture(); finishZoom();
      arrangement.clear(); held.clear(); measureSize(); moveTo(baseLayout(), true); cameraTouched = false;
    },
    select(ref) { const id = referenceKey(ref); if (shapes.has(id)) select(id); },
    clear() { hovered = undefined; select(undefined); },
    fit() { measureSize(); fit(); },
    zoom(factor) {
      if (!Number.isFinite(factor) || factor <= 0) throw new Error("Zoom factor must be positive and finite.");
      measureSize(); zoomAt(factor, size.w / 2, size.h / 2);
    },
    destroy() {
      destroyed = true; abort.abort(); observer?.disconnect();
      win?.cancelAnimationFrame(frame); stopMotion(); resetGesture(); finishZoom();
      svg.remove(); shapes.clear(); world.clear(); arrangement.clear(); held.clear(); bends.clear();
    }
  };
  return view;
}
