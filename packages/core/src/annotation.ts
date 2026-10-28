import type {
  Annotation,
  AnnotationSyntaxError,
  BearingKind,
  Diagnostic,
  LocalBearingMark,
  LocalBearingRole,
  OperatorClause,
  PointOperatorClause,
  Ref,
  Role,
  SourceSpan
} from "./types.js";

// A mark ends at the end of the annotation, whitespace, a handle separator, an
// @reference, or an operator written without its separating space (diagnosed
// below). Hyphens, plus signs and slashes inside ordinary words such as O-ring,
// C++ or G/O ratio therefore do not end a mark, and that prose stays body.
const MARK_END = String.raw`(?=$|[\s;@]|[+\-~/_]>)`;
const FAMILY_START_RE = new RegExp(String.raw`^(\s*)(point|node|\.|bearing|edge|_)` + MARK_END, "i");
const LOCAL_BEARING_START_RE = new RegExp(String.raw`^[QCGORD](?:\?|\/|_)?` + MARK_END, "i");
const GLUED_BEARING_FAMILY_RE = new RegExp(String.raw`^(\s*)(bearing|edge|_)(?=[QCGORD](?:[?/_])?` + MARK_END + ")", "i");
const RESERVED_START_RE = new RegExp(
  String.raw`^(?:(?:[QCGORD](?:\?|\/|_)?|\?[/_]?)` + MARK_END +
  String.raw`|use(?=$|;|\s+@)|linked(?=$|[\s;])|join(?=$|[\s;])|@)`,
  "i"
);
type AnnotationHead = {
  family?: "point" | "bearing";
  operation: "construct" | "use" | "note";
  mode?: "local" | "explicit";
  canonicalRaw: string;
};

/** One family/operation boundary for parsing and outline recovery, including
 * unclosed headers. Case-insensitive intent preserves failure boundaries;
 * only exact lowercase aliases are normalized into valid grammar.
 */
export function recognizeAnnotationHead(raw: string): AnnotationHead {
  // A role written against a Bearing family spelling, as in [_G], keeps the
  // local boundary so its sources cannot silently fall back to body.
  const family = FAMILY_START_RE.exec(raw) ?? GLUED_BEARING_FAMILY_RE.exec(raw);
  const type = family ? /^(point|node|\.)$/i.test(family[2]) ? "point" : "bearing" : undefined;
  const rest = family ? raw.slice(family[0].length).trimStart() : raw.trimStart();
  const operation = /^note(?=$|[\s;@]|[+\-~/_]>)/i.test(rest) ? "note"
    : (type === "bearing" ? /^use(?=$|[\s;])/i : /^(?:[QCGORD](?:\?|[_/])?\s+)?use(?=$|[\s;])/i).test(rest) ? "use" : "construct";
  // Keep malformed role-led headers in local mode; later tokens never select
  // another mode, including use/note or a partially written explicit clause.
  const mode = type === "bearing" && operation === "construct"
    ? LOCAL_BEARING_START_RE.test(rest) ? "local" : "explicit"
    : undefined;
  const canonicalRaw = family && family[2] === family[2].toLowerCase()
    ? family[1] + (type === "point" ? "." : "_") + raw.slice(family[0].length) : raw;
  return { family: type, operation, ...(mode ? { mode } : {}), canonicalRaw };
}
const RETIRED_CLAIM_RE = new RegExp(String.raw`^\s*C\?` + MARK_END, "i");
const RETIRED_SELECTOR_RE = /^\s*[GO]_(?=$|[\s;@])/i;
const GLUED_OPERATOR_RE = /[^\s,;](?:\+>|->|\/>|~>|_>)|(?:\+>|->|\/>|~>|_>)[^\s,;]/;
const ROLE_RE = /^(Q|C|G|O|R|D)$/;
const INVALID_OPEN_ROLE_RE = /^(Q|G|O|R|D)\?$/;
const ANCHOR_RE = /^@([a-z][a-z0-9_-]*)$/;
const RELATION_TOKENS = new Map<string, BearingKind>([
  ["+>", "supports"],
  ["->", "challenges"],
  ["/>", "challenges"],
  ["~>", "concerns"],
  ["supports", "supports"],
  ["challenges", "challenges"],
  ["concerns", "concerns"],
  ["answers", "answers"],
  ["respondsTo", "respondsTo"],
  ["clarifies", "clarifies"]
]);

export type AnnotationParseResult = {
  annotation?: Annotation;
  diagnostics: Diagnostic[];
};

