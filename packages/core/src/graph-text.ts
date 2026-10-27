import { FORMAT_VERSION } from "./types.js";
import type { BearingTarget, GraphIR, PointDeclaration } from "./types.js";
import { formatDiagnostic, quote } from "./inspection-text.js";

/** Version of the inspection notation, independent of the compiler's JSON format. */
export const GRAPH_TEXT_VERSION = "1";

/**
 * Render one compiler-produced graph using the structure-v1 projection.
 * Labels belong only to this output. Source/AST/Explain and entity spans are
 * deliberately outside the projection; diagnostics remain visible, even for a
 * partial graph. Callers importing JSON must validate it before calling this API.
 */
export function formatGraph(graph: GraphIR): string {
  if (graph.version !== FORMAT_VERSION) {
    throw new Error(`Unsupported graph format ${graph.version}; expected ${FORMAT_VERSION}.`);
  }
  const points = labels(graph.points, "p");
  const bearings = labels(graph.bearings, "b");
  const reference = (ref: BearingTarget): string => {
    const label = (ref.kind === "point" ? points : bearings).get(ref.key);
    if (!label) throw new Error(`Cannot format dangling ${ref.kind} reference ${quote(ref.key)}.`);
    return label;
  };
  const lines = [
    `cogitatum-graph-text ${GRAPH_TEXT_VERSION}`,
    `format: ${quote(graph.version)}`,
    "projection: structure-v1",
    `status: ${graph.diagnostics.some(d => d.severity === "error") ? "partial" : "no-errors"}`,
    "",
    `points (${graph.points.length}):`
  ];
  for (const point of graph.points) {
    lines.push(`${points.get(point.key)}: ${declaration(point.declaration)}${field("id", point.id)} text=${quote(point.text)}`);
  }
  lines.push("", `bearings (${graph.bearings.length}):`);
  for (const bearing of graph.bearings) {
    // Fail closed rather than print a plausible-looking reduced or aliased step.
    if (!bearing.sources.length || bearing.sources.some(source => source.kind !== "point") ||
        new Set(bearing.sources.map(source => source.key)).size !== bearing.sources.length) {
      throw new Error(`Cannot format Bearing ${quote(bearing.key)} with invalid sources.`);
    }
    const sources = bearing.sources.map(reference).join(", ");
    lines.push(`${bearings.get(bearing.key)}: ${bearing.kind}([${sources}], ${reference(bearing.target)})${field("handle", bearing.handle)}${field("text", bearing.text)}`);
  }
  lines.push("", `diagnostics (${graph.diagnostics.length}):`);
  for (const diagnostic of graph.diagnostics) lines.push(...formatDiagnostic(diagnostic));
  return lines.join("\n") + "\n";
}

function labels(entities: { key: string }[], prefix: "p" | "b"): Map<string, string> {
  const result = new Map<string, string>();
  for (const [index, entity] of entities.entries()) {
    if (result.has(entity.key)) throw new Error(`Cannot format duplicate ${prefix === "p" ? "Point" : "Bearing"} key ${quote(entity.key)}.`);
    result.set(entity.key, `${prefix}${index + 1}`);
  }
  return result;
}

function declaration(value: PointDeclaration): string {
  if (value.form === "role") return `role(${value.role})`;
  return "material";
}

function field(name: string, value: string | undefined): string {
  return value === undefined ? "" : ` ${name}=${quote(value)}`;
}
