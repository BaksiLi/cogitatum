import type { Diagnostic } from "./types.js";

export function formatDiagnostic(diagnostic: Diagnostic): string[] {
  const span = diagnostic.sourceSpan;
  const location = span ? ` at ${span.startLine}:${span.startColumn}-${span.endLine}:${span.endColumn}` : "";
  const lines = [`  ${diagnostic.severity} ${quote(diagnostic.code)}${location}: ${quote(diagnostic.message)}`];
  if (diagnostic.explanation !== undefined) lines.push(`    explanation: ${quote(diagnostic.explanation)}`);
  return lines;
}

export function quote(value: string): string {
  // Keep authored controls, separators and bidi overrides from impersonating
  // another inspection record or visually rearranging its relation.
  return JSON.stringify(value).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, character =>
    character.split("").map(unit => "\\u" + unit.charCodeAt(0).toString(16).padStart(4, "0")).join(""));
}
