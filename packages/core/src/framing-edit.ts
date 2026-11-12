import { MARK_RELATIONS } from "./annotation.js";
import { annotationOffset, locateSourceBlock, minimalEdit, same, splitLines, subtreeEndLine } from "./source-edit.js";
import type { SourceEdit } from "./source-edit.js";
import { explainSource } from "./source.js";
import { FORMAT_VERSION } from "./types.js";
import type { Diagnostic, ExplainedSource, ExplainFraming, GraphIR, Role, SourceParseMode } from "./types.js";

/**
 * An edit to how an occurrence is presented, which never changes a relation:
 *
 * - remark: write another mark on the occurrence. Offered only where the
 *   occurrence constructs the same Bearing afterwards, as with a written
 *   clause; re-marking a default changes its relation and is refused.
 * - split: for an opposed framing such as [O @cost +> @delay], re-mark the
 *   occurrence to agree with its clause and keep the original intention as an
 *   unbound use at root, [O use @cost], for the author to target later.
 *
 * Lines are one-based in the complete source.
 */
export type FramingEdit =
  | { operation: "remark"; line: number; mark: Role | "." }
  | { operation: "split"; line: number };
export type FramingEditOptions = FramingEdit & { mode?: SourceParseMode };

export type FramingEditUnavailableReason =
  | "invalid-line" | "invalid-operation" | "source-errors" | "no-occurrence" | "unchanged"
  | "not-opposed" | "unnamed-point" | "changes-relation" | "invalid-result" | "preservation-failed";

export type FramingEditPreview = {
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
      /** The edited occurrence's framing before and after. */
      framing: { before: ExplainFraming; after: ExplainFraming };
      /** Re-marking a declaration also changes the Point's recorded declaration mark. */
      declarationChanged: boolean;
      /** For split: the line of the added unbound use in the proposed source. */
      addedLine?: number;
      consequence: string;
    }
  | { status: "unavailable"; reason: FramingEditUnavailableReason; message: string }
);

const MARKS: readonly string[] = [".", "Q", "C", "G", "O", "R", "D"];

/**
 * Preview a framing edit without writing source. The complete proposed input
 * is recompiled and must construct exactly the same Points and Bearings; only
 * the occurrence's framing, a declaration mark and, for split, one added
 * unbound occurrence may differ.
 */
export function previewFramingEdit(source: string, options: FramingEditOptions): FramingEditPreview {
  return previewFramingEditFrom(source, explainSource(source, options.mode ?? "document"), options);
}

