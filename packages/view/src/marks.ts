/**
 * The shared mark vocabulary: one source for names, glyph shapes, relation symbols and type sizes.
 * Hosts reuse it for source chips, structure lists and legends so every surface reads the same way.
 * Display names and Chinese readings follow docs/glossary.md; Chinese readings are auxiliary.
 * Keys, label unions and shapes are stable identifiers: the dot form keeps the machine key
 * "Material" (Graph IR `declaration.form: "material"`) while displaying as Neutral Point.
 */

import type { PointDeclaration } from "@cogitatum/core";

export type PointMarkLabel = "Q" | "C" | "G" | "O" | "R" | "D" | "Material";
export type MarkShape = "filled" | "material";
export type MarkTone = "support" | "objection" | "neutral";

export type PointMark = { label: PointMarkLabel; name: string; zh: string; letter: string; shape: MarkShape };
export type BearingMark = { kind: string; name: string; zh: string; symbol: string; tone: MarkTone; dashed: boolean };

/** Point marks describe authored roles, never acceptance or completion. */
export const POINT_MARKS: Readonly<Record<PointMarkLabel, PointMark>> = {
  Q: { label: "Q", name: "Question", zh: "問題", letter: "Q", shape: "filled" },
  C: { label: "C", name: "Claim", zh: "主張", letter: "C", shape: "filled" },
  G: { label: "G", name: "Ground", zh: "依據", letter: "G", shape: "filled" },
  O: { label: "O", name: "Objection", zh: "駁議", letter: "O", shape: "filled" },
  R: { label: "R", name: "Reply", zh: "回應", letter: "R", shape: "filled" },
  D: { label: "D", name: "Distinction", zh: "辨別", letter: "D", shape: "filled" },
  Material: { label: "Material", name: "Neutral Point", zh: "中性點", letter: "", shape: "material" }
};

/** Symbols and line styles only; colour distinguishes the authored direction, not correctness. */
export const BEARING_MARKS: Readonly<Record<string, BearingMark>> = {
  supports: { kind: "supports", name: "supports", zh: "支持", symbol: "+", tone: "support", dashed: false },
  challenges: { kind: "challenges", name: "challenges", zh: "質疑", symbol: "−", tone: "objection", dashed: false },
  concerns: { kind: "concerns", name: "concerns", zh: "關涉", symbol: "∼", tone: "neutral", dashed: true },
  answers: { kind: "answers", name: "answers", zh: "回答", symbol: "↳", tone: "neutral", dashed: false },
  repliesTo: { kind: "repliesTo", name: "replies to", zh: "回應", symbol: "↩", tone: "neutral", dashed: false },
  clarifies: { kind: "clarifies", name: "clarifies", zh: "釐清", symbol: "=", tone: "neutral", dashed: true }
};

/** Type scale shared by the renderer and hosts (CSS pixels, fixed regardless of zoom). */
export const MARK_TYPE = { letter: 10.5, label: 12, text: 14, lineHeight: 18 } as const;

export function pointMark(label: string): PointMark {
  return (POINT_MARKS as Record<string, PointMark>)[label] ?? { label: label as PointMarkLabel, name: label, zh: label, letter: label.slice(0, 1), shape: "filled" };
}

/** The mark a Point was declared with. Marks written at later uses are in the AST and Explain, not here. */
export function declarationMark(declaration: PointDeclaration): PointMark {
  if (declaration.form === "material") return POINT_MARKS.Material;
  return pointMark(declaration.role);
}

export function bearingMark(kind: string): BearingMark {
  return BEARING_MARKS[kind] ?? { kind, name: kind, zh: kind, symbol: "·", tone: "neutral", dashed: false };
}

/** A joint Bearing has several sources; independent Bearings each keep one. */
export const isJoint = (sources: readonly unknown[]): boolean => sources.length > 1;

const SVG = "http://www.w3.org/2000/svg";

/** Draws a Point glyph into `parent` (centred on 0,0). Used inside the graph and by host chips. */
export function drawPointGlyph(parent: SVGElement, label: string, radius = 9): SVGGElement {
  const doc = parent.ownerDocument, mark = pointMark(label);
  const g = doc.createElementNS(SVG, "g");
  g.setAttribute("class", `cog-glyph cog-shape-${mark.shape}`);
  const shape = mark.shape === "material" ? doc.createElementNS(SVG, "rect") : doc.createElementNS(SVG, "circle");
  if (mark.shape === "material") {
    const side = radius * 1.6;
    shape.setAttribute("x", String(-side / 2)); shape.setAttribute("y", String(-side / 2));
    shape.setAttribute("width", String(side)); shape.setAttribute("height", String(side)); shape.setAttribute("rx", "2");
  } else shape.setAttribute("r", String(radius));
  shape.setAttribute("class", "cog-glyph-shape");
  g.append(shape);
  if (mark.letter) {
    const text = doc.createElementNS(SVG, "text");
    text.setAttribute("class", "cog-glyph-letter"); text.setAttribute("text-anchor", "middle"); text.setAttribute("dy", "0.36em");
    text.textContent = mark.letter; g.append(text);
  }
  parent.append(g);
  return g;
}

/** Draws a Bearing symbol (circle for one source, diamond for a joint or addressed junction). */
export function drawBearingGlyph(parent: SVGElement, kind: string, junction = false, radius = 7.5): SVGGElement {
  const doc = parent.ownerDocument, mark = bearingMark(kind);
  const g = doc.createElementNS(SVG, "g");
  g.setAttribute("class", `cog-bearing-glyph cog-tone-${mark.tone}${junction ? " cog-junction" : ""}`);
  const shape = doc.createElementNS(SVG, junction ? "path" : "circle");
  if (junction) { const r = radius + 2.5; shape.setAttribute("d", `M0 ${-r}L${r} 0L0 ${r}L${-r} 0Z`); }
  else shape.setAttribute("r", String(radius));
  shape.setAttribute("class", "cog-bearing-glyph-shape");
  const text = doc.createElementNS(SVG, "text");
  text.setAttribute("class", "cog-bearing-glyph-symbol"); text.setAttribute("text-anchor", "middle"); text.setAttribute("dy", "0.34em");
  text.textContent = mark.symbol;
  g.append(shape, text); parent.append(g);
  return g;
}

/** A standalone inline SVG chip for hosts (source lines, lists, legends). */
export function createMarkChip(doc: Document, label: string, size = 16): SVGSVGElement {
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("class", "cog-chip"); svg.setAttribute("viewBox", "-10 -10 20 20");
  svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size)); svg.setAttribute("aria-hidden", "true");
  drawPointGlyph(svg, label, 8.4);
  return svg;
}

export function createBearingChip(doc: Document, kind: string, size = 16, junction = false): SVGSVGElement {
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("class", "cog-chip"); svg.setAttribute("viewBox", "-10 -10 20 20");
  svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size)); svg.setAttribute("aria-hidden", "true");
  drawBearingGlyph(svg, kind, junction, junction ? 5.5 : 7.5);
  return svg;
}
