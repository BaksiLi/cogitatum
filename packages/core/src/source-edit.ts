import type { AstBlock, SourceParseMode } from "./types.js";

/** offset counts UTF-16 code units in originalSource. */
export type SourceEdit = { offset: number; remove: string; insert: string };

/** The smallest replacement turning before into after, located in source at offset. */
export function minimalEdit(before: string, after: string, offset = 0): SourceEdit {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { offset: offset + start, remove: before.slice(start, before.length - end), insert: after.slice(start, after.length - end) };
}

/** The occurrence whose own lines contain line; literal note subtrees are not occurrences. */
export function findBlock(blocks: AstBlock[], line: number): AstBlock | undefined {
  for (const block of blocks) {
    if (block.sourceSpan.startLine <= line && line <= block.sourceSpan.endLine) return block;
    if (block.annotation?.kind !== "note") {
      const found = findBlock(block.children, line);
      if (found) return found;
    }
  }
  return undefined;
}

/** The parent of block among blocks, or undefined for a root. */
export function parentBlock(blocks: AstBlock[], block: AstBlock): AstBlock | undefined {
  for (const candidate of blocks) {
    if (candidate.children.includes(block)) return candidate;
    const found = parentBlock(candidate.children, block);
    if (found) return found;
  }
  return undefined;
}

/** The last line of block and all of its descendants, including literal subtrees. */
export function subtreeEndLine(block: AstBlock): number {
  return Math.max(block.sourceSpan.endLine, ...block.children.map(subtreeEndLine));
}

/** Line endings as the parser of each mode recognizes them. */
export function lineEndings(mode: SourceParseMode): RegExp {
  return mode === "host" ? /\r\n|\r|\n/g : /\r?\n/g;
}

export function lineStart(source: string, line: number, mode: SourceParseMode): number {
  let offset = 0, current = 1;
  for (const ending of source.matchAll(lineEndings(mode))) {
    if (current++ === line) break;
    offset = ending.index + ending[0].length;
  }
  return offset;
}

/** One physical line, split from its terminator. */
export type SourceLine = { text: string; ending: string };

export function splitLines(source: string, mode: SourceParseMode): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (const ending of source.matchAll(lineEndings(mode))) {
    lines.push({ text: source.slice(start, ending.index), ending: ending[0] });
    start = ending.index + ending[0].length;
  }
  lines.push({ text: source.slice(start), ending: "" });
  return lines;
}

/** Whether the source contains "[raw]" exactly at the block's annotation. */
export function annotationOffset(source: string, block: AstBlock, mode: SourceParseMode): number | undefined {
  const raw = block.annotation?.raw;
  if (raw === undefined) return undefined;
  const offset = lineStart(source, block.sourceSpan.startLine, mode) + block.sourceSpan.startColumn;
  return source.slice(offset - 1, offset + raw.length + 1) === "[" + raw + "]" ? offset : undefined;
}

/** Structural equality with sorted keys, ignoring undefined fields and any omitted keys. */
export function same(left: unknown, right: unknown, omitted: string[] = []): boolean {
  const normalize = (_key: string, value: unknown): unknown => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([key, v]) => !omitted.includes(key) && v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : value;
  return JSON.stringify(left, normalize) === JSON.stringify(right, normalize);
}
