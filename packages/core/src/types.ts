export const FORMAT_VERSION = "0.6.0";

export type Role = "Q" | "C" | "G" | "O" | "R" | "D";
export type BearingOp = "supports" | "challenges" | "concerns";
export type BearingKind = BearingOp | "respondsTo" | "clarifies" | "answers";
export type BearingDerivedBy = "operator" | "structural";
export type Severity = "error" | "warning" | "suggestion";
export type AnnotationSyntaxError = "operator" | "handle" | "localBearing" | "mode" | "selector" | "reference" | "retired" | "note";
export type LocalBearingChildFunction = "source" | "commentary" | "independent" | "supplementary" | "unclassified";
export type LocalBearingRole = "G" | "O" | "R" | "D";
export type LocalBearingMark =
  | { role?: LocalBearingRole; selector?: never }
  | { role: "G" | "O" | "Q"; selector: "attachment" };
export type SourceParseMode = "document" | "host";
export type SourceUnitKind = "document" | "fence";

export type SourceSpan = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type Ref = {
  id: string;
};

export type PointRef = {
  key: string;
  kind: "point";
};

export type BearingRef = {
  key: string;
  kind: "bearing";
};

// Authored target requirements stay correlated with the canonical kind.
export type OperatorClause = {
  sources: Ref[] | "self";
  target: Ref;
} & (
  | { op: "supports" | "concerns"; targetKind: "either" }
  | { op: "challenges"; targetKind: "bearing" | "either" }
  | { op: "answers" | "respondsTo" | "clarifies"; targetKind: "point" }
);

// A Point declaration or use is the sole source of its explicit clause.
export type PointOperatorClause = OperatorClause & { sources: "self" };

type AnnotationBase<ErrorKind extends AnnotationSyntaxError = "operator" | "handle" | "selector" | "retired"> = {
  syntaxErrors?: ErrorKind[];
  handle?: string;
  raw: string;
};

type RoleMark =
  | { role: "G" | "O" | "Q"; status?: never; selector: "attachment"; operatorClause?: never }
  | { role: Role; status?: never; selector?: never };

// A reused Point has its own local role; G/, O/ and Q/ select an attachment.
// AST and Explain must retain the same role/selector correlation.
type PointUseMark =
  | { role?: Role; selector?: never }
  | { role: "G" | "O" | "Q"; selector: "attachment"; operatorClause?: never };

type PointAnnotationBase = AnnotationBase & {
  anchor?: string;
  operatorClause?: PointOperatorClause;
};

export type Annotation =
  | { kind: "note"; targetKind?: "point" | "bearing"; raw: string; syntaxErrors?: "note"[] }
  | { kind: "invalid"; raw: string; selector?: "attachment" }
  | { kind: "bearingUse"; ref?: Ref; raw: string; syntaxErrors?: "reference"[] }
  | (AnnotationBase<"reference" | "operator" | "selector" | "handle" | "retired"> & {
      kind: "use";
      ref?: Ref;
      operatorClause?: PointOperatorClause;
    } & PointUseMark)
  | (PointAnnotationBase & RoleMark & { kind: "role" })
  | (PointAnnotationBase & { kind: "material" })
  // Local Bearing construction: sources are children and the target is local.
  | (AnnotationBase<"localBearing" | "handle"> & { kind: "localBearing" } & LocalBearingMark)
  // "mode" records a Bearing-family header whose first token selects no mode.
  | (AnnotationBase<"operator" | "handle" | "selector" | "retired" | "mode"> & {
      kind: "explicitBearing";
      operatorClause?: OperatorClause & { sources: Ref[] };
    });

export type AstBlock = {
  kind: "block";
  /** Header prose and contiguous indented continuations, joined with LF. */
  text: string;
  /** This block's physical lines, including its bullet, excluding child blocks. */
  raw: string;
  children: AstBlock[];
  /** From header content through the last continuation, excluding children. */
  sourceSpan: SourceSpan;
  // Annotation is the only semantic representation; raw is retained source text.
  annotation?: Annotation;
};

export type DocumentAst = {
  version: string;
  blocks: AstBlock[];
  diagnostics: Diagnostic[];
};

export type ParseOptions = {
  /** Lines preceding this source; nonnegative safe integer, default zero. */
  lineOffset?: number;
  /** UTF-16 columns removed from each line; nonnegative safe integers, missing entries default to zero. */
  lineColumnOffsets?: number[];
};

export type CogitatumSourceUnit = {
  kind: SourceUnitKind;
  source: string;
  startLine: number;
  endLine: number;
  fenceInfo?: "cog" | "cogitatum";
};

export type ParsedSource = {
  version: string;
  mode: SourceParseMode;
  units: CogitatumSourceUnit[];
  documents: DocumentAst[];
  diagnostics: Diagnostic[];
};

export type CompiledSource = ParsedSource & {
  graphs: GraphIR[];
};

// How the Point was introduced: its declaration mark, not a role every later use must take.
export type PointDeclaration =
  | { form: "role"; role: Role; status?: never }
  | { form: "material"; role?: never; status?: never };

export type Point = {
  key: string;
  id?: string;
  // Shared content shown at every occurrence.
  text: string;
  // Canonical declaration location; use occurrences are located through Explain.
  sourceSpan?: SourceSpan;
  declaration: PointDeclaration;
};

