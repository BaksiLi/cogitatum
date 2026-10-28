import type {
  Annotation,
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
  SourceSpan,
  TargetTerm
} from "./types.js";
import { FORMAT_VERSION, isNamedTarget } from "./types.js";
import { clauseSpelling, expandedClause, respellTarget } from "./annotation.js";

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
  // Set for a positional target: the slot that supplied it.
  targetFocusKind?: "point" | "bearing";
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
      reason: "annotation-syntax-error" | "explicit-bearing-descendant-requires-target" | "bearing-use-requires-explicit-target" | "failed-context-requires-explicit-target" | "invalid-local-bearing" | "no-local-attachment" | "no-local-point";
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
  const memberContext = context?.kind === "bearing" && context.localBearingChildren ? context : undefined;
  const childFunction = memberContext?.localBearingChildren?.get(block);
  const membership = memberContext ? { localBearingSpan: memberContext.block.sourceSpan, eligible: childFunction === "source", function: childFunction ?? "unclassified" as const } : undefined;
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
  const compileChildren = (childContext: Context) => {
    for (const child of block.children) compileBlock(child, childContext, pointKeys, points, bearings, explainDrafts, diagnostics, block);
  };

  if (annotation.kind === "note") {
    if (annotation.targetKind) {
      draft.noteSelection = {
        targetKind: annotation.targetKind,
        ...(context ? { contextSpan: context.block.sourceSpan } : {}),
        crossedBodySpans: context?.crossedBodySpans ?? [],
        candidate: annotation.targetKind === "point" ? pointSlot(context) : context?.exposedBearing
      };
    }
    return;
  }

  if (annotation.kind === "invalid") {
    draft.bearing = { outcome: "rejected", reason: "annotation-syntax-error" };
    compileChildren({ kind: "point", block });
    return;
  }

  if (annotation.kind === "bearingUse") {
    const syntaxFailed = Boolean(annotation.syntaxErrors?.length);
    draft.focus = { kind: "bearing", operand: annotation.ref, ...(syntaxFailed ? { reason: "annotation-syntax-error" as const } : {}) };
    compileChildren({ kind: "bearing", block, exposedBearing: syntaxFailed ? undefined : annotation.ref });
    return;
  }

  if (annotation.kind === "bearing") {
    const { bearing: produced, memberFunctions } = compileBearingConstructor(block, context, draft, pointKeys, bearings, diagnostics);
    compileChildren({
      kind: "bearing",
      block,
      exposedBearing: produced ? { kind: "bearing", key: produced.key } : undefined,
      ...(annotation.members ? { localBearingChildren: memberFunctions ?? classifyMembers(block) } : {})
    });
    return;
  }

  // A Point declaration or use.
  if (annotation.kind === "use") {
    draft.focus = { kind: "point", operand: annotation.ref, ...(annotation.syntaxErrors?.includes("reference") ? { reason: "annotation-syntax-error" as const } : {}) };
  } else {
    const point = pointFromBlock(block, pointKeys);
    points.push(point);
    draft.point = { key: point.key, ...(point.id ? { id: point.id } : {}), reason: pointReasonForBlock(block) };
  }

  const relation = occurrenceRelation(annotation);
  const source = annotation.kind === "use" ? annotation.ref : pointRef(pointKeyForBlock(block, pointKeys));
  let produced: CandidateBearing | undefined;
  let diagnosedContext = false;
  if (annotation.syntaxErrors?.length) {
    draft.bearing = { outcome: "rejected", reason: "annotation-syntax-error" };
  } else if (isNamedTarget(relation.target)) {
    produced = addBearing(bearings, candidate(block, relation.kind!, [source!], relation.target, "operator"));
    draft.bearing = { outcome: "candidate", candidate: produced, reason: "operator-clause" };
  } else if (relation.target.local === "bearing") {
    const selected = resolveBearingSlot(context, draft);
    if (selected) {
      produced = addBearing(bearings, candidate(block, relation.kind!, [source!], selected, "structural", "bearing"));
      draft.bearing = { outcome: "candidate", candidate: produced, reason: "local-attachment" };
    } else {
      diagnostics.push({ severity: "error", code: "NO_LOCAL_BEARING_ATTACHMENT", message: noLocalBearingMessage(context, annotation, relation.kind!), sourceSpan: block.sourceSpan });
      draft.bearing = { outcome: "rejected", reason: "no-local-attachment" };
    }
  } else {
    const slot = resolvePointSlot(context);
    if ("target" in slot) {
      if (relation.kind) {
        produced = addBearing(bearings, candidate(block, relation.kind, [source!], slot.target, "structural", "point"));
        draft.bearing = { outcome: "candidate", candidate: produced, reason: "annotated-containment" };
      } else {
        draft.bearing = { outcome: "skipped", reason: "no-structural-rule" };
      }
    } else {
      const outcome = POINT_SLOT_OUTCOMES[slot.failure][relation.by];
      if (outcome.outcome === "rejected") {
        diagnosedContext = outcome.reason === "explicit-bearing-descendant-requires-target";
        diagnostics.push({ severity: "error", code: outcome.code, message: outcome.message, sourceSpan: block.sourceSpan });
        draft.bearing = { outcome: "rejected", reason: outcome.reason };
      } else {
        draft.bearing = outcome;
      }
    }
  }

  if (annotation.handle && !produced && !annotation.syntaxErrors?.length && !diagnosedContext) {
    diagnostics.push({
      severity: "error",
      code: "BEARING_HANDLE_WITHOUT_BEARING",
      message: `Bearing handle @${annotation.handle} appears on an annotation that produces no Bearing. Resolve any layout or constructor errors first, then check that this annotation defines a Bearing before naming it.`,
      sourceSpan: block.sourceSpan
    });
  }
  if (produced?.derivedBy === "structural" && context) {
    draft.implicit = { contextSpan: context.block.sourceSpan, crossedBodySpans: context.crossedBodySpans ?? [] };
  }
  compileChildren({
    kind: "point",
    block,
    focus: annotation.kind === "use" ? annotation.syntaxErrors?.includes("reference") ? undefined : annotation.ref : pointRef(pointKeyForBlock(block, pointKeys)),
    exposedBearing: produced ? { kind: "bearing", key: produced.key } : undefined
  });
}

