import type {
  AstBlock,
  Bearing,
  BearingDerivedBy,
  BearingKind,
  BearingRef,
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
  LocalBearingChildFunction,
  OperatorClause,
  ObjectNote,
  Point,
  PointDeclaration,
  PointRef,
  Ref,
  Role,
  SourceSpan
} from "./types.js";
import { FORMAT_VERSION } from "./types.js";
import { operatorSymbol } from "./annotation.js";

const LOCAL_SELECTOR_KINDS = { G: "supports", O: "challenges", Q: "concerns" } as const;

type Context = (
  | { kind: "point"; block: AstBlock; focus?: PointRef | Ref; exposedBearing?: BearingRef }
  | { kind: "bearing"; block: AstBlock; exposedBearing?: BearingRef | Ref; localBearingChildren?: ReadonlyMap<AstBlock, LocalBearingChildFunction> }
) & { crossedBodySpans?: SourceSpan[] } | undefined;

type CandidateBearing = {
  key: string;
  handle?: string;
  kind: BearingKind;
  sources: (PointRef | Ref)[];
  target: BearingTarget | Ref;
  derivedBy: BearingDerivedBy;
  sourceSpan?: SourceSpan;
  targetFocusKind?: "point" | "bearing";
  targetKind?: OperatorClause["targetKind"];
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
  bearingKeys: Set<string>;
  keysById: Map<string, string>;
};

type PointDraft = {
  key: string;
  id?: string;
  reason: "role-annotation" | "material-annotation";
};

type BearingDraft =
  | {
      outcome: "candidate";
      candidate: CandidateBearing;
      reason: "operator-clause" | "annotated-containment" | "local-bearing-containment" | "local-attachment";
    }
  | {
      outcome: "rejected";
      reason: "annotation-syntax-error" | "explicit-bearing-descendant-requires-target" | "bearing-use-requires-explicit-target" | "failed-context-requires-explicit-target" | "invalid-local-bearing" | "no-local-attachment";
    }
  | {
      outcome: "skipped";
      reason: "no-eligible-ancestor" | "no-structural-rule" | "local-bearing-membership";
    };

