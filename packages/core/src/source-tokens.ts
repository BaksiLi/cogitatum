import { isSeparatedAfterAnnotation, parseAnnotation } from "./annotation.js";
import { extractCogitatumSourceUnits } from "./source.js";
import type { SourceParseMode } from "./types.js";

/**
 * Lexical classes shared by every highlighter: editors, terminal output and language servers.
 * `mark` is structure (brackets, `.`, `_`, family words, `use`, `note`); `role` is a Point role,
 * optionally with `/` or `?`; `retired` is a spelling the compiler diagnoses rather than compiles.
 */
export type SourceTokenKind = "bullet" | "mark" | "role" | "name" | "operator" | "relation" | "punct" | "code" | "note" | "retired";

/** One display token; a line's token texts concatenate back to the line exactly. */
export type SourceToken = { text: string; kind?: SourceTokenKind; annotation?: true };
/** `role` is the header's first mark, as written: a role such as `G/`, `.` or `_`, or `note`. */
export type SourceLine = { tokens: SourceToken[]; role?: string; note: boolean };
/** A tokenized line placed in its host file: one-based `line`, and the one-based UTF-16 `column` of its first token. */
export type PlacedSourceLine = SourceLine & { line: number; column: number };

const BULLET = /^(\s*)([-*+])(\s+)/;
const RELATIONS = new Set(["supports", "challenges", "concerns", "respondsTo", "interprets", "answers"]);
const KEYWORDS = new Set(["use", "point", "bearing", "by"]);
const PROFILES = new Set(["example"]);
const RETIRED = new Set(["/>", "_>", "about", "repliesTo", "clarifies", "undercuts", "linked", "join", "node", "edge"]);
const HEAD = /^\s*([QCGORD][?/_]?|[._]\/?)(?=[\s\];@,]|$)/u;
const INSIDE = /(@[\p{L}\p{N}_-]+)|([+\-~/_]>|\^\/?)|([\p{L}]+)|([;,/])|(\s+)|(.)/gu;

/**
 * Lexical tokens for highlighting only; the compiler owns interpretation.
 * Annotations are recognized on bullet headers, as the outline parser does, and a note keeps its
 * subtree literal until the outline returns to its level. Prose is never tokenized as syntax.
 */
export function tokenizeSource(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let noteIndent: number | undefined;
  for (const line of source.split(/\r\n|\r|\n/)) {
    const bullet = BULLET.exec(line);
    const indent = /^\s*/.exec(line)![0].length;
    if (noteIndent !== undefined && line.trim() && indent <= noteIndent) noteIndent = undefined;
    if (noteIndent !== undefined) { lines.push({ tokens: [{ text: line, kind: "note" }], note: true }); continue; }
    if (!bullet) { lines.push({ tokens: prose(line), note: false }); continue; }
    const tokens: SourceToken[] = [{ text: bullet[0], kind: "bullet" }];
    const rest = line.slice(bullet[0].length);
    const close = rest.startsWith("[") ? rest.indexOf("]") : -1;
    if (close < 0) { lines.push({ tokens: [...tokens, ...prose(rest)], note: false }); continue; }
    const inner = rest.slice(1, close);
    const head = HEAD.exec(inner);
    const isNote = parseAnnotation(inner).annotation?.kind === "note";
    // The parser rejects an annotation glued to its prose; show it as prose, keeping a note's subtree literal.
    if (!isSeparatedAfterAnnotation(rest.slice(close + 1))) {
      if (isNote) noteIndent = indent;
      lines.push({ tokens: [...tokens, ...prose(rest)], note: false });
      continue;
    }
    tokens.push({ text: "[", kind: "mark" });
    let consumed = 0;
    if (head) {
      const leading = inner.slice(0, head[0].length - head[1].length);
      if (leading) tokens.push({ text: leading });
      tokens.push({ text: head[1], kind: /^[._]/.test(head[1]) ? "mark" : /^(?:[GO]_|C\?)$/i.test(head[1]) ? "retired" : "role" });
      consumed = head[0].length;
    }
    for (const match of inner.slice(consumed).matchAll(INSIDE)) {
      const [text, name, operator, word, punct] = match;
      if (name) tokens.push({ text, kind: "name" });
      else if (operator) tokens.push({ text, kind: RETIRED.has(operator) ? "retired" : "operator" });
      else if (word && RELATIONS.has(word)) tokens.push({ text, kind: "relation" });
      else if (word && KEYWORDS.has(word)) tokens.push({ text, kind: "mark" });
      else if (word && PROFILES.has(word)) tokens.push({ text, kind: "relation" });
      else if (word && RETIRED.has(word)) tokens.push({ text, kind: "retired" });
      else if (word === "note" && isNote) tokens.push({ text, kind: "mark" });
      else if (punct) tokens.push({ text, kind: "punct" });
      else tokens.push({ text });
    }
    tokens.push({ text: "]", kind: "mark" });
    for (const token of tokens) if (token.kind !== "bullet") token.annotation = true;
    tokens.push(...prose(rest.slice(close + 1)));
    if (isNote) noteIndent = indent;
    lines.push({ tokens, role: isNote ? "note" : head?.[1], note: isNote });
  }
  return lines;
}

/**
 * Tokens for every Cogitatum line of a file, placed at host positions.
 * A Markdown host contributes only its fences; an indented fence's lines start after the indentation Core removed.
 */
export function tokenizeHostSource(source: string, mode: SourceParseMode = "document"): PlacedSourceLine[] {
  const hostLines = source.split(/\r\n|\r|\n/);
  return extractCogitatumSourceUnits(source, mode).flatMap(unit => tokenizeSource(unit.source).map((line, index) => {
    const number = unit.startLine + index;
    const length = line.tokens.reduce((total, token) => total + token.text.length, 0);
    return { ...line, line: number, column: (hostLines[number - 1]?.length ?? length) - length + 1 };
  }));
}

/** Inline code spans are the only lexical structure inside prose. */
function prose(text: string): SourceToken[] {
  const tokens: SourceToken[] = [];
  let last = 0;
  for (const match of text.matchAll(/`[^`\n]+`/g)) {
    if (match.index > last) tokens.push({ text: text.slice(last, match.index) });
    tokens.push({ text: match[0], kind: "code" });
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last) });
  return tokens;
}