/** @internal Only used with Core's private analysis of this exact source. */
export function previewFramingEditFrom(source: string, before: ExplainedSource, options: FramingEdit): FramingEditPreview {
  const base = { version: FORMAT_VERSION, mode: before.mode, diagnostics: before.diagnostics };
  const unavailable = (reason: FramingEditUnavailableReason, message: string): FramingEditPreview => ({ ...base, status: "unavailable", reason, message });
  if (!Number.isSafeInteger(options.line) || options.line < 1) return unavailable("invalid-line", "Select a positive, one-based source line.");
  if (options.operation !== "remark" && options.operation !== "split") return unavailable("invalid-operation", "Choose remark or split.");
  if (options.operation === "remark" && !MARKS.includes(options.mark)) return unavailable("invalid-operation", "Choose one of the marks ., Q, C, G, O, R or D.");
  if (before.diagnostics.some(d => d.severity === "error")) return unavailable("source-errors", "Fix errors in the complete input before preparing an edit.");

  const located = locateSourceBlock(before, options.line);
  const annotation = located?.block.annotation;
  const framed = located?.entry?.effects.find(e => e.kind === "frameOccurrence");
  if (!located || !framed || !annotation || (annotation.kind !== "role" && annotation.kind !== "material" && annotation.kind !== "use")) {
    return unavailable("no-occurrence", "Select a Point declaration or use.");
  }
  const { unitIndex, block } = located;
  const offset = annotationOffset(source, block, before.mode);
  if (offset === undefined) return unavailable("preservation-failed", "The original annotation cannot be located exactly; no edit is offered.");
  const written = "role" in annotation && annotation.role ? annotation.role : ".";

  let mark: Role | ".";
  let name: string | undefined;
  if (options.operation === "remark") {
    mark = options.mark;
    if (mark === written) return unavailable("unchanged", `This occurrence is already marked ${written}.`);
  } else {
    if (framed.framing !== "opposed") return unavailable("not-opposed", "Only an opposed framing, a G whose clause challenges or an O whose clause supports, is split.");
    mark = written === "O" ? "G" : "O";
    name = annotation.kind === "use" ? annotation.ref?.id : annotation.anchor;
    if (!name) return unavailable("unnamed-point", "A separate use needs a name to refer to; name this Point deliberately first.");
  }

  // Only the family or mark token changes; a selector slash, operand, clause and handle stay as written.
  const remarked = annotation.raw.replace(/^(\s*)(?:[QCGORD]|\.|point)/, `$1${mark}`);
  let proposedSource = source.slice(0, offset) + remarked + source.slice(offset + annotation.raw.length);
  let addedLine: number | undefined;
  if (name) {
    // The kept intention goes to root, after the enclosing root block: nested
    // beneath a Point it would construct a new relation instead.
    const blocks = before.documents[unitIndex].blocks;
    const root = blocks.find(candidate => candidate.sourceSpan.startLine <= block.sourceSpan.startLine && block.sourceSpan.startLine <= subtreeEndLine(candidate))!;
    const lines = splitLines(proposedSource, before.mode);
    const first = lines[root.sourceSpan.startLine - 1].text;
    const prefix = first.slice(0, first.lastIndexOf("-", root.sourceSpan.startColumn - 2));
    const end = subtreeEndLine(root);
    const ending = lines[end - 1].ending || lines.find(l => l.ending)?.ending || "\n";
    const added = { text: `${prefix}- [${written} use @${name}]`, ending: lines[end - 1].ending };
    lines[end - 1].ending = ending;
    lines.splice(end, 0, added);
    proposedSource = lines.map(l => l.text + l.ending).join("");
    addedLine = end + 1;
  }

  const after = explainSource(proposedSource, before.mode);
  const errors = after.diagnostics.filter(d => d.severity === "error");
  if (errors.length) return unavailable("invalid-result", `The edited source would not compile: ${errors[0].message}`);
  if (after.documents.length !== before.documents.length) return unavailable("preservation-failed", "The edit would change the source units; no edit is offered.");
  const afterEntry = after.explanations[unitIndex].entries.find(e => e.sourceSpan.startLine === block.sourceSpan.startLine);
  const reframed = afterEntry?.effects.find(e => e.kind === "frameOccurrence");
  if (!reframed) return unavailable("preservation-failed", "The edited occurrence no longer stands; no edit is offered.");

  // Everything constructed stays; a declaration records its new mark.
  const declares = annotation.kind !== "use";
  const expected = structuredClone(before.graphs);
  if (declares) {
    const key = located.entry?.effects.find(e => e.kind === "emitPoint")?.ref.key;
    const point = expected[unitIndex].points.find(p => p.key === key);
    if (!point) return unavailable("preservation-failed", "The declared Point cannot be located; no edit is offered.");
    point.declaration = mark === "." ? { form: "material" } : { form: "role", role: mark };
  }
  const constructed = (graphs: GraphIR[]) => graphs.map(({ diagnostics: _diagnostics, ...graph }) => graph);
  if (!same(constructed(expected), constructed(after.graphs), ["sourceSpan"])) {
    const relation = (entry: typeof afterEntry) => {
      const emitted = entry?.effects.find(e => e.kind === "emitBearing");
      return emitted?.kind === "emitBearing" ? emitted.bearing.kind : "no relation";
    };
    return unavailable("changes-relation", options.operation === "remark" && relation(located.entry) !== relation(afterEntry)
      ? `Here the mark states the relation: ${mark} would construct ${relation(afterEntry)} in place of ${relation(located.entry)}. That changes a commitment; decide the relation's kind instead, or write a clause first.`
      : "Recompilation changed more than this occurrence's framing; no edit is offered.");
  }
  if (addedLine !== undefined) {
    const kept = after.explanations[unitIndex].entries.find(e => e.sourceSpan.startLine === addedLine)?.effects.find(e => e.kind === "frameOccurrence");
    if (kept?.framing !== "unbound" || kept.intention !== MARK_RELATIONS[written as Role]) return unavailable("preservation-failed", "The added use would not keep the original intention unbound; no edit is offered.");
  }
  const { kind: _b, focus: _bf, ...framingBefore } = framed;
  const { kind: _a, focus: _af, ...framingAfter } = reframed;
  const consequence = (declares ? `The Point is now declared ${mark}; ` : "This occurrence is now marked " + mark + "; ")
    + "every constructed relation is unchanged."
    + (addedLine !== undefined ? ` Line ${addedLine} keeps the ${written === "O" ? "objection" : "ground"} intention as an unbound use with no target; it constructs nothing until it is placed or given a clause.` : "");
  return {
    ...base, status: "ready", originalSource: source, proposedSource,
    edit: minimalEdit(source, proposedSource), proposedDiagnostics: after.diagnostics,
    framing: { before: framingBefore as ExplainFraming, after: framingAfter as ExplainFraming },
    declarationChanged: declares,
    ...(addedLine !== undefined ? { addedLine } : {}),
    consequence
  };
}
