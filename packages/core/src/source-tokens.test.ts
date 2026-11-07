import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDocument } from "./outline.js";
import { tokenizeSource, type SourceLine } from "./source-tokens.js";

const text = (line: SourceLine) => line.tokens.map(token => token.text).join("");
const kinds = (line: SourceLine) => line.tokens.filter(token => token.kind).map(token => `${token.kind}:${token.text}`);

describe("lexical source tokens", () => {
  it("reproduce every line exactly, including CRLF, lone CR and unclosed headers", () => {
    const source = "- [C @claim] Claim `code`.\r\n  - [G +> @claim; @step] Reason.\r  continuation\n- [O unclosed\r\n";
    expect(tokenizeSource(source).map(text)).toEqual(source.split(/\r\n|\r|\n/));
  });

  it("reproduce every conformance fixture", () => {
    const directory = new URL("../../../fixtures/core/", import.meta.url);
    for (const file of readdirSync(directory).filter(name => name.endsWith(".cog.md"))) {
      const source = readFileSync(new URL(file, directory), "utf8");
      expect(tokenizeSource(source).map(text), file).toEqual(source.split(/\r\n|\r|\n/));
    }
  });

  it("distinguish roles, structural marks, names, operators and relation words only inside a bullet header", () => {
    const [claim, joint, selector, body] = tokenizeSource("- [C @claim] Claim.\n  - [_ @a, @b challenges ^/] Both.\n    - [O/ use @a] Again.\n  - prose [G] with @name and -> inside.");
    expect(claim.role).toBe("C");
    expect(kinds(claim)).toEqual(["bullet:- ", "mark:[", "role:C", "name:@claim", "mark:]"]);
    expect(joint.role).toBe("_");
    expect(kinds(joint)).toEqual(["bullet:  - ", "mark:[", "mark:_", "name:@a", "punct:,", "name:@b", "relation:challenges", "operator:^/", "mark:]"]);
    expect(kinds(selector)).toEqual(["bullet:    - ", "mark:[", "role:O/", "mark:use", "name:@a", "mark:]"]);
    expect(kinds(body)).toEqual(["bullet:  - "]);
  });

  it("show retired spellings that the compiler diagnoses", () => {
    const lines = tokenizeSource("- [C] A.\n  - [G_] Old selector.\n  - [_ linked] Old.\n  - [O /> ^] Old operator.\n  - [C?] Old claim.");
    expect(lines.slice(1).map(line => kinds(line).filter(kind => kind.startsWith("retired")))).toEqual([["retired:G_"], ["retired:linked"], ["retired:/>"], ["retired:C?"]]);
  });

  it("keep a note subtree literal until the outline returns to its level", () => {
    const lines = tokenizeSource("- [C] Claim.\n  - [note] Check.\n    - [G] literal\n    more\n  - [G] Compiled.");
    expect(lines.map(line => line.note)).toEqual([false, true, true, true, false]);
    expect(lines[4].role).toBe("G");
  });

  it("follow the compiler's reading of note, not the word", () => {
    const lines = tokenizeSource("- [C] Claim.\n  - [G note] Child-bearing prose.\n    - [O] Compiled child.\n  - [note @bad] Malformed note.\n    - [O] Literal child.\n  - [point note] Alias note.\n    - [O] Literal alias child.");
    expect(lines.map(line => line.note)).toEqual([false, false, false, true, true, true, true]);
  });

  it("agree with the outline parser about which lines carry an annotation", () => {
    const source = "- Context with [G] in prose.\n- [C @claim] A claim\n  [O] on a continuation is prose.\n  - [G] A ground.";
    const annotated = new Set<number>();
    const visit = (block: ReturnType<typeof parseDocument>["blocks"][number]): void => {
      if (block.annotation) annotated.add(block.sourceSpan.startLine);
      block.children.forEach(visit);
    };
    parseDocument(source).blocks.forEach(visit);
    const tokenized = tokenizeSource(source).flatMap((line, index) => line.tokens.some(token => token.annotation) ? [index + 1] : []);
    expect(tokenized).toEqual([...annotated].sort((a, b) => a - b));
  });
});