export function parseAnnotation(raw: string, sourceSpan?: SourceSpan): AnnotationParseResult {
  const head = recognizeAnnotationHead(raw);
  if (head.operation === "note") {
    const valid = head.canonicalRaw.trim().replace(/\s+/g, " ") === (head.family === "point" ? ". note" : head.family === "bearing" ? "_ note" : "note");
    return {
      annotation: { kind: "note", raw, ...(head.family ? { targetKind: head.family } : {}), ...(!valid ? { syntaxErrors: ["note" as const] } : {}) },
      diagnostics: valid ? [] : [{ severity: "error", code: "MALFORMED_NOTE", message: "Notes use [note], [. note] or [_ note] followed by prose, without targets, anchors or other parameters." + proseHint(splitTokens(head.canonicalRaw)), sourceSpan }]
    };
  }
  const parsed = parseRecognizedAnnotation(head.canonicalRaw, sourceSpan);
  if (parsed.annotation) parsed.annotation.raw = raw;
  return parsed;
}

function parseRecognizedAnnotation(raw: string, sourceSpan?: SourceSpan): AnnotationParseResult {
  if (RETIRED_CLAIM_RE.test(raw)) {
    return {
      annotation: { kind: "invalid", raw },
      diagnostics: [{ severity: "error", code: "RETIRED_CLAIM_OPENNESS", message: "C? is retired. Deliberately migrate to C to remove Claim open metadata, retaining tentative wording and the original source/version. C does not assert truth, certainty, acceptance or completion.", sourceSpan }]
    };
  }
  if (/^\s*\?(?=$|[\s;@/_]|[+\-~]>)/.test(raw)) {
    return {
      annotation: { kind: "invalid", raw },
      diagnostics: [{ severity: "error", code: "RETIRED_GAP_ANNOTATION", message: "Gap [?] is retired. Use a Point for a scoped absence claim, retaining its anchor and explicit ~> attachment when needed, or a note for an author's task. Notes remove Point identity; G/O add a different commitment. Recompile the retained source.", sourceSpan }]
    };
  }
  if (GLUED_OPERATOR_RE.test(raw)) {
    return parseGluedOperator(raw, sourceSpan);
  }
  const retired = /^\s*(?:@[a-z]|use(?=$|;|\s+@))/i.test(raw) || RETIRED_SELECTOR_RE.test(raw) || /(?:^|\s)_>(?=$|\s)/.test(raw);
  if (retired) {
    const normalized = raw.replace(/^(\s*)@/, "$1. @").replace(/^(\s*)use(?=$|[\s;])/i, "$1. use").replace(/^(\s*)([GO])_/i, "$1$2/").replace(/_>/g, "/>");
    const parsed = parseCurrentAnnotation(normalized, sourceSpan);
    const annotation = parsed.annotation;
    if (annotation?.kind === "bearingUse") {
      annotation.raw = raw;
      annotation.syntaxErrors = ["reference"];
    } else if (annotation && annotation.kind !== "invalid" && annotation.kind !== "localBearing" && annotation.kind !== "note") {
      annotation.raw = raw;
      const errors = new Set<AnnotationSyntaxError>(annotation.syntaxErrors);
      errors.add("retired");
      if (annotation.kind === "use" && /^\s*use(?=$|;|\s+@)/i.test(raw)) errors.add("reference");
      (annotation as { syntaxErrors?: AnnotationSyntaxError[] }).syntaxErrors = [...errors];
    }
    return { annotation: /^\s*@/.test(raw) ? { kind: "invalid", raw } : annotation ?? { kind: "invalid", raw }, diagnostics: [{ severity: "error", code: "RETIRED_AUTHORING_SYNTAX", message: "Retired authoring spelling; migrate this annotation to [" + normalized + "] and reparse the original source.", sourceSpan }, ...parsed.diagnostics] };
  }
  return parseCurrentAnnotation(raw, sourceSpan);
}

/** Whether bracketed text at the start of a block selects annotation parsing rather than body. */
export function isAnnotationStart(raw: string): boolean {
  const head = recognizeAnnotationHead(raw);
  return !!head.family || head.operation === "note" || raw.trim() === "" || RESERVED_START_RE.test(raw.trimStart());
}

/** Whether bracketed text begins with the retired C? mark. */
export function isRetiredClaimStart(raw: string): boolean {
  return RETIRED_CLAIM_RE.test(raw);
}

