import { expandedClause, isRelationSpelling, respellTarget, targetSpelling } from "./annotation.js";
import { annotationOffset, findBlock, minimalEdit, same } from "./source-edit.js";
import type { SourceEdit } from "./source-edit.js";
import { explainSource } from "./source.js";
import { FORMAT_VERSION, isNamedTarget } from "./types.js";
import type { Annotation, AstBlock, Diagnostic, ExplainedSource, OperatorClause, SourceParseMode, TargetTerm } from "./types.js";

/** Whether a relation's target is written by name or selected by position. */
export type TargetForm = "named" | "positional";
export type TargetFormOptions = { line: number; form: TargetForm; mode?: SourceParseMode };
export type TargetFormUnavailableReason =
  | "invalid-line" | "invalid-form" | "source-errors" | "no-bearing"
  | "already-named" | "already-positional" | "unnamed-target" | "preservation-failed";
export type { SourceEdit };
export type TargetFormPreview = {
  version: string;
  mode: SourceParseMode;
  diagnostics: Diagnostic[];
} & (
  | {
      status: "ready";
      originalSource: string;
      proposedSource: string;
      edit: SourceEdit;
      proposedDiagnostics: Diagnostic[];
      consequence: string;
    }
  | { status: "unavailable"; reason: TargetFormUnavailableReason; message: string }
);

/**
 * Preview naming a relation's positional target, or making a named target
 * positional, without writing source. Sources never move: only the target
 * term in one header changes, so the outline, its members and their order
 * stay as authored. A positional result uses the shortest spelling, such as
 * [G] for [G +> ^] or [_] for [_ ~> ^]. Applying a preview requires an exact
 * originalSource comparison; editing invalidates it.
 */
export function previewTargetForm(source: string, options: TargetFormOptions): TargetFormPreview {
  const before = explainSource(source, options.mode ?? "document");
  const base = { version: FORMAT_VERSION, mode: before.mode, diagnostics: before.diagnostics };
  const unavailable = (reason: TargetFormUnavailableReason, message: string): TargetFormPreview =>
    ({ ...base, status: "unavailable", reason, message });
  if (!Number.isSafeInteger(options.line) || options.line < 1) return unavailable("invalid-line", "Select a positive, one-based source line.");
  if (options.form !== "named" && options.form !== "positional") return unavailable("invalid-form", "Choose named or positional.");
  if (before.diagnostics.some(d => d.severity === "error")) return unavailable("source-errors", "Fix errors in the complete input before preparing an edit.");

  const unitIndex = before.documents.findIndex(d => findBlock(d.blocks, options.line));
  const block = unitIndex < 0 ? undefined : findBlock(before.documents[unitIndex].blocks, options.line);
  const annotation = block?.annotation;
  const entry = block && before.explanations[unitIndex].entries.find(e => e.sourceSpan.startLine === block.sourceSpan.startLine);
  const emission = entry?.effects.find(e => e.kind === "emitBearing");
  const clause = expandedClause(annotation);
  if (!block || !annotation || !emission || !clause) {
    return unavailable("no-bearing", entry?.effects.some(e => e.kind === "localBearingMember" && e.eligible && e.function === "source")
      ? "This Point is a source of the enclosing constructor and has no target of its own; select the constructor, whose target can change without moving its members."
      : "Select an occurrence or constructor that authors a validated Bearing.");
  }
  const positional = !isNamedTarget(clause.target);
  if (positional === (options.form === "positional")) {
    return unavailable(positional ? "already-positional" : "already-named", `This relation's target is already ${options.form}.`);
  }

  const graph = before.graphs[unitIndex];
  const bearing = graph.bearings.find(b => b.key === emission.bearing.key)!;
  let target: TargetTerm;
  if (options.form === "named") {
    const name = bearing.target.kind === "point"
      ? graph.points.find(p => p.key === bearing.target.key)?.id
      : graph.bearings.find(b => b.key === bearing.target.key)?.handle;
    if (!name) return unavailable("unnamed-target", `Name the selected ${bearing.target.kind === "point" ? "Point" : "Bearing"} deliberately before naming it here.`);
    target = { id: name };
  } else {
    target = { local: bearing.target.kind };
  }

  const offset = annotationOffset(source, block, before.mode);
  if (offset === undefined) {
    return unavailable("preservation-failed", "The original annotation cannot be located exactly; no edit is offered.");
  }
  const respelled = respellTarget(annotation, target);
  const edit = minimalEdit(annotation.raw, respelled, offset);
  const proposedSource = source.slice(0, edit.offset) + edit.insert + source.slice(edit.offset + edit.remove.length);
  const after = explainSource(proposedSource, before.mode);
  if (!preserves(before, after, unitIndex, block, bearing.key, options.form)) {
    return unavailable("preservation-failed", options.form === "positional"
      ? "The nearest semantic context does not select the same target, or recompilation changed more than this target; no edit is offered."
      : "Recompilation changed more than this target and its provenance; no edit is offered.");
  }
  const consequence = options.form === "named"
    ? `The target is now fixed as ${targetSpelling(target)}; moving this occurrence no longer selects another target.`
    : "The target now follows the nearest semantic context; moving this occurrence can select another target.";
  // Writing or dropping the clause also changes what states the relation.
  const writtenAfter = respelled.split(";")[0].split(/\s+/).find(isRelationSpelling);
  const marked = annotation.kind !== "bearing";
  const relation = !hasWrittenClause(annotation)
    ? ` The relation is now written as ${writtenAfter}` + (marked ? "; changing the mark will no longer change it." : ".")
    : writtenAfter ? ""
      : marked ? " The mark states the relation again; changing the mark will change it." : " The constructor's default states the relation again.";
  return { ...base, status: "ready", originalSource: source, proposedSource, edit, proposedDiagnostics: after.diagnostics, consequence: consequence + relation + " Sources, members and their order are unchanged." };
}

