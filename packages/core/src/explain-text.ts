import { formatDiagnostic, quote } from "./inspection-text.js";
import { FORMAT_VERSION } from "./types.js";
import type { ExplainEffect, ExplainedSource, ExplainReference, SourceSpan } from "./types.js";

export const EXPLAIN_TEXT_VERSION = "1";

/** A readable projection of the existing compiler evidence, including failed
 * decisions and all host units. It neither evaluates reasoning nor edits source.
 */
export function formatExplain(source: ExplainedSource): string {
  if (source.version !== FORMAT_VERSION) throw new Error(`Unsupported source format ${source.version}; expected ${FORMAT_VERSION}.`);
  if (source.units.length !== source.documents.length || source.units.length !== source.graphs.length || source.units.length !== source.explanations.length) throw new Error("Explain inspection requires source, AST, graph and trace from the same compilation.");
  const lines = [
    `cogitatum-explain-text ${EXPLAIN_TEXT_VERSION}`, `format: ${quote(source.version)}`, `input: ${source.mode}`,
    `status: ${source.diagnostics.some(d => d.severity === "error") ? "partial" : "no-errors"}`,
    "Generated keys and locations apply only to this compilation."
  ];
  source.units.forEach((unit, index) => {
    const graph = source.graphs[index];
    const reference = (ref: ExplainReference | undefined): string => {
      if (!ref) return "unavailable";
      if ("id" in ref) return "unresolved @" + ref.id;
      const entity = ref.kind === "point" ? graph.points.find(p => p.key === ref.key) : graph.bearings.find(b => b.key === ref.key);
      if (!entity) return `unavailable ${ref.kind} ${quote(ref.key)}`;
      const name = "declaration" in entity ? entity.id : entity.handle;
      return `${ref.kind} ${name ? "@" + name : quote(ref.key)}${entity.sourceSpan ? " at " + location(entity.sourceSpan) : ""}`;
    };
    const effectText = (effect: ExplainEffect): string => {
      switch (effect.kind) {
        case "preserveBody": return "Preserve ordinary body; it introduces no semantic context.";
        case "preserveNote": return `Preserve a literal note subtree${effect.parentSpan ? " under " + location(effect.parentSpan) : ""}.`;
        case "attachNote": return `${effect.note.origin === "constructor-description" ? "Constructor description" : "Object note"} belongs to ${reference(effect.note.target)}.`;
        case "selectNoteTarget": return `Select ${effect.targetKind} note slot from ${effect.contextSpan ? location(effect.contextSpan) : "no local context"}: ${reference(effect.target)}${crossings(effect.crossedBodySpans)}.`;
        case "localBearingMember": return `In local Bearing at ${location(effect.localBearingSpan)}: ${effect.function}; ${effect.eligible ? "contributes one ordered source" : "does not contribute a source"}.`;
        case "focusPoint": return `Reuse Point @${effect.operand.id}: ${reference(effect.ref)}; this occurrence does not copy its shared content.`;
        case "focusBearing": return `Reuse Bearing @${effect.operand.id}: ${reference(effect.ref)}; its endpoints remain fixed.`;
        case "rejectFocus": return `Reject reuse${effect.operand ? " @" + effect.operand.id : ""}: ${effect.reason}.`;
        case "selectAttachment": return `Select exposed attachment from ${effect.ownerSpan ? location(effect.ownerSpan) : "no local context"}: ${reference(effect.target)}.`;
        case "selectBearing": return `Select referenced Bearing from use at ${location(effect.contextSpan)}: ${reference(effect.target)}.`;
        case "emitPoint": return `Declare ${reference(effect.ref)} (${effect.reason}).`;
        case "rejectPoint": return `Reject Point${effect.id ? " @" + effect.id : ""}: ${effect.reason}.`;
        case "implicitAttachment": return `Local context ${location(effect.contextSpan)} selects ${reference(effect.target)}${crossings(effect.crossedBodySpans)}.`;
        case "emitBearing": return `Construct ${reference(effect.ref)}: ${effect.bearing.kind}([${effect.bearing.sources.map(reference).join(", ")}], ${reference(effect.bearing.target)}); ${effect.bearing.derivedBy}, ${effect.reason}.`;
        case "rejectBearing": return `Reject Bearing: ${effect.reason}${effect.bearing ? `; candidate ${effect.bearing.kind}([${effect.bearing.sources.map(reference).join(", ")}], ${reference(effect.bearing.target)})` : ""}.`;
        case "skipBearing": return `No Bearing: ${effect.reason}.`;
      }
    };
    lines.push("", `unit ${index + 1}: ${unit.kind} at lines ${unit.startLine}-${unit.endLine} (independent namespace)`);
    for (const entry of source.explanations[index].entries) {
      const r = entry.recognition;
      const mark = "role" in r && r.role ? " " + r.role + ("selector" in r && r.selector ? "/" : "") : "";
      lines.push(`  ${location(entry.sourceSpan)} ${r.kind}${mark}`);
      for (const effect of entry.effects) lines.push("    " + effectText(effect));
      if (entry.diagnosticCodes.length) lines.push("    Diagnostics: " + entry.diagnosticCodes.join(", ") + ".");
    }
  });
  lines.push("", `diagnostics (${source.diagnostics.length}):`);
  for (const diagnostic of source.diagnostics) lines.push(...formatDiagnostic(diagnostic));
  return lines.join("\n") + "\n";
}

function location(span: SourceSpan): string {
  return `${span.startLine}:${span.startColumn}-${span.endLine}:${span.endColumn}`;
}
function crossings(spans: SourceSpan[]): string {
  return spans.length ? "; through ordinary body at " + spans.map(location).join(", ") : "; no ordinary body crossed";
}
