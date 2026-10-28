import { operatorSymbol } from "./annotation.js";
import { explainSource } from "./source.js";
import { FORMAT_VERSION } from "./types.js";
import type {
  Annotation, AstBlock, Bearing, BearingTarget, Diagnostic, ExplainedSource,
  OperatorClause, SourceParseMode, SourceSpan
} from "./types.js";

export type BearingForm = "local" | "explicit";
export type BearingFormOptions = { line: number; form: BearingForm; mode?: SourceParseMode };
export type BearingFormUnavailableReason =
  | "invalid-line" | "invalid-form" | "source-errors" | "no-bearing" | "already-local" | "already-explicit"
  | "unnamed-target" | "unnamed-source" | "unsupported-local-form" | "preservation-failed";
/** Offsets count UTF-16 code units in originalSource. Edits are ordered and do not overlap. */
export type SourceEdit = { offset: number; remove: string; insert: string };
export type BearingFormPreview = {
  version: string;
  mode: SourceParseMode;
  diagnostics: Diagnostic[];
} & (
  | {
      status: "ready";
      originalSource: string;
      proposedSource: string;
      edits: SourceEdit[];
      proposedDiagnostics: Diagnostic[];
      consequence: string;
    }
  | { status: "unavailable"; reason: BearingFormUnavailableReason; message: string }
);

type Occurrence = { block: AstBlock; ancestors: AstBlock[] };
type PhysicalLine = { offset: number; next: number; text: string; ending: string };

/**
 * Preview one structurally equivalent Bearing spelling, without writing source.
 * Applying it requires an exact originalSource comparison; editing invalidates it.
 * This preserves authored content and graph structure, not reading order, source
 * restoration, logical equivalence or behaviour after subsequent edits.
 */
