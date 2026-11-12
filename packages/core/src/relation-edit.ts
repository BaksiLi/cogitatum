import { defaultRelation, expandedClause, leavesIntentionUnbound, MARK_RELATIONS, operatorSymbol, respellClause, targetSpelling } from "./annotation.js";
import type { Focus } from "./annotation.js";
import { compareCommitments } from "./commitments.js";
import type { CommitmentComparison, Correspondence } from "./commitments.js";
import { annotationOffset, focusAt, locateSourceBlock, minimalEdit, parentBlock, same, splitLines, subtreeEndLine } from "./source-edit.js";
import type { SourceEdit, SourceLine } from "./source-edit.js";
import { explainSource } from "./source.js";
import { FORMAT_VERSION, isNamedTarget } from "./types.js";
import type { Annotation, AstBlock, BearingKind, Diagnostic, ExplainedSource, GraphIR, OperatorClause, Role, SourceParseMode, TargetTerm } from "./types.js";

/**
 * A structural edit to recorded relations:
 *
 * - decide: give one relation another kind, such as [_] to [_ +> ^];
 * - retarget: give one relation another target, named or positional, keeping
 *   its kind, sources and place in the outline. A Ground left unbound beneath
 *   a Question is bound instead: it supports the selected target;
 * - separate: replace a member-sourced constructor with one relation per
 *   member, such as [_ +> ^] over a and b to [G] a and [G] b;
 * - join: replace adjacent sibling relations of one kind and target with one
 *   constructor whose members they become, the inverse of separate.
 *
 * Lines are one-based in the complete source.
 */
export type RelationEdit =
  | { operation: "decide"; line: number; kind: BearingKind }
  | { operation: "retarget"; line: number; target: TargetTerm }
  | { operation: "separate"; line: number }
  | { operation: "join"; lines: number[] };
export type RelationEditOptions = RelationEdit & { mode?: SourceParseMode };

export type RelationEditUnavailableReason =
  | "invalid-line" | "invalid-operation" | "source-errors" | "no-relation" | "unchanged"
  | "not-separable" | "not-joinable" | "profiled-relation" | "invalid-result" | "preservation-failed";

export type RelationEditPreview = {
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
      /** Which entity of the edited source unit continues which; the edit knows what it moved. */
      correspondence: Correspondence;
      /**
       * What the edit commits the author to, in the commitment order. A
       * refinement only adds; any retraction makes the edit a weakening or
       * revision, which a caller may require the author to confirm.
       */
      comparison: Extract<CommitmentComparison, { status: "compared" }>;
    }
  | { status: "unavailable"; reason: RelationEditUnavailableReason; message: string }
);

// The marks whose only content is their relation; Q also marks a question.
const RELATION_MARKS = new Map<BearingKind, Role>(
  (Object.entries(MARK_RELATIONS) as [Role, BearingKind][]).filter(([role]) => role !== "Q").map(([role, kind]) => [kind, role])
);

type Unit = { index: number; graph: GraphIR; blocks: AstBlock[] };
type Plan = {
  unit: Unit;
  lines: SourceLine[];
  /** Old line to new line for every line kept; removed lines are absent. */
  lineMap: (line: number) => number | undefined;
  /** Bearings this edit replaces, and the lines of the Bearings it creates. */
  replaced: string[];
  createdLines: number[];
  /** Bearings that continue on their own line with a changed relation. */
  continued: string[];
};

/**
 * Preview a structural edit to recorded relations without writing source.
 * The tool supplies the correspondence it knows from the edit, recompiles the
 * complete proposed input, requires that only the edited relations change,
 * and classifies the result with compareCommitments.
 */
export function previewRelationEdit(source: string, options: RelationEditOptions): RelationEditPreview {
  return previewRelationEditFrom(source, explainSource(source, options.mode ?? "document"), options);
}