// A mark without a relation (C, .) still occupies ^: its context decides
// whether that is merely no relation or a diagnosed misplacement.
type OccurrenceRelation = { kind?: BearingKind; target: TargetTerm; by: "mark" | "clause" };

function occurrenceRelation(annotation: Extract<Annotation, { kind: "role" | "material" | "use" }>): OccurrenceRelation {
  const clause = expandedClause(annotation);
  return { kind: clause?.op, target: clause?.target ?? { local: "point" }, by: annotation.operatorClause ? "clause" : "mark" };
}

/** Why the nearest context has no Point slot. */
type PointSlotFailure =
  | "no-context"            // document root
  | "failed-context"        // a Point context whose own occurrence failed
  | "bearing-use"           // [_ use @route]
  | "reference-constructor" // [_ @a +> @b], including a failed clause
  | "member-constructor"    // [_ +> ^], whose direct children are its sources
  | "unselected-constructor"; // a Bearing header whose first token selected no mode

function pointSlot(context: Context): PointRef | Ref | undefined {
  return context?.kind === "point" ? context.focus : undefined;
}

function resolvePointSlot(context: Context): { target: PointRef | Ref } | { failure: PointSlotFailure } {
  if (!context) return { failure: "no-context" };
  if (context.kind === "point") return context.focus ? { target: context.focus } : { failure: "failed-context" };
  const annotation = context.block.annotation;
  if (annotation?.kind !== "bearing") return { failure: "bearing-use" };
  if (annotation.members) return { failure: "member-constructor" };
  return { failure: annotation.syntaxErrors?.includes("mode") ? "unselected-constructor" : "reference-constructor" };
}

function resolveBearingSlot(context: Context, draft: ExplainDraft): BearingRef | Ref | undefined {
  const selected = context?.exposedBearing;
  draft.selection = {
    ...(context?.block.annotation?.kind === "bearingUse" ? { contextSpan: context.block.sourceSpan } : context ? { ownerSpan: context.block.sourceSpan } : {}),
    ...(selected ? { target: { ...selected } } : {})
  };
  return selected;
}

type SlotOutcome =
  | { outcome: "rejected"; reason: Extract<BearingDraft, { outcome: "rejected" }>["reason"]; code: string; message: string }
  | Extract<BearingDraft, { outcome: "skipped" }>;

