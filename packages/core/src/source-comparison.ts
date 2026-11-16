import { compareCommitments } from "./commitments.js";
import type { CommitmentComparison, Correspondence } from "./commitments.js";
import { same } from "./source-edit.js";
import { FORMAT_VERSION } from "./types.js";
import type {
  Annotation, AstBlock, ExplainedSource, ExplainEntry, ExplainFraming,
  ExplainRecognition, GraphIR, SourceSpan
} from "./types.js";

type AnnotationShape<T = Annotation> = T extends Annotation ? Omit<T, "raw"> : never;
type LiteralBlock = { text: string; children: LiteralBlock[] };
type Emission = Extract<ExplainEntry["effects"][number], { kind: "emitBearing" }>;

/** Revision-local source evidence, without generated entity keys or identity claims. */
type BlockSnapshot = {
  sourceSpan: SourceSpan;
  recognition: ExplainRecognition;
  framing?: ExplainFraming;
  text: string;
  /** Only Notes own literal children; other children are separate occurrences. */
  literalChildren?: LiteralBlock[];
  /** Parsed authoring shape: annotation spacing is not an intention change. */
  annotation?: AnnotationShape;
  relations: {
    reason: Emission["reason"];
    kind: Emission["bearing"]["kind"];
    profile?: Emission["bearing"]["profile"];
    targetBy: Emission["bearing"]["targetBy"];
  }[];
};

export type PresentationChange =
  | { kind: "added"; after: BlockSnapshot }
  | { kind: "removed"; before: BlockSnapshot }
  | {
      kind: "changed";
      before: BlockSnapshot;
      after: BlockSnapshot;
      /** Recognition of the local mark, excluding a use's reference operand. */
      mark: boolean;
      fit: boolean;
      /** Includes what an unbound intention awaits. */
      intention: boolean;
      /** Prose, including a Note's entire literal subtree. */
      content: boolean;
      annotation: boolean;
      provenance: boolean;
    };

type Indeterminate = Extract<CommitmentComparison, { status: "indeterminate" }>;

export type SourceComparison =
  | (Extract<CommitmentComparison, { status: "compared" }> & { presentationChanges: PresentationChange[] })
  | (Omit<Indeterminate, "reason"> & { reason: Indeterminate["reason"] | "invalid-source-correspondence" });

/**
 * Compare one unit's commitments and retained source evidence. `lines` asserts
 * earlier block-start line -> later block-start line, in complete-input
 * coordinates, injectively. It may include body and Note roots, never literal
 * Note descendants or continuation lines. Unmapped occurrences are removed or
 * added; neither text, authored names nor generated keys establish continuity.
 *
 * Equivalent commitments do not certify unchanged source, prose fidelity or
 * assessment validity. Presentation changes describe only the retained fields
 * below; source coordinates and annotation whitespace alone do not count.
 */
export function compareSourceRevisions(
  before: ExplainedSource,
  after: ExplainedSource,
  options: { unitIndex: number; correspondence: Correspondence; lines: Record<number, number> }
): SourceComparison {
  const invalid = (message: string): SourceComparison => ({ status: "indeterminate", reason: "invalid-source-correspondence", message });
  const unsupported = (): SourceComparison => ({
    status: "indeterminate", reason: "unsupported-version",
    message: `Compare explained sources of format ${FORMAT_VERSION}; reparse older sources rather than relabelling them.`
  });
  if (before.version !== FORMAT_VERSION || after.version !== FORMAT_VERSION) return unsupported();
  if (before.mode !== after.mode || (before.mode !== "document" && before.mode !== "host")) {
    return invalid("Compare sources parsed in the same document or host mode.");
  }
  const index = options.unitIndex;
  if (!Number.isSafeInteger(index) || index < 0) return invalid("The selected unit index must be a nonnegative safe integer.");
  for (const source of [before, after]) {
    if (!source.units[index] || !source.documents[index] || !source.graphs[index] || !source.explanations[index]) {
      return invalid("The selected source unit, document, graph and explanation must exist in both revisions.");
    }
    if (source.documents[index].version !== FORMAT_VERSION || source.explanations[index].version !== FORMAT_VERSION) return unsupported();
    if (source.units[index].kind !== (source.mode === "document" ? "document" : "fence")) {
      return invalid("The selected source unit must belong to its declared parse mode.");
    }
  }
  const commitments = compareCommitments(before.graphs[index], after.graphs[index], options.correspondence);
  if (commitments.status === "indeterminate") return commitments;
  if ([before, after].some(source => [...source.documents[index].diagnostics, ...source.explanations[index].diagnostics].some(d => d.severity === "error"))) {
    return { status: "indeterminate", reason: "source-errors", message: "Compare only source units parsed and explained without errors." };
  }

  const earlier = activeSnapshots(before, index), later = activeSnapshots(after, index);
  if (!earlier || !later) return invalid("Each active AST block must have exactly one matching Explain entry at its block-start line.");
  const pairs = new Map<number, number>(), taken = new Set<number>();
  for (const [key, to] of Object.entries(options.lines)) {
    const from = Number(key);
    if (!Number.isSafeInteger(from) || String(from) !== key || !Number.isSafeInteger(to) || !earlier.has(from) || !later.has(to)) {
      return invalid("Source correspondence must pair actual active block-start lines in the selected units.");
    }
    if (taken.has(to)) return invalid("Two earlier occurrences cannot continue as one later occurrence.");
    pairs.set(from, to);
    taken.add(to);
  }

  const presentationChanges: PresentationChange[] = [];
  for (const [line, previous] of earlier) {
    const to = pairs.get(line);
    if (to === undefined) {
      presentationChanges.push({ kind: "removed", before: previous });
      continue;
    }
    const next = later.get(to)!;
    const flags = {
      mark: !same(previous.recognition, next.recognition, ["ref"]),
      fit: previous.framing?.fit !== next.framing?.fit,
      intention: !same(intention(previous.framing), intention(next.framing)),
      content: previous.text !== next.text || !same(previous.literalChildren, next.literalChildren),
      annotation: !same(previous.annotation, next.annotation),
      provenance: !same(previous.relations, next.relations)
    };
    if (Object.values(flags).some(Boolean)) presentationChanges.push({ kind: "changed", before: previous, after: next, ...flags });
  }
  for (const [line, next] of later) {
    if (!taken.has(line)) presentationChanges.push({ kind: "added", after: next });
  }
  return { ...commitments, presentationChanges };
}

