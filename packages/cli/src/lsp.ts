import type { Readable, Writable } from "node:stream";
import { analyzeSourceReferences, explainSource } from "@cogitatum/core";
import type { AstBlock, Diagnostic, ExplainedSource, SourceParseMode, SourceReferenceAnalysis, SourceSpan } from "@cogitatum/core";

// A Language Server Protocol endpoint over the existing compiler.
// Core spans are one-based UTF-16 line/column positions: LSP's default
// position encoding shifted by one, so no column conversion is needed.

export type Position = { line: number; character: number };
export type Range = { start: Position; end: Position };
export type Message = { jsonrpc: "2.0"; id?: number | string | null; method?: string; params?: any; result?: unknown; error?: unknown };

/** A located `@name` token, covering the name characters after `@`. */
type Occurrence = { range: Range; unit: number; entity: string; name: string; declaration: boolean };

type OpenDocument = {
  text: string;
  version: number;
  mode: SourceParseMode;
  explained?: ExplainedSource;
  occurrences?: Occurrence[] | "unavailable";
};

const NAME_RE = /^[a-z][a-z0-9_-]*$/;
const NAME_TOKEN_RE = /@([a-z][a-z0-9_-]*)(?![a-z0-9_-])/g;
const SEVERITY = { error: 1, warning: 2, suggestion: 3 } as const;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;
const REQUEST_FAILED = -32803;

/** `.cog.md` and `.cog` files are whole Cogitatum documents; other Markdown carries Cogitatum fences. */
export function sourceModeFor(uri: string): SourceParseMode {
  return /\.cog(?:\.md)?$/i.test(uri.replace(/[?#].*$/, "")) ? "document" : "host";
}

export function createLanguageServer(send: (message: Message) => void) {
  const documents = new Map<string, OpenDocument>();
  let shutdownRequested = false;

  // Derived results are computed on demand and discarded with their revision.
  const explained = (document: OpenDocument) =>
    document.explained ??= explainSource(document.text, document.mode);
  const occurrences = (document: OpenDocument) =>
    document.occurrences ??= locateOccurrences(document.text, analyzeSourceReferences(document.text, document.mode));

  function publishDiagnostics(uri: string, document?: OpenDocument): void {
    const diagnostics = document ? explained(document).diagnostics.map(toLspDiagnostic) : [];
    send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, version: document?.version, diagnostics } });
  }

  function open(uri: string, text: string, version: number): void {
    const document: OpenDocument = { text, version, mode: sourceModeFor(uri) };
    documents.set(uri, document);
    publishDiagnostics(uri, document);
  }

  /** The named entity under the cursor, with every occurrence of it in the same source unit. */
  function entityAt(params: { textDocument: { uri: string }; position: Position }, requireResolution = false) {
    const document = documents.get(params.textDocument.uri);
    if (!document) return undefined;
    const located = occurrences(document);
    if (located === "unavailable") {
      if (requireResolution) throw new RequestFailure("Resolve source errors before renaming.");
      return undefined;
    }
    const target = located.find(occurrence => contains(occurrence.range, params.position));
    if (!target) return undefined;
    const all = located.filter(occurrence => occurrence.unit === target.unit && occurrence.entity === target.entity);
    return { document, located, target, all };
  }

  const requests: Record<string, (params: any) => unknown> = {
    initialize: () => ({
      capabilities: {
        positionEncoding: "utf-16",
        textDocumentSync: { openClose: true, change: 1 },
        documentSymbolProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        hoverProvider: true,
        renameProvider: { prepareProvider: true }
      },
      serverInfo: { name: "cogitatum" }
    }),
    shutdown: () => {
      shutdownRequested = true;
      return null;
    },
    "textDocument/documentSymbol": ({ textDocument }) => {
      const document = documents.get(textDocument.uri);
      return document ? explained(document).documents.flatMap(ast => ast.blocks.map(toSymbol)) : null;
    },
    "textDocument/definition": params => {
      const declaration = entityAt(params)?.all.find(occurrence => occurrence.declaration);
      return declaration ? { uri: params.textDocument.uri, range: declaration.range } : null;
    },
    "textDocument/references": params => {
      const found = entityAt(params);
      if (!found) return null;
      const includeDeclaration = params.context?.includeDeclaration !== false;
      return found.all
        .filter(occurrence => includeDeclaration || !occurrence.declaration)
        .map(({ range }) => ({ uri: params.textDocument.uri, range }));
    },
    "textDocument/hover": params => {
      const found = entityAt(params);
      if (!found) return null;
      return { range: found.target.range, contents: { kind: "markdown", value: describeEntity(explained(found.document), found.target) } };
    },
    "textDocument/prepareRename": params => {
      const found = entityAt(params, true);
      return found ? { range: found.target.range, placeholder: found.target.name } : null;
    },
    "textDocument/rename": params => {
      const found = entityAt(params, true);
      if (!found) return null;
      const name = String(params.newName).replace(/^@/, "");
      if (!NAME_RE.test(name)) throw new RequestFailure(`@${name} is not a valid name; names look like @claim or @second-route.`);
      const taken = found.located.some(other => other.unit === found.target.unit && other.declaration && other.name === name);
      if (name !== found.target.name && taken) throw new RequestFailure(`@${name} is already declared in this inquiry.`);
      return { changes: { [params.textDocument.uri]: found.all.map(({ range }) => ({ range, newText: name })) } };
    }
  };

  const notifications: Record<string, (params: any) => void> = {
    "textDocument/didOpen": ({ textDocument }) => open(textDocument.uri, textDocument.text, textDocument.version),
    // Full synchronization: each revision replaces the document and its derived results.
    "textDocument/didChange": ({ textDocument, contentChanges }) => {
      const text = contentChanges.at(-1)?.text;
      if (documents.has(textDocument.uri) && typeof text === "string") open(textDocument.uri, text, textDocument.version);
    },
    "textDocument/didClose": ({ textDocument }) => {
      documents.delete(textDocument.uri);
      publishDiagnostics(textDocument.uri);
    }
  };

  /** Handles one decoded message; returns an exit status once the client ends the session. */
  function handle(message: Message): number | undefined {
    const { id, method, params } = message;
    if (method === "exit") return shutdownRequested ? 0 : 1;
    if (method === undefined) return undefined;
    if (id === undefined) {
      notifications[method]?.(params);
      return undefined;
    }
    const request = requests[method];
    if (!request) {
      send({ jsonrpc: "2.0", id, error: { code: METHOD_NOT_FOUND, message: `Unsupported request ${method}.` } });
      return undefined;
    }
    try {
      send({ jsonrpc: "2.0", id, result: request(params) ?? null });
    } catch (error) {
      const code = error instanceof RequestFailure ? REQUEST_FAILED : INTERNAL_ERROR;
      send({ jsonrpc: "2.0", id, error: { code, message: error instanceof Error ? error.message : String(error) } });
    }
    return undefined;
  }

  return { handle };
}