const NO_LOCAL_POINT: SlotOutcome = {
  outcome: "rejected", reason: "no-local-point", code: "NO_LOCAL_POINT_TARGET",
  message: "The nearest context exposes no Point for ^. Place this occurrence beneath a Point declaration or use, or name its target."
};
const EXPLICIT_DESCENDANT: SlotOutcome = {
  outcome: "rejected", reason: "explicit-bearing-descendant-requires-target", code: "EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET",
  message: "The first Point beneath an explicit Bearing constructor, including a neutral declaration or use, needs a target: ^/ for the constructed Bearing, or a name. Only a constructor without listed sources takes direct neutral source members; place an unconnected Point outside this Bearing context."
};
const BEARING_USE: SlotOutcome = {
  outcome: "rejected", reason: "bearing-use-requires-explicit-target", code: "BEARING_USE_REQUIRES_EXPLICIT_TARGET",
  message: "Bearing use exposes no Point target; the first Point, including a neutral declaration or use, needs ^/ or a named target. Place an unconnected Point outside this Bearing context."
};
const FAILED_CONTEXT: SlotOutcome = {
  outcome: "rejected", reason: "failed-context-requires-explicit-target", code: "FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET",
  message: "This Point is beneath a failed constructor, so no implicit attachment to an outer Point is derived. Fix any layout or annotation errors in the enclosing constructor first; use a named target only if this Point is intended to attach independently."
};

// A missing Point slot is diagnosed by its context. Nesting alone places an
// occurrence beneath ^, so even a mark without a default relation is checked;
// an explicit ^ is additionally an error where nesting is merely inert.
const POINT_SLOT_OUTCOMES: Record<PointSlotFailure, Record<OccurrenceRelation["by"], SlotOutcome>> = {
  "no-context": { mark: { outcome: "skipped", reason: "no-eligible-ancestor" }, clause: NO_LOCAL_POINT },
  "failed-context": { mark: FAILED_CONTEXT, clause: FAILED_CONTEXT },
  "bearing-use": { mark: BEARING_USE, clause: BEARING_USE },
  "reference-constructor": { mark: EXPLICIT_DESCENDANT, clause: EXPLICIT_DESCENDANT },
  // The constructor classifies its direct children and diagnoses invalid members,
  // whether a mark abbreviates the relation to ^ or a clause spells it.
  "member-constructor": { mark: { outcome: "skipped", reason: "local-bearing-membership" }, clause: { outcome: "skipped", reason: "local-bearing-membership" } },
  // The header's own diagnostic suffices; its descendants cannot attach outward.
  "unselected-constructor": { mark: { outcome: "skipped", reason: "no-structural-rule" }, clause: NO_LOCAL_POINT }
};

// A constructor header that needs ^ reports the missing slot in its own terms.
const CONSTRUCTOR_POINT_SLOT_CODES: Record<PointSlotFailure, [string, string]> = {
  "no-context": ["LOCAL_BEARING_REQUIRES_POINT_TARGET", "^ requires a nearest enclosing Point target."],
  "failed-context": ["LOCAL_BEARING_REQUIRES_POINT_TARGET", "^ requires a nearest enclosing Point target; the enclosing occurrence failed."],
  "bearing-use": ["LOCAL_BEARING_REQUIRES_POINT_TARGET", "^ requires a nearest enclosing Point target; a Bearing use exposes only ^/."],
  "reference-constructor": ["EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET", "A Bearing constructor beneath an explicit Bearing cannot target ^; use ^/ or a name."],
  "member-constructor": ["NESTED_LOCAL_BEARING_UNSUPPORTED", "A Bearing constructor directly beneath another member-sourced constructor has no Point for ^; use ^/ to address that Bearing, or add an intervening Point."],
  "unselected-constructor": ["LOCAL_BEARING_REQUIRES_POINT_TARGET", "^ requires a nearest enclosing Point target; the enclosing header selected no mode."]
};

function addBearing(bearings: CandidateBearing[], bearing: CandidateBearing): CandidateBearing {
  bearing.key = `_b${bearings.length + 1}`;
  bearings.push(bearing);
  return bearing;
}

