import type {
  AstBlock,
  Bearing,
  BearingDerivedBy,
  BearingKind,
  BearingTarget,
  Diagnostic,
  DocumentAst,
  ExplainBearingSummary,
  ExplainEmittedBearingSummary,
  ExplainEffect,
  ExplainEntry,
  ExplainRecognition,
  GraphCompilation,
  GraphIR,
  OperatorClause,
  Point,
  PointRef,
  Ref,
  SourceSpan
} from "./types.js";
import { FORMAT_VERSION } from "./types.js";

type Context = {
  parent?: AstBlock;
  edgeAncestor?: AstBlock;
};

type CandidateBearing = {
  key: string;
  handle?: string;
  kind: BearingKind;
  sources: (PointRef | Ref)[];
  target: BearingTarget | Ref;
  text?: string;
  derivedBy: BearingDerivedBy;
  sourceSpan?: SourceSpan;
};

type SymbolKind = "point" | "bearing" | "invalid" | "unknown";

type SymbolTable = {
  pointIds: Set<string>;
  duplicatePointIds: Set<string>;
  bearingIds: Set<string>;
  conflictingIds: Set<string>;
  duplicateBearingIds: Set<string>;
  allIds: Map<string, AstBlock>;
  pointsByKey: Map<string, Point>;
  keysById: Map<string, string>;
};

type PointDraft = {
  key: string;
  id?: string;
  reason: "role-annotation" | "gap-annotation" | "anchor-annotation";
};

type BearingDraft =
  | {
      outcome: "candidate";
      candidate: CandidateBearing;
      reason: "operator-clause" | "annotated-containment";
    }
  | {
      outcome: "rejected";
      reason: "annotation-syntax-error" | "edge-descendant-requires-explicit-target";
    }
  | {
      outcome: "skipped";
      reason: "no-eligible-ancestor" | "no-structural-rule";
    };

type ExplainDraft = {
  block: AstBlock;
  recognition: ExplainRecognition;
  point?: PointDraft;
  bearing?: BearingDraft;
};

type BearingValidation = {
  bearings: Bearing[];
  accepted: CandidateBearing[];
};

export function compileGraph(ast: DocumentAst): GraphIR {
  return compileGraphWithExplain(ast).graph;
}

export function compileGraphWithExplain(ast: DocumentAst): GraphCompilation {
  if (ast.version !== FORMAT_VERSION) {
    throw new Error(`Unsupported AST format ${ast.version}; expected ${FORMAT_VERSION}.`);
  }
  const diagnostics = [...ast.diagnostics];
  const pointKeys = assignPointKeys(ast.blocks);
  const symbols = collectSymbols(ast.blocks, diagnostics);
  const compiledPoints: Point[] = [];
  const compiledBearings: CandidateBearing[] = [];
  const explainDrafts: ExplainDraft[] = [];

  for (const block of ast.blocks) {
    compileBlock(block, {}, pointKeys, compiledPoints, compiledBearings, explainDrafts, diagnostics);
  }

  const points = compiledPoints.filter((point) => !point.id || !symbols.duplicatePointIds.has(point.id));
  for (const point of points) {
    symbols.pointsByKey.set(point.key, point);
    if (point.id) {
      symbols.keysById.set(point.id, point.key);
    }
  }

  collectBearingSymbols(compiledBearings, symbols, diagnostics);
  const validation = validateBearings(compiledBearings, symbols, diagnostics);
  addStructuralDiagnostics(ast.blocks, validation.bearings, symbols, diagnostics);

  const graph = {
    version: FORMAT_VERSION,
    points,
    bearings: validation.bearings,
    diagnostics
  };

  return {
    graph,
    explain: {
      version: FORMAT_VERSION,
      entries: buildExplainEntries(explainDrafts, points, validation, diagnostics),
      diagnostics: [...diagnostics]
    }
  };
}