/** @internal Only used with Core's private analysis of this exact source. */
export function previewRelationEditFrom(source: string, before: ExplainedSource, options: RelationEdit): RelationEditPreview {
  const base = { version: FORMAT_VERSION, mode: before.mode, diagnostics: before.diagnostics };
  const unavailable = (reason: RelationEditUnavailableReason, message: string): RelationEditPreview => ({ ...base, status: "unavailable", reason, message });
  const lines = options.operation === "join" ? options.lines : [options.line];
  if (!Array.isArray(lines) || !lines.length || lines.some(line => !Number.isSafeInteger(line) || line < 1)) return unavailable("invalid-line", "Select positive, one-based source lines.");
  if (!["decide", "retarget", "separate", "join"].includes(options.operation)) return unavailable("invalid-operation", "Choose decide, retarget, separate or join.");
  if (before.diagnostics.some(d => d.severity === "error")) return unavailable("source-errors", "Fix errors in the complete input before preparing an edit.");

  const planned = options.operation === "decide" ? planRespell(source, before, options.line, { op: options.kind })
    : options.operation === "retarget" ? planRespell(source, before, options.line, { target: options.target })
    : options.operation === "separate" ? planSeparate(source, before, options.line)
    : planJoin(source, before, options.lines);
  if ("reason" in planned) return unavailable(planned.reason, planned.message);
  const { plan, proposedSource } = planned;
  // Whether several examples form one joint example, or an example remains
  // one under another kind, is not decided by matching profiles.
  const edited = [...plan.replaced, ...plan.continued];
  if (plan.unit.graph.bearings.some(b => b.profile && edited.includes(b.key))) {
    return unavailable("profiled-relation", "This relation is offered by example. Joining, separating or changing its kind would have to drop or reinterpret that profile, which this edit does not promise; edit the source deliberately instead.");
  }

  const after = explainSource(proposedSource, before.mode);
  const errors = after.diagnostics.filter(d => d.severity === "error");
  if (errors.length) return unavailable("invalid-result", `The edited source would not compile: ${errors[0].message}`);
  if (after.documents.length !== before.documents.length) return unavailable("preservation-failed", "The edit would change the source units; no edit is offered.");
  // Other units only move.
  const others = (compiled: ExplainedSource) => compiled.graphs.filter((_, i) => i !== plan.unit.index).map(({ diagnostics: _d, ...graph }) => graph);
  if (!same(others(before), others(after), ["sourceSpan"])) return unavailable("preservation-failed", "The edit would change another source unit; no edit is offered.");

  const later = after.graphs[plan.unit.index];
  const correspondence = correspondenceByLine(plan, later);
  const comparison = compareCommitments(plan.unit.graph, later, correspondence);
  if (comparison.status !== "compared") return unavailable("preservation-failed", comparison.message);
  const created = new Set(later.bearings.filter(b => b.sourceSpan && plan.createdLines.includes(b.sourceSpan.startLine)).map(b => b.key));
  const editedBefore = new Set([...plan.replaced, ...plan.continued]);
  const editedAfter = new Set([...created, ...plan.continued.map(key => correspondence.bearings[key])]);
  // Points neither appear nor disappear, and keep their text; only the
  // edited relations may change commitments.
  if (comparison.points.removed.length || comparison.points.added.length || comparison.points.changed.some(c => c.text)
    || comparison.retracted.some(c => c.bearings.some(key => !editedBefore.has(key)))
    || comparison.added.some(c => c.bearings.some(key => !editedAfter.has(key)))) {
    return unavailable("preservation-failed", "Recompilation changed more than the edited relations; no edit is offered.");
  }
  return {
    ...base, status: "ready", originalSource: source, proposedSource,
    edit: minimalEdit(source, proposedSource), proposedDiagnostics: after.diagnostics, correspondence, comparison
  };
}

type Planned = { plan: Plan; proposedSource: string } | { reason: RelationEditUnavailableReason; message: string };

// One header changes and its Bearing continues: with another kind, or another target.
function planRespell(source: string, before: ExplainedSource, line: number, change: { op: BearingKind } | { target: TargetTerm }): Planned {
  const located = locate(before, line);
  if (!located) return { reason: "no-relation", message: "Select an occurrence or constructor that authors a validated Bearing." };
  const { unit, block, clause, bearing, focus } = located;
  const annotation = block.annotation!;
  let header: string;
  if ("op" in change) {
    if (clause.op === change.op) return { reason: "unchanged", message: `This relation is already ${change.op}.` };
    header = decidedHeader(annotation, clause, change.op, focus);
  } else {
    const term = change.target;
    const valid = term && typeof term === "object" && (isNamedTarget(term) ? /^[a-z][a-z0-9_-]*$/.test(String(term.id)) : term.local === "point" || term.local === "bearing");
    if (!valid) return { reason: "invalid-operation", message: "Give the new target as a name, ^ or ^/." };
    if (JSON.stringify(clause.target) === JSON.stringify(term)) return { reason: "unchanged", message: `This relation already targets ${targetSpelling(term)}.` };
    // An unbound Ground has no support to move: selecting its target binds
    // the intention, so the mark's own relation is constructed toward it.
    const role = annotation.kind === "role" || annotation.kind === "use" ? annotation.role : undefined;
    const binds = focus && !("operatorClause" in annotation && annotation.operatorClause) && !("selector" in annotation && annotation.selector) && leavesIntentionUnbound(role, focus);
    header = respellClause(annotation, binds ? { op: MARK_RELATIONS[role!]!, target: term } : { target: term }, focus);
  }
  const offset = annotationOffset(source, block, before.mode)!;
  const proposedSource = source.slice(0, offset) + header + source.slice(offset + annotation.raw.length);
  return { plan: { unit, lines: splitLines(source, before.mode), lineMap: l => l, replaced: [], createdLines: [], continued: [bearing] }, proposedSource };
}

