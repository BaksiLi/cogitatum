import { isAnnotationStart, isRetiredClaimStart, parseAnnotation, recognizeAnnotationHead } from "./annotation.js";
import { FORMAT_VERSION } from "./types.js";
import type { Annotation, AstBlock, SelectorRole, Diagnostic, DocumentAst, ParsedLine, ParseOptions, SourceSpan } from "./types.js";

type RawNode = {
  line: ParsedLine;
  header: string;
  rawLines: string[];
  continuationPrefix: string;
  text: string;
  annotationRaw?: string;
  indentationValid: boolean;
  literal: boolean;
  noteBoundary: boolean;
  children: RawNode[];
  sourceSpan: SourceSpan;
};

export function parseDocument(source: string, options: ParseOptions = {}): DocumentAst {
  const diagnostics: Diagnostic[] = [];
  const rawRoots = parseRawOutline(source, diagnostics, options.lineOffset ?? 0, options.lineColumnOffsets ?? []);
  const blocks = rawRoots.map((node) => toAstBlock(node, diagnostics));

  return {
    version: FORMAT_VERSION,
    blocks,
    diagnostics
  };
}

function parseRawOutline(
  source: string,
  diagnostics: Diagnostic[],
  lineOffset: number,
  columnOffsets: number[]
): RawNode[] {
  // Mapping errors belong to the API caller, not to the author's source.
  // Reject them before returning coordinates that cannot locate original text.
  if (!Number.isSafeInteger(lineOffset) || lineOffset < 0) {
    throw new RangeError("lineOffset must be a nonnegative safe integer.");
  }
  if (columnOffsets.some(offset => !Number.isSafeInteger(offset) || offset < 0)) {
    throw new RangeError("lineColumnOffsets must contain nonnegative safe integers.");
  }
  const roots: RawNode[] = [];
  const stack: RawNode[] = [];
  let continuation: RawNode | undefined;
  let blankLines: string[] = [];
  // Only bullet indentation chooses the unit's style. Continuation padding
  // belongs to the current block and does not introduce another outline level.
  let unitIndentation: "\t" | " " | undefined;
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (!Number.isSafeInteger(lineOffset + lines.length)) {
    throw new RangeError("lineOffset places source lines beyond the safe integer range.");
  }

  lines.forEach((rawLine, index) => {
    if (rawLine.trim() === "") {
      if (continuation) blankLines.push(rawLine);
      return;
    }

    const columnOffset = columnOffsets[index] ?? 0;
    if (!Number.isSafeInteger(rawLine.length + 1 + columnOffset)) {
      throw new RangeError(`lineColumnOffsets places source line ${index + 1} beyond the safe integer range.`);
    }
    // Lines are already split; Unicode separators inside prose remain content.
    const match = /^([ \t]*)-(\s+)(.*)$/s.exec(rawLine);
    if (!match) {
      if (continuation && rawLine.startsWith(continuation.continuationPrefix)) {
        // Only the most recent block can continue. Never reopen an ancestor
        // after a child: its prose would otherwise move ahead of that child.
        continuation.text += "\n".repeat(blankLines.length + 1) + rawLine.slice(continuation.continuationPrefix.length);
        continuation.rawLines.push(...blankLines, rawLine);
        continuation.sourceSpan.endLine = index + 1 + lineOffset;
        continuation.sourceSpan.endColumn = rawLine.length + 1 + columnOffset;
        blankLines = [];
        return;
      }
      diagnostics.push({
        severity: "error",
        code: "UNSUPPORTED_LINE",
        message: "Start a block with '- ', or continue the preceding block using its exact bullet indentation followed by spaces replacing the bullet marker and separator. A continuation cannot reopen an ancestor after a child.",
        sourceSpan: spanForLine(index + 1 + lineOffset, 1 + columnOffset, rawLine.length + 1 + columnOffset)
      });
      continuation = undefined;
      blankLines = [];
      return;
    }

    const indentText = match[1];
    const indent = indentText.length;
    const content = match[3];
    const contentColumn = indent + 2 + match[2].length + columnOffset;
    let indentationValid = true;
    let indentationDiagnostic: Diagnostic | undefined;

    const lineIndentation = indentText === "" ? undefined
      : indentText.includes("\t") && indentText.includes(" ") ? "mixed"
      : indentText[0] as "\t" | " ";
    if (lineIndentation && lineIndentation !== "mixed" && !unitIndentation) {
      unitIndentation = lineIndentation;
    }
    if (lineIndentation && lineIndentation !== unitIndentation) {
      indentationValid = false;
      indentationDiagnostic = {
        severity: "error",
        code: "MIXED_INDENTATION",
        message: lineIndentation === "mixed"
          ? "This bullet's indentation mixes tabs and spaces. Use either tabs or spaces for bullet indentation throughout a Cogitatum source unit."
          : `This source unit indents bullets with ${indentationName(unitIndentation!)}, but this bullet uses ${indentationName(lineIndentation)}. Use either tabs or spaces for bullet indentation throughout.`,
        sourceSpan: spanForLine(index + 1 + lineOffset, 1 + columnOffset, rawLine.length + 1 + columnOffset)
      };
    }

    let parent: RawNode | undefined;
    if (stack.length === 0) {
      if (indent !== 0 && !indentationDiagnostic) {
        indentationValid = false;
        indentationDiagnostic = {
          severity: "error",
          code: "INDENTED_ROOT_UNSUPPORTED",
          message: "A root block must begin at indentation column 0 inside its Cogitatum source unit. Fix the outline layout first: if the fragment has a common left margin, remove it from every line while preserving relative indentation; if a parent bullet was omitted, restore it at column 0.",
          sourceSpan: spanForLine(index + 1 + lineOffset, 1 + columnOffset, rawLine.length + 1 + columnOffset)
        };
      }
    } else if (indent > stack[stack.length - 1].line.indent) {
      parent = stack[stack.length - 1];
    } else {
      while (stack.length > 0 && indent < stack[stack.length - 1].line.indent) {
        stack.pop();
      }

      if (stack.length > 0 && indent === stack[stack.length - 1].line.indent) {
        const matchedLevel = stack.pop();
        if (!matchedLevel?.indentationValid && !indentationDiagnostic) {
          indentationValid = false;
          indentationDiagnostic = unmatchedDedentDiagnostic(
            index + 1 + lineOffset,
            indent,
            unitIndentation,
            rawLine.length,
            columnOffset
          );
        }
      } else if (indent !== 0 && !indentationDiagnostic) {
        indentationValid = false;
        indentationDiagnostic = unmatchedDedentDiagnostic(index + 1 + lineOffset, indent, unitIndentation, rawLine.length, columnOffset);
      }
      parent = stack[stack.length - 1];
    }

    if (indentationDiagnostic) {
      diagnostics.push(indentationDiagnostic);
    }

    const literal = Boolean(parent?.literal || parent?.noteBoundary);
    const noteBoundary = !literal && content.startsWith("[") &&
      recognizeAnnotationHead(content.slice(1).split("]")[0]).operation === "note";
    const retiredClaim = !literal && content.startsWith("[") && isRetiredClaimStart(content.slice(1).split("]")[0]);
    const bracketMatch = !literal && (indentationValid || noteBoundary || retiredClaim) ? /^\[([^\]]+)\]\s*(.*)$/s.exec(content) : undefined;
    // Closing a prose bracket must not turn ordinary text into an annotation.
    // Recognize misspelled case and retired spellings for diagnostics;
    // parseAnnotation still enforces the actual, case-sensitive grammar.
    const annotationMatch = bracketMatch && (noteBoundary || isAnnotationStart(bracketMatch[1])) ? bracketMatch : undefined;
    const malformedPrefix = !literal && !noteBoundary && !annotationMatch && classifyMalformedAnnotationPrefix(content);
    if (indentationValid && malformedPrefix) {
      diagnostics.push({
        severity: "error",
        code: "MALFORMED_ANNOTATION_PREFIX",
        message:
          malformedPrefix === "empty"
            ? "Cogitatum annotation prefix cannot be empty."
            : "Cogitatum annotation prefix is missing a closing ']'.",
        sourceSpan: spanForLine(index + 1 + lineOffset, contentColumn, rawLine.length + 1 + columnOffset)
      });
    }
    const node: RawNode = {
      line: {
        lineNumber: index + 1 + lineOffset,
        indent,
        text: rawLine,
        contentColumn
      },
      header: content,
      rawLines: [rawLine],
      continuationPrefix: indentText + " ".repeat(1 + match[2].length),
      annotationRaw: annotationMatch?.[1],
      text: annotationMatch ? annotationMatch[2] : content,
      indentationValid,
      literal,
      noteBoundary,
      children: [],
      sourceSpan: spanForLine(index + 1 + lineOffset, contentColumn, rawLine.length + 1 + columnOffset)
    };

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
    continuation = node;
    blankLines = [];
  });

  return roots;
}