// An operator written against its neighbours, as in [O->@x], states clear
// intent. It is parsed with the missing spaces restored so that the mark, name
// and handle keep their usual recovery, but the clause itself is rejected.
function parseGluedOperator(raw: string, sourceSpan?: SourceSpan): AnnotationParseResult {
  const spaced = raw.trim().replace(/\s*(\+>|->|\/>|~>|_>)\s*/g, " $1 ").replace(/\s+;/g, ";").trim();
  const parsed = parseAnnotation(spaced, sourceSpan);
  const annotation = parsed.annotation;
  const spacing: Diagnostic = {
    severity: "error",
    code: "MALFORMED_EXPLICIT_BEARING",
    message: `Separate an operator from its neighbours with spaces, as in [${spaced.replace(/(^|\s)_>(?=\s)/g, "$1/>")}].`,
    sourceSpan
  };
  if (!annotation || annotation.kind === "invalid" || annotation.kind === "note" || annotation.kind === "localBearing" || annotation.kind === "bearingUse") {
    return { annotation: annotation ? { ...annotation, raw } : { kind: "invalid", raw }, diagnostics: [spacing, ...parsed.diagnostics] };
  }
  const { operatorClause: _clause, ...rest } = annotation;
  const syntaxErrors = [...new Set([...(annotation.syntaxErrors ?? []), "operator" as const])];
  return { annotation: { ...rest, raw, syntaxErrors } as Annotation, diagnostics: [spacing, ...parsed.diagnostics] };
}

