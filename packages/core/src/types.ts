export const FORMAT_VERSION = "0.5.0";

export type Role = "Q" | "C" | "G" | "O" | "R" | "D";
export type BearingOp = "supports" | "challenges" | "about";
export type BearingKind = BearingOp | "repliesTo" | "clarifies" | "answers";
export type BearingDerivedBy = "operator" | "structural";
export type Severity = "error" | "warning" | "suggestion";
export type AnnotationSyntaxError = "operator" | "handle" | "linked" | "selector" | "reference" | "retired" | "note";
export type LinkedChildFunction = "source" | "commentary" | "independent" | "supplementary" | "unclassified";
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

export type OperatorClause = {
  op: BearingKind;
  // Authored target requirement, retained independently of the canonical kind.
  targetKind: "point" | "bearing" | "either";
  sources: Ref[] | "self";
  target: Ref;
};

type AnnotationBase<ErrorKind extends AnnotationSyntaxError = "operator" | "handle" | "selector" | "retired"> = {
  syntaxErrors?: ErrorKind[];
  handle?: string;
  raw: string;
};

type RoleMark =
  | { role: "G" | "O"; status?: never; selector: "attachment"; operatorClause?: never }
  | { role: Role; status?: never; selector?: never };

type PointAnnotationBase = AnnotationBase & {
  anchor?: string;
  operatorClause?: OperatorClause & { op: BearingOp; sources: "self" };
};

export type Annotation =
  | { kind: "note"; raw: string; syntaxErrors?: "note"[] }
  | { kind: "invalid"; raw: string; selector?: "attachment" }
  | { kind: "bearingUse"; ref?: Ref; raw: string; syntaxErrors?: "reference"[] }
  | (AnnotationBase<"reference" | "operator" | "selector" | "handle" | "retired"> & {
      kind: "use";
      ref?: Ref;
      operatorClause?: OperatorClause & { op: BearingOp; sources: "self" };
    } & (
      | { role?: Role; selector?: never }
      | { role: "G" | "O"; selector: "attachment"; operatorClause?: never }
    ))
  | (PointAnnotationBase & RoleMark & { kind: "role" })
  | (PointAnnotationBase & { kind: "gap"; status: "open" })
  | (PointAnnotationBase & { kind: "material" })
  | (AnnotationBase<"linked" | "handle"> & { kind: "linked" })
  | (AnnotationBase & {
      kind: "edge";
      operatorClause?: OperatorClause & { sources: Ref[] };
    });

export type AstBlock = {
  kind: "block";
  text: string;
  raw: string;
  children: AstBlock[];
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
  lineOffset?: number;
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
  | { form: "gap"; role?: never; status: "open" }
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
  text?: string;
  derivedBy: BearingDerivedBy;
  sourceSpan?: SourceSpan;
};

type BearingRelation =
  | { kind: "answers" | "repliesTo" | "clarifies"; target: PointRef }
  | { kind: "supports" | "challenges" | "about"; target: BearingTarget };

export type Bearing = BearingBase & BearingRelation;

export type Diagnostic = {
  severity: Severity;
  code: string;
  message: string;
  explanation?: string;
  sourceSpan?: SourceSpan;
};

export type GraphIR = {
  version: string;
  points: Point[];
  bearings: Bearing[];
  diagnostics: Diagnostic[];
};

export type ExplainRecognition =
  | { kind: "note" }
  | { kind: "body" }
  | { kind: "invalid"; selector?: "attachment" }
  | ({ kind: "role" } & RoleMark)
  | { kind: "gap"; status: "open" }
  | { kind: "material" }
  | { kind: "edge" }
  | { kind: "linked" }
  | { kind: "bearingUse"; ref?: Ref }
  | { kind: "use"; ref?: Ref; role?: Role; selector?: "attachment" };

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
  | { kind: "implicitAttachment"; target: BearingTarget; targetSpan?: SourceSpan; contextSpan: SourceSpan; crossedBodySpans: SourceSpan[] }
  | { kind: "linkedMember"; linkedSpan: SourceSpan; eligible: boolean; function: LinkedChildFunction }
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
      reason: "role-annotation" | "gap-annotation" | "material-annotation";
    }
  | { kind: "rejectPoint"; ref: PointRef; id?: string; reason: "duplicate-anchor" }
  | {
      kind: "emitBearing";
      ref: ExplainBearingRef;
      bearing: ExplainEmittedBearingSummary;
      reason: "operator-clause" | "annotated-containment" | "linked-containment" | "local-attachment";
    }
  | {
      kind: "rejectBearing";
      bearing?: ExplainBearingSummary;
      reason:
        | "annotation-syntax-error"
        | "edge-descendant-requires-explicit-target"
        | "bearing-use-requires-explicit-target"
        | "failed-context-requires-explicit-target"
        | "no-local-attachment"
        | "validation-error"
        | "invalid-linked";
    }
  | {
      kind: "skipBearing";
      reason: "no-eligible-ancestor" | "no-structural-rule" | "linked-membership";
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
