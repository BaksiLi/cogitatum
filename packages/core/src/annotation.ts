import type {
  Annotation,
  AnnotationSyntaxError,
  BearingKind,
  Diagnostic,
  BearingOperatorClause,
  OperatorClause,
  PointOperatorClause,
  Ref,
  Role,
  SelectorRole,
  SourceSpan,
  TargetTerm
} from "./types.js";
import { isNamedTarget } from "./types.js";

// A mark ends at the end of the annotation, whitespace, a handle separator, an
// @reference, or an operator written without its separating space (diagnosed
// below). Hyphens, plus signs and slashes inside ordinary words such as O-ring,
// C++ or G/O ratio therefore do not end a mark, and that prose stays body.
const MARK_END = String.raw`(?=$|[\s;@]|[+\-~/_]>)`;
const FAMILY_START_RE = new RegExp(String.raw`^(\s*)(point|node|\.|bearing|edge|_)` + MARK_END, "i");
// `[_/]` selects the exposed Bearing; the slash belongs to the family token.
const BEARING_SELECTOR_RE = /^(\s*)(bearing|edge|_)\/(?=$|[\s;])/i;
// A role letter after a Bearing family spelling is the unreleased 0.6 header
// form. It keeps a member boundary so its children cannot fall back to body.
const ROLE_HEADED_BEARING_RE = new RegExp(String.raw`^[QCGORD](?:\?|\/|_)?` + MARK_END, "i");
// Retired operators still open a clause, so their headers keep member sources.
const RELATION_START_RE = /^(?:\+>|->|\/>|_>|~>)(?=$|\s)|^(?:supports|challenges|concerns|answers|respondsTo|repliesTo|clarifies|undercuts|about)(?=$|\s)/i;
const GLUED_BEARING_FAMILY_RE = new RegExp(String.raw`^(\s*)(bearing|edge|_)(?=[QCGORD](?:[?/_])?` + MARK_END + ")", "i");
const RESERVED_START_RE = new RegExp(
  String.raw`^(?:(?:[QCGORD](?:\?|\/|_)?|\?[/_]?)` + MARK_END +
  String.raw`|use(?=$|;|\s+@)|linked(?=$|[\s;])|join(?=$|[\s;])|@)`,
  "i"
);
type AnnotationHead = {
  family?: "point" | "bearing";
  operation: "construct" | "use" | "note";
  /** For a Bearing construction: where its sources come from, if the first token says. */
  sources?: "members" | "references" | "unselected";
  canonicalRaw: string;
};

/** One family/operation boundary for parsing and outline recovery, including
 * unclosed headers. Case-insensitive intent preserves failure boundaries;
 * only exact lowercase aliases are normalized into valid grammar.
 */