function unmatchedDedentDiagnostic(
  line: number,
  indent: number,
  unitIndentation: "\t" | " " | undefined,
  lineLength: number,
  columnOffset: number
): Diagnostic {
  return {
    severity: "error",
    code: "UNMATCHED_DEDENT",
    message: `Indentation of ${indent} ${indentationName(unitIndentation ?? " ", indent)} does not match a valid active outline level. Fix any earlier layout errors first, then align this block with an established level (or column 0 for a root).`,
    sourceSpan: spanForLine(line, 1 + columnOffset, lineLength + 1 + columnOffset)
  };
}

function indentationName(indentation: "\t" | " ", count = 2): string {
  return (indentation === "\t" ? "tab" : "space") + (count === 1 ? "" : "s");
}

function classifyMalformedAnnotationPrefix(content: string): "empty" | "unclosed" | undefined {
  if (content.startsWith("[]")) {
    return "empty";
  }
  if (!content.startsWith("[") || content.includes("]")) {
    return undefined;
  }

  return isAnnotationStart(content.slice(1)) ? "unclosed" : undefined;
}

function toAstBlock(node: RawNode, diagnostics: Diagnostic[]): AstBlock {
  // Recognition is confined to the bullet header. Brackets on continuation
  // lines are prose and cannot complete or repair a malformed annotation.
  const header = node.header;
  if (node.literal || node.noteBoundary) {
    const parsed = node.noteBoundary ? parseAnnotation(node.annotationRaw ?? header.slice(1), node.sourceSpan) : undefined;
    const annotation = parsed?.annotation;
    if (parsed) diagnostics.push(...parsed.diagnostics);
    if (annotation?.kind === "note" && (!node.annotationRaw || !node.indentationValid)) {
      annotation.syntaxErrors = ["note"];
      if (!parsed?.diagnostics.length) diagnostics.push({ severity: "error", code: "MALFORMED_NOTE", message: "A note requires a closed header and valid outline indentation.", sourceSpan: node.sourceSpan });
    }
    return {
      kind: "block",
      text: node.text,
      raw: node.rawLines.join("\n"),
      children: node.children.map(child => toAstBlock(child, diagnostics)),
      sourceSpan: node.sourceSpan,
      ...(annotation ? { annotation } : {})
    };
  }
  // Failed constructors retain their context boundary even without a closing bracket.
  const head = recognizeAnnotationHead(header.slice(1));
  const unclosedConstructor = node.indentationValid && !node.annotationRaw && header.startsWith("[") && !header.includes("]")
    ? head.family === "bearing" ? "_" : /^\[\s*(?:[QCGORD][/_]?\s+)?(linked|join)(?=$|[\s;])/i.exec(header)?.[1].toLowerCase()
    : undefined;
  const retiredClaimRaw = !node.annotationRaw && header.startsWith("[") && isRetiredClaimStart(header.slice(1)) ? header.slice(1) : undefined;
  const annotationRaw = node.annotationRaw ?? retiredClaimRaw ?? (unclosedConstructor === "join" || unclosedConstructor === "linked" ? header.slice(1) : undefined);
  const unclosedSelector = node.indentationValid && !node.annotationRaw && !header.includes("]") && /^\[\s*(?:[GO][_/]|[QD]\/)(?=$|[\s;@])/i.test(header);
  const unclosedUse = node.indentationValid && !node.annotationRaw && header.startsWith("[") && !header.includes("]") && head.operation === "use";
  const unclosedBearingUse = unclosedConstructor === "_" && head.operation === "use";
  const unclosedMembersBearing = unclosedConstructor === "_" && head.sources === "members";
  const parsed = annotationRaw ? parseAnnotation(annotationRaw, node.sourceSpan) : undefined;
  if (parsed) {
    diagnostics.push(...parsed.diagnostics);
  }
  if (!parsed && !node.annotationRaw && node.indentationValid && header.startsWith("[") && !header.includes("]") && isAnnotationStart(header.slice(1))) {
    diagnostics.push(...parseAnnotation(header.slice(1), node.sourceSpan).diagnostics.filter(diagnostic => ["RETIRED_AUTHORING_SYNTAX", "RETIRED_CLAIM_OPENNESS", "RETIRED_GAP_ANNOTATION", "RETIRED_LINKED_ANNOTATION"].includes(diagnostic.code)));
  }
  // A layout error rejects the annotation, not its boundary. Treating it as
  // body would let descendants invent attachments to a more distant Point.
  const misindentedRaw = !node.indentationValid && header.startsWith("[") ? header.slice(1).split("]")[0] : undefined;
  const misindentedAnnotation = misindentedRaw !== undefined && isAnnotationStart(misindentedRaw)
    ? { kind: "invalid" as const, raw: misindentedRaw } : undefined;
  let annotation: Annotation | undefined;
  if (parsed?.annotation?.kind === "invalid") {
    annotation = parsed.annotation;
  } else if (misindentedAnnotation) {
    annotation = misindentedAnnotation;
  } else if (unclosedBearingUse) {
    annotation = { kind: "bearingUse", raw: header.slice(1), syntaxErrors: ["reference"] };
  } else if (unclosedMembersBearing) {
    // Member sources keep their boundary; specific header errors still surface.
    const members = parseAnnotation(header.slice(1), node.sourceSpan);
    diagnostics.push(...members.diagnostics);
    const syntaxErrors = members.annotation?.kind === "bearing" ? members.annotation.syntaxErrors ?? [] : [];
    annotation = { kind: "bearing", members: true, raw: header.slice(1), syntaxErrors: [...new Set(["operator" as const, ...syntaxErrors])] };
  } else if (unclosedUse) {
    // Retain clear selector intent so an unfinished use cannot become a joint source.
    const role = /^\[\s*([GOQD])\/\s+use(?=$|[\s;])/i.exec(header)?.[1].toUpperCase() as SelectorRole | undefined;
    annotation = role
      ? { kind: "use", role, selector: "attachment", raw: header.slice(1), syntaxErrors: ["reference"] }
      : { kind: "use", raw: header.slice(1), syntaxErrors: ["reference"] };
  } else if (unclosedSelector) {
    annotation = { kind: "invalid", raw: header.slice(1), selector: "attachment" };
  } else if (parsed?.annotation) {
    annotation = parsed.annotation;
  } else if (unclosedConstructor === "_") {
    annotation = { kind: "bearing", members: false, raw: header.slice(1), syntaxErrors: [head.sources === "unselected" ? "mode" : "operator"] };
  } else if (parsed?.diagnostics.length || (node.indentationValid && !node.annotationRaw && classifyMalformedAnnotationPrefix(header))) {
    annotation = { kind: "invalid", raw: node.annotationRaw ?? header.slice(1) };
  }
  return {
    kind: "block",
    text: node.text,
    raw: node.rawLines.join("\n"),
    children: node.children.map((child) => toAstBlock(child, diagnostics)),
    sourceSpan: node.sourceSpan,
    annotation
  };
}

function spanForLine(line: number, startColumn: number, endColumn: number): SourceSpan {
  return {
    startLine: line,
    startColumn,
    endLine: line,
    endColumn
  };
}
