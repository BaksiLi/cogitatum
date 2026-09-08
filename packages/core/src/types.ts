export const FORMAT_VERSION = "0.3.0";

export type Role = "Q" | "C" | "G" | "O" | "R" | "D";
export type BearingOp = "supports" | "challenges" | "undercuts" | "about";
export type BearingKind = BearingOp | "repliesTo" | "clarifies" | "answers";
export type BearingDerivedBy = "operator" | "structural";
export type Severity = "error" | "warning" | "suggestion";
export type AnnotationSyntaxError = "operator" | "handle";
export type SourceParseMode = "document" | "host" | "auto";
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
  op: BearingOp;
  sources: Ref[] | "self";
  target: Ref;
};

type AnnotationBase = {
  syntaxErrors?: AnnotationSyntaxError[];
  handle?: string;
  raw: string;
};

type RoleMark =
  | { role: "C"; status?: "open" }
  | { role: Exclude<Role, "C">; status?: never };

type PointAnnotationBase = AnnotationBase & {
  anchor?: string;
  operatorClause?: OperatorClause & { sources: "self" };
};

export type Annotation =
  | (PointAnnotationBase & RoleMark & { kind: "role" })
  | (PointAnnotationBase & { kind: "gap"; status: "open" })
  | (PointAnnotationBase & { kind: "anchor"; anchor: string })
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
  mode: Exclude<SourceParseMode, "auto">;
  units: CogitatumSourceUnit[];
  documents: DocumentAst[];
  diagnostics: Diagnostic[];
};

export type CompiledSource = ParsedSource & {
  graphs: GraphIR[];
};

type PointBase = {
  key: string;
  id?: string;
  text: string;
  sourceSpan?: SourceSpan;
};

export type Point =
  | (PointBase & { form: "role"; role: "C"; status?: "open" })
  | (PointBase & { form: "role"; role: Exclude<Role, "C">; status?: never })
  | (PointBase & { form: "gap"; role?: never; status: "open" })
  | (PointBase & { form: "material"; role?: never; status?: never });

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
  | { kind: "challenges" | "answers" | "repliesTo" | "clarifies"; target: PointRef }
  | { kind: "undercuts"; target: BearingRef }
  | { kind: "supports" | "about"; target: BearingTarget };

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
  | { kind: "body" }
  | { kind: "role"; role: "C"; status?: "open" }
  | { kind: "role"; role: Exclude<Role, "C">; status?: never }
  | { kind: "gap"; status: "open" }
  | { kind: "material" }
  | { kind: "edge" };

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
  | { kind: "preserveBody" }
  | {
      kind: "emitPoint";
      ref: PointRef;
      id?: string;
      reason: "role-annotation" | "gap-annotation" | "anchor-annotation";
    }
  | { kind: "rejectPoint"; ref: PointRef; id?: string; reason: "duplicate-anchor" }
  | {
      kind: "emitBearing";
      ref: ExplainBearingRef;
      bearing: ExplainEmittedBearingSummary;
      reason: "operator-clause" | "annotated-containment";
    }
  | {
      kind: "rejectBearing";
      bearing?: ExplainBearingSummary;
      reason:
        | "annotation-syntax-error"
        | "edge-descendant-requires-explicit-target"
        | "validation-error";
    }
  | {
      kind: "skipBearing";
      reason: "no-eligible-ancestor" | "no-structural-rule";
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