function parseCurrentAnnotation(raw: string, sourceSpan?: SourceSpan): AnnotationParseResult {
  const diagnostics: Diagnostic[] = [];
  const trimmed = raw.trim();
  const semicolonParts = trimmed.split(";").map((part) => part.trim());
  const head = recognizeAnnotationHead(trimmed);
  const edgeIntent = head.family === "bearing";

  if (edgeIntent && head.operation === "use") {
    const tokens = splitTokens(semicolonParts[0]);
    const operand = tokens[2] ? parseSingleRef(tokens[2]) : undefined;
    const valid = tokens[0] === "_" && tokens[1] === "use" && Boolean(operand) && tokens.length === 3 && semicolonParts.length === 1;
    return {
      annotation: { kind: "bearingUse", raw, ...(operand ? { ref: { id: operand } } : {}), ...(!valid ? { syntaxErrors: ["reference"] } : {}) },
      diagnostics: valid ? [] : [{ severity: "error", code: "MALFORMED_BEARING_USE", message: "Bearing uses must look like [_ use @id]; they cannot declare an alias or construct an attachment.", sourceSpan }]
    };
  }

  if (edgeIntent && head.mode === "local") {
    const tokens = splitTokens(semicolonParts[0]);
    const roleToken = /^(?:_|bearing|edge)([GOQ]\/)/i.exec(tokens[0])?.[1] ?? tokens[1] ?? "";
    const mark: LocalBearingMark = /^[GOQ]\//i.test(roleToken)
      ? { role: roleToken[0].toUpperCase() as "G" | "O" | "Q", selector: "attachment" }
      : { role: /^[GORD]$/.test(roleToken) ? roleToken as LocalBearingRole : undefined };
    const handle = semicolonParts.length === 2 ? parseSingleRef(semicolonParts[1]) : undefined;
    const invalidSyntax = tokens[0] !== "_" || tokens.length !== 2 || !mark.role || (mark.selector && roleToken !== mark.role + "/") || semicolonParts.length > 2;
    const invalidHandle = semicolonParts.length === 2 && !handle;
    const errors: ("localBearing" | "handle")[] = [];
    if (invalidSyntax) {
      errors.push("localBearing");
      diagnostics.push({
        severity: "error", code: "MALFORMED_LOCAL_BEARING",
        message: pointOnlySelectorHint(roleToken, true) || "Local Bearing headers use [_ G], [_ O], [_ R] or [_ D] for a Point target, or [_ G/], [_ O/] or [_ Q/] for the locally exposed Bearing, with an optional ; @route handle and neutral Point sources. The first token after _ selects the mode; do not mix a role with references, operators, use or note." + gluedRoleHint(tokens[0]) + markCaseHint(tokens[1]),
        sourceSpan
      });
    }
    if (invalidHandle) {
      errors.push("handle");
      diagnostics.push({ severity: "error", code: "MALFORMED_BEARING_HANDLE",
        message: "Bearing handle separator ';' must be followed by exactly one valid @id.", sourceSpan });
    }
    return { annotation: { kind: "localBearing", raw, ...mark, ...(!invalidSyntax && handle ? { handle } : {}),
      syntaxErrors: errors.length ? errors : undefined }, diagnostics };
  }

  if (/^join(?=$|[\s;])/i.test(trimmed)) {
    return {
      annotation: { kind: "localBearing", raw, syntaxErrors: ["localBearing"] },
      diagnostics: [{ severity: "error", code: "RETIRED_JOIN_ANNOTATION",
        message: "The join keyword is retired. Use [_ G; @route] with neutral [.] or [. use @id] source members, then recompile the original source.", sourceSpan }]
    };
  }
  const useIntent = head.family === "point" && head.operation === "use"
    ? [trimmed, splitTokens(semicolonParts[0])[0]]
    : /^(?:([QCGORD](?:\?|\/)?|\?)\s+)use(?=$|[\s;])/i.exec(trimmed);
  if (useIntent) {
    const tokens = splitTokens(semicolonParts[0]);
    const useIndex = useIntent[1] ? 1 : 0;
    const mark = useIntent[1];
    const selectorRole = mark === "G/" || mark === "O/" || mark === "Q/" ? mark[0] as "G" | "O" | "Q" : undefined;
    const role = mark && /^[QCGORD]$/.test(mark) ? mark as Role : selectorRole;
    const operand = tokens[useIndex + 1] ? parseSingleRef(tokens[useIndex + 1]) : undefined;
    const handle = semicolonParts.length === 2 ? parseSingleRef(semicolonParts[1]) : undefined;
    const errors: ("reference" | "operator" | "selector" | "handle")[] = [];
    if (tokens[useIndex] !== "use" || (mark !== "." && !role) || !operand || semicolonParts.length > 2) {
      errors.push("reference");
      diagnostics.push({ severity: "error", code: "MALFORMED_POINT_USE", message: "Point uses must look like [. use @id] or [G use @id]; occurrence status is unsupported." + markCaseHint(mark), sourceSpan });
    }
    const suffix = tokens.slice(useIndex + 2);
    let operatorClause: PointOperatorClause | undefined;
    if (suffix.length) {
      if (selectorRole) {
        errors.push("selector");
        diagnostics.push({ severity: "error", code: "LOCAL_SELECTOR_WITH_EXPLICIT_CLAUSE", message: "A local selector and an explicit operator clause are mutually exclusive.", sourceSpan });
      } else if (isRelationToken(suffix[0])) {
        const clause = parseOperatorClause(suffix[0], "self", suffix.slice(1), sourceSpan, diagnostics);
        if (clause) operatorClause = pointOperatorClause(clause);
        else errors.push("operator");
      } else {
        errors.push("operator");
        diagnostics.push({ severity: "error", code: "MALFORMED_POINT_USE", message: "After a Point use operand, only a complete symbolic operator or canonical named-kind clause is permitted." + kindHint(suffix[0]), sourceSpan });
      }
    }
    if (semicolonParts.length === 2 && !handle) {
      errors.push("handle");
      diagnostics.push({ severity: "error", code: "MALFORMED_BEARING_HANDLE", message: "Bearing handle separator ';' must be followed by exactly one valid @id.", sourceSpan });
    }
    const base = { kind: "use" as const, ref: operand ? { id: operand } : undefined, handle, raw, syntaxErrors: errors.length ? [...new Set(errors)] : undefined };
    return { annotation: selectorRole ? { ...base, role: selectorRole, selector: "attachment" } : { ...base, role, operatorClause }, diagnostics };
  }
  if (/^linked(?=$|[\s;])/i.test(trimmed) || /^(?:[QCGORD](?:[/_])?|\.)\s+linked(?=$|[\s;])/i.test(trimmed)) {
    return {
      annotation: { kind: "localBearing", raw, syntaxErrors: ["localBearing"] },
      diagnostics: [{ severity: "error", code: "RETIRED_LINKED_ANNOTATION",
        message: "The linked keyword is retired. Use [_ G], [_ O], [_ R] or [_ D], optionally followed by ; @route, with neutral [.] or [. use @id] source members. Preserve the intended relation, names, commentary and member subtrees when migrating.", sourceSpan }]
    };
  }

  const selectorIntent = /^([QCGORD?])\//i.exec(trimmed);
  if (selectorIntent) {
    const role = selectorIntent[1].toUpperCase();
    if (role !== "G" && role !== "O" && role !== "Q") {
      diagnostics.push({ severity: "error", code: "UNSUPPORTED_LOCAL_BEARING_SELECTOR", message: pointOnlySelectorHint(selectorIntent[1] + "/", false) || "Only G/, O/ and Q/ select a local Bearing attachment.", sourceSpan });
      return { annotation: { kind: "invalid", raw }, diagnostics };
    }
    const tokens = splitTokens(semicolonParts[0]);
    const anchor = tokens.length === 2 ? parseSingleRef(tokens[1]) : undefined;
    const handle = semicolonParts.length === 2 ? parseSingleRef(semicolonParts[1]) : undefined;
    const combined = tokens.some(isRelationToken);
    const invalidSelector = tokens[0] !== role + "/" || tokens.length > 2 || (tokens.length === 2 && !anchor) || semicolonParts.length > 2;
    const invalidHandle = semicolonParts.length === 2 && !handle;
    const errors: ("selector" | "handle")[] = [];
    if (invalidSelector) {
      errors.push("selector");
      diagnostics.push({ severity: "error", code: combined ? "LOCAL_SELECTOR_WITH_EXPLICIT_CLAUSE" : "MALFORMED_LOCAL_BEARING_SELECTOR", message: combined ? "A local selector and an explicit operator clause are mutually exclusive; use a complete clause such as G +> @route, O /> @route or Q ~> @route instead." : "Local selectors must look like [G/], [O/ @id], or [Q/ @id; @question-route]." + markCaseHint(tokens[0]), sourceSpan });
    }
    if (invalidHandle) {
      errors.push("handle");
      diagnostics.push({ severity: "error", code: "MALFORMED_BEARING_HANDLE", message: "Bearing handle separator ';' must be followed by exactly one valid @id.", sourceSpan });
    }
    return { annotation: { kind: "role", role, selector: "attachment", anchor, handle, raw, syntaxErrors: errors.length ? errors : undefined }, diagnostics };
  }

  if (semicolonParts.length > 2) {
    diagnostics.push({
      severity: "error",
      code: "MALFORMED_ANNOTATION",
      message: "Annotation may contain at most one Bearing handle separator.",
      sourceSpan
    });
    return {
      annotation: edgeIntent ? { kind: "explicitBearing", raw, syntaxErrors: [isBearingModeUnselected(trimmed) ? "mode" : "operator"] } : undefined,
      diagnostics
    };
  }

  const main = semicolonParts[0] ?? "";
  const hasHandleSeparator = semicolonParts.length === 2;
  const handlePart = semicolonParts[1] ?? "";
  const handle = hasHandleSeparator && handlePart ? parseSingleRef(handlePart) : undefined;
  const invalidHandle = hasHandleSeparator && !handle;
  if (invalidHandle) {
    diagnostics.push({
      severity: "error",
      code: "MALFORMED_BEARING_HANDLE",
      message: "Bearing handle separator ';' must be followed by exactly one valid @id.",
      sourceSpan
    });
  }

  const tokens = splitTokens(main);
  if (tokens.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "EMPTY_ANNOTATION",
      message: "Cogitatum annotation is empty.",
      sourceSpan
    });
    return { diagnostics };
  }

  // Only a role letter or an @reference starts a construction. Any other first
  // token selects no mode, so neither local nor explicit rules are assumed.
  if (edgeIntent && isBearingModeUnselected(main)) {
    diagnostics.push({
      severity: "error",
      code: "MALFORMED_BEARING_MODE",
      message: "The first token after _, bearing or edge selects the mode: G, O, R, D, G/, O/ or Q/ for local construction ([_ G]), @ref for explicit construction ([_ @a +> @claim]), use ([_ use @route]) or note ([_ note])." + localKindHint(tokens[1]) + proseHint(tokens),
      sourceSpan
    });
    return { annotation: { kind: "explicitBearing", syntaxErrors: invalidHandle ? ["mode", "handle"] : ["mode"], handle, raw }, diagnostics };
  }

  // Retain the failed constructor and its handle so descendants and references
  // cannot silently attach elsewhere. This is a migration error, never an alias.
  if (edgeIntent && tokens.includes("undercuts")) {
    diagnostics.push({
      severity: "error",
      code: "RETIRED_BEARING_KIND",
      message: "The named undercuts spelling is retired. To preserve a challenge to a Bearing, replace undercuts with /> and recompile the original source. This does not classify a theory-specific undercut.",
      sourceSpan
    });
    return { annotation: { kind: "explicitBearing", raw, handle, syntaxErrors: syntaxErrors(true, invalidHandle) }, diagnostics };
  }
  if (edgeIntent && tokens.includes("about")) {
    diagnostics.push({ severity: "error", code: "RETIRED_BEARING_KIND",
      message: "The named about spelling is retired. Use concerns or ~> and recompile the original source; do not relabel old JSON.", sourceSpan });
    return { annotation: { kind: "explicitBearing", raw, handle, syntaxErrors: syntaxErrors(true, invalidHandle) }, diagnostics };
  }

  const opIndex = tokens.findIndex(isRelationToken);
  if (opIndex >= 0) {
    const prefix = tokens.slice(0, opIndex);
    const targets = tokens.slice(opIndex + 1);
    const op = tokens[opIndex];

    if (edgeIntent) {
      const operatorClause = (prefix[0] === "edge" || prefix[0] === "_")
        ? parseOperatorClause(op, prefix.slice(1), targets, sourceSpan, diagnostics)
        : undefined;
      if (prefix[0] !== "edge" && prefix[0] !== "_") {
        diagnostics.push({
          severity: "error",
          code: "MALFORMED_EXPLICIT_BEARING",
          message: "Bearing family spellings are lowercase: write _, bearing or edge.",
          sourceSpan
        });
      }
      return {
        annotation: {
          kind: "explicitBearing",
          operatorClause: operatorClause as (OperatorClause & { sources: Ref[] }) | undefined,
          syntaxErrors: syntaxErrors(!operatorClause, invalidHandle),
          handle,
          raw
        },
        diagnostics
      };
    }

    const host = parseBearingHost(prefix, tokens.slice(opIndex).join(" "), raw, sourceSpan, diagnostics);
    if (!host) {
      return { diagnostics };
    }

    const operatorClause = parseOperatorClause(op, "self", targets, sourceSpan, diagnostics);
    return {
      annotation: {
        ...host,
        operatorClause: operatorClause ? pointOperatorClause(operatorClause) : undefined,
        syntaxErrors: syntaxErrors(!operatorClause, invalidHandle),
        handle
      },
      diagnostics
    };
  }

  const first = tokens[0];
  if (edgeIntent) {
    diagnostics.push({
      severity: "error",
      code: "MALFORMED_EXPLICIT_BEARING",
      message: "Explicit Bearings require sources, a symbolic operator or canonical kind, and one target." + edgeKindHint(tokens) + proseHint(tokens),
      sourceSpan
    });
    return {
      annotation: {
        kind: "explicitBearing",
        syntaxErrors: syntaxErrors(true, invalidHandle),
        handle,
        raw
      },
      diagnostics
    };
  }

  const parsedRole = parseRoleToken(first);
  if (parsedRole) {
    const anchor = tokens[1] ? parseSingleRef(tokens[1]) : undefined;
    if (tokens.length > 2 || (tokens[1] && !anchor)) {
      diagnostics.push({
        severity: "error",
        code: "MALFORMED_ROLE_ANNOTATION",
        message: "Role annotations must look like [C], [G @id], or [Q @id respondsTo @target]." + proseHint(tokens),
        sourceSpan
      });
      return { diagnostics };
    }
    return {
      annotation: {
        kind: "role",
        ...parsedRole,
        anchor,
        syntaxErrors: invalidHandle ? ["handle"] : undefined,
        handle,
        raw
      },
      diagnostics
    };
  }

  if (INVALID_OPEN_ROLE_RE.test(first)) {
    diagnostics.push(openStatusDiagnostic(sourceSpan));
    return { diagnostics };
  }

  const anchor = tokens[1] ? parseSingleRef(tokens[1]) : undefined;
  if (first === ".") {
    if (tokens.length > 2 || (tokens[1] && !anchor)) {
      diagnostics.push({
        severity: "error",
        code: "MALFORMED_ANCHOR_ANNOTATION",
        message: "Neutral Point declarations must look like [.], [. @id], or [. @id +> @target].",
        sourceSpan
      });
      return { diagnostics };
    }
    return {
      annotation: {
        kind: "material",
        anchor,
        syntaxErrors: invalidHandle ? ["handle"] : undefined,
        handle,
        raw
      },
      diagnostics
    };
  }

  diagnostics.push({
    severity: "error",
    code: "MALFORMED_ANNOTATION",
    message: `Could not parse Cogitatum annotation [${raw}].` + markCaseHint(first),
    sourceSpan
  });
  return { diagnostics };
}