export function previewBearingForm(source: string, options: BearingFormOptions): BearingFormPreview {
  const before = explainSource(source, options.mode ?? "document");
  const base = { version: FORMAT_VERSION, mode: before.mode, diagnostics: before.diagnostics };
  const unavailable = (reason: BearingFormUnavailableReason, message: string): BearingFormPreview =>
    ({ ...base, status: "unavailable", reason, message });
  if (!Number.isSafeInteger(options.line) || options.line < 1) return unavailable("invalid-line", "Select a positive, one-based source line.");
  if (options.form !== "local" && options.form !== "explicit") return unavailable("invalid-form", "Choose local or explicit.");
  if (before.diagnostics.some(d => d.severity === "error")) return unavailable("source-errors", "Fix errors in the complete input before preparing an edit.");
  const unitIndex = before.documents.findIndex(d => findOccurrence(d.blocks, options.line));
  const occurrence = unitIndex < 0 ? undefined : findOccurrence(before.documents[unitIndex].blocks, options.line);
  const block = occurrence?.block;
  const annotation = block?.annotation;
  const entry = unitIndex < 0 ? undefined : before.explanations[unitIndex].entries.find(e => e.sourceSpan.startLine === block?.sourceSpan.startLine);
  const emission = entry?.effects.find(e => e.kind === "emitBearing");
  if (!occurrence || !block || !annotation || !emission) return unavailable("no-bearing", "Select an active occurrence that constructs a validated Bearing, rather than a member, note or use of a Bearing.");
  const explicit = "operatorClause" in annotation && Boolean(annotation.operatorClause);
  if (explicit === (options.form === "explicit")) return unavailable(explicit ? "already-explicit" : "already-local", `This occurrence already uses ${options.form} construction.`);
  const graph = before.graphs[unitIndex];
  const bearing = graph.bearings.find(b => b.key === emission.bearing.key)!;
  const targetName = bearing.target.kind === "point"
    ? graph.points.find(p => p.key === bearing.target.key)?.id
    : graph.bearings.find(b => b.key === bearing.target.key)?.handle;
  const sourceNames = bearing.sources.map(s => graph.points.find(p => p.key === s.key)?.id);
  const group = annotation.kind === "localBearing" || annotation.kind === "explicitBearing";
  if (options.form === "explicit" && !targetName) return unavailable("unnamed-target", "Name the selected Point or Bearing deliberately before making this target explicit.");
  if (group && sourceNames.some(id => !id)) return unavailable("unnamed-source", "Name every joint source deliberately before previewing explicit references or local source uses.");

  const expected = structuredClone(before.documents);
  const clones = new Map<AstBlock, AstBlock>();
  before.documents.forEach((d, i) => pairBlocks(d.blocks, expected[i].blocks, clones));
  const selected = clones.get(block)!;
  const lines = physicalLines(source, before.mode);
  const headerOffset = lines[block.sourceSpan.startLine - 1].offset + block.sourceSpan.startColumn - 1;
  const oldHeader = "[" + annotation.raw + "]";
  if (source.slice(headerOffset, headerOffset + oldHeader.length) !== oldHeader) return unavailable("preservation-failed", "The original annotation cannot be located exactly; no edit is offered.");
  const edits: SourceEdit[] = [];
  const handle = "handle" in annotation && annotation.handle;
  const handleText = handle ? `; @${handle}` : "";
  const family = /^\s*(bearing|edge|_)(?=\s)/.exec(annotation.raw)?.[1] ?? "_";
  let header: string;
  let consequence: string;

  if (options.form === "explicit") {
    const clause = explicitClause(bearing, targetName!);
    const symbol = operatorSymbol(clause.op, clause.targetKind) ?? clause.op;
    if (annotation.kind === "localBearing") {
      const sources = block.children.filter(child => before.explanations[unitIndex].entries
        .find(e => e.sourceSpan.startLine === child.sourceSpan.startLine)?.effects
        .some(e => e.kind === "localBearingMember" && e.eligible && e.function === "source"));
      selected.annotation = { kind: "explicitBearing", raw: "", ...(handle ? { handle } : {}), operatorClause: { ...clause, sources: sourceNames.map(id => ({ id: id! })) } };
      const moved = sources.map(s => clones.get(s)!);
      selected.children = selected.children.filter(c => !moved.includes(c));

      // Lift past enclosing Bearing contexts as necessary. Putting a neutral
      // source beside a nested assessment inside a joint would enlarge that joint.
      const lastPoint = occurrence.ancestors.map(a => Boolean(a.annotation && ["role", "material", "use"].includes(a.annotation.kind))).lastIndexOf(true);
      const anchor = occurrence.ancestors.slice(lastPoint + 1).find(a => a.annotation && ["localBearing", "explicitBearing", "bearingUse"].includes(a.annotation.kind)) ?? block;
      const anchorClone = clones.get(anchor)!;
      const destination = findSiblings(expected[unitIndex].blocks, anchorClone)!;
      destination.splice(destination.indexOf(anchorClone), 0, ...moved);
      const destinationLine = lines[anchor.sourceSpan.startLine - 1];
      const indent = bulletIndent(destinationLine.text);
      let movedSource = "";
      for (const member of sources) {
        const start = lines[member.sourceSpan.startLine - 1].offset;
        const end = lines[subtreeEndLine(member) - 1].next;
        const removed = source.slice(start, end);
        const oldIndent = bulletIndent(lines[member.sourceSpan.startLine - 1].text);
        const movedLines = physicalLines(removed, before.mode);
        movedSource += movedLines.filter(l => l.offset < removed.length).map(l =>
          (l.text.startsWith(oldIndent) ? indent + l.text.slice(oldIndent.length) : l.text) + l.ending).join("");
        if (end === source.length && !lines[subtreeEndLine(member) - 1].ending) movedSource += preferredEnding(lines, block);
        edits.push({ offset: start, remove: removed, insert: "" });
      }
      edits.push({ offset: destinationLine.offset, remove: "", insert: movedSource });
      header = `${family} ${sourceNames.map(id => "@" + id).join(", ")} ${symbol} @${targetName}${handleText}`;
      consequence = "Neutral source occurrences and their complete subtrees move before the constructor, outside any enclosing Bearing context. Their reading positions change; their Point identities, ordered sources, relations and note ownership are preserved.";
    } else if ((annotation.kind === "role" || annotation.kind === "use") && annotation.role) {
      selected.annotation = { ...annotation, selector: undefined, operatorClause: { ...clause, sources: "self" } } as Annotation;
      header = `${pointHead(annotation)} ${symbol} @${targetName}${handleText}`;
      consequence = "The Point occurrence, its local role, prose, children and object-note ownership are preserved.";
    } else return unavailable("no-bearing", "This occurrence has no supported local attachment.");
    consequence += ` The target is now fixed as @${targetName}; later moves or role changes no longer choose another relation or target.`;
  } else {
    const mark = localMark(bearing);
    if (!mark) return unavailable("unsupported-local-form", "This relation has no local spelling: answers and Point-targeted concerns require explicit endpoints; respondsTo and clarifies require Point targets.");
    if (annotation.kind === "explicitBearing") {
      selected.annotation = { kind: "localBearing", raw: "", ...mark, ...(handle ? { handle } : {}) };
      const indent = bulletIndent(lines[block.sourceSpan.startLine - 1].text);
      const childIndent = block.children.length ? bulletIndent(lines[block.children[0].sourceSpan.startLine - 1].text)
        : indent + (allBlocks(before.documents[unitIndex].blocks).some(b => b.raw.startsWith("\t")) ? "\t" : "  ");
      const eol = preferredEnding(lines, block);
      const insertAt = lines[block.sourceSpan.endLine - 1].next;
      const uses = sourceNames.map(id => `${childIndent}- [. use @${id}]`).join(eol) + eol;
      edits.push({ offset: insertAt, remove: "", insert: (lines[block.sourceSpan.endLine - 1].ending ? "" : eol) + uses });
      selected.children.unshift(...sourceNames.map(id => ({
        kind: "block" as const, text: "", raw: "", sourceSpan: block.sourceSpan,
        annotation: { kind: "use" as const, raw: "", ref: { id: id! } }, children: []
      })));
      header = `${family} ${mark.role}${mark.selector ? "/" : ""}${handleText}`;
      consequence = "Ordered neutral source uses are introduced; the original declarations remain in place. This is a structural preview, not restoration of a previous outline.";
    } else if (annotation.kind === "role" || annotation.kind === "use") {
      if (annotation.role !== mark.role) return unavailable("unsupported-local-form", "The local spelling would change the authored Point role. Choose that presentation deliberately; no edit is offered.");
      selected.annotation = { ...annotation, operatorClause: undefined, ...mark } as Annotation;
      header = pointHead(annotation) + handleText;
      if (mark.selector) header = header.replace(new RegExp("^" + mark.role), mark.role + "/");
      consequence = "The Point's role, prose, children and object-note ownership are preserved.";
    } else return unavailable("unsupported-local-form", "This occurrence has no supported local spelling.");
    consequence += " The relation and target now follow the local mark and nearest semantic context; later moves or role changes can change them.";
  }
  edits.push({ offset: headerOffset, remove: oldHeader, insert: "[" + header + "]" });
  // Insertions precede replacements at the same position, so offsets always
  // address the original input and consumers can apply the array in reverse.
  edits.sort((a, b) => a.offset - b.offset || a.remove.length - b.remove.length);
  let proposedSource = source, boundary = source.length;
  for (const edit of [...edits].reverse()) {
    if (edit.offset + edit.remove.length > boundary || source.slice(edit.offset, edit.offset + edit.remove.length) !== edit.remove) return unavailable("preservation-failed", "The required source edits overlap or cannot be located exactly.");
    proposedSource = proposedSource.slice(0, edit.offset) + edit.insert + proposedSource.slice(edit.offset + edit.remove.length);
    boundary = edit.offset;
  }
  const after = explainSource(proposedSource, before.mode);
  if (!preserves(before, after, expected, clones, unitIndex, bearing.key, block)) return unavailable("preservation-failed", "Recompilation did not preserve the complete content, identities, ordered endpoints, note ownership and unrelated diagnostics. The nearest local target may differ; no edit is offered.");
  return { ...base, status: "ready", originalSource: source, proposedSource, edits, proposedDiagnostics: after.diagnostics, consequence };
}

