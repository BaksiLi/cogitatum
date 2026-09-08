import type {
  Annotation,
  AnnotationSyntaxError,
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
const OP_TO_BEARING: Record<string, BearingOp> = {
  "+>": "supports",
  "->": "challenges",
  "_>": "undercuts",
  "~>": "about"
};

export type AnnotationParseResult = {
  annotation?: Annotation;
  diagnostics: Diagnostic[];
};

export function parseAnnotation(raw: string, sourceSpan?: SourceSpan): AnnotationParseResult {
  const diagnostics: Diagnostic[] = [];
  const trimmed = raw.trim();
  const semicolonParts = trimmed.split(";").map((part) => part.trim());

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

  const opIndex = tokens.findIndex((token) => token in OP_TO_BEARING);
  if (opIndex >= 0) {
    const prefix = tokens.slice(0, opIndex);
    const targets = tokens.slice(opIndex + 1);
    const op = tokens[opIndex];

    if (prefix[0] === "edge") {
      const operatorClause = parseOperatorClause(op, prefix.slice(1), targets, sourceSpan, diagnostics);
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
        operatorClause: operatorClause ? { ...operatorClause, sources: "self" } : undefined,
        syntaxErrors: syntaxErrors(!operatorClause, invalidHandle),
        handle
      },
      diagnostics
    };
  }

  const first = tokens[0];
  if (first === "edge") {
    diagnostics.push({
      severity: "error",
      code: "MALFORMED_EDGE_ANNOTATION",
      message: "Edge annotations require sources, an operator, and one target.",
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

  const anchor = parseSingleRef(first);
  if (anchor) {
    if (tokens.length > 1) {
      diagnostics.push({
        severity: "error",
        code: "MALFORMED_ANCHOR_ANNOTATION",
        message: "Anchor-only annotations must look like [@id].",
        sourceSpan
      });
      return { diagnostics };
    }
    return {
      annotation: {
        kind: "anchor",
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
  const op = OP_TO_BEARING[opToken];
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

function syntaxErrors(invalidOperator: boolean, invalidHandle: boolean): AnnotationSyntaxError[] | undefined {
  const errors: AnnotationSyntaxError[] = [];
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
): Extract<Annotation, { kind: "role" | "gap" | "anchor" }> | undefined {
  const first = prefix[0];
  const parsedRole = first ? parseRoleToken(first) : undefined;

  if (parsedRole) {
    const anchor = prefix[1] ? parseSingleRef(prefix[1]) : undefined;
    if (prefix.length > 2 || (prefix[1] && !anchor)) {
      diagnostics.push({
        severity: "error",
        code: "MALFORMED_ROLE_BEARING",
        message: "Role Bearing annotations must look like [O _> @target] or [O @id _> @target].",
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

  const anchor = prefix.length === 1 ? parseSingleRef(prefix[0]) : undefined;
  if (anchor) {
    return { kind: "anchor", anchor, raw };
  }

  diagnostics.push({
    severity: "error",
    code: "MALFORMED_EXPLICIT_BEARING",
    message: "Operator clauses must begin with a role, ?, @id, or the edge keyword.",
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