function parseOperatorClause(
  opToken: string,
  sourceTokens: string[] | "self",
  targetTokens: string[],
  sourceSpan: SourceSpan | undefined,
  diagnostics: Diagnostic[]
): OperatorClause | undefined {
  if (opToken.toLowerCase() === "repliesto") {
    diagnostics.push({
      severity: "error",
      code: "RETIRED_BEARING_KIND",
      message: "The named repliesTo spelling is retired. Use respondsTo, retaining the same sources, Point target, handle and prose, then recompile retained source; do not relabel old JSON.",
      sourceSpan
    });
    return undefined;
  }
  const op = RELATION_TOKENS.get(opToken);
  if (!op || (sourceTokens !== "self" && sourceTokens.length === 0) || targetTokens.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "MALFORMED_EXPLICIT_BEARING",
      message: "Operator clause must include sources, a symbolic operator or canonical kind, and one target." + (!op ? kindHint(opToken) : ""),
      sourceSpan
    });
    return undefined;
  }

  const sourceResult = sourceTokens === "self" ? undefined : parseRefs(sourceTokens);
  const targetResult = parseRefs(targetTokens);
  const sources: OperatorClause["sources"] = sourceTokens === "self" ? "self" : (sourceResult?.refs ?? []);
  const targets = targetResult.refs;

  if (sourceResult && (sourceResult.invalid.length > 0 || sourceResult.refs.length === 0)) {
    diagnostics.push({
      severity: "error",
      code: "MALFORMED_BEARING_SOURCES",
      message: invalidRefsMessage("sources", sourceResult.invalid),
      sourceSpan
    });
    return undefined;
  }
  if (sourceResult) {
    const duplicateSources = duplicateRefIds(sourceResult.refs);
    if (duplicateSources.length > 0) {
      diagnostics.push({
        severity: "error",
        code: "DUPLICATE_BEARING_SOURCES",
        message:
          `Operator clause source references must be unique. Duplicate: ` +
          `${duplicateSources.map((id) => `@${id}`).join(", ")}.`,
        sourceSpan
      });
      return undefined;
    }
  }
  if (targetResult.invalid.length > 0 || targets.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "MALFORMED_BEARING_TARGETS",
      message: invalidRefsMessage("targets", targetResult.invalid),
      sourceSpan
    });
    return undefined;
  }
  if (targets.length > 1) {
    diagnostics.push({
      severity: "error",
      code: "MULTIPLE_BEARING_TARGETS_UNSUPPORTED",
      message: "Operator clauses accept exactly one target; edge declarations can have multiple sources.",
      sourceSpan
    });
    return undefined;
  }

  const refs = { sources, target: targets[0] };
  if (op === "supports" || op === "concerns") return { ...refs, op, targetKind: "either" };
  if (op === "challenges") {
    const targetKind = opToken === "/>" ? "bearing" : "either";
    return { ...refs, op, targetKind };
  }
  return { ...refs, op, targetKind: "point" };
}