/** Serves LSP over stdio with Content-Length framing; resolves with the exit status. */
export function serveStdio(input: Readable = process.stdin, output: Writable = process.stdout): Promise<number> {
  return new Promise(resolve => {
    const server = createLanguageServer(message => {
      const body = Buffer.from(JSON.stringify(message), "utf8");
      output.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]));
    });
    let buffer = Buffer.alloc(0);
    const finish = (status: number) => {
      input.removeAllListeners("data");
      input.removeAllListeners("end");
      // The client may keep its end of the pipe open; release it so the process can exit.
      input.destroy();
      resolve(status);
    };
    input.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const length = /content-length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString("ascii"))?.[1];
        const bodyStart = headerEnd + 4;
        if (length === undefined) {
          buffer = buffer.subarray(bodyStart);
          continue;
        }
        const bodyEnd = bodyStart + Number(length);
        if (buffer.length < bodyEnd) return;
        const message = JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString("utf8"));
        buffer = buffer.subarray(bodyEnd);
        const status = server.handle(message);
        if (status !== undefined) return finish(status);
      }
    });
    input.on("end", () => finish(1));
  });
}

class RequestFailure extends Error {}

function toRange(span: SourceSpan): Range {
  return {
    start: { line: span.startLine - 1, character: span.startColumn - 1 },
    end: { line: span.endLine - 1, character: span.endColumn - 1 }
  };
}

function contains(range: Range, position: Position): boolean {
  const notBefore = (a: Position, b: Position) => a.line > b.line || (a.line === b.line && a.character >= b.character);
  return notBefore(position, range.start) && notBefore(range.end, position);
}