function planSeparate(source: string, before: ExplainedSource, line: number): Planned {
  const located = locate(before, line);
  const annotation = located?.block.annotation;
  if (!located || annotation?.kind !== "bearing" || !annotation.members) {
    return { reason: "not-separable", message: "Select a constructor whose direct neutral children are its sources." };
  }
  const { unit, block, clause, bearing, focus } = located;
  if (annotation.handle || block.text) {
    return { reason: "not-separable", message: "The constructor's handle and description belong to the joint relation, which separation removes; move or drop them first." };
  }
  const entries = before.explanations[unit.index].entries;
  const role = (child: AstBlock) => entries.find(e => e.sourceSpan.startLine === child.sourceSpan.startLine)?.effects
    .find(e => e.kind === "localBearingMember");
  const others = block.children.filter(child => (role(child) as { function?: string } | undefined)?.function !== "source");
  if (others.length) {
    return { reason: "not-separable", message: `Line ${others[0].sourceSpan.startLine} addresses or annotates the joint relation itself, which separation removes; move or retarget it first.` };
  }

  const lines = splitLines(source, before.mode);
  const constructorDash = dashColumn(lines, block);
  const memberDash = dashColumn(lines, block.children[0]);
  const first = block.children[0].sourceSpan.startLine;
  const last = subtreeEndLine(block);
  const prefix = lines[first - 1].text.slice(0, memberDash);
  const edited = lines.map(l => ({ ...l }));
  for (let n = first; n <= last; n++) {
    const text = edited[n - 1].text;
    if (text.trim() === "") continue;
    if (text.slice(0, constructorDash) !== prefix.slice(0, constructorDash) || text.slice(constructorDash, memberDash).trim() !== "") {
      return { reason: "preservation-failed", message: "A member's lines do not share the constructor's indentation; no edit is offered." };
    }
    edited[n - 1].text = text.slice(0, constructorDash) + text.slice(memberDash);
  }
  for (const child of block.children) {
    const at = edited[child.sourceSpan.startLine - 1];
    const column = child.sourceSpan.startColumn - 1 - (memberDash - constructorDash);
    const raw = child.annotation!.raw;
    at.text = at.text.slice(0, column) + "[" + occurrenceHeader(child.annotation!, clause.op, clause.target, focus) + "]" + at.text.slice(column + raw.length + 2);
  }
  const removed = first - block.sourceSpan.startLine;
  const kept = [...edited.slice(0, block.sourceSpan.startLine - 1), ...edited.slice(first - 1)];
  return {
    plan: {
      unit, lines, replaced: [bearing], continued: [],
      createdLines: block.children.map(child => child.sourceSpan.startLine - removed),
      lineMap: l => l < block.sourceSpan.startLine ? l : l < first ? undefined : l - removed
    },
    proposedSource: join(kept)
  };
}