function pointOperatorClause(clause: OperatorClause): PointOperatorClause {
  if (clause.sources === "self") return { ...clause, sources: "self" };
  throw new Error("Parser invariant violated: a Point clause must use a self source.");
}

function duplicateRefIds(refs: Ref[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.id)) {
      duplicates.add(ref.id);
    }
    seen.add(ref.id);
  }
  return [...duplicates];
}

function syntaxErrors(invalidOperator: boolean, invalidHandle: boolean): ("operator" | "handle")[] | undefined {
  const errors: ("operator" | "handle")[] = [];
  if (invalidOperator) {
    errors.push("operator");
  }
  if (invalidHandle) {
    errors.push("handle");
  }
  return errors.length > 0 ? errors : undefined;
}

type ParsedRefs = {
  refs: Ref[];
  invalid: string[];
};

function parseRefs(tokens: string[]): ParsedRefs {
  const parts = tokens
    .join(" ")
    .split(",")
    .map((part) => part.trim());
  const refs: Ref[] = [];
  const invalid: string[] = [];

  for (const part of parts) {
    const id = parseSingleRef(part);
    if (id) {
      refs.push({ id });
    } else {
      invalid.push(part || "<empty>");
    }
  }

  return { refs, invalid };
}

function invalidRefsMessage(kind: "sources" | "targets", invalid: string[]): string {
  const detail = invalid.length > 0 ? ` Invalid: ${invalid.join(", ")}.` : "";
  return `Operator clause ${kind} must be comma-separated @id references.${detail}`;
}

