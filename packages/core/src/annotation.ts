import type {
  Annotation,
  BearingKind,
  BearingOp,
  Diagnostic,
  OperatorClause,
  Ref,
  Role,
  SourceSpan
} from "./types.js";

const ROLE_RE = /^(Q|C|G|O|R|D)$/;
const INVALID_OPEN_ROLE_RE = /^(Q|G|O|R|D)\?$/;
const ANCHOR_RE = /^@([a-z][a-z0-9_-]*)$/;
const OP_TO_BEARING = new Map<string, BearingOp>([
  ["+>", "supports"],
  ["->", "challenges"],
  ["/>", "undercuts"],
  ["~>", "about"]
]);
const EDGE_TO_BEARING = new Map<string, BearingKind>([
  ...OP_TO_BEARING,
  ["supports", "supports"],
  ["challenges", "challenges"],
  ["undercuts", "undercuts"],
  ["about", "about"],
  ["answers", "answers"],
  ["repliesTo", "repliesTo"],
  ["clarifies", "clarifies"]
]);

export type AnnotationParseResult = {
  annotation?: Annotation;
  diagnostics: Diagnostic[];
};

export function parseAnnotation(raw: string, sourceSpan?: SourceSpan): AnnotationParseResult {
  const retired = /^\s*(?:@[a-z]|use(?=$|;|\s+@)|[GO]_)/i.test(raw) || /(?:^|\s)_>(?=$|\s)/.test(raw);
  if (retired) {
    const normalized = raw.replace(/^(\s*)@/, "$1. @").replace(/^(\s*)use(?=$|[\s;])/i, "$1. use").replace(/^(\s*)([GO])_/i, "$1$2/").replace(/_>/g, "/>");
    const parsed = parseCurrentAnnotation(normalized, sourceSpan);
    const annotation = parsed.annotation;
    if (annotation && annotation.kind !== "invalid" && annotation.kind !== "linked") {
      annotation.raw = raw;
      annotation.syntaxErrors = [...(annotation.syntaxErrors ?? []), "retired"];
      if (annotation.kind === "use" && /^\s*use(?=$|;|\s+@)/i.test(raw)) annotation.syntaxErrors.push("reference");
    }
    return { annotation: /^\s*@/.test(raw) ? { kind: "invalid", raw } : annotation ?? { kind: "invalid", raw }, diagnostics: [{ severity: "error", code: "RETIRED_AUTHORING_SYNTAX", message: "Retired authoring spelling; migrate this annotation to [" + normalized + "] and reparse the original source.", sourceSpan }, ...parsed.diagnostics] };
  }
  return parseCurrentAnnotation(raw, sourceSpan);
}