function hasWrittenClause(annotation: Annotation): boolean {
  return "operatorClause" in annotation && annotation.operatorClause !== undefined;
}

/**
 * Only the selected header may change: its relation, sources, handle and
 * Point identity are kept, the Bearing keeps every endpoint, and only its
 * provenance (and through-body advice for a positional target) may differ.
 */
function preserves(before: ExplainedSource, after: ExplainedSource, unitIndex: number, selected: AstBlock, bearingKey: string, form: TargetForm): boolean {
  if (after.diagnostics.some(d => d.severity === "error") || before.documents.length !== after.documents.length) return false;
  const afterBlock = findBlock(after.documents[unitIndex].blocks, selected.sourceSpan.startLine);
  if (!afterBlock || !same(stable(selected.annotation), stable(afterBlock.annotation))) return false;
  const unchanged = (documents: ExplainedSource["documents"], block: AstBlock) =>
    documents.map(d => JSON.stringify(d.blocks, (key, value) => value === block ? { ...block, annotation: undefined } : key === "raw" || key === "sourceSpan" ? undefined : value));
  if (!same(unchanged(before.documents, selected), unchanged(after.documents, afterBlock))) return false;

  const expected = structuredClone(before.graphs);
  const changed = expected[unitIndex].bearings.find(b => b.key === bearingKey);
  if (!changed) return false;
  changed.derivedBy = form === "named" ? "operator" : "structural";
  if (!same(expected.map(({ diagnostics: _d, ...g }) => g), after.graphs.map(({ diagnostics: _d, ...g }) => g), ["sourceSpan"])) return false;
  // Messages can embed changed columns; compare severity, code and start.
  const signature = (diagnostics: Diagnostic[]) => diagnostics
    .filter(d => !(d.code === "IMPLICIT_ATTACHMENT_THROUGH_BODY" && d.sourceSpan?.startLine === selected.sourceSpan.startLine))
    .map(d => [d.severity, d.code, d.sourceSpan?.startLine, d.sourceSpan?.startColumn]);
  return same(signature(before.diagnostics), signature(after.diagnostics));
}

// What a target respelling must not change about the header itself.
function stable(annotation: Annotation | undefined) {
  const clause = expandedClause(annotation);
  if (!annotation || !clause) return undefined;
  return {
    kind: annotation.kind,
    role: "role" in annotation ? annotation.role : undefined,
    anchor: "anchor" in annotation ? annotation.anchor : undefined,
    ref: "ref" in annotation ? annotation.ref : undefined,
    members: "members" in annotation ? annotation.members : undefined,
    handle: "handle" in annotation ? annotation.handle : undefined,
    op: clause.op,
    sources: clause.sources
  };
}