function compileBlock(
  block: AstBlock,
  context: Context,
  pointKeys: WeakMap<AstBlock, string>,
  points: Point[],
  bearings: CandidateBearing[],
  explainDrafts: ExplainDraft[],
  diagnostics: Diagnostic[]
): void {
  if (!block.annotation) {
    explainDrafts.push({ block, recognition: { kind: "body" } });
    for (const child of block.children) {
      compileBlock(child, context, pointKeys, points, bearings, explainDrafts, diagnostics);
    }
    return;
  }

  const annotation = block.annotation;
  const draft: ExplainDraft = {
    block,
    recognition: recognitionForBlock(block)
  };
  explainDrafts.push(draft);

  if (annotation.kind !== "edge") {
    const point = pointFromBlock(block, pointKeys);
    points.push(point);
    draft.point = { key: point.key, ...(point.id ? { id: point.id } : {}), reason: pointReasonForBlock(block) };
  }

  let producedBearing = false;
  const bearingSyntaxFailed = Boolean(annotation.syntaxErrors && annotation.syntaxErrors.length > 0);
  const implicitEdgeDescendant = Boolean(
    context.edgeAncestor && annotation.kind !== "edge" && !annotation.operatorClause && !bearingSyntaxFailed
  );
  if (implicitEdgeDescendant) {
    draft.bearing = {
      outcome: "rejected",
      reason: "edge-descendant-requires-explicit-target"
    };
    diagnostics.push({
      severity: "error",
      code: "EDGE_DESCENDANT_REQUIRES_EXPLICIT_TARGET",
      message:
        "The first Point beneath an edge, possibly through body, must use an explicit target; edge containment does not derive a Bearing.",
      sourceSpan: block.sourceSpan
    });
  } else if (bearingSyntaxFailed) {
    draft.bearing = { outcome: "rejected", reason: "annotation-syntax-error" };
    producedBearing = false;
  } else if (annotation.operatorClause) {
    const bearing = bearingFromOperator(block, annotation.operatorClause, pointKeys);
    if (bearing) {
      bearing.key = `_b${bearings.length + 1}`;
      bearings.push(bearing);
      draft.bearing = { outcome: "candidate", candidate: bearing, reason: "operator-clause" };
      producedBearing = true;
    } else {
      draft.bearing = { outcome: "rejected", reason: "annotation-syntax-error" };
    }
  } else {
    const bearing = deriveStructuralBearing(block, context.parent, pointKeys);
    if (bearing) {
      bearing.key = `_b${bearings.length + 1}`;
      bearings.push(bearing);
      draft.bearing = { outcome: "candidate", candidate: bearing, reason: "annotated-containment" };
      producedBearing = true;
    } else {
      draft.bearing = {
        outcome: "skipped",
        reason: context.parent ? "no-structural-rule" : "no-eligible-ancestor"
      };
    }
  }

  if (annotation.handle && !producedBearing && !bearingSyntaxFailed && !implicitEdgeDescendant) {
    diagnostics.push({
      severity: "error",
      code: "BEARING_HANDLE_WITHOUT_BEARING",
      message: `Bearing handle @${annotation.handle} appears on an annotation that produces no Bearing.`,
      sourceSpan: block.sourceSpan
    });
  }

  const childContext =
    annotation.kind === "edge"
      ? { parent: context.parent, edgeAncestor: block }
      : { parent: block };
  for (const child of block.children) {
    compileBlock(child, childContext, pointKeys, points, bearings, explainDrafts, diagnostics);
  }
}

function recognitionForBlock(block: AstBlock): ExplainRecognition {
  const annotation = block.annotation;
  if (!annotation) {
    return { kind: "body" };
  }
  if (annotation.kind === "role") {
    if (annotation.role === "C") {
      return annotation.status
        ? { kind: "role", role: "C", status: annotation.status }
        : { kind: "role", role: "C" };
    }
    return { kind: "role", role: annotation.role };
  }
  if (annotation.kind === "gap") {
    return { kind: "gap", status: "open" };
  }
  return { kind: annotation.kind === "anchor" ? "material" : "edge" };
}

function pointReasonForBlock(block: AstBlock): PointDraft["reason"] {
  if (block.annotation?.kind === "role") {
    return "role-annotation";
  }
  if (block.annotation?.kind === "gap") {
    return "gap-annotation";
  }
  return "anchor-annotation";
}

function bearingFromOperator(
  block: AstBlock,
  operator: OperatorClause,
  pointKeys: WeakMap<AstBlock, string>
): CandidateBearing | undefined {
  const sources =
    operator.sources === "self"
      ? [pointRef(pointKeyForBlock(block, pointKeys))]
      : operator.sources.map((source) => ({ id: source.id }));

  const target = operator.target;
  if (!target) {
    return undefined;
  }

  return {
    key: "",
    ...(block.annotation?.handle ? { handle: block.annotation?.handle } : {}),
    kind: operator.op,
    sources,
    target: { id: target.id },
    text: block.annotation?.kind === "edge" && block.text ? block.text : undefined,
    derivedBy: "operator",
    sourceSpan: block.sourceSpan
  };
}

