import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSourceEdits, explainSource } from "@cogitatum/core";
import { describe, expect, it } from "vitest";
import { createLanguageServer, semanticTokens, sourceModeFor } from "./lsp.js";
import type { Message, Position, Range } from "./lsp.js";

type TextEdit = { range: Range; newText: string };
type QuickFix = {
  title: string;
  kind: string;
  diagnostics: { code: string; range: Range }[];
  edit: { documentChanges: { textDocument: { uri: string; version: number }; edits: TextEdit[] }[] };
};

const DOCUMENT = "file:///notes/inquiry.cog.md";
const SOURCE = [
  "- [C @observation] Two retries timed out.",
  "- [C @claim] The shared configuration may explain the timeouts.",
  "  - [G use @observation; @step] The observation matters here.",
  "- [C @second] The evidence motivates a controlled test.",
  "  - [G use @claim; @serial] Reuse the earlier Claim as a Ground."
].join("\n");

function session() {
  const sent: Message[] = [];
  const server = createLanguageServer(message => sent.push(message));
  let id = 0;
  const request = (method: string, params: unknown) => {
    const requestId = ++id;
    server.handle({ jsonrpc: "2.0", id: requestId, method, params });
    const reply = sent.find(message => message.id === requestId)!;
    return reply;
  };
  const notify = (method: string, params: unknown) => server.handle({ jsonrpc: "2.0", method, params });
  const open = (text: string, uri = DOCUMENT, version = 1) => notify("textDocument/didOpen", { textDocument: { uri, languageId: "markdown", version, text } });
  const diagnostics = (uri = DOCUMENT) => sent.filter(message => message.method === "textDocument/publishDiagnostics" && message.params.uri === uri).at(-1)!.params.diagnostics;
  const at = (method: string, position: Position, extra: object = {}, uri = DOCUMENT) => request(method, { textDocument: { uri }, position, ...extra });
  const actions = (range: Range, uri = DOCUMENT) => request("textDocument/codeAction", { textDocument: { uri }, range, context: { diagnostics: [] } }).result as QuickFix[];
  return { server, sent, request, notify, open, diagnostics, at, actions };
}

function applyFix(text: string, action: QuickFix): string {
  const starts = [0, ...Array.from(text.matchAll(/\r\n|\r|\n/g), match => match.index + match[0].length)];
  const offset = ({ line, character }: Position) => starts[line] + character;
  const [change] = action.edit.documentChanges;
  expect(action.edit.documentChanges).toHaveLength(1);
  expect(change.edits).toHaveLength(1);
  const [{ range, newText }] = change.edits;
  return text.slice(0, offset(range.start)) + newText + text.slice(offset(range.end));
}

/** The position of the first character of `@name` on a zero-based line. */
function nameAt(text: string, line: number, name: string): Position {
  return { line, character: text.split("\n")[line].indexOf(`@${name}`) + 1 };
}