export function recognizeAnnotationHead(raw: string): AnnotationHead {
  // A role written against a Bearing family spelling, as in [_G], keeps the
  // local boundary so its sources cannot silently fall back to body.
  const selector = BEARING_SELECTOR_RE.exec(raw);
  const family = selector ?? FAMILY_START_RE.exec(raw) ?? GLUED_BEARING_FAMILY_RE.exec(raw);
  const type = family ? /^(point|node|\.)$/i.test(family[2]) ? "point" : "bearing" : undefined;
  const rest = family ? raw.slice(family[0].length).trimStart() : raw.trimStart();
  const operation = /^note(?=$|[\s;@]|[+\-~/_]>)/i.test(rest) ? "note"
    : (type === "bearing" ? /^use(?=$|[\s;])/i : /^(?:[QCGORD](?:\?|[_/])?\s+)?use(?=$|[\s;])/i).test(rest) ? "use" : "construct";
  // The first token fixes where sources come from; later tokens never select
  // another mode, including use/note or a partially written clause.
  const sources = type === "bearing" && operation === "construct"
    ? selector || rest === "" || rest.startsWith(";") || RELATION_START_RE.test(rest) || ROLE_HEADED_BEARING_RE.test(rest) ? "members"
      : rest.startsWith("@") ? "references" : "unselected"
    : undefined;
  const canonicalRaw = family && family[2] === family[2].toLowerCase()
    ? family[1] + (type === "point" ? "." : "_") + (selector ? "/" : "") + raw.slice(family[0].length) : raw;
  return { family: type, operation, ...(sources ? { sources } : {}), canonicalRaw };
}
const RETIRED_CLAIM_RE = new RegExp(String.raw`^\s*C\?` + MARK_END, "i");
const RETIRED_SELECTOR_RE = /^\s*[GO]_(?=$|[\s;@])/i;
// `/>` (published in 0.5) and `_>` (earlier) both migrate to `->`.
const RETIRED_OPERATOR_RE = /(^|\s)[_/]>(?=$|\s)/;
const RETIRED_OPERATOR_RE_GLOBAL = /(^|\s)[_/]>(?=$|\s)/g;
const GLUED_OPERATOR_RE = /[^\s,;](?:\+>|->|\/>|~>|_>)|(?:\+>|->|\/>|~>|_>)[^\s,;]/;
const ROLE_RE = /^(Q|C|G|O|R|D)$/;
const SELECTOR_MARK_RE = /^[GOQD]\/$/;
const INVALID_OPEN_ROLE_RE = /^(Q|G|O|R|D)\?$/;
const ANCHOR_RE = /^@([a-z][a-z0-9_-]*)$/;
const RELATION_TOKENS = new Map<string, BearingKind>([
  ["+>", "supports"],
  ["->", "challenges"],
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
  const retired = /^\s*(?:@[a-z]|use(?=$|;|\s+@))/i.test(raw) || RETIRED_SELECTOR_RE.test(raw) || RETIRED_OPERATOR_RE.test(raw);
  if (retired) {
    const normalized = raw.replace(/^(\s*)@/, "$1. @").replace(/^(\s*)use(?=$|[\s;])/i, "$1. use").replace(/^(\s*)([GO])_/i, "$1$2/").replace(RETIRED_OPERATOR_RE_GLOBAL, "$1->");
    const parsed = parseCurrentAnnotation(normalized, sourceSpan);
    const annotation = parsed.annotation;
    if (annotation?.kind === "bearingUse") {
      annotation.raw = raw;
      annotation.syntaxErrors = ["reference"];
    } else if (annotation && annotation.kind !== "invalid" && annotation.kind !== "note") {
      annotation.raw = raw;
      const errors = new Set<AnnotationSyntaxError>(annotation.syntaxErrors);
      errors.add("retired");
      if (annotation.kind === "use" && /^\s*use(?=$|;|\s+@)/i.test(raw)) errors.add("reference");
      (annotation as { syntaxErrors?: AnnotationSyntaxError[] }).syntaxErrors = [...errors];
    }
    const operatorNote = RETIRED_OPERATOR_RE.test(raw)
      ? " -> challenges a Point or a Bearing; its reference, or ^/ for the locally exposed Bearing, selects which." : "";
    return { annotation: /^\s*@/.test(raw) ? { kind: "invalid", raw } : annotation ?? { kind: "invalid", raw }, diagnostics: [{ severity: "error", code: "RETIRED_AUTHORING_SYNTAX", message: "Retired authoring spelling; migrate this annotation to [" + normalized + "] and reparse the original source." + operatorNote, sourceSpan }, ...parsed.diagnostics] };
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
    message: `Separate an operator from its neighbours with spaces, as in [${spaced.replace(RETIRED_OPERATOR_RE_GLOBAL, "$1->")}].`,
    sourceSpan
  };
  if (!annotation || annotation.kind === "invalid" || annotation.kind === "note" || annotation.kind === "bearingUse") {
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

  if (edgeIntent) return parseBearingConstructor(raw, head, sourceSpan);

  if (/^join(?=$|[\s;])/i.test(trimmed)) {
    return {
      annotation: { kind: "bearing", members: true, raw, syntaxErrors: ["retired"] },
      diagnostics: [{ severity: "error", code: "RETIRED_JOIN_ANNOTATION",
        message: "The join keyword is retired. Use [_ +> ^], [_ -> ^], [_ respondsTo ^] or [_ clarifies ^] (or another operator and target), optionally followed by ; @route, with neutral [.] or [. use @id] source members. Then recompile the original source.", sourceSpan }]
    };
  }
  const useIntent = head.family === "point" && head.operation === "use"
    ? [trimmed, splitTokens(semicolonParts[0])[0]]
    : /^(?:([QCGORD](?:\?|\/)?|\?)\s+)use(?=$|[\s;])/i.exec(trimmed);
  if (useIntent) {
    const tokens = splitTokens(semicolonParts[0]);
    const useIndex = useIntent[1] ? 1 : 0;
    const mark = useIntent[1];
    const selectorRole = mark && SELECTOR_MARK_RE.test(mark) ? mark[0] as SelectorRole : undefined;
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
      annotation: { kind: "bearing", members: true, raw, syntaxErrors: ["retired"] },
      diagnostics: [{ severity: "error", code: "RETIRED_LINKED_ANNOTATION",
        message: "The linked keyword is retired. Use [_ +> ^], [_ -> ^], [_ respondsTo ^] or [_ clarifies ^] (or another operator and target), optionally followed by ; @route, with neutral [.] or [. use @id] source members. Preserve the intended relation, names, commentary and member subtrees when migrating.", sourceSpan }]
    };
  }

  const selectorIntent = /^([QCGORD?])\//i.exec(trimmed);
  if (selectorIntent) {
    const role = selectorIntent[1].toUpperCase();
    if (!SELECTOR_MARK_RE.test(role + "/")) {
      diagnostics.push({ severity: "error", code: "UNSUPPORTED_LOCAL_BEARING_SELECTOR", message: pointOnlySelectorHint(selectorIntent[1] + "/") || "Only G/, O/, Q/ and D/ select the locally exposed Bearing.", sourceSpan });
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
      diagnostics.push({ severity: "error", code: combined ? "LOCAL_SELECTOR_WITH_EXPLICIT_CLAUSE" : "MALFORMED_LOCAL_BEARING_SELECTOR", message: combined ? "A local selector and an explicit operator clause are mutually exclusive; the selector already states its relation to ^/. Write a complete clause such as [G +> @route] or [O -> ^/] instead." : "Local selectors must look like [G/], [O/ @id], or [Q/ @id; @question-route]." + markCaseHint(tokens[0]), sourceSpan });
    }
    if (invalidHandle) {
      errors.push("handle");
      diagnostics.push({ severity: "error", code: "MALFORMED_BEARING_HANDLE", message: "Bearing handle separator ';' must be followed by exactly one valid @id.", sourceSpan });
    }
    return { annotation: { kind: "role", role: role as SelectorRole, selector: "attachment", anchor, handle, raw, syntaxErrors: errors.length ? errors : undefined }, diagnostics };
  }

  if (semicolonParts.length > 2) {
    diagnostics.push({
      severity: "error",
      code: "MALFORMED_ANNOTATION",
      message: "Annotation may contain at most one Bearing handle separator.",
      sourceSpan
    });
    return { diagnostics };
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

  const opIndex = tokens.findIndex(isRelationToken);
  if (opIndex >= 0) {
    const prefix = tokens.slice(0, opIndex);
    const targets = tokens.slice(opIndex + 1);
    const op = tokens[opIndex];

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
  const parsedRole = parseRoleToken(first);
  if (parsedRole) {
    const anchor = tokens[1] ? parseSingleRef(tokens[1]) : undefined;
    if (tokens.length > 2 || (tokens[1] && !anchor)) {
      diagnostics.push({
        severity: "error",
        code: "MALFORMED_ROLE_ANNOTATION",
        message: "Role annotations must look like [C], [G @id], or [Q @id respondsTo @target]." + (targetTermHint(first, tokens[1]) ?? proseHint(tokens)),
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
  sourceTokens: string[] | "self" | "members",
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
  const listed = Array.isArray(sourceTokens) ? sourceTokens : undefined;
  if (!op || (listed && listed.length === 0) || targetTokens.length === 0) {
    // Only listed sources are written in the clause; self and member sources are implied.
    diagnostics.push({
      severity: "error",
      code: "MALFORMED_EXPLICIT_BEARING",
      message: (listed ? "Operator clause must include sources, a symbolic operator or canonical kind, and one target." : "Operator clause must include a symbolic operator or canonical kind and one target.") +
        (!op ? kindHint(opToken) : targetTokens.length === 0 ? POSITIONAL_TARGET_HINT : ""),
      sourceSpan
    });
    return undefined;
  }

  let sources: OperatorClause["sources"];
  if (listed) {
    const sourceResult = parseRefs(listed);
    if (sourceResult.invalid.length > 0 || sourceResult.refs.length === 0) {
      diagnostics.push({ severity: "error", code: "MALFORMED_BEARING_SOURCES", message: invalidRefsMessage("sources", sourceResult.invalid), sourceSpan });
      return undefined;
    }
    const duplicateSources = duplicateRefIds(sourceResult.refs);
    if (duplicateSources.length > 0) {
      diagnostics.push({
        severity: "error",
        code: "DUPLICATE_BEARING_SOURCES",
        message: `Operator clause source references must be unique. Duplicate: ${duplicateSources.map((id) => `@${id}`).join(", ")}.`,
        sourceSpan
      });
      return undefined;
    }
    sources = sourceResult.refs;
  } else {
    sources = sourceTokens as "self" | "members";
  }

  const target = parseTargetTerm(targetTokens, sourceSpan, diagnostics);
  return target ? { op, sources, target } : undefined;
}

const POSITIONAL_TARGET_HINT = " For a positional target, write ^ for the nearest Point or ^/ for its exposed Bearing.";

// Exactly one target: a named reference, or a positional slot written without @.
function parseTargetTerm(tokens: string[], sourceSpan: SourceSpan | undefined, diagnostics: Diagnostic[]): TargetTerm | undefined {
  const joined = tokens.join(" ").trim();
  if (joined === "^") return { local: "point" };
  if (joined === "^/") return { local: "bearing" };
  const { refs, invalid } = parseRefs(tokens);
  if (invalid.length > 0 || refs.length === 0) {
    const positional = invalid.some(part => /^@\^|\^/.test(part));
    diagnostics.push({
      severity: "error",
      code: "MALFORMED_BEARING_TARGETS",
      message: invalidRefsMessage("targets", invalid) + (positional ? " Positional targets are written ^ or ^/ alone, without @." : ""),
      sourceSpan
    });
    return undefined;
  }
  if (refs.length > 1) {
    diagnostics.push({
      severity: "error",
      code: "MULTIPLE_BEARING_TARGETS_UNSUPPORTED",
      message: "Operator clauses accept exactly one target; edge declarations can have multiple sources.",
      sourceSpan
    });
    return undefined;
  }
  return refs[0];
}

// The family token is "_" or "_/" after canonicalization; any other spelling is
// a case error or a role glued to the family. Sources and target vary
// independently: members or references, a name or a positional slot.
function parseBearingConstructor(raw: string, head: AnnotationHead, sourceSpan?: SourceSpan): AnnotationParseResult {
  const diagnostics: Diagnostic[] = [];
  type BearingError = "operator" | "handle" | "selector" | "mode";
  const errors = new Set<BearingError>();
  const fail = (error: BearingError, code: string, message: string) => {
    errors.add(error);
    diagnostics.push({ severity: "error", code, message, sourceSpan });
  };
  const parts = head.canonicalRaw.trim().split(";").map(part => part.trim());
  const handle = parts.length === 2 ? parseSingleRef(parts[1]) : undefined;
  if (parts.length > 2) fail("operator", "MALFORMED_ANNOTATION", "Annotation may contain at most one Bearing handle separator.");
  else if (parts.length === 2 && !handle) fail("handle", "MALFORMED_BEARING_HANDLE", "Bearing handle separator ';' must be followed by exactly one valid @id.");
  const [family, ...rest] = splitTokens(parts[0]);
  let operatorClause: BearingOperatorClause | undefined;
  let selector = false;

  if (errors.has("operator")) {
    // A second handle separator leaves no reliable clause to read.
  } else if (/^(?:_|bearing|edge)[QCGORD]/i.test(family)) {
    fail("mode", "MALFORMED_BEARING_MODE", "A Bearing header states a relation, not a role." + roleHeaderHint(family.replace(/^(?:_|bearing|edge)/i, "")));
  } else if (family !== "_" && family !== "_/") {
    fail("operator", "MALFORMED_EXPLICIT_BEARING", "Bearing family spellings are lowercase: write _, bearing or edge.");
  } else if (rest.some(token => token === "undercuts")) {
    fail("operator", "RETIRED_BEARING_KIND", "The named undercuts spelling is retired. To preserve a challenge to a Bearing, replace undercuts with -> and recompile the original source. This does not classify a theory-specific undercut.");
  } else if (rest.some(token => token === "about")) {
    fail("operator", "RETIRED_BEARING_KIND", "The named about spelling is retired. Use concerns or ~> and recompile the original source; do not relabel old JSON.");
  } else if (family === "_/") {
    selector = true;
    if (rest.length) fail("selector", "MALFORMED_LOCAL_BEARING_SELECTOR", "[_/] states joint concerns to the locally exposed Bearing and takes no further tokens; for another relation write a clause such as [_ -> ^/].");
  } else if (rest.length === 0) {
    // [_]: joint concerns from the members to the nearest Point.
  } else if (ROLE_HEADED_BEARING_RE.test(rest[0])) {
    fail("mode", "MALFORMED_BEARING_MODE", "A Bearing header states a relation, not a role." + roleHeaderHint(rest[0]) + markCaseHint(rest[0]));
  } else if (head.sources === "members") {
    operatorClause = parseOperatorClause(rest[0], "members", rest.slice(1), sourceSpan, diagnostics) as BearingOperatorClause | undefined;
    if (!operatorClause) errors.add("operator");
  } else if (head.sources === "references") {
    const opIndex = rest.findIndex(isRelationToken);
    if (opIndex < 0) {
      fail("operator", "MALFORMED_EXPLICIT_BEARING", "Explicit Bearings require sources, a symbolic operator or canonical kind, and one target." + edgeKindHint(["_", ...rest]) + proseHint(["_", ...rest]));
    } else {
      operatorClause = parseOperatorClause(rest[opIndex], rest.slice(0, opIndex), rest.slice(opIndex + 1), sourceSpan, diagnostics) as BearingOperatorClause | undefined;
      if (!operatorClause) errors.add("operator");
    }
  } else {
    const missingOperator = /^\^\/?$/.test(rest[0]) ? ` Write the operator before the target, as in [_ +> ${rest[0]}].`
      : rest[0] === "/" && rest.length === 1 ? " For joint relevance to the exposed Bearing, write [_/] without a space."
      : proseHint(["_", ...rest]);
    fail("mode", "MALFORMED_BEARING_MODE",
      "The first token after _, bearing or edge selects the mode: an operator or kind for member sources ([_ +> ^]), @ref for listed sources ([_ @a +> @claim]), use ([_ use @route]) or note ([_ note]). [_] alone records joint relevance to the nearest Point." + missingOperator);
  }
  return {
    annotation: {
      kind: "bearing",
      members: head.sources === "members",
      raw,
      ...(operatorClause ? { operatorClause } : {}),
      ...(selector ? { selector: "attachment" as const } : {}),
      ...(handle ? { handle } : {}),
      ...(errors.size ? { syntaxErrors: [...errors] } : {})
    },
    diagnostics
  };
}

// The unreleased 0.6 role-lettered headers and the relation each one meant.
const ROLE_HEADER_CLAUSES = new Map<string, string>([
  ["G", "+> ^"], ["O", "-> ^"], ["R", "respondsTo ^"], ["D", "clarifies ^"], ["Q", "~> ^"],
  ["G/", "+> ^/"], ["O/", "-> ^/"], ["Q/", "~> ^/"], ["D/", "clarifies ^/"]
]);

function roleHeaderHint(token: string): string {
  if (token.toUpperCase() === "R/") return " respondsTo requires a Point target, so write [_ respondsTo ^] for the nearest Point, or [_ @source respondsTo @target] with named endpoints.";
  const clause = ROLE_HEADER_CLAUSES.get(token.toUpperCase());
  return clause ? ` Write [_ ${clause}]; the operator names the relation and the direct neutral children are its sources.` : " Write an operator and target, such as [_ +> ^].";
}

// ^ and ^/ are target terms, not handles: a mark already implies its relation toward them.
function targetTermHint(role: string, token: string): string | undefined {
  const term = /^@?(\^\/?)$/.exec(token)?.[1];
  if (!term) return undefined;
  const mark = role.replace(/\/$/, "").toUpperCase() + (term === "^/" ? "/" : "");
  const clause = ROLE_HEADER_CLAUSES.get(mark);
  return clause
    ? ` ${term} is a target term and follows an operator: write [${mark}], or [${mark.replace("/", "")} ${clause}] to spell the relation.`
    : ` ${term} is a target term and follows an operator, as in [G +> ^].`;
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
        message: "Role Bearing annotations must look like [O -> @target] or [O @id -> ^/]." + jointSourceHint(prefix, clause),
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

// Each mark abbreviates one relation. C and . state none.
export const MARK_RELATIONS: Partial<Record<Role, BearingKind>> = {
  Q: "concerns", G: "supports", O: "challenges", R: "respondsTo", D: "clarifies"
};

/**
 * The relation an annotation authors, with its shorthand expanded: [G] is
 * [G +> ^], [G/] is [G +> ^/], [_] is [_ ~> ^] and [_/] is [_ ~> ^/]. A
 * written clause is returned as authored. Defaults depend only on the
 * occurrence's own mark, never on its context. A failed header authors none.
 */
export function expandedClause(annotation: Annotation | undefined): OperatorClause | undefined {
  if (!annotation || annotation.kind === "invalid" || annotation.syntaxErrors?.length) return undefined;
  if (annotation.kind === "bearing") {
    if (annotation.operatorClause) return annotation.operatorClause;
    // Only [_] and [_/] abbreviate a clause; listed sources always write one.
    return annotation.members ? { op: "concerns", sources: "members", target: { local: annotation.selector ? "bearing" : "point" } } : undefined;
  }
  if (annotation.kind !== "role" && annotation.kind !== "material" && annotation.kind !== "use") return undefined;
  if (annotation.operatorClause) return annotation.operatorClause;
  const role = "role" in annotation ? annotation.role : undefined;
  const op = role ? MARK_RELATIONS[role] : undefined;
  const selector = "selector" in annotation && annotation.selector;
  return op ? { op, sources: "self", target: { local: selector ? "bearing" : "point" } } : undefined;
}

/** Whether a clause is exactly what the annotation's mark or family abbreviates. */
export function isAbbreviatedClause(annotation: Annotation, clause: OperatorClause): boolean {
  if (isNamedTarget(clause.target)) return false;
  if (annotation.kind === "bearing") return clause.sources === "members" && clause.op === "concerns";
  const role = "role" in annotation ? annotation.role : undefined;
  if (!role || MARK_RELATIONS[role] !== clause.op) return false;
  return clause.target.local === "point" || SELECTOR_MARK_RE.test(role + "/");
}

/**
 * Respell a relation-bearing header with another target. This is a lexical
 * edit of the authored text: only the target term changes, together with the
 * clause or selector slash that the shortest spelling needs, so [G +> ^]
 * becomes [G], [G/] becomes [G +> @route] and [_ ~> ^/] becomes [_/]. Mark,
 * operand, sources, operator spelling, handle and whitespace stay as written.
 */
export function respellTarget(annotation: Annotation, target: TargetTerm): string {
  return respellClause(annotation, { target });
}

/**
 * Respell a relation-bearing header with another kind or target, as one
 * lexical edit. Sources, mark, operand, handle and whitespace stay as
 * written; an unchanged kind keeps its authored operator spelling, and the
 * result is abbreviated exactly when the mark or family states the clause.
 */
export function respellClause(annotation: Annotation, change: { op?: BearingKind; target?: TargetTerm }): string {
  const authored = expandedClause(annotation);
  if (!authored || (annotation.kind !== "role" && annotation.kind !== "material" && annotation.kind !== "use" && annotation.kind !== "bearing")) {
    throw new Error("respellClause requires a header that authors a relation.");
  }
  const raw = annotation.raw;
  const separator = raw.indexOf(";");
  const main = separator < 0 ? raw : raw.slice(0, separator);
  const tokens = [...main.matchAll(/\S+/g)].map(match => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
  const mark = tokens[0];
  const opIndex = tokens.findIndex(token => isRelationSpelling(token.text));
  const clause = { ...authored, ...change };
  const abbreviated = isAbbreviatedClause(annotation, clause);
  const operator = (written?: string) => clause.op === authored.op && written ? written : operatorSymbol(clause.op) ?? clause.op;

  // The clause occupies the operator and target tokens; a mark default writes none.
  let clauseStart: number, clauseEnd: number, spelled: string;
  if (opIndex >= 0) {
    clauseStart = tokens[opIndex - 1].end;
    clauseEnd = tokens[tokens.length - 1].end;
    const gap = main.slice(clauseStart, tokens[opIndex].start);
    spelled = gap + operator(tokens[opIndex].text) + main.slice(tokens[opIndex].end, tokens[opIndex + 1].start) + targetSpelling(clause.target);
  } else {
    clauseStart = clauseEnd = tokens[tokens.length - 1].end;
    spelled = ` ${operator()} ${targetSpelling(clause.target)}`;
  }
  // Only the abbreviated form toward ^/ is spelled with a selector slash.
  const markText = mark.text.replace(/\/$/, "") + (abbreviated && clause.target.local === "bearing" ? "/" : "");
  return main.slice(0, mark.start) + markText + main.slice(mark.end, clauseStart) + (abbreviated ? "" : spelled) + main.slice(clauseEnd) + raw.slice(main.length);
}

/** The authored spelling of a target term. */
export function targetSpelling(target: TargetTerm): string {
  return isNamedTarget(target) ? "@" + target.id : target.local === "point" ? "^" : "^/";
}

/** A clause's operator and target as written, preferring the symbolic operator. */
export function clauseSpelling(clause: Pick<OperatorClause, "op" | "target">): string {
  return `${operatorSymbol(clause.op) ?? clause.op} ${targetSpelling(clause.target)}`;
}

const KIND_NAMES = [...RELATION_TOKENS.keys()].filter(key => /^[a-z]/i.test(key));
const KIND_SYMBOLS = new Map<string, string>([["supports", "+>"], ["challenges", "->"], ["concerns", "~>"]]);

/** Whether a token is a current operator or canonical kind spelling. */
export function isRelationSpelling(token: string): boolean {
  return RELATION_TOKENS.has(token);
}

/** The symbolic spelling for a canonical kind, if it has one. */
export function operatorSymbol(kind: BearingKind): string | undefined {
  return KIND_SYMBOLS.get(kind);
}

// Hints guide authoring without changing diagnostic codes or severities.
function pointOnlySelectorHint(token: string): string {
  if (!/^R\/$/i.test(token)) return "";
  return "respondsTo requires a Point target, so there is no [R/]: write [R] for the nearest Point, or [R respondsTo @target] with a named Point target." + markCaseHint(token);
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

function edgeKindHint(tokens: string[]): string {
  const word = tokens.slice(1).find(token => !token.startsWith("@") && token !== ",");
  if (!word || !tokens[1]?.startsWith("@")) return "";
  return kindHint(word);
}

function kindHint(word: string): string {
  const exact = KIND_NAMES.find(kind => kind.toLowerCase() === word.toLowerCase());
  return exact
    ? ` Kind names are case-sensitive: write ${exact}, not ${word}.`
    : ` ${word} is not a canonical kind; use +>, ->, ~> or one of ${KIND_NAMES.join(", ")}.`;
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