function deriveStructuralBearing(
  block: AstBlock,
  parent: AstBlock | undefined,
  pointKeys: WeakMap<AstBlock, string>
): CandidateBearing | undefined {
  if (!parent) {
    return undefined;
  }

  const source = pointKeyForBlock(block, pointKeys);
  const target = pointKeyForBlock(parent, pointKeys);

  if (pointRole(block) === "C" && pointRole(parent) === "Q") {
    return structural(block, "answers", [source], target);
  }
  if (pointRole(block) === "G") {
    return structural(block, "supports", [source], target);
  }
  if (pointRole(block) === "O") {
    return structural(block, "challenges", [source], target);
  }
  if (pointRole(block) === "R" && pointRole(parent) === "O") {
    return structural(block, "repliesTo", [source], target);
  }
  if (pointRole(block) === "D") {
    return structural(block, "clarifies", [source], target);
  }
  if (block.annotation?.kind === "gap") {
    return structural(block, "about", [source], target);
  }
  return undefined;
}

function structural(
  block: AstBlock,
  kind: BearingKind,
  sourceIds: string[],
  targetId: string
): CandidateBearing {
  return {
    key: "",
    ...(block.annotation?.handle ? { handle: block.annotation?.handle } : {}),
    kind,
    sources: sourceIds.map(pointRef),
    target: pointRef(targetId),
    derivedBy: "structural",
    sourceSpan: block.sourceSpan
  };
}

function pointRef(key: string): PointRef {
  return { key, kind: "point" };
}

function collectSymbols(blocks: AstBlock[], diagnostics: Diagnostic[]): SymbolTable {
  const symbols: SymbolTable = {
    pointIds: new Set(),
    duplicatePointIds: new Set(),
    bearingIds: new Set(),
    conflictingIds: new Set(),
    duplicateBearingIds: new Set(),
    allIds: new Map(),
    pointsByKey: new Map(),
    keysById: new Map()
  };

  walkWithParent(blocks, undefined, (block) => {
    const anchor = pointAnchor(block);
    if (!anchor) {
      return;
    }
    if (symbols.allIds.has(anchor)) {
      symbols.duplicatePointIds.add(anchor);
      diagnostics.push({
        severity: "error",
        code: "DUPLICATE_ID",
        message: `Duplicate anchor @${anchor}.`,
        sourceSpan: block.sourceSpan
      });
    }
    symbols.allIds.set(anchor, block);
    symbols.pointIds.add(anchor);
  });

  for (const id of symbols.duplicatePointIds) {
    symbols.pointIds.delete(id);
  }

  return symbols;
}

function collectBearingSymbols(
  bearings: CandidateBearing[],
  symbols: SymbolTable,
  diagnostics: Diagnostic[]
): void {
  for (const bearing of bearings) {
    if (!bearing.handle) {
      continue;
    }
    if (symbols.bearingIds.has(bearing.handle)) {
      symbols.duplicateBearingIds.add(bearing.handle);
      diagnostics.push({
        severity: "error",
        code: "DUPLICATE_BEARING_HANDLE",
        message: `Duplicate Bearing handle @${bearing.handle}.`,
        sourceSpan: bearing.sourceSpan
      });
    }
    if (symbols.allIds.has(bearing.handle)) {
      symbols.conflictingIds.add(bearing.handle);
    }
    symbols.bearingIds.add(bearing.handle);
    symbols.keysById.set(bearing.handle, bearing.key);
  }
}

