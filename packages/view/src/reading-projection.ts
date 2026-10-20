import { FORMAT_VERSION } from "@cogitatum/core";
import type {
  AstBlock, Bearing, BearingRef, BearingTarget, Diagnostic, ExplainedSource,
  ExplainEntry, ExplainRecognition, GraphIR, PointRef, SourceParseMode, SourceSpan
} from "@cogitatum/core";
import { referenceKey } from "./projection.js";

export type ReadingReference =
  | { kind: "declares"; ref: PointRef; name?: string }
  | { kind: "uses"; ref: BearingTarget; name: string }
  | { kind: "constructs"; ref: BearingRef; name?: string };

export type ReadingOccurrence = {
  kind: "occurrence";
  /** Opaque address within this projection, never an identity across revisions. */
  id: string;
  unitIndex: number;
  line: number;
  depth: number;
  sourceSpan: SourceSpan;
  raw: string;
  text: string;
  recognition: ExplainRecognition | { kind: "literal" };
  references: ReadingReference[];
  diagnostics: Diagnostic[];
};

export type ReadingSourceLine = {
  kind: "source";
  line: number;
  raw: string;
  /** Absent for host prose and fences outside the selected source units. */
  unitIndex?: number;
  diagnostics: Diagnostic[];
};

export type ReadingEndpoint = {
  occurrenceId: string;
  ref: BearingTarget;
  /** Evidence for a display location; does not create another graph identity. */
  basis: "self" | "linked-member" | "context" | "declaration";
};

export type ReadingBearing = {
  bearing: Bearing;
  occurrenceId: string;
  sources: ReadingEndpoint[];
  target: ReadingEndpoint;
};

export type ReadingUnit = {
  graph: GraphIR;
  occurrences: ReadingOccurrence[];
  bearings: ReadingBearing[];
};

export type ReadingProjection = {
  version: string;
  mode: SourceParseMode;
  source: string;
  rows: (ReadingOccurrence | ReadingSourceLine)[];
  units: ReadingUnit[];
  diagnostics: Diagnostic[];
};

const spanKey = (span: SourceSpan) =>
  `${span.startLine}:${span.startColumn}:${span.endLine}:${span.endColumn}`;
const sameRef = (a: BearingTarget, b: BearingTarget) => referenceKey(a) === referenceKey(b);
const mismatch = (detail: string): never => { throw new Error(`Reading requires matching source and compiler output: ${detail}.`); };

/**
 * Project one original input and its explainSource result, from the same revision.
 * Core owns selection and resolution. This function indexes its evidence for a reader;
 * it never reconstructs a target from indentation, nearby names or rejected summaries.
 */
