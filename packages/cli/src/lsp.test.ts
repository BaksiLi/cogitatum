import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createLanguageServer, semanticTokens, sourceModeFor } from "./lsp.js";
import type { Message, Position } from "./lsp.js";

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
  const open = (text: string, uri = DOCUMENT) => notify("textDocument/didOpen", { textDocument: { uri, languageId: "markdown", version: 1, text } });
  const diagnostics = (uri = DOCUMENT) => sent.filter(message => message.method === "textDocument/publishDiagnostics" && message.params.uri === uri).at(-1)!.params.diagnostics;
  const at = (method: string, position: Position, extra: object = {}, uri = DOCUMENT) => request(method, { textDocument: { uri }, position, ...extra });
  return { server, sent, request, notify, open, diagnostics, at };
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