function validateBearings(
  bearings: CandidateBearing[],
  symbols: SymbolTable,
  diagnostics: Diagnostic[]
): BearingValidation {
  const validity = new Map<CandidateBearing, boolean>();

  for (const bearing of bearings) {
    let isValid = true;

    for (let index = 0; index < bearing.sources.length; index += 1) {
      const source = bearing.sources[index];
      const kind = classifyReference(source, symbols);
      if (kind === "unknown") {
        diagnostics.push({
          severity: "error",
          code: "UNKNOWN_SOURCE",
          message: `Source ${referenceLabel(source, symbols)} not found.`,
          sourceSpan: bearing.sourceSpan
        });
        isValid = false;
      } else if (kind === "invalid") {
        isValid = false;
      } else if (kind === "bearing") {
        diagnostics.push({
          severity: "error",
          code: "BEARING_IS_NOT_BEARING_SOURCE",
          message: `Bearing ${referenceLabel(source, symbols)} cannot be a Bearing source.`,
          sourceSpan: bearing.sourceSpan
        });
        isValid = false;
      } else {
        bearing.sources[index] = pointRef(resolveKey(source, symbols));
      }
    }

    const targetLabel = referenceLabel(bearing.target, symbols);
    const targetKind = classifyReference(bearing.target, symbols);
    if (targetKind === "point" || targetKind === "bearing") {
      bearing.target = { key: resolveKey(bearing.target, symbols), kind: targetKind };
      if (bearing.kind === "undercuts" && targetKind !== "bearing") {
        diagnostics.push({
          severity: "error",
          code: "UNDERCUT_REQUIRES_BEARING_TARGET",
          message: `Undercut target ${targetLabel} is a Point; use _> only for a named Bearing.`,
          sourceSpan: bearing.sourceSpan
        });
        isValid = false;
      }
      if (bearing.kind === "challenges" && targetKind !== "point") {
        diagnostics.push({
          severity: "error",
          code: "CHALLENGE_REQUIRES_POINT_TARGET",
          message: `Challenge target ${targetLabel} is a Bearing; use -> for a Point or _> to undercut the route.`,
          sourceSpan: bearing.sourceSpan
        });
        isValid = false;
      } else if (requiresPointTarget(bearing.kind) && targetKind !== "point") {
        diagnostics.push({
          severity: "error",
          code: "BEARING_KIND_REQUIRES_POINT_TARGET",
          message: `${bearing.kind} target ${targetLabel} is a Bearing; ${bearing.kind} requires a Point target.`,
          sourceSpan: bearing.sourceSpan
        });
        isValid = false;
      }
    } else if (targetKind === "invalid") {
      isValid = false;
    } else {
      diagnostics.push({
        severity: "error",
        code: "UNKNOWN_TARGET",
        message: `Target ${targetLabel} not found.`,
        sourceSpan: bearing.sourceSpan
      });
      isValid = false;
    }

    if (bearing.handle && symbols.allIds.has(bearing.handle)) {
      diagnostics.push({
        severity: "error",
        code: "POINT_BEARING_ID_CONFLICT",
        message: `Bearing handle @${bearing.handle} conflicts with an existing Point anchor.`,
        sourceSpan: bearing.sourceSpan
      });
      isValid = false;
    }

    if (bearing.handle && symbols.duplicateBearingIds.has(bearing.handle)) {
      isValid = false;
    }

    validity.set(bearing, isValid);
  }

  let changed = true;
  while (changed) {
    changed = false;
    const validBearingKeys = new Set(
      bearings.filter((bearing) => validity.get(bearing)).map((bearing) => bearing.key)
    );

    for (const bearing of bearings) {
      if (!validity.get(bearing) || !("key" in bearing.target) || bearing.target.kind !== "bearing" || validBearingKeys.has(bearing.target.key)) {
        continue;
      }
      diagnostics.push({
        severity: "error",
        code: "UNRESOLVED_BEARING_TARGET",
        message: `Target Bearing ${referenceLabel(bearing.target, symbols)} did not compile into canonical Graph IR.`,
        sourceSpan: bearing.sourceSpan
      });
      validity.set(bearing, false);
      changed = true;
    }
  }

  const accepted = bearings.filter((bearing) => validity.get(bearing));
  return {
    accepted,
    bearings: accepted.map(toCanonicalBearing)
  };
}