function parseCurrentAnnotation(raw: string, sourceSpan?: SourceSpan): AnnotationParseResult {
  const diagnostics: Diagnostic[] = [];
  const trimmed = raw.trim();
  const semicolonParts = trimmed.split(";").map((part) => part.trim());
  const edgeIntent = /^(?:edge|_)(?=$|[\s;])/i.test(trimmed);

  if (/^join(?=$|[\s;])/i.test(trimmed)) {
    return {
      annotation: { kind: "linked", raw, syntaxErrors: ["linked"] },
      diagnostics: [{ severity: "error", code: "RETIRED_JOIN_ANNOTATION",
        message: "The join keyword is retired. Replace a grouping header with [linked] or [linked; @route], then recompile the original source.", sourceSpan }]
    };
  }
  const useIntent = /^(?:([QCGORD](?:\?|\/)?|\?|\.)\s+)use(?=$|[\s;])/i.exec(trimmed);
  if (useIntent) {
    const tokens = splitTokens(semicolonParts[0]);
    const useIndex = useIntent[1] ? 1 : 0;
    const mark = useIntent[1];
    const role = mark && /^[QCGORD]$/.test(mark) ? mark as Role : mark === "G/" || mark === "O/" ? mark[0] as "G" | "O" : undefined;
    const selector = mark === "G/" || mark === "O/" ? "attachment" as const : undefined;
    const operand = tokens[useIndex + 1] ? parseSingleRef(tokens[useIndex + 1]) : undefined;
    const handle = semicolonParts.length === 2 ? parseSingleRef(semicolonParts[1]) : undefined;
    const errors: ("reference" | "operator" | "selector" | "handle")[] = [];
    if (tokens[useIndex] !== "use" || (mark !== "." && !role) || !operand || semicolonParts.length > 2) {
      errors.push("reference");
      diagnostics.push({ severity: "error", code: "MALFORMED_POINT_USE", message: "Point uses must look like [. use @id] or [G use @id]; occurrence status is unsupported.", sourceSpan });
    }
    const suffix = tokens.slice(useIndex + 2);
    let operatorClause: (OperatorClause & { op: BearingOp; sources: "self" }) | undefined;
    if (suffix.length) {
      if (selector) {
        errors.push("selector");
        diagnostics.push({ severity: "error", code: "LOCAL_SELECTOR_WITH_EXPLICIT_CLAUSE", message: "A local selector and an explicit operator clause are mutually exclusive.", sourceSpan });
      } else if (OP_TO_BEARING.has(suffix[0])) {
        const clause = parseOperatorClause(suffix[0], "self", suffix.slice(1), sourceSpan, diagnostics);
        if (clause) operatorClause = { ...clause, op: OP_TO_BEARING.get(suffix[0])!, sources: "self" };
        else errors.push("operator");
      } else {
        errors.push("reference");
        diagnostics.push({ severity: "error", code: "MALFORMED_POINT_USE", message: "After a Point use operand, only a complete symbolic operator clause is permitted.", sourceSpan });
      }
    }
    if (semicolonParts.length === 2 && !handle) {
      errors.push("handle");
      diagnostics.push({ severity: "error", code: "MALFORMED_BEARING_HANDLE", message: "Bearing handle separator ';' must be followed by exactly one valid @id.", sourceSpan });
    }
    const base = { kind: "use" as const, ref: operand ? { id: operand } : undefined, handle, raw, syntaxErrors: errors.length ? errors : undefined };
    return { annotation: selector ? { ...base, role: mark === "G/" ? "G" : "O", selector } : { ...base, role, operatorClause }, diagnostics };
  }
  if (/^linked(?=$|[\s;])/i.test(trimmed)) {
    const main = semicolonParts[0];
    const handle = semicolonParts.length === 2 ? parseSingleRef(semicolonParts[1]) : undefined;
    const invalidSyntax = main !== "linked" || semicolonParts.length > 2;
    const invalidHandle = semicolonParts.length === 2 && !handle;
    if (invalidSyntax) {
      diagnostics.push({ severity: "error", code: "MALFORMED_LINKED_ANNOTATION",
        message: "Linked annotations must look like [linked] or [linked; @route].", sourceSpan });
    }
    if (invalidHandle) {
      diagnostics.push({ severity: "error", code: "MALFORMED_BEARING_HANDLE",
        message: "Bearing handle separator ';' must be followed by exactly one valid @id.", sourceSpan });
    }
    const errors: ("linked" | "handle")[] = [];
    if (invalidSyntax) errors.push("linked");
    if (invalidHandle) errors.push("handle");
    return { annotation: { kind: "linked", raw, handle,
      syntaxErrors: errors.length ? errors : undefined }, diagnostics };
  }

  const selectorIntent = /^([QCGORD?])\//i.exec(trimmed);
  if (selectorIntent) {
    const role = selectorIntent[1].toUpperCase();
    if (role !== "G" && role !== "O") {
      diagnostics.push({ severity: "error", code: "UNSUPPORTED_LOCAL_BEARING_SELECTOR", message: "Only G/ and O/ select a local Bearing attachment.", sourceSpan });
      return { annotation: { kind: "invalid", raw }, diagnostics };
    }
    const tokens = splitTokens(semicolonParts[0]);
    const anchor = tokens.length === 2 ? parseSingleRef(tokens[1]) : undefined;
    const handle = semicolonParts.length === 2 ? parseSingleRef(semicolonParts[1]) : undefined;
    const combined = tokens.some(token => OP_TO_BEARING.has(token));
    const invalidSelector = tokens[0] !== role + "/" || tokens.length > 2 || (tokens.length === 2 && !anchor) || semicolonParts.length > 2;
    const invalidHandle = semicolonParts.length === 2 && !handle;
    const errors: ("selector" | "handle")[] = [];
    if (invalidSelector) {
      errors.push("selector");
      diagnostics.push({ severity: "error", code: combined ? "LOCAL_SELECTOR_WITH_EXPLICIT_CLAUSE" : "MALFORMED_LOCAL_BEARING_SELECTOR", message: combined ? "A local selector and an explicit operator clause are mutually exclusive; use G +> @route or O /> @route instead." : "Local selectors must look like [G/], [O/ @id], or [O/ @id; @attack].", sourceSpan });
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
      annotation: edgeIntent ? { kind: "edge", raw, syntaxErrors: ["operator"] } : undefined,
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

  const opIndex = tokens.findIndex((token) => (edgeIntent ? EDGE_TO_BEARING : OP_TO_BEARING).has(token));
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
          message: "Edge annotations must begin with the lowercase edge keyword.",
          sourceSpan
        });
      }
      return {
        annotation: {
          kind: "edge",
          operatorClause: operatorClause as (OperatorClause & { sources: Ref[] }) | undefined,
          syntaxErrors: syntaxErrors(!operatorClause, invalidHandle),
          handle,
          raw
        },
        diagnostics
      };
    }

    const host = parseBearingHost(prefix, raw, sourceSpan, diagnostics);
    if (!host) {
      return { diagnostics };
    }

    const operatorClause = parseOperatorClause(op, "self", targets, sourceSpan, diagnostics);
    return {
      annotation: {
        ...host,
        operatorClause: operatorClause ? { ...operatorClause, op: OP_TO_BEARING.get(op)!, sources: "self" } : undefined,
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
      code: "MALFORMED_EDGE_ANNOTATION",
      message: "Edge annotations require sources, a symbolic operator or canonical kind, and one target.",
      sourceSpan
    });
    return {
      annotation: {
        kind: "edge",
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
        message: "Role annotations must look like [C], [C?], or [C @id].",
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

  if (first === "?") {
    const anchor = tokens[1] ? parseSingleRef(tokens[1]) : undefined;
    if (tokens.length > 2 || (tokens[1] && !anchor)) {
      diagnostics.push({
        severity: "error",
        code: "MALFORMED_GAP_ANNOTATION",
        message: "Gap annotations must look like [?] or [? @id].",
        sourceSpan
      });
      return { diagnostics };
    }
    return {
      annotation: {
        kind: "gap",
        status: "open",
        anchor,
        syntaxErrors: invalidHandle ? ["handle"] : undefined,
        handle,
        raw
      },
      diagnostics
    };
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
    message: `Could not parse Cogitatum annotation [${raw}].`,
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
  const op = EDGE_TO_BEARING.get(opToken);
  if (!op || (sourceTokens !== "self" && sourceTokens.length === 0) || targetTokens.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "MALFORMED_EXPLICIT_BEARING",
      message: "Operator clause must include sources, an operator, and one target.",
      sourceSpan
    });
    return undefined;
  }

  const sourceResult = sourceTokens === "self" ? undefined : parseRefs(sourceTokens);
  const targetResult = parseRefs(targetTokens);
  const sources = sourceTokens === "self" ? "self" : (sourceResult?.refs ?? []);
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

  return { op, sources, target: targets[0] };
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
  raw: string,
  sourceSpan: SourceSpan | undefined,
  diagnostics: Diagnostic[]
): (Extract<Annotation, { kind: "role" | "gap" | "material" }> & { selector?: never }) | undefined {
  const first = prefix[0];
  const parsedRole = first ? parseRoleToken(first) : undefined;

  if (parsedRole) {
    const anchor = prefix[1] ? parseSingleRef(prefix[1]) : undefined;
    if (prefix.length > 2 || (prefix[1] && !anchor)) {
      diagnostics.push({
        severity: "error",
        code: "MALFORMED_ROLE_BEARING",
        message: "Role Bearing annotations must look like [O /> @target] or [O @id /> @target].",
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

  if (first === "?") {
    const anchor = prefix[1] ? parseSingleRef(prefix[1]) : undefined;
    if (prefix.length > 2 || (prefix[1] && !anchor)) {
      diagnostics.push({
        severity: "error",
        code: "MALFORMED_GAP_BEARING",
        message: "Gap Bearing annotations must look like [? ~> @target] or [? @id ~> @target].",
        sourceSpan
      });
      return undefined;
    }
    return { kind: "gap", status: "open", anchor, raw };
  }

  const anchor = prefix[1] ? parseSingleRef(prefix[1]) : undefined;
  if (first === "." && prefix.length <= 2 && (!prefix[1] || anchor)) {
    return { kind: "material", anchor, raw };
  }

  diagnostics.push({
    severity: "error",
    code: "MALFORMED_EXPLICIT_BEARING",
    message: "Operator clauses must begin with a role, ?, ., edge or _.",
    sourceSpan
  });
  return undefined;
}

function parseSingleRef(token: string): string | undefined {
  const match = ANCHOR_RE.exec(token.trim());
  return match?.[1];
}

function parseRoleToken(token: string):
  | { role: "C"; status?: "open" }
  | { role: Exclude<Role, "C">; status?: never }
  | undefined {
  if (token === "C?") {
    return { role: "C", status: "open" };
  }
  const match = ROLE_RE.exec(token);
  return match ? { role: match[1] as Role } : undefined;
}

function openStatusDiagnostic(sourceSpan: SourceSpan | undefined): Diagnostic {
  return {
    severity: "error",
    code: "OPEN_STATUS_REQUIRES_CLAIM",
    message: "Only C may carry role-level open status. Use C? for an open Claim or ? for an open Gap.",
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
