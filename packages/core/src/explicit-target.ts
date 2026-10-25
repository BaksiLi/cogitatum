import { explainSource } from "./source.js";
import { FORMAT_VERSION } from "./types.js";
import type { AstBlock, Diagnostic, ExplainedSource, PointOperatorClause, SourceParseMode } from "./types.js";

export type ExplicitTargetOptions = { line: number; mode?: SourceParseMode };
export type ExplicitTargetUnavailableReason =
  | "invalid-line" | "source-errors" | "no-attachment" | "already-explicit"
  | "unsupported-attachment" | "unnamed-target" | "preservation-failed";
export type ExplicitTargetPreview = {
  version: string;
  mode: SourceParseMode;
  diagnostics: Diagnostic[];
} & (
  | {
      status: "ready";
      originalSource: string;
      proposedSource: string;
      /** One insertion; offset counts UTF-16 code units in originalSource. */
      edit: { offset: number; insert: string };
      proposedDiagnostics: Diagnostic[];
      consequence: string;
    }
  | { status: "unavailable"; reason: ExplicitTargetUnavailableReason; message: string }
);

/**
 * Preview one ordinary implicit Point attachment as an explicit symbolic clause.
 * No source is written. A caller applying a preview must first compare its current
 * complete source with originalSource; a changed source requires a fresh preview.
 */
export function previewExplicitTarget(source: string, options: ExplicitTargetOptions): ExplicitTargetPreview {
  const before = explainSource(source, options.mode ?? "document");
  const base = { version: FORMAT_VERSION, mode: before.mode, diagnostics: before.diagnostics };
  const unavailable = (reason: ExplicitTargetUnavailableReason, message: string): ExplicitTargetPreview => ({ ...base, status: "unavailable", reason, message });
  if (!Number.isSafeInteger(options.line) || options.line < 1) return unavailable("invalid-line", "Select a positive, one-based source line.");
  if (before.diagnostics.some(d => d.severity === "error")) return unavailable("source-errors", "Fix errors in the complete input before preparing an edit.");

  // Source coordinates, compilation and name resolution all come from the same
  // complete input. Never treat a reference inventory's block span as a token span.
  const unitIndex = before.documents.findIndex(document => findBlock(document.blocks, options.line));
  const block = unitIndex < 0 ? undefined : findBlock(before.documents[unitIndex].blocks, options.line);
  const annotation = block?.annotation;
  if (annotation?.kind === "linked") {
    return unavailable("no-attachment", "This linked header constructs one joint Bearing. Making its target explicit requires a separate edit that preserves its source members and their order.");
  }
  if (!block || !annotation || (annotation.kind !== "role" && annotation.kind !== "gap" && annotation.kind !== "use")) {
    return unavailable("no-attachment", "Select an active Point occurrence with an ordinary implicit attachment.");
  }
  if (annotation.operatorClause) return unavailable("already-explicit", "This occurrence already has an explicit target.");
  if ("selector" in annotation && annotation.selector) return unavailable("unsupported-attachment", "Local Bearing selectors require a separate edit; this operation handles ordinary Point attachments only.");
  const entry = before.explanations[unitIndex].entries.find(e => e.sourceSpan.startLine === options.line);
  const emission = entry?.effects.find(effect => effect.kind === "emitBearing");
  if (!emission || emission.reason !== "annotated-containment") {
    if (entry?.effects.some(effect => effect.kind === "linkedMember" && effect.eligible && effect.function === "source")) {
      return unavailable("no-attachment", "This Ground contributes to the enclosing joint Bearing. Making the joint target explicit requires a separate edit of the linked construction, preserving its source members and their order.");
    }
    return unavailable("no-attachment", "This occurrence does not construct an ordinary implicit attachment.");
  }
  const relation = emission.bearing;
  if (relation.target.kind !== "point" || (relation.kind !== "supports" && relation.kind !== "challenges" && relation.kind !== "about")) {
    return unavailable("unsupported-attachment", "This relation has no equivalent Point-attached symbolic clause; moving it into an edge is a different operation.");
  }
  const targetName = before.graphs[unitIndex].points.find(p => p.key === relation.target.key)?.id;
  if (!targetName) return unavailable("unnamed-target", "The selected target has no authored name. Name it deliberately before preparing this edit.");
  const symbol = relation.kind === "supports" ? "+>" : relation.kind === "challenges" ? "->" : "~>";
  const clause: PointOperatorClause = relation.kind === "challenges"
    ? { sources: "self", op: "challenges", targetKind: "point", target: { id: targetName } }
    : { sources: "self", op: relation.kind, targetKind: "either", target: { id: targetName } };

  // Host Markdown recognizes lone CR as well as CRLF/LF; document outlines
  // recognize CRLF/LF. Count the original separators without normalizing bytes.
  const lineEndings = before.mode === "host" ? /\r\n|\r|\n/g : /\r?\n/g;
  let lineOffset = 0, line = 1;
  for (const ending of source.matchAll(lineEndings)) {
    if (line++ === options.line) break;
    lineOffset = ending.index + ending[0].length;
  }
  const annotationOffset = lineOffset + block.sourceSpan.startColumn - 1;
  const expected = "[" + annotation.raw + "]";
  if (source.slice(annotationOffset, annotationOffset + expected.length) !== expected) {
    return unavailable("preservation-failed", "The annotation cannot be located exactly in the original source; no edit is offered.");
  }
  const separator = annotation.raw.indexOf(";");
  const prefix = separator < 0 ? annotation.raw : annotation.raw.slice(0, separator);
  const edit = { offset: annotationOffset + 1 + prefix.trimEnd().length, insert: ` ${symbol} @${targetName}` };
  const proposedSource = source.slice(0, edit.offset) + edit.insert + source.slice(edit.offset);
  const after = explainSource(proposedSource, before.mode);
  if (!preserves(before, after, unitIndex, block, clause, relation.key)) {
    return unavailable("preservation-failed", "Recompilation changed more than the selected target clause and its provenance; no edit is offered.");
  }
  return {
    ...base, status: "ready", originalSource: source, proposedSource, edit,
    proposedDiagnostics: after.diagnostics,
    consequence: `This occurrence now explicitly targets @${targetName}. Later moves will retain that target instead of following the nearest Point context. Changing its role will not automatically change this explicit relation.`
  };
}