function buildExplainEntries(
  drafts: ExplainDraft[],
  points: Point[],
  validation: BearingValidation,
  diagnostics: Diagnostic[]
): ExplainEntry[] {
  const pointKeys = new Set(points.map((point) => point.key));
  const bearingIndexes = new Map(
    validation.accepted.map((bearing, graphIndex) => [bearing, graphIndex] as const)
  );

  return drafts.map((draft) => {
    const effects: ExplainEffect[] = [];

    if (draft.recognition.kind === "body") {
      effects.push({ kind: "preserveBody" });
    }

    if (draft.point) {
      const ref = pointRef(draft.point.key);
      const identity = draft.point.id ? { id: draft.point.id } : {};
      effects.push(
        pointKeys.has(draft.point.key)
          ? { kind: "emitPoint", ref, ...identity, reason: draft.point.reason }
          : { kind: "rejectPoint", ref, ...identity, reason: "duplicate-anchor" }
      );
    }

    if (draft.bearing?.outcome === "candidate") {
      const graphIndex = bearingIndexes.get(draft.bearing.candidate);
      const summary = summarizeCandidate(draft.bearing.candidate);
      if (graphIndex === undefined) {
        effects.push({ kind: "rejectBearing", bearing: summary, reason: "validation-error" });
      } else {
        const { key, handle } = draft.bearing.candidate;
        const canonical = validation.bearings[graphIndex];
        effects.push({
          kind: "emitBearing",
          ref: { key, kind: "bearing", graphIndex, ...(handle ? { handle } : {}) },
          bearing: summarizeEmittedBearing(canonical),
          reason: draft.bearing.reason
        });
      }
    } else if (draft.bearing?.outcome === "rejected") {
      effects.push({ kind: "rejectBearing", reason: draft.bearing.reason });
    } else if (draft.bearing?.outcome === "skipped") {
      effects.push({ kind: "skipBearing", reason: draft.bearing.reason });
    }

    return {
      sourceSpan: draft.block.sourceSpan,
      recognition: draft.recognition,
      effects,
      diagnosticCodes: diagnosticCodesForSpan(draft.block.sourceSpan, diagnostics)
    };
  });
}

function summarizeEmittedBearing(bearing: Bearing): ExplainEmittedBearingSummary {
  const { text: _text, sourceSpan: _sourceSpan, ...summary } = bearing;
  // Explain owns its references; mutating it must not mutate the graph projection.
  return structuredClone(summary);
}

function pointAnchor(block: AstBlock): string | undefined {
  return block.annotation && "anchor" in block.annotation ? block.annotation.anchor : undefined;
}

function pointRole(block: AstBlock) {
  return block.annotation?.kind === "role" ? block.annotation.role : undefined;
}

function summarizeCandidate(candidate: CandidateBearing): ExplainBearingSummary {
  return {
    key: candidate.key,
    ...(candidate.handle ? { handle: candidate.handle } : {}),
    kind: candidate.kind,
    sources: candidate.sources.map((source) => ({ ...source })),
    target: { ...candidate.target },
    derivedBy: candidate.derivedBy
  };
}

function diagnosticCodesForSpan(sourceSpan: SourceSpan, diagnostics: Diagnostic[]): string[] {
  return [
    ...new Set(
      diagnostics
        .filter(
          (diagnostic) =>
            diagnostic.sourceSpan &&
            diagnostic.sourceSpan.startLine <= sourceSpan.endLine &&
            diagnostic.sourceSpan.endLine >= sourceSpan.startLine
        )
        .map((diagnostic) => diagnostic.code)
    )
  ];
}

function toCanonicalBearing(bearing: CandidateBearing): Bearing {
  if (!("key" in bearing.target)) {
    throw new Error("Compiler invariant violated: canonical Bearing target kind was not resolved.");
  }
  const sources = bearing.sources.map((source) => {
    if (!("key" in source)) {
      throw new Error("Compiler invariant violated: canonical Bearing source was not resolved.");
    }
    return source;
  });
  const base = { ...bearing, sources };
  if (requiresPointTarget(bearing.kind)) {
    if (bearing.target.kind !== "point") {
      throw new Error(`Compiler invariant violated: ${bearing.kind} target was not validated as a Point.`);
    }
    return { ...base, kind: bearing.kind, target: { key: bearing.target.key, kind: "point" } };
  }
  if (bearing.kind === "undercuts") {
    if (bearing.target.kind !== "bearing") {
      throw new Error("Compiler invariant violated: undercut target was not validated as a Bearing.");
    }
    return { ...base, kind: "undercuts", target: { key: bearing.target.key, kind: "bearing" } };
  }
  const target =
    bearing.target.kind === "point"
      ? { key: bearing.target.key, kind: "point" as const }
      : { key: bearing.target.key, kind: "bearing" as const };
  return { ...base, kind: bearing.kind, target };
}