function parseBearingHost(
  prefix: string[],
  clause: string,
  raw: string,
  sourceSpan: SourceSpan | undefined,
  diagnostics: Diagnostic[]
): (Extract<Annotation, { kind: "role" | "material" }> & { selector?: never }) | undefined {
  const first = prefix[0];
  const parsedRole = first ? parseRoleToken(first) : undefined;

  if (parsedRole) {
    const anchor = prefix[1] ? parseSingleRef(prefix[1]) : undefined;
    if (prefix.length > 2 || (prefix[1] && !anchor)) {
      diagnostics.push({
        severity: "error",
        code: "MALFORMED_ROLE_BEARING",
        message: "Role Bearing annotations must look like [O /> @target] or [O @id /> @target]." + jointSourceHint(prefix, clause),
        sourceSpan
      });
      return undefined;
    }
    return {
      kind: "role",
      ...parsedRole,
      anchor,
      raw
    };
  }

  if (first && INVALID_OPEN_ROLE_RE.test(first)) {
    diagnostics.push(openStatusDiagnostic(sourceSpan));
    return undefined;
  }

  const anchor = prefix[1] ? parseSingleRef(prefix[1]) : undefined;
  if (first === "." && prefix.length <= 2 && (!prefix[1] || anchor)) {
    return { kind: "material", anchor, raw };
  }

  diagnostics.push({
    severity: "error",
    code: "MALFORMED_EXPLICIT_BEARING",
    message: "Operator clauses must begin with a role, ., edge or _." + (first === "." ? jointSourceHint(prefix, clause) : markCaseHint(first)),
    sourceSpan
  });
  return undefined;
}

const KIND_NAMES = [...RELATION_TOKENS.keys()].filter(key => /^[a-z]/i.test(key));
const KIND_SYMBOLS = new Map<string, string>([["supports", "+>"], ["challenges", "->"], ["concerns", "~>"]]);

/** The symbolic spelling for a canonical kind, if it has one. */
export function operatorSymbol(kind: BearingKind, targetKind?: OperatorClause["targetKind"]): string | undefined {
  if (kind === "challenges" && targetKind === "bearing") return "/>";
  return KIND_SYMBOLS.get(kind);
}