function planJoin(source: string, before: ExplainedSource, selected: number[]): Planned {
  if (selected.length < 2) return { reason: "not-joinable", message: "Select at least two relations to join." };
  const located = selected.map(line => locate(before, line));
  if (located.some(l => !l)) return { reason: "no-relation", message: "Each selected line must author a validated Bearing." };
  const items = located as NonNullable<ReturnType<typeof locate>>[];
  const unit = items[0].unit;
  const parent = parentBlock(unit.blocks, items[0].block);
  const siblings = parent ? parent.children : unit.blocks;
  const indices = items.map(item => siblings.indexOf(item.block));
  if (items.some(item => item.unit.index !== unit.index) || indices.some((index, i) => index < 0 || (i > 0 && index !== indices[i - 1] + 1))) {
    return { reason: "not-joinable", message: "Select adjacent sibling occurrences, in order, so that joining moves no other content." };
  }
  const [{ clause }] = items;
  for (const item of items) {
    const annotation = item.block.annotation!;
    if (item.clause.sources !== "self" || annotation.kind === "bearing") return { reason: "not-joinable", message: "Only Point occurrences, each the sole source of its relation, can become members." };
    if ("handle" in annotation && annotation.handle) return { reason: "not-joinable", message: "A handle names one occurrence's relation, which joining replaces; remove it first." };
    // A member keeps only its operand, so its mark may mean nothing but the joined relation.
    const role = annotation.kind === "role" || annotation.kind === "use" ? annotation.role : undefined;
    if (role === "Q" || role === "C") return { reason: "not-joinable", message: `A ${role} occurrence declares its Point as well as a relation; joining would erase that declaration.` };
    if (item.clause.op !== clause.op || JSON.stringify(item.clause.target) !== JSON.stringify(clause.target)) {
      return { reason: "not-joinable", message: "The selected relations must share one kind and one written target term." };
    }
  }

  const lines = splitLines(source, before.mode);
  const dash = dashColumn(lines, items[0].block);
  const parentDash = parent ? dashColumn(lines, parent) : undefined;
  const step = parentDash === undefined ? unitIndentStep(lines, unit.blocks) : lines[items[0].block.sourceSpan.startLine - 1].text.slice(parentDash, dash);
  const prefix = lines[items[0].block.sourceSpan.startLine - 1].text.slice(0, dash);
  const first = items[0].block.sourceSpan.startLine;
  const last = subtreeEndLine(items[items.length - 1].block);
  const edited = lines.map(l => ({ ...l }));
  for (let n = first; n <= last; n++) {
    const text = edited[n - 1].text;
    if (text.trim() === "") continue;
    if (text.slice(0, dash) !== prefix) return { reason: "preservation-failed", message: "An occurrence's lines do not share its indentation; no edit is offered." };
    edited[n - 1].text = prefix + step + text.slice(dash);
  }
  for (const { block } of items) {
    const at = edited[block.sourceSpan.startLine - 1];
    const column = block.sourceSpan.startColumn - 1 + step.length;
    const raw = block.annotation!.raw;
    at.text = at.text.slice(0, column) + "[" + memberHeader(block.annotation!) + "]" + at.text.slice(column + raw.length + 2);
  }
  const ending = lines[first - 1].ending || lines.find(l => l.ending)?.ending || "\n";
  const header = { text: `${prefix}- [${constructorHeader(clause)}]`, ending };
  const kept = [...edited.slice(0, first - 1), header, ...edited.slice(first - 1)];
  return {
    plan: {
      unit, lines, replaced: items.map(item => item.bearing), continued: [], createdLines: [first],
      lineMap: l => l < first ? l : l + 1
    },
    proposedSource: join(kept)
  };
}

/** The validated relation an occurrence or constructor at line authors. */
function locate(before: ExplainedSource, line: number) {
  const located = locateSourceBlock(before, line);
  if (!located) return undefined;
  const { unitIndex: index, block, entry } = located;
  const blocks = before.documents[index].blocks;
  const focus = focusAt(blocks, block);
  const clause = expandedClause(block.annotation, focus);
  const emission = entry?.effects.find(e => e.kind === "emitBearing");
  if (!clause || !emission || emission.kind !== "emitBearing") return undefined;
  return { unit: { index, graph: before.graphs[index], blocks }, block, clause, bearing: emission.bearing.key, focus };
}

/** Pair entities by where the edit moved their lines. */
function correspondenceByLine(plan: Plan, after: GraphIR): Correspondence {
  const at = <T extends { key: string; sourceSpan?: { startLine: number } }>(items: T[]) =>
    new Map(items.filter(e => e.sourceSpan).map(e => [e.sourceSpan!.startLine, e.key]));
  const laterPoints = at(after.points), laterBearings = at(after.bearings);
  const points: Record<string, string> = {}, bearings: Record<string, string> = {};
  for (const point of plan.unit.graph.points) {
    const line = point.sourceSpan && plan.lineMap(point.sourceSpan.startLine);
    const key = line === undefined ? undefined : laterPoints.get(line);
    if (key !== undefined) points[point.key] = key;
  }
  for (const bearing of plan.unit.graph.bearings) {
    if (plan.replaced.includes(bearing.key)) continue;
    const line = bearing.sourceSpan && plan.lineMap(bearing.sourceSpan.startLine);
    const key = line === undefined ? undefined : laterBearings.get(line);
    if (key !== undefined) bearings[bearing.key] = key;
  }
  return { points, bearings };
}