// Member functions are compiler context for the children, never part of the Bearing.
type ConstructedBearing = { bearing?: CandidateBearing; memberFunctions?: ReadonlyMap<AstBlock, LocalBearingChildFunction> };

function compileBearingConstructor(
  block: AstBlock,
  context: Context,
  draft: ExplainDraft,
  pointKeys: WeakMap<AstBlock, string>,
  bearings: CandidateBearing[],
  diagnostics: Diagnostic[]
): ConstructedBearing {
  const annotation = block.annotation;
  if (annotation?.kind !== "bearing") throw new Error("Compiler invariant violated: expected a Bearing constructor.");
  const headerValid = !annotation.syntaxErrors?.length;
  let valid = headerValid;
  const reject = (code: string, message: string, location = block) => {
    diagnostics.push({ severity: "error", code, message, sourceSpan: location.sourceSpan });
    valid = false;
  };
  const clause = expandedClause(annotation);
  if (!clause) {
    if (!annotation.members && !annotation.syntaxErrors?.length) {
      const at = block.sourceSpan.startLine + ":" + block.sourceSpan.startColumn;
      throw new Error(`Invalid AST: the Bearing constructor at ${at} has listed sources but no operatorClause and records no syntax error; validate imported AST JSON against the AST schema before compiling.`);
    }
    // A failed member-sourced header rejects the joint as an invalid local Bearing, as an invalid member does.
    draft.bearing = { outcome: "rejected", reason: annotation.members ? "invalid-local-bearing" : "annotation-syntax-error" };
    return {};
  }

  let target: BearingTarget | Ref | undefined;
  let targetFocusKind: "point" | "bearing" | undefined;
  if (isNamedTarget(clause.target)) {
    target = { id: clause.target.id };
  } else if (clause.target.local === "bearing") {
    target = resolveBearingSlot(context, draft);
    targetFocusKind = "bearing";
    if (!target) reject("NO_LOCAL_BEARING_ATTACHMENT", noLocalBearingMessage(context, annotation, clause.op));
  } else {
    const slot = resolvePointSlot(context);
    targetFocusKind = "point";
    if ("target" in slot) target = slot.target;
    else reject(...CONSTRUCTOR_POINT_SLOT_CODES[slot.failure]);
  }

  let sources: (PointRef | Ref)[];
  let memberFunctions: ReadonlyMap<AstBlock, LocalBearingChildFunction> | undefined;
  if (clause.sources === "members") {
    memberFunctions = classifyAndDiagnoseMembers(block, headerValid, reject);
    sources = block.children.filter(child => memberFunctions!.get(child) === "source")
      .map(child => child.annotation?.kind === "use" ? { ...child.annotation.ref! } : pointRef(pointKeyForBlock(child, pointKeys)));
  } else {
    sources = (clause.sources as Ref[]).map(ref => ({ id: ref.id }));
  }

  const reason = clause.sources === "members" ? "local-bearing-containment" as const
    : isNamedTarget(clause.target) ? "operator-clause" as const
    : clause.target.local === "bearing" ? "local-attachment" as const : "annotated-containment" as const;
  if (!valid || !target) {
    draft.bearing = { outcome: "rejected", reason: clause.sources === "members" ? "invalid-local-bearing" : reason === "local-attachment" ? "no-local-attachment" : "no-local-point" };
    return { memberFunctions };
  }
  const bearing = addBearing(bearings, candidate(block, clause.op, sources, target, targetFocusKind ? "structural" : "operator", targetFocusKind));
  draft.bearing = { outcome: "candidate", candidate: bearing, reason };
  if (targetFocusKind && context) draft.implicit = { contextSpan: context.block.sourceSpan, crossedBodySpans: context.crossedBodySpans ?? [] };
  return { bearing, memberFunctions };
}

function classifyMembers(block: AstBlock): ReadonlyMap<AstBlock, LocalBearingChildFunction> {
  return new Map(block.children.map(child => [child, classifyLocalBearingChild(child)]));
}

