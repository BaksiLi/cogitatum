import { compileGraph, compileGraphWithExplain, parseDocument } from "./index.js";
import type { GraphIR, SourceSpan } from "./types.js";

export const compile = (source: string) => compileGraph(parseDocument(source));
export const compileWithExplain = (source: string) => compileGraphWithExplain(parseDocument(source));
export const codes = (graph: GraphIR) => graph.diagnostics.map(diagnostic => diagnostic.code);
export const json = (value: unknown) => JSON.parse(JSON.stringify(value));
export const spanless = <T extends { sourceSpan?: SourceSpan }>(values: T[]) => values.map(({ sourceSpan: _span, ...value }) => value);

export function graphNames(graph: GraphIR) {
  return new Map([...graph.points.map(point => [point.key, point.id] as const), ...graph.bearings.map(bearing => [bearing.key, bearing.handle] as const)]);
}

export function relations(graph: GraphIR) {
  const names = graphNames(graph);
  return graph.bearings.map(bearing => ({
    kind: bearing.kind, handle: bearing.handle,
    sources: bearing.sources.map(ref => names.get(ref.key)),
    target: { kind: bearing.target.kind, name: names.get(bearing.target.key) }
  }));
}