// Hints guide authoring without changing diagnostic codes or severities.
function pointOnlySelectorHint(token: string, group: boolean): string {
  if (!/^[RD]\/$/i.test(token)) return "";
  const role = token[0].toUpperCase();
  const kind = role === "R" ? "respondsTo" : "clarifies";
  const prefix = group ? "_ " : "";
  const explicit = group ? `[_ @source ${kind} @target]` : `[${role} ${kind} @target]`;
  const naming = group ? "named endpoints" : "a named Point target";
  return `${kind} requires a Point target, so there is no [${prefix}${role}/]: write [${prefix}${role}] for the nearest Point, or ${explicit} with ${naming}.` + markCaseHint(token);
}

function markCaseHint(token: string | undefined): string {
  const upper = token?.toUpperCase();
  return token && upper !== token && /^[QCGORD](?:\?|\/|_)?$/.test(upper!)
    ? ` Marks are uppercase: write ${upper}, not ${token}.` : "";
}

function proseHint(tokens: string[]): string {
  return tokens[1] && !tokens[1].startsWith("@") && !isRelationToken(tokens[1])
    ? " To keep bracketed prose at the start of a block, remove the brackets or place other text before them." : "";
}

// Case-mismatched names still select a clause boundary; parsing diagnoses them
// instead of letting the occurrence acquire a default attachment.
function isRelationToken(token: string): boolean {
  return token.toLowerCase() === "repliesto" || RELATION_TOKENS.has(token) || KIND_NAMES.some(kind => kind.toLowerCase() === token.toLowerCase());
}

function jointSourceHint(prefix: string[], clause: string): string {
  const sources = prefix.slice(1).join(" ").split(",").map(part => part.trim()).filter(Boolean);
  return sources.length > 1 && sources.every(source => parseSingleRef(source))
    ? ` A Point clause has only the Point itself as its source; write joint sources in an edge: [_ ${sources.join(", ")} ${clause}].` : "";
}

/** Whether a Bearing-family construction header has no role letter or @reference after its family spelling. */
export function isBearingModeUnselected(header: string): boolean {
  const head = recognizeAnnotationHead(header);
  if (head.family !== "bearing" || head.mode !== "explicit") return false;
  const first = splitTokens(head.canonicalRaw.split(";")[0])[1];
  return !first?.startsWith("@");
}

const LOCAL_ROLE_FOR_KIND = new Map<string, string>([
  ["+>", "G"], ["supports", "G"], ["->", "O"], ["/>", "O/"], ["challenges", "O"], ["respondsTo", "R"], ["clarifies", "D"]
]);

function localKindHint(token: string | undefined): string {
  if (!token) return "";
  const role = LOCAL_ROLE_FOR_KIND.get(token);
  if (role) return ` To take sources and target from the outline, write the local mark: [_ ${role}].`;
  return token === "answers" || token === "concerns" || token === "~>"
    ? " Joint answers and Point-targeted concerns have no local header; name their endpoints explicitly. For concerns about the nearest exposed Bearing, write [_ Q/]." : "";
}

function gluedRoleHint(token: string | undefined): string {
  const glued = token && /^(_|bearing|edge)([QCGORD](?:[?/_])?)/i.exec(token);
  return glued ? ` Separate the family spelling from the role with a space: [${glued[1]} ${glued[2]}].` : "";
}

function edgeKindHint(tokens: string[]): string {
  const word = tokens.slice(1).find(token => !token.startsWith("@") && token !== ",");
  if (!word || !tokens[1]?.startsWith("@")) return "";
  return kindHint(word);
}

function kindHint(word: string): string {
  const exact = KIND_NAMES.find(kind => kind.toLowerCase() === word.toLowerCase());
  return exact
    ? ` Kind names are case-sensitive: write ${exact}, not ${word}.`
    : ` ${word} is not a canonical kind; use +>, ->, />, ~> or one of ${KIND_NAMES.join(", ")}.`;
}

function parseSingleRef(token: string): string | undefined {
  const match = ANCHOR_RE.exec(token.trim());
  return match?.[1];
}

function parseRoleToken(token: string): { role: Role } | undefined {
  const match = ROLE_RE.exec(token);
  return match ? { role: match[1] as Role } : undefined;
}

function openStatusDiagnostic(sourceSpan: SourceSpan | undefined): Diagnostic {
  return {
    severity: "error",
    code: "ROLE_OPENNESS_UNSUPPORTED",
    message: "Role-level open status is unsupported. Keep tentative wording in Point content and author tasks in notes.",
    sourceSpan
  };
}

function splitTokens(input: string): string[] {
  return input
    .replace(/,/g, ", ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