type ExplainDraft = {
  block: AstBlock;
  recognition: ExplainRecognition;
  point?: PointDraft;
  membership?: { localBearingSpan: SourceSpan; eligible: boolean; function: LocalBearingChildFunction };
  selection?: { ownerSpan?: SourceSpan; contextSpan?: SourceSpan; target?: BearingRef | Ref };
  focus?: { kind: "point" | "bearing"; operand?: Ref; ref?: BearingTarget; reason?: "reference-error" | "annotation-syntax-error" };
  bearing?: BearingDraft;
  parentSpan?: SourceSpan;
  implicit?: { contextSpan: SourceSpan; crossedBodySpans: SourceSpan[] };
  note?: ObjectNote;
  noteSelection?: {
    targetKind: "point" | "bearing";
    contextSpan?: SourceSpan;
    crossedBodySpans: SourceSpan[];
    candidate?: BearingTarget | Ref;
    target?: BearingTarget;
  };
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
    compileBlock(block, undefined, pointKeys, compiledPoints, compiledBearings, explainDrafts, diagnostics);
  }

  const points = compiledPoints.filter((point) => !point.id || !symbols.duplicatePointIds.has(point.id));
  for (const point of points) {
    symbols.pointsByKey.set(point.key, point);
    if (point.id) {
      symbols.keysById.set(point.id, point.key);
    }
  }

  collectBearingSymbols(compiledBearings, symbols, diagnostics);
  for (const draft of explainDrafts) {
    if (!draft.focus || draft.focus.kind !== "point" || draft.focus.reason) continue;
    const operand = draft.focus.operand;
    const kind = operand ? classifyReference(operand, symbols) : "invalid";
    if (kind === "point" && operand) {
      draft.focus.ref = pointRef(resolveKey(operand, symbols));
    } else {
      draft.focus.reason = "reference-error";
      diagnostics.push({ severity: "error", code: kind === "bearing" ? "BEARING_IS_NOT_POINT_REFERENCE" : kind === "unknown" ? "UNKNOWN_POINT_REFERENCE" : "INVALID_POINT_REFERENCE", message: "Point use operand " + (operand ? "@" + operand.id : "(missing)") + " does not resolve to a unique Point in this source unit.", sourceSpan: draft.block.sourceSpan });
    }
  }
  const validation = validateBearings(compiledBearings, symbols, diagnostics);
  const validBearingKeys = new Set(validation.bearings.map(bearing => bearing.key));
  for (const draft of explainDrafts) {
    if (!draft.selection?.contextSpan) continue;
    const target = draft.selection.target;
    draft.selection.target = target && classifyReference(target, symbols) === "bearing" && validBearingKeys.has(resolveKey(target, symbols))
      ? { kind: "bearing", key: resolveKey(target, symbols) } : undefined;
  }
  for (const draft of explainDrafts) {
    if (!draft.focus || draft.focus.kind !== "bearing" || draft.focus.reason) continue;
    const operand = draft.focus.operand;
    const kind = operand ? classifyReference(operand, symbols) : "invalid";
    if (operand && kind === "bearing" && validBearingKeys.has(resolveKey(operand, symbols))) {
      draft.focus.ref = { kind: "bearing", key: resolveKey(operand, symbols) };
    } else {
      draft.focus.reason = "reference-error";
      diagnostics.push({ severity: "error", code: kind === "point" ? "POINT_IS_NOT_BEARING_REFERENCE" : kind === "unknown" ? "UNKNOWN_BEARING_REFERENCE" : "INVALID_BEARING_REFERENCE", message: "Bearing use operand " + (operand ? "@" + operand.id : "(missing)") + " does not resolve to a unique validated Bearing in this source unit.", sourceSpan: draft.block.sourceSpan });
    }
  }
  resolveNotes(explainDrafts, symbols, validation.bearings, diagnostics);
  const entries = buildExplainEntries(explainDrafts, points, validation, diagnostics, new Set([...symbols.allIds.keys(), ...symbols.bearingIds]));

  const graph = {
    version: FORMAT_VERSION,
    points,
    bearings: validation.bearings,
    notes: explainDrafts.flatMap(draft => draft.note ? [draft.note] : []),
    diagnostics
  };

  return {
    graph,
    explain: {
      version: FORMAT_VERSION,
      entries,
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
  diagnostics: Diagnostic[],
  sourceParent?: AstBlock
): void {
  const localBearingAncestor = context?.kind === "bearing" && context.block.annotation?.kind === "localBearing" ? context.block : undefined;
  const childFunction = context?.kind === "bearing" ? context.localBearingChildren?.get(block) : undefined;
  const membership = localBearingAncestor ? { localBearingSpan: localBearingAncestor.sourceSpan, eligible: childFunction === "source", function: childFunction ?? "unclassified" as const } : undefined;
  if (!block.annotation) {
    explainDrafts.push({ block, recognition: { kind: "body" }, membership });
    for (const child of block.children) {
      compileBlock(child, context ? { ...context, crossedBodySpans: [...(context.crossedBodySpans ?? []), block.sourceSpan] } : undefined, pointKeys, points, bearings, explainDrafts, diagnostics, block);
    }
    return;
  }

  const annotation = block.annotation;
  const draft: ExplainDraft = {
    block,
    recognition: recognitionForBlock(block),
    membership,
    parentSpan: sourceParent?.sourceSpan
  };
  explainDrafts.push(draft);

  if (annotation.kind === "note") {
    if (annotation.targetKind) {
      draft.noteSelection = {
        targetKind: annotation.targetKind,
        ...(context ? { contextSpan: context.block.sourceSpan } : {}),
        crossedBodySpans: context?.crossedBodySpans ?? [],
        candidate: annotation.targetKind === "point"
          ? context?.kind === "point" ? context.focus : undefined
          : context?.exposedBearing
      };
    }
    return;
  }

  if (annotation.kind === "invalid") {
    draft.bearing = { outcome: "rejected", reason: "annotation-syntax-error" };
    for (const child of block.children) {
      compileBlock(child, { kind: "point", block }, pointKeys, points, bearings, explainDrafts, diagnostics, block);
    }
    return;
  }

  if (annotation.kind === "localBearing") {
    compileLocalBearing(block, context, draft, pointKeys, points, bearings, explainDrafts, diagnostics);
    return;
  }

  if (annotation.kind === "bearingUse") {
    const syntaxFailed = Boolean(annotation.syntaxErrors?.length);
    draft.focus = { kind: "bearing", operand: annotation.ref, ...(syntaxFailed ? { reason: "annotation-syntax-error" as const } : {}) };
    for (const child of block.children) {
      compileBlock(child, { kind: "bearing", block, exposedBearing: syntaxFailed ? undefined : annotation.ref }, pointKeys, points, bearings, explainDrafts, diagnostics, block);
    }
    return;
  }

  // A header that selected no mode states no explicit-target requirement; its
  // own diagnostic suffices, and its descendants still cannot attach outward.
  const edgeAncestor = context?.kind === "bearing" && context.block.annotation?.kind === "explicitBearing"
    && !context.block.annotation.syntaxErrors?.includes("mode") ? context.block : undefined;

  if (annotation.kind === "use") {
    draft.focus = { kind: "point", operand: annotation.ref, ...(annotation.syntaxErrors?.includes("reference") ? { reason: "annotation-syntax-error" as const } : {}) };
  } else if (annotation.kind !== "explicitBearing") {
    const point = pointFromBlock(block, pointKeys);
    points.push(point);
    draft.point = { key: point.key, ...(point.id ? { id: point.id } : {}), reason: pointReasonForBlock(block) };
  }

  let producedBearing: CandidateBearing | undefined;
  const bearingSyntaxFailed = Boolean(annotation.syntaxErrors && annotation.syntaxErrors.length > 0);
  const implicitEdgeDescendant = Boolean(
    edgeAncestor && annotation.kind !== "explicitBearing" && !annotation.operatorClause && !("selector" in annotation && annotation.selector) && !bearingSyntaxFailed
  );
  if (implicitEdgeDescendant) {
    draft.bearing = {
      outcome: "rejected",
      reason: "explicit-bearing-descendant-requires-target"
    };
    diagnostics.push({
      severity: "error",
      code: "EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET",
      message:
        "The first Point beneath an explicit Bearing constructor, including a neutral declaration or use, needs a local selector or an explicit target. Only a local Bearing constructor takes direct neutral source members; place an unconnected Point outside this Bearing context.",
      sourceSpan: block.sourceSpan
    });
  } else if (context?.block.annotation?.kind === "bearingUse" && annotation.kind !== "explicitBearing" && !annotation.operatorClause && !("selector" in annotation && annotation.selector) && !bearingSyntaxFailed) {
    draft.bearing = { outcome: "rejected", reason: "bearing-use-requires-explicit-target" };
    diagnostics.push({ severity: "error", code: "BEARING_USE_REQUIRES_EXPLICIT_TARGET", message: "Bearing use exposes no Point target; the first Point, including a neutral declaration or use, needs a local selector or an explicit target. Place an unconnected Point outside this Bearing context.", sourceSpan: block.sourceSpan });
  } else if (context?.kind === "point" && !context.focus && annotation.kind !== "explicitBearing" && !annotation.operatorClause && !("selector" in annotation && annotation.selector) && !bearingSyntaxFailed) {
    draft.bearing = { outcome: "rejected", reason: "failed-context-requires-explicit-target" };
    diagnostics.push({ severity: "error", code: "FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET", message: "This Point is beneath a failed constructor, so no implicit attachment to an outer Point is derived. Fix any layout or annotation errors in the enclosing constructor first; use an explicit target only if this Point is intended to attach independently.", sourceSpan: block.sourceSpan });
  } else if (bearingSyntaxFailed) {
    draft.bearing = { outcome: "rejected", reason: "annotation-syntax-error" };
  } else if ((annotation.kind === "role" || annotation.kind === "use") && annotation.selector) {
    const selected = selectLocalBearing(context, draft);
    if (selected) {
      const source = annotation.kind === "use" ? annotation.ref : pointKeyForBlock(block, pointKeys);
      if (!source) throw new Error("Compiler invariant violated: a valid selector has no Point operand.");
      const bearing = structural(block, LOCAL_SELECTOR_KINDS[annotation.role], [source], selected, "bearing");
      bearing.key = "_b" + (bearings.length + 1);
      bearings.push(bearing);
      draft.bearing = { outcome: "candidate", candidate: bearing, reason: "local-attachment" };
      producedBearing = bearing;
    } else {
      diagnostics.push({ severity: "error", code: "NO_LOCAL_BEARING_ATTACHMENT", message: "The nearest ancestor constructor exposes no Bearing; use an explicit target instead.", sourceSpan: block.sourceSpan });
      draft.bearing = { outcome: "rejected", reason: "no-local-attachment" };
    }
  } else if (annotation.operatorClause) {
    const bearing = bearingFromOperator(block, annotation.operatorClause, pointKeys);
    if (bearing) {
      bearing.key = `_b${bearings.length + 1}`;
      bearings.push(bearing);
      draft.bearing = { outcome: "candidate", candidate: bearing, reason: "operator-clause" };
      producedBearing = bearing;
    } else {
      draft.bearing = { outcome: "rejected", reason: "annotation-syntax-error" };
    }
  } else if (annotation.kind === "explicitBearing") {
    // The parser records an operator error on every edge without a clause. An
    // edge is never a Point, so it must not reach the indentation defaults.
    const at = block.sourceSpan.startLine + ":" + block.sourceSpan.startColumn;
    throw new Error(`Invalid AST: the edge annotation at ${at} has no operatorClause and records no syntax error; validate imported AST JSON against the AST schema before compiling.`);
  } else if (localBearingAncestor) {
    draft.bearing = { outcome: "skipped", reason: "local-bearing-membership" };
  } else {
    const bearing = deriveStructuralBearing(block, context?.kind === "point" ? context : undefined, pointKeys);
    if (bearing) {
      bearing.key = `_b${bearings.length + 1}`;
      bearings.push(bearing);
      draft.bearing = { outcome: "candidate", candidate: bearing, reason: "annotated-containment" };
      producedBearing = bearing;
    } else {
      draft.bearing = {
        outcome: "skipped",
        reason: context ? "no-structural-rule" : "no-eligible-ancestor"
      };
    }
  }

  if (annotation.handle && !producedBearing && !bearingSyntaxFailed && !implicitEdgeDescendant) {
    diagnostics.push({
      severity: "error",
      code: "BEARING_HANDLE_WITHOUT_BEARING",
      message: `Bearing handle @${annotation.handle} appears on an annotation that produces no Bearing. Resolve any layout or constructor errors first, then check that this annotation defines a Bearing before naming it.`,
      sourceSpan: block.sourceSpan
    });
  }

  if (producedBearing?.derivedBy === "structural" && context) {
    draft.implicit = { contextSpan: context.block.sourceSpan, crossedBodySpans: context.crossedBodySpans ?? [] };
  }
  const childContext: Context =
    annotation.kind === "explicitBearing"
      ? { kind: "bearing", block, exposedBearing: producedBearing ? { kind: "bearing", key: producedBearing.key } : undefined }
      : { kind: "point", block, focus: annotation.kind === "use" ? annotation.syntaxErrors?.includes("reference") ? undefined : annotation.ref : pointRef(pointKeyForBlock(block, pointKeys)), exposedBearing: producedBearing ? { kind: "bearing", key: producedBearing.key } : undefined };
  for (const child of block.children) {
    compileBlock(child, childContext, pointKeys, points, bearings, explainDrafts, diagnostics, block);
  }
}

function classifyLocalBearingChild(block: AstBlock): LocalBearingChildFunction {
  const annotation = block.annotation;
  if (!annotation) return "unclassified";
  if (annotation.kind === "note") return annotation.syntaxErrors?.length ? "unclassified" : "supplementary";
  if (annotation.kind === "bearingUse") return "independent";
  if ("selector" in annotation && annotation.selector) return "commentary";
  if (annotation.kind === "invalid" || annotation.kind === "localBearing") return "unclassified";
  if ("operatorClause" in annotation && annotation.operatorClause) return "independent";
  return (annotation.kind === "material" || (annotation.kind === "use" && !annotation.role)) && !annotation.handle && !annotation.syntaxErrors?.length ? "source" : "unclassified";
}

function localBearingMemberDiagnosticMessage(block: AstBlock): string {
  const annotation = block.annotation;
  if ((annotation?.kind === "role" || annotation?.kind === "use")
      && (annotation.role === "G" || annotation.role === "O")
      && !annotation.selector && !annotation.operatorClause && !annotation.handle && !annotation.syntaxErrors?.length
      && (annotation.kind !== "use" || annotation.ref)) {
    const operand = annotation.kind === "use" ? ` use @${annotation.ref!.id}` : annotation.anchor ? ` @${annotation.anchor}` : "";
    const action = annotation.role === "G" ? "support" : "challenge";
    return `A direct ${annotation.role}-marked Point is not a local Bearing source. ` +
      `Use [.${operand}] for a joint source, [${annotation.role}/${operand}] to ${action} this Bearing, ` +
      "or a complete explicit target for an independent relation. These are different authoring choices; no default attachment is created here.";
  }
  return "Direct local Bearing children must be neutral Point sources, local selector commentary, complete independent clauses or valid notes.";
}

function compileLocalBearing(
  block: AstBlock,
  context: Context,
  draft: ExplainDraft,
  pointKeys: WeakMap<AstBlock, string>,
  points: Point[],
  bearings: CandidateBearing[],
  explainDrafts: ExplainDraft[],
  diagnostics: Diagnostic[]
): void {
  const annotation = block.annotation;
  if (annotation?.kind !== "localBearing") throw new Error("Compiler invariant violated: expected a local Bearing annotation.");
  const role = annotation.role;
  let valid = Boolean(role) && !annotation.syntaxErrors?.length;
  const headerValid = valid;
  const reject = (code: string, message: string, location = block) => {
    diagnostics.push({ severity: "error", code, message, sourceSpan: location.sourceSpan });
    valid = false;
  };
  const target = annotation.selector ? selectLocalBearing(context, draft) : context?.kind === "point" ? context.focus : undefined;
  if (annotation.selector) {
    if (!target) reject("NO_LOCAL_BEARING_ATTACHMENT", "The nearest ancestor constructor exposes no Bearing; use an explicit target instead.");
  } else {
    if (!target && context?.block.annotation?.kind !== "localBearing") reject("LOCAL_BEARING_REQUIRES_POINT_TARGET", "A local Bearing requires a nearest enclosing Point target.");
    if (context?.block.annotation?.kind === "explicitBearing") reject("EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET",
      "A local Bearing beneath an explicit Bearing cannot bypass the requirement for an explicitly targeted first Point.");
    if (context?.block.annotation?.kind === "localBearing") reject("NESTED_LOCAL_BEARING_UNSUPPORTED",
      "A local Bearing cannot be nested beneath another local Bearing without an intervening Point.");
  }
  const localBearingChildren = new Map(block.children.map(child => [child, classifyLocalBearingChild(child)]));
  const sources = block.children.filter(child => localBearingChildren.get(child) === "source");
  if (headerValid && !sources.length && ![...localBearingChildren.values()].includes("unclassified")) reject("EMPTY_LOCAL_BEARING", "A local Bearing requires at least one direct neutral Point source, not only commentary or notes.");
  for (const child of block.children) {
    if (headerValid && localBearingChildren.get(child) === "unclassified") reject("INVALID_LOCAL_BEARING_MEMBER",
      localBearingMemberDiagnosticMessage(child), child);
  }
  let attachment: CandidateBearing | undefined;
  const kind = annotation.selector ? LOCAL_SELECTOR_KINDS[annotation.role] : structuralKind(role);
  if (valid && target && kind) {
    const bearing = structural(block, kind, sources.map(child => child.annotation?.kind === "use" ? child.annotation.ref! : pointKeyForBlock(child, pointKeys)),
      target, annotation.selector ? "bearing" : "point");
    bearing.key = `_b${bearings.length + 1}`;
    bearings.push(bearing);
    draft.bearing = { outcome: "candidate", candidate: bearing, reason: "local-bearing-containment" };
    if (context) draft.implicit = { contextSpan: context.block.sourceSpan, crossedBodySpans: context.crossedBodySpans ?? [] };
    attachment = bearing;
  } else {
    draft.bearing = { outcome: "rejected", reason: "invalid-local-bearing" };
  }
  for (const child of block.children) {
    compileBlock(child, { kind: "bearing", block, exposedBearing: attachment ? { kind: "bearing", key: attachment.key } : undefined, localBearingChildren }, pointKeys, points, bearings, explainDrafts, diagnostics, block);
  }
}

function selectLocalBearing(context: Context, draft: ExplainDraft): BearingRef | Ref | undefined {
  const selected = context?.exposedBearing;
  draft.selection = {
    ...(context?.block.annotation?.kind === "bearingUse" ? { contextSpan: context.block.sourceSpan } : context ? { ownerSpan: context.block.sourceSpan } : {}),
    ...(selected ? { target: { ...selected } } : {})
  };
  return selected;
}

function recognitionForBlock(block: AstBlock): ExplainRecognition {
  const annotation = block.annotation;
  if (!annotation) {
    return { kind: "body" };
  }
  if (annotation.kind === "note") return { kind: "note", ...(annotation.targetKind ? { targetKind: annotation.targetKind } : {}) };
  if (annotation.kind === "role") {
    return annotation.selector ? { kind: "role", role: annotation.role, selector: annotation.selector } : { kind: "role", role: annotation.role };
  }
  if (annotation.kind === "invalid") return annotation.selector ? { kind: "invalid", selector: annotation.selector } : { kind: "invalid" };
  if (annotation.kind === "bearingUse") return { kind: "bearingUse", ...(annotation.ref ? { ref: { ...annotation.ref } } : {}) };
  if (annotation.kind === "use") {
    const focus = { kind: "use" as const, ...(annotation.ref ? { ref: { ...annotation.ref } } : {}) };
    return annotation.selector
      ? { ...focus, role: annotation.role, selector: annotation.selector }
      : { ...focus, ...(annotation.role ? { role: annotation.role } : {}) };
  }
  if (annotation.kind === "localBearing") return annotation.selector
    ? { kind: "localBearing", role: annotation.role, selector: annotation.selector }
    : { kind: "localBearing", ...(annotation.role ? { role: annotation.role } : {}) };
  return { kind: annotation.kind };
}

function pointReasonForBlock(block: AstBlock): PointDraft["reason"] {
  if (block.annotation?.kind === "role") {
    return "role-annotation";
  }
  return "material-annotation";
}

function bearingFromOperator(
  block: AstBlock,
  operator: OperatorClause,
  pointKeys: WeakMap<AstBlock, string>
): CandidateBearing | undefined {
  const handle = block.annotation && "handle" in block.annotation ? block.annotation.handle : undefined;
  const sources =
    operator.sources === "self"
      ? block.annotation?.kind === "use" ? block.annotation.ref ? [{ ...block.annotation.ref }] : [] : [pointRef(pointKeyForBlock(block, pointKeys))]
      : operator.sources.map((source) => ({ id: source.id }));

  const target = operator.target;
  if (!target) {
    return undefined;
  }

  return {
    key: "",
    ...(handle ? { handle } : {}),
    kind: operator.op,
    targetKind: operator.targetKind,
    sources,
    target: { id: target.id },
    derivedBy: "operator",
    sourceSpan: block.sourceSpan
  };
}

// Resolve only the nearest context's selected slot after graph validation.
// No endpoint search or fallback: a rejected local object stays unavailable.
function resolveNotes(drafts: ExplainDraft[], symbols: SymbolTable, bearings: Bearing[], diagnostics: Diagnostic[]): void {
  const byKey = new Map(bearings.map(bearing => [bearing.key, bearing]));
  for (const draft of drafts) {
    const selection = draft.noteSelection;
    if (selection) {
      if (draft.block.annotation?.kind !== "note" || draft.block.annotation.syntaxErrors?.length) continue;
      const candidate = selection.candidate;
      const kind = candidate ? classifyReference(candidate, symbols) : undefined;
      const key = candidate && kind === selection.targetKind ? resolveKey(candidate, symbols) : undefined;
      if (key && (kind === "point" || byKey.has(key))) {
        const target: BearingTarget = { kind: selection.targetKind, key };
        selection.target = target;
        draft.note = { origin: "note", target, sourceSpan: draft.block.sourceSpan };
      } else {
        diagnostics.push({
          severity: "error",
          code: candidate ? "INVALID_LOCAL_NOTE_TARGET" : "NO_LOCAL_NOTE_TARGET",
          message: `The nearest context exposes no validated ${selection.targetKind === "point" ? "Point" : "Bearing"} for this note. Place it beneath that object's declaration or use; no outer context is searched.`,
          sourceSpan: draft.block.sourceSpan
        });
      }
    } else if (draft.bearing?.outcome === "candidate" &&
      (draft.recognition.kind === "explicitBearing" || draft.recognition.kind === "localBearing") && draft.block.text) {
      const bearing = byKey.get(draft.bearing.candidate.key);
      if (bearing) {
        draft.note = { origin: "constructor-description", target: { kind: "bearing", key: bearing.key }, sourceSpan: draft.block.sourceSpan };
        bearing.text = draft.block.text;
      }
    }
  }
}

function deriveStructuralBearing(
  block: AstBlock,
  parent: Extract<Context, { kind: "point" }> | undefined,
  pointKeys: WeakMap<AstBlock, string>
): CandidateBearing | undefined {
  if (!parent?.focus) {
    return undefined;
  }

  const source = block.annotation?.kind === "use" ? block.annotation.ref : pointKeyForBlock(block, pointKeys);
  if (!source) return undefined;
  const kind = structuralKind(pointRole(block));
  return kind ? structural(block, kind, [source], parent.focus, "point") : undefined;
}

// Point attachments and local Bearing constructors share relation rules.
// The constructor grammar separately limits its permitted roles.
function structuralKind(role: Role | undefined): BearingKind | undefined {
  switch (role) {
    case "G": return "supports";
    case "O": return "challenges";
    case "D": return "clarifies";
    case "R": return "respondsTo";
    default: return undefined;
  }
}

function structural(
  block: AstBlock,
  kind: BearingKind,
  sourceIds: (string | Ref)[],
  target: BearingTarget | Ref,
  targetFocusKind: "point" | "bearing"
): CandidateBearing {
  const handle = block.annotation && "handle" in block.annotation ? block.annotation.handle : undefined;
  return {
    key: "",
    ...(handle ? { handle } : {}),
    kind,
    sources: sourceIds.map(source => typeof source === "string" ? pointRef(source) : { ...source }),
    target,
    targetFocusKind,
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
    bearingKeys: new Set(),
    keysById: new Map()
  };

  walkBlocks(blocks, (block) => {
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
        explanation: `No Point declared as @${anchor} is emitted, and Bearings that depend on @${anchor} are rejected. ` +
          `If this line means the existing Point, reuse it with ${reuseSpelling(block, anchor)}; a use writes its local mark without declaring again. ` +
          "If it is different content, give it another name.",
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
    symbols.bearingKeys.add(bearing.key);
    if (!bearing.handle) {
      continue;
    }
    if (symbols.bearingIds.has(bearing.handle)) {
      symbols.duplicateBearingIds.add(bearing.handle);
      diagnostics.push({
        severity: "error",
        code: "DUPLICATE_BEARING_HANDLE",
        message: `Duplicate Bearing handle @${bearing.handle}.`,
        explanation: `Every Bearing with handle @${bearing.handle} is rejected. ` +
          `If this line should discuss that existing Bearing rather than construct another, write [_ use @${bearing.handle}]; otherwise choose a different handle.`,
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
    const resolvedSourceKeys = bearing.sources.filter((source): source is PointRef => "key" in source).map(source => source.key);
    if (new Set(resolvedSourceKeys).size !== resolvedSourceKeys.length) {
      isValid = false;
      diagnostics.push({ severity: "error", code: "DUPLICATE_BEARING_SOURCES", message: "A Bearing cannot contain the same resolved Point more than once; the entire source set is rejected.", sourceSpan: bearing.sourceSpan });
    }

    const targetLabel = referenceLabel(bearing.target, symbols);
    const targetKind = classifyReference(bearing.target, symbols);
    if (targetKind === "point" || targetKind === "bearing") {
      bearing.target = { key: resolveKey(bearing.target, symbols), kind: targetKind };
      if (bearing.targetFocusKind && targetKind !== bearing.targetFocusKind) {
        diagnostics.push({ severity: "error", code: bearing.targetFocusKind === "point" ? "POINT_FOCUS_REQUIRES_POINT" : "BEARING_FOCUS_REQUIRES_BEARING", message: bearing.targetFocusKind === "point" ? "The nearest Point use cannot supply a Bearing as its Point focus." : "The nearest Bearing use cannot supply a Point as its Bearing focus.", sourceSpan: bearing.sourceSpan });
        isValid = false;
      }
      if (bearing.targetKind === "bearing" && targetKind !== "bearing") {
        diagnostics.push({
          severity: "error",
          code: "CHALLENGE_REQUIRES_BEARING_TARGET",
          message: `Challenge target ${targetLabel} is a Point; /> requires a Bearing.`,
          sourceSpan: bearing.sourceSpan
        });
        isValid = false;
      }
      if (requiresPointTarget(bearing.kind) && targetKind !== "point") {
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

  // Follow reverse dependencies once instead of rescanning every Bearing for
  // each failed link. A valid cycle has no failed seed and remains intact.
  const dependents = new Map<string, number[]>();
  const rejected: { index: number; depth: number }[] = [];
  for (const [index, bearing] of bearings.entries()) {
    if (!validity.get(bearing)) {
      rejected.push({ index, depth: 0 });
    } else if ("key" in bearing.target && bearing.target.kind === "bearing") {
      const target = bearing.target.key;
      const entries = dependents.get(target);
      if (entries) entries.push(index);
      else dependents.set(target, [index]);
    }
  }
  for (let next = 0; next < rejected.length; next += 1) {
    const { index, depth } = rejected[next];
    for (const dependent of dependents.get(bearings[index].key) ?? []) {
      if (!validity.get(bearings[dependent])) continue;
      validity.set(bearings[dependent], false);
      rejected.push({ index: dependent, depth: depth + 1 });
    }
  }
  // Retain the existing diagnostic order: successive failure depths, then
  // construction order within each depth, regardless of dependency traversal.
  const propagated = rejected.filter(item => item.depth > 0)
    .sort((a, b) => a.depth - b.depth || a.index - b.index);
  for (const { index } of propagated) {
    const bearing = bearings[index];
    diagnostics.push({
      severity: "error",
      code: "UNRESOLVED_BEARING_TARGET",
      message: `Target Bearing ${referenceLabel(bearing.target, symbols)} did not compile into canonical Graph IR.`,
      sourceSpan: bearing.sourceSpan
    });
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
  diagnostics: Diagnostic[],
  authoredNames: ReadonlySet<string>
): ExplainEntry[] {
  const pointKeys = new Set(points.map((point) => point.key));
  const pointTargets = new Map(points.map(point => [point.key, point]));
  const bearingTargets = new Map(validation.bearings.map(bearing => [bearing.key, bearing]));
  const bearingIndexes = new Map(
    validation.accepted.map((bearing, graphIndex) => [bearing, graphIndex] as const)
  );

  return drafts.map((draft) => {
    const effects: ExplainEffect[] = [];

    if (draft.recognition.kind === "body") {
      effects.push({ kind: "preserveBody" });
    }

    if (draft.recognition.kind === "note") {
      effects.push({ kind: "preserveNote", ...(draft.parentSpan ? { parentSpan: { ...draft.parentSpan } } : {}) });
    }
    if (draft.noteSelection) {
      const { targetKind, contextSpan, crossedBodySpans, target } = draft.noteSelection;
      const base = { kind: "selectNoteTarget" as const, ...(contextSpan ? { contextSpan: { ...contextSpan } } : {}), crossedBodySpans: structuredClone(crossedBodySpans) };
      if (target && target.kind !== targetKind) throw new Error("Compiler invariant violated: note target has the wrong kind.");
      effects.push(targetKind === "point"
        ? { ...base, targetKind, ...(target?.kind === "point" ? { target: { ...target } } : {}) }
        : { ...base, targetKind, ...(target?.kind === "bearing" ? { target: { ...target } } : {}) });
    }
    if (draft.note) effects.push({ kind: "attachNote", note: structuredClone(draft.note) });

    if (draft.membership) {
      effects.push({ kind: "localBearingMember", ...draft.membership });
    }
    if (draft.selection) {
      const target = draft.selection.target;
      if (draft.selection.contextSpan) {
        effects.push({ kind: "selectBearing", contextSpan: draft.selection.contextSpan, ...(target && "key" in target ? { target } : {}) });
      } else {
        effects.push({ kind: "selectAttachment", ...(draft.selection.ownerSpan ? { ownerSpan: draft.selection.ownerSpan } : {}), ...(target && "key" in target ? { target } : {}) });
      }
    }
    if (draft.focus) {
      const focus = draft.focus;
      effects.push(focus.ref && focus.operand
        ? focus.ref.kind === "point" ? { kind: "focusPoint", ref: { ...focus.ref }, operand: { ...focus.operand } } : { kind: "focusBearing", ref: { ...focus.ref }, operand: { ...focus.operand } }
        : { kind: "rejectFocus", ...(focus.operand ? { operand: { ...focus.operand } } : {}), reason: focus.reason ?? "reference-error" });
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
        if (draft.implicit) {
          const target = canonical.target;
          const entity = target.kind === "point" ? pointTargets.get(target.key) : bearingTargets.get(target.key);
          const targetSpan = entity?.sourceSpan;
          const name = entity && ("declaration" in entity ? entity.id : entity.handle);
          const spanLabel = (span: SourceSpan) => span.startLine + ":" + span.startColumn + "–" + span.endLine + ":" + span.endColumn;
          const targetLabel = name ? "@" + name : target.kind + (targetSpan ? " at " + spanLabel(targetSpan) : "");
          effects.push({
            kind: "implicitAttachment",
            target: { ...target },
            ...(targetSpan ? { targetSpan: { ...targetSpan } } : {}),
            contextSpan: { ...draft.implicit.contextSpan },
            crossedBodySpans: draft.implicit.crossedBodySpans.map(span => ({ ...span }))
          });
          if (draft.implicit.crossedBodySpans.length) diagnostics.push({
            severity: "suggestion",
            code: "IMPLICIT_ATTACHMENT_THROUGH_BODY",
            message: "Implicit " + canonical.kind + " selects " + targetLabel + " through ordinary body at " + draft.implicit.crossedBodySpans.map(spanLabel).join(", ") + ".",
            explanation: implicitAttachmentAdvice(draft.block, canonical.kind, draft.bearing.reason, name || undefined, canonical.sources.map(source => pointTargets.get(source.key)?.id), authoredNames),
            sourceSpan: draft.block.sourceSpan
          });
        }
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

// Advice names an existing spelling that states the same relation explicitly.
// It never proposes adding an edge beside a default that would still apply.
// Sources come from the surviving canonical Bearing, never from a second
// reading of the block's children, so independent relations stay out of it.
function implicitAttachmentAdvice(
  block: AstBlock,
  kind: BearingKind,
  reason: Extract<BearingDraft, { outcome: "candidate" }>["reason"],
  targetName: string | undefined,
  sourceNames: (string | undefined)[],
  authoredNames: ReadonlySet<string>
): string {
  // Placeholders for unnamed Points avoid every name in this source unit and each
  // other, so following the advice never produces a duplicate or wrong reference.
  const taken = new Set(authoredNames);
  const placeholder = (base: string) => {
    let name = base;
    for (let index = 2; taken.has(name); index += 1) name = base + index;
    taken.add(name);
    return "@" + name;
  };
  const keep = "This grouping is transparent to attachment. Keep it deliberately or move the active content beside its target.";
  const target = targetName ? "@" + targetName : placeholder("target");
  const naming = targetName ? "" : " after naming the target";
  const note = " Choosing note instead excludes the whole subtree from the graph.";
  const annotation = block.annotation;
  const handle = annotation && "handle" in annotation && annotation.handle ? "; @" + annotation.handle : "";
  if (reason === "local-bearing-containment") {
    const sources = sourceNames.map(id => id ? "@" + id : placeholder("source"));
    const unnamed = !targetName || sourceNames.some(id => !id);
    const selector = annotation?.kind === "localBearing" && annotation.selector;
    return keep + ` To state it explicitly, write [_ ${sources.join(", ")} ${operatorSymbol(kind, selector ? "bearing" : "point") ?? kind} ${target}${handle}] in place of the local Bearing header` +
      `${unnamed ? selector ? " after naming every unnamed endpoint" : " after naming each placeholder Point" : ""}, move its neutral source occurrences with their subtrees before the constructor, outside enclosing Bearing contexts, and keep its other children, such as independent relations, notes and selector commentary, beneath the constructor.` + note;
  }
  if (!annotation || (annotation.kind !== "role" && annotation.kind !== "use")) return keep + note;
  if (reason === "local-attachment" && "selector" in annotation && annotation.selector) {
    const mark = annotation.kind === "use" ? `${annotation.role} use @${annotation.ref?.id}` : annotation.role + (annotation.anchor ? " @" + annotation.anchor : "");
    return keep + ` To state it explicitly, write [${mark} ${operatorSymbol(kind, "bearing")} ${target}${handle}]${targetName ? "" : " after naming the selected Bearing"}; the operator replaces the selector rather than adding a second Bearing.` + note;
  }
  const mark = annotation.role ?? ".";
  const source = annotation.kind === "use" ? `${mark} use @${annotation.ref?.id}` : mark + (annotation.anchor ? " @" + annotation.anchor : "");
  return keep + ` To state it explicitly, write [${source} ${operatorSymbol(kind) ?? kind} ${target}${handle}]${naming}; the clause replaces the default rather than adding a second Bearing.` + note;
}

function reuseSpelling(block: AstBlock, anchor: string): string {
  const annotation = block.annotation;
  // A selector survives reuse: [O/ use @p] still challenges the local attachment.
  const mark = annotation?.kind === "role" ? annotation.role + (annotation.selector ? "/" : "") : ".";
  const clause = annotation && "operatorClause" in annotation && annotation.operatorClause
    ? ` ${operatorSymbol(annotation.operatorClause.op, annotation.operatorClause.targetKind) ?? annotation.operatorClause.op} @${annotation.operatorClause.target.id}` : "";
  const handle = annotation && "handle" in annotation && annotation.handle ? "; @" + annotation.handle : "";
  return `[${mark} use @${anchor}${clause}${handle}]`;
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
  return block.annotation?.kind === "role" || block.annotation?.kind === "use" ? block.annotation.role : undefined;
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
  const { targetFocusKind: _focusKind, targetKind: _targetKind, ...canonicalFields } = bearing;
  const base = { ...canonicalFields, sources };
  if (requiresPointTarget(bearing.kind)) {
    if (bearing.target.kind !== "point") {
      throw new Error(`Compiler invariant violated: ${bearing.kind} target was not validated as a Point.`);
    }
    return { ...base, kind: bearing.kind, target: { key: bearing.target.key, kind: "point" } };
  }
  const target =
    bearing.target.kind === "point"
      ? { key: bearing.target.key, kind: "point" as const }
      : { key: bearing.target.key, kind: "bearing" as const };
  return { ...base, kind: bearing.kind, target };
}

function requiresPointTarget(
  kind: BearingKind
): kind is "answers" | "respondsTo" | "clarifies" {
  return kind === "answers" || kind === "respondsTo" || kind === "clarifies";
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
  if (ref.kind === "bearing") return symbols.bearingKeys.has(ref.key) ? "bearing" : "invalid";
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
  return {
    key: pointKeyForBlock(block, pointKeys),
    ...(pointAnchor(block) ? { id: pointAnchor(block) } : {}),
    text: block.text,
    sourceSpan: block.sourceSpan,
    declaration: pointDeclaration(block)
  };
}

function pointDeclaration(block: AstBlock): PointDeclaration {
  if (block.annotation?.kind === "role") {
    const annotation = block.annotation;
    return { form: "role", role: annotation.role };
  }
  return { form: "material" };
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

  walkBlocks(blocks, (block) => {
    if (block.annotation?.kind === "role" || block.annotation?.kind === "material") {
      pointKeys.set(block, `_p${nextId}`);
      nextId += 1;
    }
  });

  return pointKeys;
}

function walkBlocks(blocks: AstBlock[], visit: (block: AstBlock) => void): void {
  for (const block of blocks) {
    visit(block);
    if (block.annotation?.kind !== "note") walkBlocks(block.children, visit);
  }
}