// A notes-only or empty constructor fails; any invalid member rejects the
// whole joint rather than shrinking its source set.
function classifyAndDiagnoseMembers(
  block: AstBlock,
  headerValid: boolean,
  reject: (code: string, message: string, location?: AstBlock) => void
): ReadonlyMap<AstBlock, LocalBearingChildFunction> {
  const functions = classifyMembers(block);
  if (!headerValid) return functions;
  if (![...functions.values()].some(f => f === "source") && ![...functions.values()].includes("unclassified")) {
    reject("EMPTY_LOCAL_BEARING", "A Bearing constructor without listed sources requires at least one direct neutral Point source, not only commentary or notes.");
  }
  for (const child of block.children) {
    if (functions.get(child) === "unclassified") reject("INVALID_LOCAL_BEARING_MEMBER", localBearingMemberDiagnosticMessage(child, block), child);
  }
  return functions;
}

function candidate(
  block: AstBlock,
  kind: BearingKind,
  sources: (PointRef | Ref)[],
  target: BearingTarget | Ref,
  derivedBy: BearingDerivedBy,
  targetFocusKind?: "point" | "bearing"
): CandidateBearing {
  const handle = block.annotation && "handle" in block.annotation ? block.annotation.handle : undefined;
  return {
    key: "",
    ...(handle ? { handle } : {}),
    kind,
    sources: sources.map(source => ({ ...source })),
    target: { ...target },
    derivedBy,
    ...(targetFocusKind ? { targetFocusKind } : {}),
    sourceSpan: block.sourceSpan
  };
}

function classifyLocalBearingChild(block: AstBlock): LocalBearingChildFunction {
  const annotation = block.annotation;
  if (!annotation) return "unclassified";
  if (annotation.kind === "note") return annotation.syntaxErrors?.length ? "unclassified" : "supplementary";
  if (annotation.kind === "bearingUse") return "independent";
  // Anything addressing ^/ comments on the joint being constructed. A failed
  // selector keeps that intent, so it can never become a source instead.
  const target = expandedClause(annotation)?.target;
  if (("selector" in annotation && annotation.selector) || target?.local === "bearing") return "commentary";
  if (annotation.kind === "invalid") return "unclassified";
  // A member-sourced constructor cannot nest directly; a failed header of
  // either mode is diagnosed once, at its own cause, and never joins this one.
  if (annotation.kind === "bearing") return annotation.members && !annotation.syntaxErrors?.length ? "unclassified" : "independent";
  // Only a named target leaves the joint. A relation to ^ is the same whether
  // a mark abbreviates it or a clause spells it: there is no Point for it here.
  if (target && isNamedTarget(target)) return "independent";
  return (annotation.kind === "material" || (annotation.kind === "use" && !annotation.role)) && !target && !annotation.handle && !annotation.syntaxErrors?.length ? "source" : "unclassified";
}

function localBearingMemberDiagnosticMessage(block: AstBlock, constructor: AstBlock): string {
  const annotation = block.annotation;
  const clause = expandedClause(annotation);
  const towardPoint = clause?.target.local === "point";
  if ((annotation?.kind === "role" || annotation?.kind === "use") && (annotation.role === "R" || annotation.role === "D" || annotation.role === "Q") && towardPoint) {
    const relation = annotation.role === "R" ? "respond to" : annotation.role === "D" ? "clarify" : "concern";
    return `A Bearing constructor creates no Point, so a direct ${annotation.role} has no Point to ${relation}. ` +
      `Place it beneath the Point it addresses${annotation.role === "R" ? "" : `, write [${annotation.role}/] to address this Bearing`}, or give it a named target.` +
      (annotation.role === "R" ? questionPointHint(constructor) : "");
  }
  if ((annotation?.kind === "role" || annotation?.kind === "use")
      && (annotation.role === "G" || annotation.role === "O")
      && towardPoint && !annotation.handle && (annotation.kind !== "use" || annotation.ref)) {
    const operand = annotation.kind === "use" ? ` use @${annotation.ref!.id}` : annotation.anchor ? ` @${annotation.anchor}` : "";
    const action = annotation.role === "G" ? "support" : "challenge";
    return `A direct ${annotation.role}-marked Point is not a joint source. ` +
      `Use [.${operand}] for a joint source, [${annotation.role}/${operand}] to ${action} this Bearing, ` +
      "or a named target for an independent relation. These are different authoring choices; no default attachment is created here.";
  }
  return "Direct children of a Bearing constructor without listed sources must be neutral Point sources, ^/ commentary, complete independent clauses or valid notes.";
}