function findBlock(blocks: AstBlock[], line: number): AstBlock | undefined {
  for (const block of blocks) {
    if (block.sourceSpan.startLine === line) return block;
    if (block.annotation?.kind !== "note") {
      const found = findBlock(block.children, line);
      if (found) return found;
    }
  }
  return undefined;
}

function preserves(before: ExplainedSource, after: ExplainedSource, unitIndex: number, selected: AstBlock, clause: PointOperatorClause, bearingKey: string): boolean {
  if (after.diagnostics.some(d => d.severity === "error") || before.documents.length !== after.documents.length) return false;
  const expected = structuredClone(before.documents);
  const expectedBlock = findBlock(expected[unitIndex].blocks, selected.sourceSpan.startLine)!;
  const annotation = expectedBlock.annotation;
  if (!annotation || (annotation.kind !== "role" && annotation.kind !== "gap" && annotation.kind !== "use") || ("selector" in annotation && annotation.selector)) return false;
  annotation.operatorClause = clause;
  if (!same(expected, after.documents, ["raw", "sourceSpan"])) return false;
  const expectedGraphs = structuredClone(before.graphs);
  const changed = expectedGraphs[unitIndex].bearings.find(b => b.key === bearingKey);
  if (!changed) return false;
  changed.derivedBy = "operator";
  // The supported insertion changes a Point header only. Every note origin and
  // target must remain exact, even though that header's end column changes.
  if (!same(before.graphs.map(graph => graph.notes), after.graphs.map(graph => graph.notes))) return false;
  if (!same(expectedGraphs.map(({ diagnostics: _d, ...graph }) => graph), after.graphs.map(({ diagnostics: _d, ...graph }) => graph), ["sourceSpan"])) return false;
  // Compiler messages can embed changed source columns. Retain their severity,
  // code and start location; expose both full diagnostic lists in the preview.
  // Only this occurrence's now-obsolete implicit-through-body advice may vanish.
  const signature = (diagnostics: Diagnostic[]) => diagnostics.map(d => [d.severity, d.code, d.sourceSpan?.startLine, d.sourceSpan?.startColumn]);
  const remaining = before.diagnostics.filter(d => !(d.code === "IMPLICIT_ATTACHMENT_THROUGH_BODY" && d.sourceSpan?.startLine === selected.sourceSpan.startLine));
  return same(signature(remaining), signature(after.diagnostics));
}

function same(left: unknown, right: unknown, omitted: string[] = []): boolean {
  const normalize = (_key: string, value: unknown): unknown => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.includes(key)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : value;
  return JSON.stringify(left, normalize) === JSON.stringify(right, normalize);
}
