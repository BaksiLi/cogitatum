import { parseAnnotation } from "./annotation.js";
import { FORMAT_VERSION } from "./types.js";
import type { AstBlock, Diagnostic, DocumentAst, ParsedLine, ParseOptions, SourceSpan } from "./types.js";

type RawNode = {
  line: ParsedLine;
  text: string;
  annotationRaw?: string;
  indentationValid: boolean;
  children: RawNode[];
  sourceSpan: SourceSpan;
};

const RESERVED_ANNOTATION_START_RE =
  /^(?:[QCGORD](?:\?)?(?=$|[\s@;+_~>-])|\?(?=$|[\s@;+_~>-])|edge(?=$|\s)|scope(?=$|\s)|@)/i;

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
  const roots: RawNode[] = [];
  const stack: RawNode[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  lines.forEach((rawLine, index) => {
    if (rawLine.trim() === "") {
      return;
    }

    const columnOffset = columnOffsets[index] ?? 0;
    const match = /^([ \t]*)-\s+(.*)$/.exec(rawLine);
    if (!match) {
      diagnostics.push({
        severity: "error",
        code: "UNSUPPORTED_LINE",
        message: "The outline parser only supports bullet blocks beginning with '- '.",
        sourceSpan: spanForLine(index + 1 + lineOffset, 1 + columnOffset, rawLine.length + 1 + columnOffset)
      });
      return;
    }

    const indentText = match[1];
    const indent = indentText.length;
    const content = match[2];
    const contentColumn = indent + 3 + columnOffset;
    let indentationValid = true;
    let indentationDiagnostic: Diagnostic | undefined;

    if (indentText.includes("\t")) {
      indentationValid = false;
      indentationDiagnostic = {
        severity: "error",
        code: "TAB_INDENTATION_UNSUPPORTED",
        message: "Cogitatum source-unit indentation must use spaces, not tabs.",
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
          message: "A root block must begin at indentation column 0 inside its Cogitatum source unit.",
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
            rawLine.length,
            columnOffset
          );
        }
      } else if (indent !== 0 && !indentationDiagnostic) {
        indentationValid = false;
        indentationDiagnostic = unmatchedDedentDiagnostic(index + 1 + lineOffset, indent, rawLine.length, columnOffset);
      }
      parent = stack[stack.length - 1];
    }

    if (indentationDiagnostic) {
      diagnostics.push(indentationDiagnostic);
    }

    const bracketMatch = indentationValid ? /^\[([^\]]+)\]\s*(.*)$/.exec(content) : undefined;
    // Closing a prose bracket must not turn ordinary text into an annotation.
    // Recognize misspelled case and the retired scope prefix for diagnostics;
    // parseAnnotation still enforces the actual, case-sensitive grammar.
    const annotationMatch = bracketMatch && isAnnotationCandidate(bracketMatch[1]) ? bracketMatch : undefined;
    const malformedPrefix = !annotationMatch && classifyMalformedAnnotationPrefix(content);
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
      annotationRaw: annotationMatch?.[1],
      text: annotationMatch ? annotationMatch[2] : content,
      indentationValid,
      children: [],
      sourceSpan: spanForLine(index + 1 + lineOffset, contentColumn, rawLine.length + 1 + columnOffset)
    };

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
  });

  return roots;
}

function unmatchedDedentDiagnostic(
  line: number,
  indent: number,
  lineLength: number,
  columnOffset: number
): Diagnostic {
  return {
    severity: "error",
    code: "UNMATCHED_DEDENT",
    message: `Dedent to ${indent} spaces does not match an active ancestor indentation level.`,
    sourceSpan: spanForLine(line, 1 + columnOffset, lineLength + 1 + columnOffset)
  };
}

function classifyMalformedAnnotationPrefix(content: string): "empty" | "unclosed" | undefined {
  if (content.startsWith("[]")) {
    return "empty";
  }
  if (!content.startsWith("[") || content.includes("]")) {
    return undefined;
  }

  return isAnnotationCandidate(content.slice(1)) ? "unclosed" : undefined;
}

function isAnnotationCandidate(raw: string): boolean {
  return raw.trim() === "" || RESERVED_ANNOTATION_START_RE.test(raw.trimStart());
}

function toAstBlock(node: RawNode, diagnostics: Diagnostic[]): AstBlock {
  const parsed = node.annotationRaw ? parseAnnotation(node.annotationRaw, node.sourceSpan) : undefined;
  if (parsed) {
    diagnostics.push(...parsed.diagnostics);
  }
  const annotation = parsed?.annotation;
  return {
    kind: "block",
    text: node.text,
    raw: node.line.text,
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