/** @internal Compare an edit whose occurrence continuity is known by line. */
export function compareSourceEdit(
  before: ExplainedSource, after: ExplainedSource, unitIndex: number,
  lineMap: (line: number) => number | undefined = line => line, replaced: string[] = []
) {
  const correspondence = correspondenceByLine(before.graphs[unitIndex], after.graphs[unitIndex], lineMap, replaced);
  const lines = Object.fromEntries(before.explanations[unitIndex].entries.flatMap(entry => {
    const line = entry.sourceSpan.startLine, next = lineMap(line);
    return next === undefined ? [] : [[line, next]];
  }));
  return { correspondence, comparison: compareSourceRevisions(before, after, { unitIndex, correspondence, lines }) };
}

function correspondenceByLine(
  before: GraphIR, after: GraphIR, lineMap: (line: number) => number | undefined, replaced: string[]
): Correspondence {
  const pair = (earlier: GraphIR["points"] | GraphIR["bearings"], later: typeof earlier, excluded: string[] = []) => {
    const at = new Map(later.flatMap(item => item.sourceSpan ? [[item.sourceSpan.startLine, item.key] as const] : []));
    return Object.fromEntries(earlier.flatMap(item => {
      if (excluded.includes(item.key)) return [];
      const line = item.sourceSpan && lineMap(item.sourceSpan.startLine);
      const key = line === undefined ? undefined : at.get(line);
      return key === undefined ? [] : [[item.key, key]];
    }));
  };
  return { points: pair(before.points, after.points), bearings: pair(before.bearings, after.bearings, replaced) };
}

function intention(framing: ExplainFraming | undefined) {
  if (!framing) return undefined;
  return framing.intention === "unbound" ? { intention: framing.intention, awaits: framing.awaits } : { intention: framing.intention };
}

/** Match AST to Explain only within a revision; never match across revisions. */
function activeSnapshots(source: ExplainedSource, index: number): Map<number, BlockSnapshot> | undefined {
  const blocks = new Map<number, AstBlock>();
  let valid = true;
  const visit = (block: AstBlock): void => {
    const line = block.sourceSpan.startLine;
    if (!Number.isSafeInteger(line) || line < 1 || blocks.has(line)) valid = false;
    blocks.set(line, block);
    if (block.annotation?.kind !== "note") block.children.forEach(visit);
  };
  source.documents[index].blocks.forEach(visit);
  const snapshots = new Map<number, BlockSnapshot>();
  for (const entry of source.explanations[index].entries) {
    const line = entry.sourceSpan.startLine, block = blocks.get(line);
    if (!block || snapshots.has(line) || !same(block.sourceSpan, entry.sourceSpan)) return undefined;
    snapshots.set(line, snapshot(block, entry));
  }
  return valid && snapshots.size === blocks.size ? snapshots : undefined;
}

function snapshot(block: AstBlock, entry: ExplainEntry): BlockSnapshot {
  const frame = entry.effects.find(effect => effect.kind === "frameOccurrence");
  const framing: ExplainFraming | undefined = frame && {
    ...(frame.fit ? { fit: frame.fit } : {}),
    ...intention(frame)!
  };
  const annotation = block.annotation && (({ raw: _raw, ...shape }) => shape)(block.annotation);
  return {
    sourceSpan: { ...block.sourceSpan },
    recognition: structuredClone(entry.recognition),
    ...(framing ? { framing } : {}),
    text: block.text,
    ...(block.annotation?.kind === "note" ? { literalChildren: block.children.map(literalSnapshot) } : {}),
    ...(annotation ? { annotation: structuredClone(annotation) } : {}),
    relations: entry.effects.flatMap(effect => effect.kind === "emitBearing" ? [{
      reason: effect.reason, kind: effect.bearing.kind, targetBy: effect.bearing.targetBy,
      ...(effect.bearing.profile ? { profile: effect.bearing.profile } : {})
    }] : [])
  };
}

function literalSnapshot(block: AstBlock): LiteralBlock {
  return { text: block.text, children: block.children.map(literalSnapshot) };
}