function toLspDiagnostic(diagnostic: Diagnostic) {
  const origin = { line: 0, character: 0 };
  return {
    range: diagnostic.sourceSpan ? toRange(diagnostic.sourceSpan) : { start: origin, end: origin },
    severity: SEVERITY[diagnostic.severity],
    code: diagnostic.code,
    source: "cogitatum",
    message: diagnostic.explanation ? `${diagnostic.message}\n${diagnostic.explanation}` : diagnostic.message
  };
}

// Symbol kinds carry no Cogitatum meaning; they only give clients distinct icons.
function symbolKind(block: AstBlock): number {
  switch (block.annotation?.kind) {
    case "role":
    case "material": return 19; // Object: a Point declaration
    case "use": return 13; // Variable: a Point use
    case "bearing":
    case "bearingUse": return 24; // Event: a relation
    default: return 15; // String: body and notes
  }
}

type DocumentSymbol = { name: string; detail?: string; kind: number; range: Range; selectionRange: Range; children: DocumentSymbol[] };

function toSymbol(block: AstBlock): DocumentSymbol {
  const annotation = block.annotation;
  // A note's children are its literal prose, not outline structure.
  const children = annotation?.kind === "note" ? [] : block.children.map(toSymbol);
  const own = toRange(block.sourceSpan);
  const mark = annotation ? `[${annotation.raw}]` : undefined;
  return {
    name: block.text.split("\n")[0].trim() || mark || "(empty)",
    detail: mark,
    kind: symbolKind(block),
    range: children.length ? { start: own.start, end: children.at(-1)!.range.end } : own,
    selectionRange: own,
    children
  };
}

/**
 * Index the `@name` tokens of compiler-validated declarations and references.
 * Core locates each occurrence by its containing block. A name is written in
 * that block's header brackets, so its token is found there by the resolved
 * name: this locates names the compiler resolved and never resolves one itself.
 */
function locateOccurrences(text: string, analysis: SourceReferenceAnalysis): Occurrence[] | "unavailable" {
  if (analysis.references.status !== "complete") return "unavailable";
  const lines = text.split(/\r\n|\r|\n/);
  const located: Occurrence[] = [];
  analysis.references.units.forEach((names, unit) => {
    for (const declared of names) {
      const entity = `${declared.ref.kind}:${declared.ref.key}`;
      const spans = [
        { span: declared.sourceSpan, declaration: true },
        ...declared.references.map(reference => ({ span: reference.sourceSpan, declaration: false }))
      ];
      for (const { span, declaration } of spans) {
        for (const range of nameTokens(lines, span, declared.name)) {
          // A block that both uses and names an entity reports its block twice.
          if (!located.some(other => sameStart(other.range, range))) located.push({ range, unit, entity, name: declared.name, declaration });
        }
      }
    }
  });
  return located;
}

function nameTokens(lines: string[], span: SourceSpan, name: string): Range[] {
  const line = lines[span.startLine - 1] ?? "";
  const start = span.startColumn - 1;
  if (line[start] !== "[") return [];
  const close = line.indexOf("]", start);
  const header = line.slice(start, close === -1 ? undefined : close);
  return [...header.matchAll(NAME_TOKEN_RE)]
    .filter(match => match[1] === name)
    .map(match => {
      const character = start + match.index + 1;
      return { start: { line: span.startLine - 1, character }, end: { line: span.startLine - 1, character: character + name.length } };
    });
}

function sameStart(a: Range, b: Range): boolean {
  return a.start.line === b.start.line && a.start.character === b.start.character;
}

function describeEntity(source: ExplainedSource, occurrence: Occurrence): string {
  const graph = source.graphs[occurrence.unit];
  const separator = occurrence.entity.indexOf(":");
  const kind = occurrence.entity.slice(0, separator), key = occurrence.entity.slice(separator + 1);
  if (kind === "point") {
    const point = graph?.points.find(candidate => candidate.key === key);
    const mark = point?.declaration.form === "role" ? point.declaration.role : ".";
    return `**[${mark} @${occurrence.name}]** Point${point?.text ? `\n\n${point.text}` : ""}`;
  }
  const bearing = graph?.bearings.find(candidate => candidate.key === key);
  return `**@${occurrence.name}** Bearing${bearing ? ` · ${bearing.kind}` : ""}${bearing?.text ? `\n\n${bearing.text}` : ""}`;
}