function pointHead(annotation: Extract<Annotation, { kind: "role" | "use" }>): string {
  return annotation.kind === "use" ? `${annotation.role} use @${annotation.ref!.id}`
    : annotation.role + (annotation.anchor ? " @" + annotation.anchor : "");
}

function explicitClause(bearing: Bearing, targetName: string): OperatorClause {
  const base = { sources: "self" as const, target: { id: targetName } };
  if (bearing.kind === "supports" || bearing.kind === "concerns") return { ...base, op: bearing.kind, targetKind: "either" };
  if (bearing.kind === "challenges") return { ...base, op: bearing.kind, targetKind: bearing.target.kind === "bearing" ? "bearing" : "either" };
  return { ...base, op: bearing.kind, targetKind: "point" };
}

function localMark(bearing: Bearing): { role: "G" | "O" | "R" | "D"; selector?: never } | { role: "G" | "O" | "Q"; selector: "attachment" } | undefined {
  if (bearing.target.kind === "bearing") {
    const role = bearing.kind === "supports" ? "G" : bearing.kind === "challenges" ? "O" : bearing.kind === "concerns" ? "Q" : undefined;
    return role ? { role, selector: "attachment" } : undefined;
  }
  const role = bearing.kind === "supports" ? "G" : bearing.kind === "challenges" ? "O" : bearing.kind === "respondsTo" ? "R" : bearing.kind === "clarifies" ? "D" : undefined;
  return role ? { role } : undefined;
}