export type BearingTarget = PointRef | BearingRef;

type BearingBase = {
  key: string;
  handle?: string;
  sources: PointRef[];
  /** Derived only from this Bearing's constructor description, never object notes. */
  text?: string;
  derivedBy: BearingDerivedBy;
  sourceSpan?: SourceSpan;
};

type BearingRelation =
  | { kind: "answers" | "respondsTo" | "clarifies"; target: PointRef }
  | { kind: "supports" | "challenges" | "concerns"; target: BearingTarget };

export type Bearing = BearingBase & BearingRelation;

export type Diagnostic = {
  severity: Severity;
  code: string;
  message: string;
  explanation?: string;
  sourceSpan?: SourceSpan;
};

/** One authored occurrence, identified within this source unit by sourceSpan.
 * The AST at that span owns the text (and, for a note, its literal subtree).
 * Graph-only exports preserve the link, not that prose. Equal text is not identity.
 */
export type ObjectNote = {
  sourceSpan: SourceSpan;
} & (
  | { origin: "note"; target: BearingTarget }
  | { origin: "constructor-description"; target: BearingRef }
);

export type GraphIR = {
  version: string;
  points: Point[];
  bearings: Bearing[];
  notes: ObjectNote[];
  diagnostics: Diagnostic[];
};

export type ExplainRecognition =
  | { kind: "note"; targetKind?: "point" | "bearing" }
  | { kind: "body" }
  | { kind: "invalid"; selector?: "attachment" }
  | ({ kind: "role" } & RoleMark)
  | { kind: "material" }
  | { kind: "explicitBearing" }
  | ({ kind: "localBearing" } & LocalBearingMark)
  | { kind: "bearingUse"; ref?: Ref }
  | ({ kind: "use"; ref?: Ref } & PointUseMark);

export type ExplainBearingRef = {
  kind: "bearing";
  key: string;
  graphIndex: number;
  handle?: string;
};

// Unresolved authored references occur only in rejected Bearing summaries.
export type ExplainReference = BearingTarget | Ref;

export type ExplainBearingSummary = {
  key: string;
  handle?: string;
  kind: BearingKind;
  sources: (PointRef | Ref)[];
  target: ExplainReference;
  derivedBy: BearingDerivedBy;
};

export type ExplainEmittedBearingSummary = Omit<BearingBase, "text" | "sourceSpan"> & BearingRelation;

export type ExplainEffect =
  | { kind: "preserveNote"; parentSpan?: SourceSpan }
  | { kind: "attachNote"; note: ObjectNote }
  | ({
      kind: "selectNoteTarget";
      contextSpan?: SourceSpan;
      crossedBodySpans: SourceSpan[];
    } & (
      | { targetKind: "point"; target?: PointRef }
      | { targetKind: "bearing"; target?: BearingRef }
    ))
  // Successful structural selection, even with no intervening body. Not emitted for rejected Bearings.
  | { kind: "implicitAttachment"; target: BearingTarget; targetSpan?: SourceSpan; contextSpan: SourceSpan; crossedBodySpans: SourceSpan[] }
  | { kind: "localBearingMember"; localBearingSpan: SourceSpan; eligible: boolean; function: LocalBearingChildFunction }
  | { kind: "focusPoint"; ref: PointRef; operand: Ref }
  | { kind: "focusBearing"; ref: BearingRef; operand: Ref }
  | { kind: "rejectFocus"; operand?: Ref; reason: "reference-error" | "annotation-syntax-error" }
  | { kind: "selectAttachment"; ownerSpan?: SourceSpan; target?: BearingRef }
  | { kind: "selectBearing"; contextSpan: SourceSpan; target?: BearingRef }
  | { kind: "preserveBody" }
  | {
      kind: "emitPoint";
      ref: PointRef;
      id?: string;
      reason: "role-annotation" | "material-annotation";
    }
  | { kind: "rejectPoint"; ref: PointRef; id?: string; reason: "duplicate-anchor" }
  | {
      kind: "emitBearing";
      ref: ExplainBearingRef;
      bearing: ExplainEmittedBearingSummary;
      reason: "operator-clause" | "annotated-containment" | "local-bearing-containment" | "local-attachment";
    }
  | {
      kind: "rejectBearing";
      bearing?: ExplainBearingSummary;
      reason:
        | "annotation-syntax-error"
        | "explicit-bearing-descendant-requires-target"
        | "bearing-use-requires-explicit-target"
        | "failed-context-requires-explicit-target"
        | "no-local-attachment"
        | "validation-error"
        | "invalid-local-bearing";
    }
  | {
      kind: "skipBearing";
      reason: "no-eligible-ancestor" | "no-structural-rule" | "local-bearing-membership";
    };

export type ExplainEntry = {
  sourceSpan: SourceSpan;
  recognition: ExplainRecognition;
  effects: ExplainEffect[];
  diagnosticCodes: string[];
};

export type ExplainProjection = {
  version: string;
  entries: ExplainEntry[];
  diagnostics: Diagnostic[];
};

export type GraphCompilation = {
  graph: GraphIR;
  explain: ExplainProjection;
};

export type ExplainedSource = CompiledSource & {
  explanations: ExplainProjection[];
};

export type ParsedLine = {
  lineNumber: number;
  indent: number;
  text: string;
  contentColumn: number;
};