describe("cog lsp", () => {
  it("selects document mode only for dedicated Cogitatum files", () => {
    expect(sourceModeFor("file:///a/inquiry.cog.md")).toBe("document");
    expect(sourceModeFor("file:///a/inquiry.cog")).toBe("document");
    expect(sourceModeFor("file:///a/notes.md")).toBe("host");
  });

  it("publishes compiler diagnostics with UTF-16 ranges for every revision and clears them on close", () => {
    const { open, notify, diagnostics } = session();
    const broken = "- [C @claim] 素數 😀 claim.\n  - [G +> @missing] 漢字 😀 reason.";
    open(broken);
    const [unknown] = diagnostics();
    expect(unknown).toMatchObject({ code: "UNKNOWN_TARGET", severity: 1, source: "cogitatum" });
    expect(unknown.range.start.line).toBe(1);
    expect(unknown.range.end.character).toBe(broken.split("\n")[1].length);

    notify("textDocument/didChange", { textDocument: { uri: DOCUMENT, version: 2 }, contentChanges: [{ text: SOURCE }] });
    expect(diagnostics()).toEqual([]);
    notify("textDocument/didClose", { textDocument: { uri: DOCUMENT } });
    expect(diagnostics()).toEqual([]);
  });

  it("publishes related spans as relatedInformation in the same document", () => {
    const { open, diagnostics } = session();
    open("- [C @outer] Outer.\n  - [. use @missing] Local use.\n    - [G @child] Through it.");
    const [unknown] = diagnostics();
    expect(unknown).toMatchObject({ code: "UNKNOWN_POINT_REFERENCE" });
    expect(unknown.relatedInformation).toEqual([
      { location: { uri: DOCUMENT, range: { start: { line: 2, character: 6 }, end: { line: 2, character: 28 } } }, message: "Attaches through this use; compiles once it resolves." }
    ]);
  });

  it("resolves definitions, references and hover through compiler-validated names", () => {
    const { open, at } = session();
    open(SOURCE);
    const use = nameAt(SOURCE, 2, "observation");
    expect(at("textDocument/definition", use).result).toEqual({
      uri: DOCUMENT,
      range: { start: nameAt(SOURCE, 0, "observation"), end: { line: 0, character: nameAt(SOURCE, 0, "observation").character + "observation".length } }
    });
    const references = at("textDocument/references", use, { context: { includeDeclaration: false } }).result as { range: { start: Position } }[];
    expect(references.map(reference => reference.range.start)).toEqual([use]);
    expect(at("textDocument/hover", use).result).toMatchObject({ contents: { value: "**[C @observation]** Point\n\nTwo retries timed out." } });
    expect(at("textDocument/hover", nameAt(SOURCE, 2, "step")).result).toMatchObject({ contents: { value: expect.stringContaining("**@step** Bearing") } });
    // Prose and marks without a name resolve nothing.
    expect(at("textDocument/definition", { line: 1, character: 20 }).result).toBeNull();
  });

  it("renames every occurrence of one entity and refuses invalid or taken names", () => {
    const { open, at } = session();
    open(SOURCE);
    const declaration = nameAt(SOURCE, 1, "claim");
    expect(at("textDocument/prepareRename", declaration).result).toMatchObject({ placeholder: "claim" });
    const edit = at("textDocument/rename", declaration, { newName: "hypothesis" }).result as { changes: Record<string, { range: { start: Position }; newText: string }[]> };
    expect(edit.changes[DOCUMENT].map(change => [change.range.start, change.newText])).toEqual([
      [declaration, "hypothesis"],
      [nameAt(SOURCE, 4, "claim"), "hypothesis"]
    ]);
    expect(at("textDocument/rename", declaration, { newName: "Not valid" }).error).toMatchObject({ code: -32803 });
    expect(at("textDocument/rename", declaration, { newName: "@second" }).error).toMatchObject({ code: -32803, message: "@second is already declared in this inquiry." });
  });

  it("keeps the outline while source errors withhold name resolution", () => {
    const { open, at, request } = session();
    const broken = SOURCE + "\n  - [G +> @missing] Unknown target.";
    open(broken);
    const symbols = request("textDocument/documentSymbol", { textDocument: { uri: DOCUMENT } }).result as { name: string; detail?: string; children: { name: string }[] }[];
    expect(symbols.map(symbol => symbol.detail)).toEqual(["[C @observation]", "[C @claim]", "[C @second]"]);
    expect(symbols[2].children.map(child => child.name)).toEqual(["Reuse the earlier Claim as a Ground.", "Unknown target."]);
    expect(at("textDocument/definition", nameAt(broken, 2, "observation")).result).toBeNull();
    expect(at("textDocument/prepareRename", nameAt(broken, 2, "observation")).error).toMatchObject({ code: -32803, message: "Resolve source errors before renaming." });
  });

  it("keeps names local to each fence of a Markdown host in host coordinates", () => {
    const { open, at } = session();
    const uri = "file:///notes/journal.md";
    const host = ["# Journal", "", "```cog", "- [C @claim] First.", "  - [G use @claim; @route] Again.", "```", "", "```cog", "- [C @claim] Second.", "```"].join("\n");
    open(host, uri);
    const definition = at("textDocument/definition", nameAt(host, 4, "claim"), {}, uri).result as { range: { start: Position } };
    expect(definition.range.start).toEqual(nameAt(host, 3, "claim"));
    const references = at("textDocument/references", nameAt(host, 8, "claim"), { context: { includeDeclaration: true } }, uri).result as unknown[];
    expect(references).toHaveLength(1);
  });

  it("encodes the shared lexical tokens, including only the fences of a Markdown host", () => {
    // Decode LSP's relative encoding back to [line, character, text, type, modifiers].
    const decode = (text: string, data: number[]) => {
      const lines = text.split("\n"), tokens: [number, number, string, number, number][] = [];
      let line = 0, character = 0;
      for (let index = 0; index < data.length; index += 5) {
        line += data[index]; character = data[index] ? data[index + 1] : character + data[index + 1];
        tokens.push([line, character, lines[line].slice(character, character + data[index + 2]), data[index + 3], data[index + 4]]);
      }
      return tokens;
    };
    const document = "- [C @claim] 漢字 😀 `code`.\n  - [G /> @claim] Old.";
    expect(decode(document, semanticTokens(document, "document"))).toEqual([
      [0, 2, "[", 0, 0], [0, 3, "C", 1, 0], [0, 5, "@claim", 2, 0], [0, 11, "]", 0, 0], [0, 19, "`code`", 4, 0],
      [1, 4, "[", 0, 0], [1, 5, "G", 1, 0], [1, 7, "/>", 0, 1], [1, 10, "@claim", 2, 0], [1, 16, "]", 0, 0]
    ]);
    const host = "Prose with - [C] in it.\n\n  ```cog\n  - [O @doubt] Indented fence.\n  ```";
    expect(decode(host, semanticTokens(host, "host"))).toEqual([[3, 4, "[", 0, 0], [3, 5, "O", 1, 0], [3, 7, "@doubt", 2, 0], [3, 13, "]", 0, 0]]);
  });

  it("offers Core's checked framing repairs as quick fixes for an opposed framing only", () => {
    const { open, actions, diagnostics } = session();
    const opposed = "- [C @delay] 應延後採用。\n- [O @cost +> @delay] 成本超出預算。";
    open(opposed, DOCUMENT, 7);
    expect(diagnostics()).toEqual([expect.objectContaining({ code: "OPPOSED_FRAMING" })]);
    const fixes = actions(diagnostics()[0].range);
    expect(fixes.map(action => action.title)).toEqual([
      "Re-mark as G, keeping the clause",
      "Re-mark as neutral (.), keeping the clause",
      "Re-mark as G and keep the objection as an unbound use at root"
    ]);
    for (const fix of fixes) {
      expect(fix.diagnostics).toEqual([expect.objectContaining({ code: "OPPOSED_FRAMING" })]);
      expect(fix.kind).toBe("quickfix");
      expect(fix.edit).not.toHaveProperty("changes");
      expect(fix.edit.documentChanges[0].textDocument).toEqual({ uri: DOCUMENT, version: 7 });
    }
    const results = fixes.map(fix => applyFix(opposed, fix));
    expect(results).toEqual([
      opposed.replace("[O", "[G"),
      opposed.replace("[O", "[."),
      opposed.replace("[O", "[G") + "\n- [O use @cost]"
    ]);
    for (const result of results) {
      const readback = explainSource(result);
      expect(readback.diagnostics).toEqual([]);
      expect(readback.graphs[0].points).toHaveLength(2);
      expect(readback.graphs[0].bearings.map(bearing => bearing.kind)).toEqual(["supports"]);
    }
    expect(actions({ start: { line: 0, character: 0 }, end: { line: 0, character: 0 } })).toEqual([]);
  });

  it.each(["\n", "\r\n"])("offers explicit Ground-under-Question choices with UTF-16 edits using %j endings", ending => {
    const { open, actions, diagnostics } = session();
    const source = ["- [Q @q] 應延後採用嗎 😀？", "  - [G @cost] 成本超出預算。"].join(ending);
    open(source, DOCUMENT, 12);
    expect(diagnostics()).toEqual([expect.objectContaining({ code: "UNBOUND_GROUND_UNDER_QUESTION" })]);
    const fixes = actions(diagnostics()[0].range);
    expect(fixes.map(fix => fix.title)).toEqual([
      "Re-mark as C to offer an answer (concerns → answers)",
      "Re-mark as neutral (.) to keep concerns and withdraw the unbound Ground intention"
    ]);
    const analysis = analyzeSourceEdits(source);
    for (const [index, mark] of (["C", "."] as const).entries()) {
      const fix = fixes[index];
      expect(fix.diagnostics).toEqual(diagnostics());
      expect(fix.edit).toEqual({ documentChanges: [{
        textDocument: { uri: DOCUMENT, version: 12 },
        edits: [{ range: { start: { line: 1, character: 5 }, end: { line: 1, character: 6 } }, newText: mark }]
      }] });
      const result = applyFix(source, fix);
      expect(result).toBe(source.replace("[G", `[${mark}`));
      const preview = analysis.preview({ kind: "framing", edit: { operation: "remark", line: 2, mark } });
      expect(preview).toMatchObject({
        status: "ready", proposedSource: result,
        comparison: { status: "compared", relation: mark === "C" ? "refinement" : "equivalent", retracted: [] }
      });
      const readback = explainSource(result);
      expect(readback.diagnostics).toEqual([]);
      expect(readback.graphs[0].points.map(point => [point.id, point.text])).toEqual([["q", "應延後採用嗎 😀？"], ["cost", "成本超出預算。"]]);
      expect(readback.graphs[0].bearings).toEqual([expect.objectContaining({
        kind: mark === "C" ? "answers" : "concerns",
        sources: [{ kind: "point", key: readback.graphs[0].points[1].key }],
        target: { kind: "point", key: readback.graphs[0].points[0].key }
      })]);
      expect(readback.explanations[0].entries[1].effects).toContainEqual(expect.objectContaining({
        kind: "frameOccurrence", intention: mark === "C" ? "bound" : "none"
      }));
    }
  });

  it("re-marks an existing Point use without changing its declaration or targeting another answer", () => {
    const { open, actions, diagnostics } = session();
    const source = ["- [. @cost] 成本 😀 超出預算。", "- [Q @q] 應延期嗎？", "  - [C @answer] 應延期。", "  - [G use @cost; @step]"].join("\n");
    open(source);
    const fixes = actions(diagnostics()[0].range);
    expect(fixes).toHaveLength(2);
    for (const [index, mark] of (["C", "."] as const).entries()) {
      const result = applyFix(source, fixes[index]);
      expect(result).toBe(source.replace("[G use", `[${mark} use`));
      const graph = explainSource(result).graphs[0];
      expect(graph.points.map(point => point.id)).toEqual(["cost", "q", "answer"]);
      expect(graph.points[0].declaration).toEqual({ form: "material" });
      expect(graph.bearings.find(bearing => bearing.handle === "step")).toMatchObject({
        kind: mark === "C" ? "answers" : "concerns",
        sources: [{ kind: "point", key: graph.points[0].key }],
        target: { kind: "point", key: graph.points[1].key }
      });
      expect(graph.diagnostics).toEqual([]);
    }
  });

  it("filters fixes by half-open diagnostic ranges, including cursor and multiline selections", () => {
    const { open, actions, diagnostics } = session();
    const source = ["- [C @claim] 主張。", "- [O @cost +> @claim] 成本。", "- [Q @q] 問題？", "  - [G @g] 理由 😀。", "    延續說明。"].join("\n");
    open(source);
    const [opposed, unbound] = diagnostics() as { code: string; range: Range }[];
    expect(actions({ start: opposed.range.start, end: opposed.range.start })).toHaveLength(3);
    expect(actions({ start: unbound.range.start, end: unbound.range.start })).toHaveLength(2);
    expect(actions({ start: { line: 4, character: 5 }, end: { line: 4, character: 5 } })).toHaveLength(2);
    for (const diagnostic of [opposed, unbound]) {
      expect(actions({ start: diagnostic.range.end, end: diagnostic.range.end })).toEqual([]);
      expect(actions({ start: { line: diagnostic.range.start.line, character: 0 }, end: diagnostic.range.start })).toEqual([]);
      expect(actions({ start: { line: diagnostic.range.start.line, character: 0 }, end: { line: diagnostic.range.start.line, character: 0 } })).toEqual([]);
    }
    expect(actions({ start: { line: 0, character: 0 }, end: { line: 1, character: 0 } })).toEqual([]);
    expect(actions({ start: { line: 2, character: 0 }, end: { line: 3, character: 0 } })).toEqual([]);
    const all = actions({ start: opposed.range.start, end: unbound.range.end });
    expect(all.map(fix => fix.diagnostics[0].code)).toEqual(["OPPOSED_FRAMING", "OPPOSED_FRAMING", "OPPOSED_FRAMING", "UNBOUND_GROUND_UNDER_QUESTION", "UNBOUND_GROUND_UNDER_QUESTION"]);
  });

  it("keeps host fixes within the selected fence in host coordinates", () => {
    const { open, actions, diagnostics } = session();
    const uri = "file:///notes/journal.md";
    const source = ["# 札記 😀", "", "  ```cog", "  - [Q @q] 第一問？", "    - [G @g] 理由。", "  ```", "", "```cog", "- [Q @q] 第二問？", "  - [G @g] 另一理由。", "```"].join("\r\n");
    open(source, uri, 5);
    const [first, second] = diagnostics(uri);
    const fixes = actions(first.range, uri);
    expect(fixes).toHaveLength(2);
    expect(fixes.every(fix => fix.diagnostics[0].range.start.line === 4)).toBe(true);
    expect(actions(second.range, uri)).toHaveLength(2);
    expect(actions({ start: { line: 0, character: 0 }, end: { line: 3, character: 0 } }, uri)).toEqual([]);
    for (const [index, mark] of (["C", "."] as const).entries()) {
      expect(fixes[index].edit.documentChanges[0]).toEqual({
        textDocument: { uri, version: 5 },
        edits: [{ range: { start: { line: 4, character: 7 }, end: { line: 4, character: 8 } }, newText: mark }]
      });
      const result = applyFix(source, fixes[index]);
      expect(result).toBe(source.replace("[G @g] 理由", `[${mark} @g] 理由`));
      const readback = explainSource(result, "host");
      expect(readback.graphs.map(graph => graph.bearings.map(bearing => bearing.kind))).toEqual([[mark === "C" ? "answers" : "concerns"], ["concerns"]]);
      expect(readback.diagnostics.map(diagnostic => diagnostic.sourceSpan?.startLine)).toEqual([10]);
    }
  });

  it("conveys the checked document version so clients can reject stale quick fixes", () => {
    const { open, actions, notify, diagnostics } = session();
    const source = "- [Q @q] 問題？\n  - [G @g] 理由。";
    open(source, DOCUMENT, 20);
    const oldFixes = actions(diagnostics()[0].range);
    expect(oldFixes).toHaveLength(2);
    notify("textDocument/didChange", { textDocument: { uri: DOCUMENT, version: 21 }, contentChanges: [{ text: "\n" + source }] });
    const newFixes = actions(diagnostics()[0].range);
    expect(newFixes).toHaveLength(2);
    for (const [index, fix] of oldFixes.entries()) {
      expect(fix.edit).not.toHaveProperty("changes");
      expect(fix.edit.documentChanges[0].textDocument).toEqual({ uri: DOCUMENT, version: 20 });
      expect(newFixes[index].edit.documentChanges[0].textDocument).toEqual({ uri: DOCUMENT, version: 21 });
      expect(newFixes[index].edit.documentChanges[0].edits[0].range.start.line).toBe(2);
    }
    notify("textDocument/didChange", { textDocument: { uri: DOCUMENT, version: 22 }, contentChanges: [{ text: source.replace("[G", "[.") }] });
    expect(actions({ start: { line: 1, character: 5 }, end: { line: 1, character: 5 } })).toEqual([]);
    notify("textDocument/didClose", { textDocument: { uri: DOCUMENT } });
    expect(actions({ start: { line: 1, character: 5 }, end: { line: 1, character: 5 } })).toBeNull();
  });

  it("offers only checked results when an opposed Point is unnamed or the source has errors", () => {
    const { open, actions, diagnostics } = session();
    const source = "- [C @claim] 主張。\n- [O +> @claim] 反對理由。";
    open(source);
    expect(actions(diagnostics()[0].range).map(fix => fix.title)).toEqual([
      "Re-mark as G, keeping the clause", "Re-mark as neutral (.), keeping the clause"
    ]);
    open(source + "\n- [G +> @missing] 未知。\n- [Q] 問題？\n  - [G] 理由。");
    expect(actions({ start: { line: 0, character: 0 }, end: { line: 4, character: 20 } })).toEqual([]);
  });

  it("speaks framed JSON-RPC over stdio and exits cleanly after shutdown", async () => {
    const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const tsx = createRequire(import.meta.url).resolve("tsx");
    const child = spawn(process.execPath, ["--conditions", "@cogitatum/source", "--import", tsx, join(repoRoot, "packages/cli/src/index.ts"), "lsp", "--stdio"]);
    const frame = (message: object) => {
      const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }));
      return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
    };
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    const exited = new Promise<number | null>(resolve => child.on("close", resolve));
    const all = Buffer.concat([
      frame({ id: 1, method: "initialize", params: { capabilities: {} } }),
      frame({ method: "textDocument/didOpen", params: { textDocument: { uri: DOCUMENT, languageId: "markdown", version: 1, text: "- [C] 漢字 😀" } } }),
      frame({ id: 2, method: "shutdown" }),
      frame({ method: "exit" })
    ]);
    // Split inside a frame to exercise partial reads.
    child.stdin.write(all.subarray(0, 17));
    child.stdin.write(all.subarray(17));
    expect(await exited).toBe(0);
    const bodies = output.split(/Content-Length: \d+\r\n\r\n/).filter(Boolean).map(body => JSON.parse(body));
    expect(bodies[0]).toMatchObject({ id: 1, result: { capabilities: { positionEncoding: "utf-16" }, serverInfo: { name: "cogitatum" } } });
    expect(bodies[1]).toMatchObject({ method: "textDocument/publishDiagnostics", params: { diagnostics: [] } });
    expect(bodies[2]).toEqual({ jsonrpc: "2.0", id: 2, result: null });
  }, 20000);
});
