import type { BearingTarget, GraphIR } from "@cogitatum/core";
import { layoutGraph, projectGraph, referenceKey, type GraphNode } from "./projection.js";
export * from "./projection.js";

export type GraphViewOptions = {
  direction?: "down" | "right";
  onSelect?: (node: GraphNode) => void;
  onClear?: () => void;
  onNavigate?: (node: GraphNode) => void;
};
export type GraphView = {
  /** Scope identifies one source unit; anonymous keys never survive an update. */
  update(graph: GraphIR, scope: string): void;
  select(ref: BearingTarget): void;
  fit(): void;
  zoom(factor: number): void;
  destroy(): void;
};

const NS = "http://www.w3.org/2000/svg";
let nextView = 0;

/** Framework-neutral mount/update/destroy lifecycle, suitable for a React effect. */
export function createGraphView(container: HTMLElement, options: GraphViewOptions = {}): GraphView {
  const doc = container.ownerDocument;
  const svg = doc.createElementNS(NS, "svg");
  svg.classList.add("cog-graph"); svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", "Inquiry graph. Arrow keys move between entities; Enter opens source.");
  const markerId = `cog-arrow-${++nextView}`;
  const abort = new AbortController();
  let nodes: GraphNode[] = [], selected: string | undefined, scope = "", destroyed = false;
  let bounds = { x: 0, y: 0, width: 800, height: 400 }, camera = { ...bounds };
  let drag: { x: number; y: number; camera: typeof camera } | undefined;
  container.append(svg);

  function element<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string> = {}): SVGElementTagNameMap[K] {
    const result = doc.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, value);
    return result;
  }
  function applyCamera(): void { svg.setAttribute("viewBox", `${camera.x} ${camera.y} ${camera.width} ${camera.height}`); }
  function selectNode(node: GraphNode, notify = true): void {
    selected = node.id;
    for (const group of svg.querySelectorAll<SVGGElement>("[data-node]")) {
      const active = group.dataset.node === selected;
      group.setAttribute("aria-pressed", String(active)); group.setAttribute("tabindex", active ? "0" : "-1");
    }
    if (notify) options.onSelect?.(node);
  }
  const view: GraphView = {
    update(graph, nextScope) {
      if (destroyed) throw new Error("This graph view has been destroyed.");
      const old = nodes.find(n => n.id === selected);
      const keep = nextScope === scope && old?.name ? { kind: old.ref.kind, name: old.name } : undefined;
      const first = !nodes.length || nextScope !== scope;
      const hadFocus = svg.contains(doc.activeElement);
      scope = nextScope;
      const projection = projectGraph(graph), positioned = layoutGraph(projection, options.direction);
      nodes = projection.nodes; selected = undefined;
      svg.replaceChildren();
      const defs = element("defs"), marker = element("marker", { id: markerId, viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "6", markerHeight: "6", orient: "auto-start-reverse" });
      marker.append(element("path", { d: "M 0 0 L 10 5 L 0 10 z" })); defs.append(marker); svg.append(defs);
      const positions = new Map(positioned.map(n => [n.id, n]));
      for (const link of projection.links) {
        const a = positions.get(link.source)!, b = positions.get(link.target)!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const scale = 1 / Math.max(Math.abs(dx) / 112, Math.abs(dy) / 48, 1);
        const x1 = a.x + dx * scale, y1 = a.y + dy * scale, x2 = b.x - dx * scale, y2 = b.y - dy * scale;
        const curve = a.id === b.id ? `M ${a.x + 112} ${a.y - 20} C ${a.x + 210} ${a.y - 110}, ${a.x + 210} ${a.y + 110}, ${a.x + 112} ${a.y + 20}`
          : options.direction === "right" ? `M ${x1} ${y1} C ${(x1+x2)/2} ${y1}, ${(x1+x2)/2} ${y2}, ${x2} ${y2}`
          : `M ${x1} ${y1} C ${x1} ${(y1+y2)/2}, ${x2} ${(y1+y2)/2}, ${x2} ${y2}`;
        const path = element("path", { d: curve, class: `cog-link ${link.segment}`, "aria-hidden": "true" });
        if (link.segment === "output") path.setAttribute("marker-end", `url(#${markerId})`);
        svg.append(path);
      }
      positioned.forEach((node, index) => {
        const group = element("g", { transform: `translate(${node.x} ${node.y})`, role: "button", tabindex: index === 0 ? "0" : "-1", "aria-pressed": "false", "aria-label": `${node.label}${node.name ? ` @${node.name}` : ""}: ${node.text}`, class: `cog-node ${node.ref.kind}` });
        group.dataset.node = node.id;
        group.append(element("rect", { x: "-112", y: "-48", width: "224", height: "96", rx: node.ref.kind === "bearing" ? "18" : "2" }));
        const title = element("title"); title.textContent = node.text; group.append(title);
        const label = element("text", { x: "-98", y: "-25", class: "cog-label" }); label.textContent = node.label; group.append(label);
        const text = element("text", { x: "-98", y: "0", class: "cog-text" });
        const chars = Array.from(node.text);
        for (let row = 0; row < 3 && chars.length; row++) {
          const span = element("tspan", { x: "-98", dy: row ? "17" : "0" });
          const space = chars.slice(0, 27).lastIndexOf(" ");
          const length = chars.length > 26 && space > 12 ? space : Math.min(26, chars.length);
          span.textContent = chars.splice(0, length).join("") + (row === 2 && chars.length ? "…" : "");
          while (chars[0] === " ") chars.shift();
          text.append(span);
        }
        group.append(text);
        group.addEventListener("click", () => selectNode(node));
        group.addEventListener("dblclick", () => options.onNavigate?.(node));
        group.addEventListener("keydown", event => {
          if (event.key === "Enter") { event.preventDefault(); selectNode(node); options.onNavigate?.(node); }
          if (event.key === " ") { event.preventDefault(); selectNode(node); }
          const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
          if (direction) {
            event.preventDefault(); const next = nodes[(index + direction + nodes.length) % nodes.length]; selectNode(next);
            svg.querySelectorAll<SVGGElement>("[data-node]")[(index + direction + nodes.length) % nodes.length].focus();
          }
        });
        svg.append(group);
      });
      if (!nodes.length) { const text = element("text", { x: "30", y: "60" }); text.textContent = "No compiled structure"; svg.append(text); }
      bounds = { x: 0, y: 0, width: Math.max(400, ...positioned.map(n => n.x + 135)), height: Math.max(200, ...positioned.map(n => n.y + 75)) };
      if (first) view.fit();
      const retained = keep && nodes.find(n => n.ref.kind === keep.kind && n.name === keep.name);
      if (retained) selectNode(retained);
      else options.onClear?.();
      if (hadFocus) (svg.querySelector('[tabindex="0"]') as SVGGElement | null)?.focus();
    },
    select(ref) { const node = nodes.find(n => n.id === referenceKey(ref)); if (node) selectNode(node); },
    fit() { camera = { ...bounds }; applyCamera(); },
    zoom(factor) {
      if (!Number.isFinite(factor) || factor <= 0) throw new Error("Zoom factor must be positive and finite.");
      const width = Math.max(120, Math.min(bounds.width * 4, camera.width / factor));
      const height = width * camera.height / camera.width;
      camera = { x: camera.x + (camera.width - width) / 2, y: camera.y + (camera.height - height) / 2, width, height }; applyCamera();
    },
    destroy() { abort.abort(); svg.remove(); nodes = []; destroyed = true; }
  };
  svg.addEventListener("wheel", event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); view.zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1); } }, { passive: false, signal: abort.signal });
  svg.addEventListener("pointerdown", event => {
    if ((event.target as Element).closest("[data-node]") || event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, camera: { ...camera } }; svg.setPointerCapture(event.pointerId);
  }, { signal: abort.signal });
  svg.addEventListener("pointermove", event => {
    if (!drag) return;
    const rect = svg.getBoundingClientRect();
    const scale = Math.max(camera.width / rect.width, camera.height / rect.height);
    camera = { ...drag.camera, x: drag.camera.x - (event.clientX - drag.x) * scale, y: drag.camera.y - (event.clientY - drag.y) * scale }; applyCamera();
  }, { signal: abort.signal });
  svg.addEventListener("pointerup", () => { drag = undefined; }, { signal: abort.signal });
  svg.addEventListener("pointercancel", () => { drag = undefined; }, { signal: abort.signal });
  applyCamera();
  return view;
}