/**
 * A header stating another kind. A mark that only abbreviates the old
 * relation (G, O, R, D) gives way to the new kind's mark, so [G] becomes [O]
 * rather than [G -> ^]; Q, C and neutral marks keep their own meaning and
 * write the clause instead.
 */
function decidedHeader(annotation: Annotation, clause: OperatorClause, kind: BearingKind, focus: Focus | undefined): string {
  const role = annotation.kind === "role" || annotation.kind === "use" ? annotation.role : undefined;
  const next = RELATION_MARKS.get(kind);
  // The new mark must state the new kind where it stands: beneath a Question, G does not support.
  const stated = next && ("selector" in annotation && annotation.selector ? MARK_RELATIONS[next] === kind : marks(next, kind, focus));
  if (role && role !== "Q" && MARK_RELATIONS[role] === clause.op && stated && !("operatorClause" in annotation && annotation.operatorClause)) {
    // Only the mark letter changes; a selector slash, operand and handle stay.
    return annotation.raw.replace(/^(\s*)[GORD]/, `$1${next}`);
  }
  // Deciding a mark's own relation down to relevance leaves nothing for the
  // mark to state: beneath a Point focus the neutral mark records it.
  if (role && role !== "Q" && MARK_RELATIONS[role] === clause.op && kind === "concerns" && marks(undefined, kind, focus)
    && !isNamedTarget(clause.target) && clause.target.local === "point" && !("operatorClause" in annotation && annotation.operatorClause)) {
    return annotation.raw.replace(/^(\s*)[GORD]/, "$1.");
  }
  return respellClause(annotation, { op: kind }, focus);
}

/** A member's header as a separate occurrence stating the constructor's relation. */
function occurrenceHeader(annotation: Annotation, op: BearingKind, target: TargetTerm, focus: Focus | undefined): string {
  const operand = annotation.kind === "use" ? ` use @${annotation.ref!.id}` : "anchor" in annotation && annotation.anchor ? ` @${annotation.anchor}` : "";
  const mark = RELATION_MARKS.get(op);
  if (!isNamedTarget(target)) {
    if (target.local === "bearing" && mark) return mark + "/" + operand;
    if (target.local === "point" && marks(mark, op, focus)) return (mark ?? ".") + operand;
  }
  return (mark ?? ".") + operand + ` ${operatorSymbol(op) ?? op} ${targetSpelling(target)}`;
}

/** Whether a bare mark (undefined for the neutral .) constructs exactly this kind beneath the focus. */
function marks(mark: Role | undefined, kind: BearingKind, focus: Focus | undefined): boolean {
  return !!focus && defaultRelation(mark, focus) === kind && !leavesIntentionUnbound(mark, focus);
}

/** An occurrence's header as a neutral member: its operand without mark or clause. */
function memberHeader(annotation: Annotation): string {
  if (annotation.kind === "use") return `. use @${annotation.ref!.id}`;
  return "anchor" in annotation && annotation.anchor ? `. @${annotation.anchor}` : ".";
}

function constructorHeader(clause: OperatorClause): string {
  if (clause.op === "concerns" && !isNamedTarget(clause.target)) return clause.target.local === "bearing" ? "_/" : "_";
  return `_ ${operatorSymbol(clause.op) ?? clause.op} ${targetSpelling(clause.target)}`;
}

/** The indentation one nesting level adds in this unit, or two spaces when it nests nothing. */
function unitIndentStep(lines: SourceLine[], blocks: AstBlock[]): string {
  // A root without children has no nested blocks at all, so roots suffice.
  const parent = blocks.find(block => block.children.length);
  if (!parent) return "  ";
  const child = parent.children[0];
  return lines[child.sourceSpan.startLine - 1].text.slice(dashColumn(lines, parent), dashColumn(lines, child));
}

/** The column of a block's bullet marker within its physical line. */
function dashColumn(lines: SourceLine[], block: AstBlock): number {
  const text = lines[block.sourceSpan.startLine - 1].text;
  return text.lastIndexOf("-", block.sourceSpan.startColumn - 2);
}

function join(lines: SourceLine[]): string {
  return lines.map(l => l.text + l.ending).join("");
}