export function projectReading(source: string, explained: ExplainedSource): ReadingProjection {
  if (explained.version !== FORMAT_VERSION) mismatch("unsupported format");
  const count = explained.units.length;
  if ([explained.documents, explained.graphs, explained.explanations].some(items => items.length !== count)) {
    mismatch("unaligned source units");
  }
  const lines = explained.mode === "host" ? source.split(/\r\n|\r|\n/) : source.replace(/\r\n/g, "\n").split("\n");
  const diagnosticsAt = new Map<number, Diagnostic[]>();
  for (const diagnostic of explained.diagnostics) {
    const line = diagnostic.sourceSpan?.startLine;
    if (line !== undefined) diagnosticsAt.set(line, [...diagnosticsAt.get(line) ?? [], diagnostic]);
  }
  const occurrencesByLine = new Map<number, ReadingOccurrence>();
  const unitByLine = new Map<number, number>();
  const units = explained.units.map((unit, unitIndex): ReadingUnit => {
    const document = explained.documents[unitIndex], graph = explained.graphs[unitIndex];
    const explanation = explained.explanations[unitIndex];
    if ([document, graph, explanation].some(value => value.version !== explained.version)) mismatch("mixed format versions");
    if (unit.kind === "document" && unit.source !== source) mismatch("document source changed");
    if (unit.kind === "fence") {
      // Core strips at most the opening fence's three-space indentation. Checking
      // the selected text catches stale units without selecting Markdown again.
      const original = lines.slice(unit.startLine - 1, unit.endLine);
      const selected = unit.endLine < unit.startLine ? [] : unit.source.split("\n");
      if (original.length !== selected.length || selected.some((text, i) => {
        const removed = original[i].length - text.length;
        return removed < 0 || removed > 3 || original[i] !== " ".repeat(removed) + text;
      })) mismatch("selected source changed");
    }
    for (let line = unit.startLine; line <= unit.endLine; line++) {
      if (unitByLine.has(line)) mismatch("overlapping source units");
      unitByLine.set(line, unitIndex);
    }
    const entries = new Map(explanation.entries.map(entry => [spanKey(entry.sourceSpan), entry]));
    if (entries.size !== explanation.entries.length) mismatch("duplicate Explain locations");
    const entryByOccurrence = new Map<string, ExplainEntry>();
    const occurrences: ReadingOccurrence[] = [];
    const graphRefs = new Set([
      ...graph.points.map(point => referenceKey({ kind: "point", key: point.key })),
      ...graph.bearings.map(bearing => referenceKey({ kind: "bearing", key: bearing.key }))
    ]);
    if (graphRefs.size !== graph.points.length + graph.bearings.length) mismatch("duplicate graph identities");
    const origins = new Map<string, ReadingOccurrence>();
    const bySpan = new Map<string, ReadingOccurrence>();
    function visit(block: AstBlock, depth: number, literal: boolean): void {
      const span = block.sourceSpan, key = spanKey(span);
      const entry = entries.get(key);
      if (literal ? !!entry : !entry) mismatch("AST / Explain occurrence correspondence");
      const line = lines[span.startLine - 1];
      const content = /^[ \t]*-\s+(.*)$/.exec(block.raw)?.[1];
      if (span.startLine !== span.endLine || content === undefined ||
        line?.slice(span.startColumn - 1, span.endColumn - 1) !== content) mismatch("occurrence span or source changed");
      if (occurrencesByLine.has(span.startLine)) mismatch("duplicate occurrence line");
      const occurrence: ReadingOccurrence = {
        kind: "occurrence", id: `u${unitIndex}:${key}`, unitIndex, line: span.startLine,
        depth, sourceSpan: span, raw: line, text: block.text,
        recognition: literal ? { kind: "literal" } : entry!.recognition,
        references: [], diagnostics: diagnosticsAt.get(span.startLine) ?? []
      };
      for (const effect of entry?.effects ?? []) {
        let reference: ReadingReference | undefined;
        if (effect.kind === "emitPoint") reference = { kind: "declares", ref: effect.ref, name: effect.id };
        if (effect.kind === "focusPoint" || effect.kind === "focusBearing") {
          reference = { kind: "uses", ref: effect.ref, name: effect.operand.id };
        }
        if (effect.kind === "emitBearing") {
          if (graph.bearings[effect.ref.graphIndex]?.key !== effect.ref.key) mismatch("Bearing index");
          reference = { kind: "constructs", ref: { kind: "bearing", key: effect.ref.key }, name: effect.ref.handle };
        }
        if (reference) {
          const identity = referenceKey(reference.ref);
          if (!graphRefs.has(identity)) mismatch("emitted or focused entity missing from graph");
          occurrence.references.push(reference);
          if (reference.kind !== "uses") {
            if (origins.has(identity)) mismatch("multiple entity origins");
            origins.set(identity, occurrence);
          }
        }
      }
      occurrences.push(occurrence);
      occurrencesByLine.set(occurrence.line, occurrence);
      bySpan.set(key, occurrence);
      if (entry) { entryByOccurrence.set(occurrence.id, entry); entries.delete(key); }
      for (const child of block.children) visit(child, depth + 1, literal || block.annotation?.kind === "note");
    }
    document.blocks.forEach(block => visit(block, 0, false));
    if (entries.size || origins.size !== graphRefs.size) mismatch("incomplete occurrence evidence");
    const refers = (occurrence: ReadingOccurrence, ref: BearingTarget) =>
      occurrence.references.some(reference => sameRef(reference.ref, ref));
    const origin = (ref: BearingTarget) => origins.get(referenceKey(ref)) ?? mismatch("missing entity origin");
    const endpoint = (occurrence: ReadingOccurrence, ref: BearingTarget, basis: ReadingEndpoint["basis"]): ReadingEndpoint => {
      if (!refers(occurrence, ref)) mismatch("endpoint occurrence refers to another entity");
      return { occurrenceId: occurrence.id, ref, basis };
    };
    const members = new Map<string, Map<string, ReadingOccurrence>>();
    for (const occurrence of occurrences) {
      const membership = entryByOccurrence.get(occurrence.id)?.effects.find(effect => effect.kind === "linkedMember");
      if (!membership?.eligible || membership.function !== "source") continue;
      const group = spanKey(membership.linkedSpan);
      const points = members.get(group) ?? new Map<string, ReadingOccurrence>();
      for (const reference of occurrence.references) if (reference.ref.kind === "point") {
        // Duplicate sources invalidate the entire joint Bearing in Core.
        points.set(referenceKey(reference.ref), occurrence);
      }
      members.set(group, points);
    }
    const bearings = graph.bearings.map((bearing): ReadingBearing => {
      const occurrence = origin({ kind: "bearing", key: bearing.key });
      const entry = entryByOccurrence.get(occurrence.id)!;
      const emitted = entry.effects.find(effect => effect.kind === "emitBearing")!;
      const sources = bearing.sources.map(ref => {
        if (refers(occurrence, ref)) return endpoint(occurrence, ref, "self");
        if (emitted.reason === "linked-containment") {
          const member = members.get(spanKey(occurrence.sourceSpan))?.get(referenceKey(ref));
          if (!member) mismatch("missing Linked source occurrence");
          return endpoint(member!, ref, "linked-member");
        }
        return endpoint(origin(ref), ref, "declaration");
      });
      const contexts = entry.effects.filter(effect => effect.kind === "implicitAttachment");
      if (contexts.length !== (bearing.derivedBy === "structural" ? 1 : 0)) mismatch("missing or unexpected attachment context");
      let target: ReadingEndpoint;
      if (contexts.length) {
        const context = contexts[0];
        const selected = bySpan.get(spanKey(context.contextSpan));
        if (!sameRef(context.target, bearing.target) || !selected) mismatch("invalid attachment context");
        target = endpoint(selected!, bearing.target, "context");
      } else target = endpoint(origin(bearing.target), bearing.target, "declaration");
      return { bearing, occurrenceId: occurrence.id, sources, target };
    });
    return { graph, occurrences, bearings };
  });
  const rows = lines.map((raw, index): ReadingOccurrence | ReadingSourceLine => occurrencesByLine.get(index + 1) ?? {
    kind: "source", line: index + 1, raw, unitIndex: unitByLine.get(index + 1), diagnostics: diagnosticsAt.get(index + 1) ?? []
  });
  return { version: explained.version, mode: explained.mode, source, rows, units, diagnostics: explained.diagnostics };
}