// A joint concerns header asks nothing that can be answered: only a Question
// Point can receive a response, so name the Q occurrence with the same target.
function questionPointHint(constructor: AstBlock): string {
  const clause = expandedClause(constructor.annotation);
  if (clause?.op !== "concerns" || isNamedTarget(clause.target)) return "";
  return ` For a Question Point that concerns ${clause.target.local === "bearing" ? "this step" : "this Point"} and can receive responses, write [${clause.target.local === "bearing" ? "Q/" : "Q"}] instead of the constructor.`;
}

// ^/ needs a step to bear on. Beneath a Point without an attachment, name the
// same header retargeted to that Point rather than a step that is not there.
function noLocalBearingMessage(context: Context, annotation: Annotation, kind: BearingKind): string {
  if (context?.kind === "point" && context.focus) {
    const action = kind === "supports" ? "support" : kind === "challenges" ? "challenge" : kind === "clarifies" ? "clarify" : "concern";
    return `The nearest enclosing Point has no attachment, so ^/ has no step to ${action}. ` +
      `To ${action} the Point itself, write [${respellTarget(annotation, { local: "point" })}]; to address another step, name that Bearing explicitly.`;
  }
  return "The nearest local context exposes no Bearing for ^/; use a named target instead.";
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
  if (annotation.kind === "bearing") return { kind: "bearing", members: annotation.members, ...(annotation.selector ? { selector: annotation.selector } : {}) };
  return { kind: annotation.kind };
}

function pointReasonForBlock(block: AstBlock): PointDraft["reason"] {
  if (block.annotation?.kind === "role") {
    return "role-annotation";
  }
  return "material-annotation";
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
      draft.recognition.kind === "bearing" && draft.block.text) {
      const bearing = byKey.get(draft.bearing.candidate.key);
      if (bearing) {
        draft.note = { origin: "constructor-description", target: { kind: "bearing", key: bearing.key }, sourceSpan: draft.block.sourceSpan };
        bearing.text = draft.block.text;
      }
    }
  }
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
            explanation: implicitAttachmentAdvice(draft.block, target.kind, name || undefined, authoredNames),
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

// Advice names an existing spelling that states the same relation explicitly:
// the same header with its positional target named. Only the target is
// positional, so naming it is the whole edit: sources and members stay put,
// and the named target replaces the positional one instead of adding a Bearing.
function implicitAttachmentAdvice(
  block: AstBlock,
  targetKind: "point" | "bearing",
  targetName: string | undefined,
  authoredNames: ReadonlySet<string>
): string {
  const keep = "This grouping is transparent to attachment. Keep it deliberately or move the active content beside its target.";
  const note = " Choosing note instead excludes the whole subtree from the graph.";
  const annotation = block.annotation;
  if (!annotation || !expandedClause(annotation)) return keep + note;
  // A placeholder for an unnamed target avoids every name in this source unit,
  // so following the advice never produces a duplicate or wrong reference.
  let name = targetName ?? "target";
  for (let index = 2; !targetName && authoredNames.has(name); index += 1) name = "target" + index;
  const after = targetName ? "" : targetKind === "bearing" ? " after naming the selected Bearing" : " after naming the target";
  const kept = annotation.kind === "bearing" ? "its sources stay where they are" : "the named target replaces the positional one rather than adding a second Bearing";
  return keep + ` To state it explicitly, write [${respellTarget(annotation, { id: name })}]${after}; ${kept}.` + note;
}

function reuseSpelling(block: AstBlock, anchor: string): string {
  const annotation = block.annotation;
  // A selector survives reuse: [O/ use @p] still challenges the local attachment.
  const mark = annotation?.kind === "role" ? annotation.role + (annotation.selector ? "/" : "") : ".";
  const clause = annotation && "operatorClause" in annotation && annotation.operatorClause
    ? " " + clauseSpelling(annotation.operatorClause) : "";
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
  const { targetFocusKind: _focusKind, ...canonicalFields } = bearing;
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

// Dialogical relations address a Point; evaluative and interpretive ones may
// also address a Bearing.
function requiresPointTarget(
  kind: BearingKind
): kind is "answers" | "respondsTo" {
  return kind === "answers" || kind === "respondsTo";
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
