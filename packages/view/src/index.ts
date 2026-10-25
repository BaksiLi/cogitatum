import type { BearingTarget, GraphIR } from "@cogitatum/core";
import { focusNeighborhood, projectExploration, projectGraph, referenceKey, type GraphLink, type GraphNode, type GraphProjection } from "./projection.js";
import { layoutGraph, type Point2 } from "./layout.js";
import { createDragMotion } from "./motion.js";
import { bearingMark, drawBearingGlyph, drawPointGlyph, MARK_TYPE, pointMark } from "./marks.js";
export * from "./projection.js";
export * from "./layout.js";
export * from "./marks.js";
export * from "./reading-projection.js";
export * from "./reading.js";
export type { ProseRenderer, ProseRenderRequest } from "./prose.js";

export type GraphViewOptions = {
  direction?: "down" | "right";
  /** The host may additionally disable motion; system reduced-motion is always respected. */
  reducedMotion?: () => boolean;
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
const POINT_R = 9, JUNCTION_R = 10, LABEL_K = .6, DRAG_SLOP = 4, MIN_K = .3, MAX_K = 2.2;
type Camera = { k: number; tx: number; ty: number };
type Shape = { id: string; node: GraphNode; g: SVGGElement; label?: SVGTextElement; labelHit?: SVGRectElement; inline: boolean };

/**
 * Framework-neutral mount/update/destroy lifecycle. Positions live in a world space; the camera maps
 * them to pixels so marks and text keep a fixed, readable size at every zoom level.
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
  let world = new Map<string, Point2>(), camera: Camera = { k: 1, tx: 0, ty: 0 }, size = { w: 0, h: 0 };
  let scope = "", selected: string | undefined, hovered: string | undefined;
  let destroyed = false, cameraTouched = false, frame = 0, settleFrame = 0;
  /** Positions to restore after an update; `held` are the marks the reader placed directly. */
  const arrangement = new Map<string, Point2>();
  const held = new Set<string>();
  const abort = new AbortController(), on = { signal: abort.signal };
  const positionKey = (node: GraphNode) => node.name ? `${node.ref.kind}:@${node.name}` : node.id;
  const reduced = () => !!options.reducedMotion?.() || !!win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const nodeById = (id?: string) => id ? full.nodes.find(node => node.id === id) : undefined;
  const screen = (p: Point2) => ({ x: p.x * camera.k + camera.tx, y: p.y * camera.k + camera.ty });

  // ── text measurement (fixed CSS pixel sizes from the shared mark type scale) ──
  let measure: CanvasRenderingContext2D | null | undefined, font = "";
  const wrapCache = new Map<string, string[]>();
  function textWidth(s: string): number {
    measure ??= doc.createElement("canvas").getContext?.("2d") ?? null;
    if (measure) { measure.font = font; return measure.measureText(s).width; }
    return s.length * MARK_TYPE.text * .55;
  }
  function wrap(text: string, width: number, lines: number): string[] {
    const key = `${width}|${lines}|${text}`;
    if (wrapCache.has(key)) return wrapCache.get(key)!;
    const w = textWidth;
    const tokens = text.match(/[⺀-鿿豈-﫿　-〿＀-￯]|[^\s⺀-鿿豈-﫿　-〿＀-￯]+|\s+/g) ?? [];
    const out: string[] = []; let line = "", used = 0;
    for (const token of tokens) {
      if (w(line + token) <= width || !line.trim()) { line += token; used += token.length; continue; }
      out.push(line.trim()); line = token.trimStart();
      if (out.length === lines) { line = ""; break; }
      used += token.length;
    }
    if (out.length < lines && line.trim()) out.push(line.trim());
    if (used < text.length && out.length) {
      let last = out[out.length - 1];
      while (last.length && w(last + "…") > width) last = last.slice(0, -1);
      out[out.length - 1] = last.replace(/[\s,.;:，。；：、]+$/u, "") + "…";
    }
    wrapCache.set(key, out);
    return out;
  }

  // ── build DOM for the current topology ──
  function build(): void {
    nodeLayer.replaceChildren(); glyphLayer.replaceChildren(); shapes = new Map();
    // Measure with the host's resolved text style so wrapping matches what is painted.
    const probe = element("text", { class: "cog-text" }, nodeLayer), style = win?.getComputedStyle(probe);
    font = `${style?.fontSize || `${MARK_TYPE.text}px`} ${style?.fontFamily || "serif"}`; probe.remove(); wrapCache.clear();
    for (const node of topology.nodes) {
      const isPoint = node.ref.kind === "point";
      const g = element("g", { class: `cog-node ${isPoint ? "point" : "bearing cog-junction-node"} cog-${node.label.replace("?", "-open")}`, role: "button", tabindex: "-1", "data-node": node.id }, nodeLayer);
      element("circle", { class: "cog-hit", r: isPoint ? "22" : "16" }, g);
      element("circle", { class: "cog-focus-ring", r: isPoint ? "15" : "16" }, g);
      if (isPoint) drawPointGlyph(g, node.label, POINT_R); else drawBearingGlyph(g, node.label, true, JUNCTION_R - 2.5);
      // A junction's name sits beside its diamond, so links may enter it from below without detouring.
      const labelHit = element("rect", { class: "cog-hit cog-label-hit", width: "0", height: "0", "aria-hidden": "true" }, g);
      const label = element("text", { class: isPoint ? "cog-text" : "cog-label", "text-anchor": isPoint ? "middle" : "start" }, g);
      describe(g, node);
      shapes.set(node.id, { id: node.id, node, g, label, labelHit, inline: false });
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
  const pointLabelWidth = (k: number) => Math.max(96, Math.min(150, 168 * k - 14));
  function labelLines(shape: Shape, k = camera.k, focused = shape.id === selected || shape.id === hovered): string[] {
    const node = shape.node;
    if (shape.inline) return [];
    if (node.ref.kind === "bearing") return node.name && (k >= LABEL_K || focused) ? [`@${node.name}`] : [];
    if (k < LABEL_K && !focused) return [];
    const width = pointLabelWidth(k);
    return wrap(node.text, focused ? Math.max(width, 150) : width, 2);
  }
  /** Screen-pixel reach of a mark and its unfocused wording on either side of the mark's centre. */
  function reach(shape: Shape, k: number): { left: number; right: number } {
    const lines = labelLines(shape, k, false);
    if (!lines.length) return { left: 13, right: 13 };
    if (shape.node.ref.kind === "bearing") return { left: 13, right: JUNCTION_R + 7 + textWidth(lines[0]) };
    const half = Math.max(14, ...lines.map(line => textWidth(line) / 2 + 4));
    return { left: half, right: half };
  }
  /**
   * Route links around a Point's wording whenever the other endpoint lies below it.
   * `port` shifts the end sideways so links sharing a side of one mark fan out instead of bundling.
   */
  function anchor(id: string, toward: Point2, port = 0): Point2 {
    const p = screen(world.get(id)!), shape = shapes.get(id);
    const isPoint = shape?.node.ref.kind === "point", r = isPoint ? POINT_R + 2 : JUNCTION_R + 1;
    if (isPoint && shape?.label && toward.y > p.y + r) {
      const lines = shape.label.childNodes.length;
      return { x: p.x + port, y: p.y + (lines ? 14 + lines * MARK_TYPE.lineHeight : Math.sqrt(r * r - port * port)) };
    }
    if (port && Math.abs(toward.y - p.y) > r) return { x: p.x + port, y: p.y + Math.sign(toward.y - p.y) * Math.sqrt(r * r - port * port) };
    const dx = toward.x - p.x, dy = toward.y - p.y, d = Math.hypot(dx, dy) || 1;
    return { x: p.x + dx / d * r, y: p.y + dy / d * r };
  }

  function paint(): void {
    frame = 0;
    if (destroyed) return;
    const focus = focusNeighborhood(full, nodeById(hovered ?? selected)?.ref);
    const related = new Set(focus.nodeIds), active = new Set(focus.bearingKeys), guided = related.size > 0;
    svg.dataset.guided = String(guided);
    for (const shape of shapes.values()) {
      if (shape.inline) continue;
      const p = screen(world.get(shape.id)!);
      shape.g.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
      const lines = labelLines(shape), label = shape.label!;
      label.replaceChildren();
      const isPoint = shape.node.ref.kind === "point";
      lines.forEach((text, i) => { const t = element("tspan", isPoint ? { x: "0", y: String(27 + i * MARK_TYPE.lineHeight) } : { x: String(JUNCTION_R + 5), y: "4" }, label); t.textContent = text; });
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
      const half = lines ? Math.max(14, ...[...shape.label!.childNodes].map(t => textWidth(t.textContent ?? "") / 2 + 4)) : 13;
      return { id: shape.id, x0: p.x - half, x1: p.x + half, y0: p.y - 13, y1: p.y + 14 + lines * MARK_TYPE.lineHeight };
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
      const r = nodeById(side.split("|")[0])?.ref.kind === "point" ? POINT_R : JUNCTION_R - 2;
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
          return [{ x: a.x + tail * 4, y: a.y + h }, { x: t.x + head * 4, y: t.y - h }];
        }
        const c = { x: (a.x + t.x) / 2 - dy / len * bend * len, y: (a.y + t.y) / 2 + dx / len * bend * len };
        return [c, c];
      };
      let [c1, c2] = curveFor(nth ? (nth % 2 ? 1 : -1) * Math.ceil(nth / 2) * .22 : 0);
      if (!nth) {
        let best = crossings([link.source, link.target], a, c1, c2, t);
        for (const bend of [.2, -.2, .38, -.38]) {
          if (!best) break;
          const [d1, d2] = curveFor(bend), hits = crossings([link.source, link.target], a, d1, d2, t);
          if (hits < best) { best = hits; c1 = d1; c2 = d2; }
        }
      }
      const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${t.x.toFixed(1)} ${t.y.toFixed(1)}`;
      const on = !guided || active.has(link.bearingKey);
      element("path", { d, class: `cog-link ${link.segment} cog-tone-${mark.tone}${mark.dashed ? " cog-dashed" : ""}`, "data-active": String(on), "data-bearing": link.bearingKey, "aria-hidden": "true" }, edgeLayer);
      if (link.segment === "output") {
        const hx = t.x - c2.x, hy = t.y - c2.y, hl = Math.hypot(hx, hy) || 1, ux = hx / hl, uy = hy / hl;
        element("path", { class: `cog-arrow cog-tone-${mark.tone}`, "data-active": String(on), "aria-hidden": "true",
          d: `M${t.x} ${t.y}L${t.x - ux * 7 - uy * 3.4} ${t.y - uy * 7 + ux * 3.4}L${t.x - ux * 7 + uy * 3.4} ${t.y - uy * 7 - ux * 3.4}Z` }, edgeLayer);
      }
      if (isInline) {
        element("path", { d, class: "cog-link-hit", "data-node": bearingId, "aria-hidden": "true" }, edgeLayer);
        const m = { x: .125 * a.x + .375 * c1.x + .375 * c2.x + .125 * t.x, y: .125 * a.y + .375 * c1.y + .375 * c2.y + .125 * t.y };
        const shape = shapes.get(bearingId)!;
        shape.g.setAttribute("transform", `translate(${m.x.toFixed(1)} ${m.y.toFixed(1)})`);
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
    const visible = svg.getClientRects().length > 0;
    const labelHits = [...shapes.values()].flatMap(shape => shape.labelHit ? [{
      hit: shape.labelHit,
      bounds: visible && shape.label!.childNodes.length ? shape.label!.getBBox() : undefined,
    }] : []);
    for (const { hit, bounds } of labelHits) {
      const box = bounds
        ? { x: bounds.x - 4, y: bounds.y - 4, width: bounds.width + 8, height: bounds.height + 8 }
        : { x: 0, y: 0, width: 0, height: 0 };
      for (const [name, value] of Object.entries(box)) hit.setAttribute(name, String(value));
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
  function fitCamera(): Camera {
    // Wording keeps its pixel size while the drawing scales, so the fit must include it:
    // the widest scale at which every mark keeps `room` for links bowing around it and its wording stays inside.
    // Below LABEL_K the wording disappears, so a wide inquiry falls back to an unlabelled overview.
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
    let k = Math.max(MIN_K, Math.min(1.1, (size.h - padTop - padBottom) / b.h));
    if (!fits(k)) {
      let lo = MIN_K, hi = k;
      for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
      k = lo;
    }
    const s = span(k);
    return { k, tx: (size.w - (s.x1 - s.x0)) / 2 - s.x0, ty: Math.max(padTop, (size.h - padBottom + padTop - b.h * k) / 2) - b.y * k };
  }
  function fit(): void { cameraTouched = false; camera = fitCamera(); schedule(); }
  function zoomAt(factor: number, x: number, y: number): void {
    const k = Math.max(MIN_K, Math.min(MAX_K, camera.k * factor));
    camera = { k, tx: x - (x - camera.tx) * (k / camera.k), ty: y - (y - camera.ty) * (k / camera.k) };
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
    selected = id;
    // Selection state is announced synchronously (aria-pressed), not on the next frame.
    if (frame) { win?.cancelAnimationFrame(frame); frame = 0; }
    paint();
    const node = nodeById(id);
    if (!notify) return;
    if (node) options.onSelect?.(node); else options.onClear?.();
  }
  function focusShape(id: string): void { const shape = shapes.get(id); if (shape) { selected = id; paint(); shape.g.focus({ preventScroll: true }); } }

  let motion: ReturnType<typeof createDragMotion> | undefined;
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

  /** The held mark follows the pointer exactly; its unheld component settles around it. */
  function moveNode(node: GraphNode, position: Point2, follow: boolean): void {
    if (!follow) stopMotion();
    const before = world.get(node.id);
    if (before && before.x === position.x && before.y === position.y) return;
    world.set(node.id, position); arrangement.set(positionKey(node), { ...position }); held.add(positionKey(node));
    if (!follow || reduced() || !win) return;
    if (!motion) {
      motion = createDragMotion(topology, world, node.id,
        new Set(topology.nodes.filter(n => held.has(positionKey(n))).map(n => n.id)), options.direction);
      settleFrame = win.requestAnimationFrame(settle);
    }
    motion.reheat(win.performance.now());
  }

  // ── pointer: drag a mark, pan the background, pinch to zoom; a click is a press that did not move ──
  const pointers = new Map<number, Point2>();
  let gesture: { id: number; start: Point2; moved: boolean; target?: string; node?: string; origin?: Point2; camera: Camera; pinch?: { d: number; k: number } } | undefined;
  let suppressClick = false;
  const local = (event: PointerEvent | WheelEvent | MouseEvent) => { const r = svg.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; };
  svg.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    stopMotion(); // A new gesture supersedes the previous settling or Arrange transition.
    pointers.set(event.pointerId, local(event));
    if (pointers.size === 2 && gesture) {
      const [p, q] = [...pointers.values()];
      gesture.pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), k: camera.k }; gesture.node = undefined; gesture.moved = true;
      return;
    }
    const target = (event.target as Element).closest<SVGElement>("[data-node]")?.dataset.node;
    const draggable = target && shapes.has(target) && !shapes.get(target)!.inline ? target : undefined;
    gesture = { id: event.pointerId, start: local(event), moved: false, target, node: draggable, origin: draggable ? { ...world.get(draggable)! } : undefined, camera: { ...camera } };
    suppressClick = false;
    svg.setPointerCapture?.(event.pointerId);
  }, on);
  svg.addEventListener("pointermove", event => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, local(event));
    if (!gesture) {
      const target = (event.target as Element).closest<SVGElement>("[data-node]")?.dataset.node;
      if (target !== hovered) { hovered = target; schedule(); }
      return;
    }
    if (gesture.pinch && pointers.size === 2) {
      const [p, q] = [...pointers.values()], d = Math.hypot(p.x - q.x, p.y - q.y);
      zoomAt(gesture.pinch.k * d / gesture.pinch.d / camera.k, (p.x + q.x) / 2, (p.y + q.y) / 2); return;
    }
    if (event.pointerId !== gesture.id) return;
    const at = local(event), dx = at.x - gesture.start.x, dy = at.y - gesture.start.y;
    if (!gesture.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    if (!gesture.moved) { gesture.moved = true; svg.dataset.dragging = gesture.node ? "node" : "camera"; }
    if (gesture.node) {
      const node = shapes.get(gesture.node)!.node, p = { x: gesture.origin!.x + dx / camera.k, y: gesture.origin!.y + dy / camera.k };
      moveNode(node, p, true);
      schedule();
    } else { camera = { ...gesture.camera, tx: gesture.camera.tx + dx, ty: gesture.camera.ty + dy }; cameraTouched = true; schedule(); }
  }, on);
  const end = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (!gesture || event.pointerId !== gesture.id) { if (pointers.size < 2 && gesture) gesture.pinch = undefined; return; }
    // With pointer capture the event target is the svg; the press target decides what a click selects.
    const { moved, target } = gesture;
    gesture = undefined; delete svg.dataset.dragging;
    if (event.type === "pointercancel") stopMotion();
    if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (moved) { suppressClick = true; return; }
    if (event.type === "pointerup") select(target && shapes.has(target) ? target : undefined);
  };
  svg.addEventListener("pointerup", end, on);
  svg.addEventListener("pointercancel", end, on);
  svg.addEventListener("pointerleave", () => { if (!gesture && hovered) { hovered = undefined; schedule(); } }, on);
  svg.addEventListener("click", event => {
    if (suppressClick) { event.stopPropagation(); suppressClick = false; return; }
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
    event.preventDefault(); const p = local(event); zoomAt(Math.exp(-event.deltaY * .01), p.x, p.y);
  }, { passive: false, signal: abort.signal });
  svg.addEventListener("focusin", event => { const id = (event.target as Element).closest<SVGElement>("[data-node]")?.dataset.node; if (id !== hovered) { hovered = id; schedule(); } }, on);
  svg.addEventListener("focusout", () => { hovered = undefined; schedule(); }, on);
  svg.addEventListener("keydown", event => {
    const id = (event.target as Element).closest<SVGElement>("[data-node]")?.dataset.node;
    if (!id) return;
    const node = nodeById(id)!, shape = shapes.get(id)!;
    if (event.altKey && event.key.startsWith("Arrow") && !shape.inline) {
      event.preventDefault();
      const p = world.get(id)!, step = 20 / camera.k;
      const next = { x: p.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0), y: p.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0) };
      moveNode(node, next, false); select(id); return;
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

  const view: GraphView = {
    update(graph, nextScope) {
      if (destroyed) throw new Error("This graph view has been destroyed.");
      stopMotion(); // a pending transition must not overwrite the new frame
      // Host editors can replace this revision during a captured pointer gesture.
      gesture = undefined; delete svg.dataset.dragging; hovered = undefined;
      for (const id of pointers.keys()) if (svg.hasPointerCapture?.(id)) svg.releasePointerCapture(id);
      pointers.clear();
      const previous = nodeById(selected), hadFocus = svg.contains(doc.activeElement);
      const sameScope = nextScope === scope;
      if (!sameScope) { arrangement.clear(); held.clear(); world = new Map(); cameraTouched = false; }
      scope = nextScope;
      // Only authored names carry identity across revisions; anonymous keys never do.
      const carried = new Map<string, Point2>();
      if (sameScope) for (const node of topology.nodes) { const p = world.get(node.id); if (p && node.name) carried.set(positionKey(node), p); }
      full = projectGraph(graph);
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
      if (!carried.size) { world = next; camera = fitCamera(); paint(); }
      else {
        world = new Map(topology.nodes.map(node => [node.id, { ...(carried.get(positionKey(node)) ?? next.get(node.id)!) }]));
        moveTo(next, needsRefit(next));
      }
      if (retained) options.onSelect?.(retained); else options.onClear?.();
      if (hadFocus) (svg.querySelector<SVGGElement>('[tabindex="0"]'))?.focus({ preventScroll: true });
    },
    resetLayout() {
      if (destroyed) throw new Error("This graph view has been destroyed.");
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
      win?.cancelAnimationFrame(frame); stopMotion();
      svg.remove(); shapes.clear(); world.clear(); arrangement.clear(); held.clear();
    }
  };
  return view;
}