function findOccurrence(blocks: AstBlock[], line: number, ancestors: AstBlock[] = []): Occurrence | undefined {
  for (const block of blocks) {
    if (block.sourceSpan.startLine <= line && line <= block.sourceSpan.endLine) return { block, ancestors };
    if (block.annotation?.kind !== "note") {
      const found = findOccurrence(block.children, line, [...ancestors, block]);
      if (found) return found;
    }
  }
  return undefined;
}

function findSiblings(blocks: AstBlock[], target: AstBlock): AstBlock[] | undefined {
  if (blocks.includes(target)) return blocks;
  for (const block of blocks) {
    const found = findSiblings(block.children, target);
    if (found) return found;
  }
  return undefined;
}

function pairBlocks(left: AstBlock[], right: AstBlock[], pairs: Map<AstBlock, AstBlock>): void {
  left.forEach((block, i) => { pairs.set(block, right[i]); pairBlocks(block.children, right[i].children, pairs); });
}
function allBlocks(blocks: AstBlock[]): AstBlock[] {
  return blocks.flatMap(block => [block, ...allBlocks(block.children)]);
}
function subtreeEndLine(block: AstBlock): number {
  return Math.max(...allBlocks([block]).map(b => b.sourceSpan.endLine));
}
function bulletIndent(line: string): string {
  return /^[ \t]*/.exec(line)![0];
}
function preferredEnding(lines: PhysicalLine[], block: AstBlock): string {
  return lines[block.sourceSpan.startLine - 1].ending || lines.find(l => l.ending)?.ending || "\n";
}
function physicalLines(source: string, mode: SourceParseMode): PhysicalLine[] {
  const lines: PhysicalLine[] = [];
  let offset = 0;
  for (const ending of source.matchAll(mode === "host" ? /\r\n|\r|\n/g : /\r?\n/g)) {
    lines.push({ offset, next: ending.index + ending[0].length, text: source.slice(offset, ending.index), ending: ending[0] });
    offset = ending.index + ending[0].length;
  }
  lines.push({ offset, next: source.length, text: source.slice(offset), ending: "" });
  return lines;
}

