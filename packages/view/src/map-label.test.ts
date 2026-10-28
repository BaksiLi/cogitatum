import { describe, expect, it } from "vitest";
import { labelWidth, mapLabel, wrapMapLabel } from "./map-label.js";

const measure = (text: string, code = false) => Array.from(text).length * (code ? 2 : 1);
const wording = (lines: ReturnType<typeof wrapMapLabel>) => lines.map(line => line.map(run => run.text).join(""));

describe("Map inline code", () => {
  it("keeps prose and code as separate runs without interpreting other Markdown or HTML", () => {
    expect(mapLabel("Call `answer()` and `next()`; **plain** <em>text</em>.")).toEqual([
      { text: "Call " }, { text: "answer()", code: true }, { text: " and " },
      { text: "next()", code: true }, { text: "; **plain** <em>text</em>." }
    ]);
    expect(mapLabel("`only()`")).toEqual([{ text: "only()", code: true }]);
    expect(mapLabel("")).toEqual([]);
  });

  it("leaves unmatched, escaped and longer delimiters literal", () => {
    for (const text of ["unfinished `code", "\\`escaped\\`", "``double `inner` ticks``", "```ts\n`inner`\n```", "```ts\n`inner`"]) {
      expect(mapLabel(text)).toEqual([{ text }]);
    }
    expect(mapLabel("``literal`` then `code`")).toEqual([
      { text: "``literal`` then " }, { text: "code", code: true }
    ]);
    expect(mapLabel("\\\\`code`")).toEqual([{ text: "\\\\" }, { text: "code", code: true }]);
  });

  it("normalizes code newlines and delimiter padding while retaining interior spaces", () => {
    expect(mapLabel("` one\ntwo `")).toEqual([{ text: "one two", code: true }]);
    expect(mapLabel("`a  b`")).toEqual([{ text: "a  b", code: true }]);
  });

  it("wraps by rendered width and keeps code styling across lines", () => {
    const lines = wrapMapLabel("Say `aa bb` now", 10, 3, measure);
    expect(wording(lines)).toEqual(["Say aa", "bb now"]);
    expect(lines[0]).toEqual([{ text: "Say " }, { text: "aa", code: true }]);
    expect(lines[1]).toEqual([{ text: "bb", code: true }, { text: " now" }]);
    expect(lines.every(line => labelWidth(line, measure) <= 10)).toBe(true);
  });

  it("keeps words whole across style boundaries and retains CJK wrapping", () => {
    expect(wording(wrapMapLabel("x a`bb`c", 7, 3, measure))).toEqual(["x", "abbc"]);
    expect(wording(wrapMapLabel("\u6c34\u6cf5`AB`\u5b89\u5168", 6, 3, measure))).toEqual(["\u6c34\u6cf5AB", "\u5b89\u5168"]);
  });

  it("truncates without leaking delimiters, splitting Unicode or inventing omitted content", () => {
    const lines = wrapMapLabel("`aa bb` after", 10, 1, measure);
    expect(wording(lines)).toEqual(["aa b\u2026"]);
    expect(lines[0][0].code).toBe(true);
    expect(labelWidth(lines[0], measure)).toBeLessThanOrEqual(10);
    expect(wording(wrapMapLabel("`aa`   ", 4, 1, measure))).toEqual(["aa"]);
    expect(wording(wrapMapLabel("`\u{1f600}\u{1f600}` after", 4, 1, measure))).toEqual(["\u{1f600}\u2026"]);
  });
});