function requiresPointTarget(
  kind: BearingKind
): kind is "challenges" | "answers" | "repliesTo" | "clarifies" {
  return kind === "challenges" || kind === "answers" || kind === "repliesTo" || kind === "clarifies";
}

function addStructuralDiagnostics(
  blocks: AstBlock[],
  bearings: Bearing[],
  symbols: SymbolTable,
  diagnostics: Diagnostic[]
): void {
  const connectedKeys = new Set(
    bearings.flatMap((bearing) => [...bearing.sources.map((source) => source.key), bearing.target.key])
  );

  walkWithParent(blocks, undefined, (block) => {
    const anchor = pointAnchor(block);
    if (
      !pointRole(block) &&
      anchor &&
      !symbols.duplicatePointIds.has(anchor) &&
      !symbols.conflictingIds.has(anchor) &&
      !block.annotation?.operatorClause &&
      block.annotation?.kind === "anchor" &&
      !connectedKeys.has(symbols.keysById.get(anchor) ?? "")
    ) {
      diagnostics.push({
        severity: "suggestion",
        code: "DISCONNECTED_ANCHORED_MATERIAL",
        message: `Roleless anchored material @${anchor} is not connected to the graph.`,
        sourceSpan: block.sourceSpan
      });
    }
  });
}

function classifyId(id: string, symbols: SymbolTable): SymbolKind {
  if (symbols.duplicatePointIds.has(id) || symbols.conflictingIds.has(id)) {
    return "invalid";
  }
  if (symbols.pointIds.has(id)) {
    return "point";
  }
  if (symbols.bearingIds.has(id)) {
    return "bearing";
  }
  return "unknown";
}

function classifyReference(ref: BearingTarget | Ref, symbols: SymbolTable): SymbolKind {
  if ("id" in ref) {
    return classifyId(ref.id, symbols);
  }
  const point = symbols.pointsByKey.get(ref.key);
  if (!point) {
    return "invalid";
  }
  return point.id ? classifyId(point.id, symbols) : "point";
}

function resolveKey(ref: BearingTarget | Ref, symbols: SymbolTable): string {
  if ("key" in ref) {
    return ref.key;
  }
  const key = symbols.keysById.get(ref.id);
  if (!key) {
    throw new Error("Compiler invariant violated: validated authored reference has no compilation key.");
  }
  return key;
}

function referenceLabel(ref: BearingTarget | Ref, symbols: SymbolTable): string {
  if ("id" in ref) {
    return `@${ref.id}`;
  }
  for (const [id, key] of symbols.keysById) {
    if (key === ref.key) {
      return `@${id}`;
    }
  }
  return ref.key;
}

function pointFromBlock(block: AstBlock, pointKeys: WeakMap<AstBlock, string>): Point {
  const base = {
    key: pointKeyForBlock(block, pointKeys),
    ...(pointAnchor(block) ? { id: pointAnchor(block) } : {}),
    text: block.text,
    sourceSpan: block.sourceSpan
  };
  if (block.annotation?.kind === "gap") {
    return { ...base, form: "gap", status: "open" };
  }
  if (block.annotation?.kind === "role") {
    const annotation = block.annotation;
    if (annotation.role === "C") {
      return annotation.status === "open"
        ? { ...base, form: "role", role: "C", status: "open" }
        : { ...base, form: "role", role: "C" };
    }
    return { ...base, form: "role", role: annotation.role };
  }
  return { ...base, form: "material" };
}

function pointKeyForBlock(block: AstBlock, pointKeys: WeakMap<AstBlock, string>): string {
  const generated = pointKeys.get(block);
  if (!generated) {
    throw new Error("Compiler invariant violated: Point block has no compilation key.");
  }
  return generated;
}

function assignPointKeys(blocks: AstBlock[]): WeakMap<AstBlock, string> {
  const pointKeys = new WeakMap<AstBlock, string>();
  let nextId = 1;

  walkWithParent(blocks, undefined, (block) => {
    if (block.annotation && block.annotation.kind !== "edge") {
      pointKeys.set(block, `_p${nextId}`);
      nextId += 1;
    }
  });

  return pointKeys;
}

function walkWithParent(
  blocks: AstBlock[],
  parent: AstBlock | undefined,
  visit: (block: AstBlock, parent: AstBlock | undefined) => void
): void {
  for (const block of blocks) {
    visit(block, parent);
    walkWithParent(block.children, block, visit);
  }
}