function preserves(
  before: ExplainedSource, after: ExplainedSource, expected: ExplainedSource["documents"],
  clones: Map<AstBlock, AstBlock>, selectedUnit: number, selectedBearing: string, selected: AstBlock
): boolean {
  if (after.diagnostics.some(d => d.severity === "error") || before.documents.length !== after.documents.length
      || !same(expected.map(d => d.blocks), after.documents.map(d => d.blocks), ["raw", "sourceSpan"])) return false;
  const actual = new Map<AstBlock, AstBlock>();
  expected.forEach((d, i) => pairBlocks(d.blocks, after.documents[i].blocks, actual));
  const spanMap = new Map<string, SourceSpan>();
  for (const [original, clone] of clones) spanMap.set(spanKey(original.sourceSpan), actual.get(clone)!.sourceSpan);
  const mappedSpan = (span: SourceSpan | undefined) => span ? spanMap.get(spanKey(span)) : undefined;
  const selectedAnnotation = clones.get(selected)!.annotation;
  const selectedDerivation = selectedAnnotation && "operatorClause" in selectedAnnotation && selectedAnnotation.operatorClause ? "operator" : "structural";
  for (let i = 0; i < before.graphs.length; i++) {
    const left = before.graphs[i], right = after.graphs[i];
    if (left.points.length !== right.points.length || left.bearings.length !== right.bearings.length) return false;
    const keyMap = new Map<string, string>();
    for (const entities of [[left.points, right.points], [left.bearings, right.bearings]] as const) {
      for (const entity of entities[0]) {
        const counterpart = entities[1].find(e => same(e.sourceSpan, mappedSpan(entity.sourceSpan)));
        if (!counterpart) return false;
        keyMap.set(entity.key, counterpart.key);
      }
    }
    const ref = (r: BearingTarget) => ({ ...r, key: keyMap.get(r.key) });
    const sorted = (values: { key: string }[]) => [...values].sort((a, b) => a.key.localeCompare(b.key));
    if (!same(sorted(left.points.map(p => ({ ...p, key: keyMap.get(p.key)! }))), sorted(right.points), ["sourceSpan"])) return false;
    const bearings = left.bearings.map(b => ({
      ...b, key: keyMap.get(b.key)!, sources: b.sources.map(ref), target: ref(b.target),
      derivedBy: i === selectedUnit && b.key === selectedBearing ? selectedDerivation : b.derivedBy
    }));
    if (!same(sorted(bearings), sorted(right.bearings), ["sourceSpan"])) return false;
    const notes = left.notes.map(n => ({ ...n, sourceSpan: mappedSpan(n.sourceSpan), target: ref(n.target) }));
    const sortNotes = (ns: unknown[]) => [...ns].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (!same(sortNotes(notes), sortNotes(right.notes))) return false;
  }
  // Diagnostic prose may embed changed coordinates. Match severity, code and
  // owning occurrence; only the selected relation's through-body advice may change.
  const signature = (ds: Diagnostic[], old: boolean) => ds.filter(d =>
    !(d.code === "IMPLICIT_ATTACHMENT_THROUGH_BODY" &&
      same(d.sourceSpan, old ? selected.sourceSpan : mappedSpan(selected.sourceSpan))))
    .map(d => ({ severity: d.severity, code: d.code, sourceSpan: old ? mappedSpan(d.sourceSpan) : d.sourceSpan }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return same(signature(before.diagnostics, true), signature(after.diagnostics, false));
}
function spanKey(span: SourceSpan): string {
  return `${span.startLine}:${span.startColumn}:${span.endLine}:${span.endColumn}`;
}
function same(left: unknown, right: unknown, omit: string[] = []): boolean {
  const normalize = (_key: string, value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([key, v]) => !omit.includes(key) && v !== undefined).sort(([a], [b]) => a.localeCompare(b))) : value;
  return JSON.stringify(left, normalize) === JSON.stringify(right, normalize);
}
