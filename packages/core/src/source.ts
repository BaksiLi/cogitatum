import type { Nodes } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { compileGraph, compileGraphWithExplain } from "./graph.js";
import { parseDocument } from "./outline.js";
import { FORMAT_VERSION } from "./types.js";
import type {
  CogitatumSourceUnit,
  CompiledSource,
  Diagnostic,
  DocumentAst,
  ExplainedSource,
  ParsedSource,
  SourceParseMode,
  SourceSpan
} from "./types.js";

const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const markdownParser = unified().use(remarkParse);

type SelectedSourceUnit = {
  sourceUnit: CogitatumSourceUnit;
  lineColumnOffsets: number[];
};

type SelectedSource = {
  mode: SourceParseMode;
  units: SelectedSourceUnit[];
  diagnostics: Diagnostic[];
};

export function extractCogitatumSourceUnits(source: string, mode: SourceParseMode = "document"): CogitatumSourceUnit[] {
  return selectSource(source, mode).units.map((selected) => selected.sourceUnit);
}

export function parseSource(source: string, mode: SourceParseMode = "document"): ParsedSource {
  const selected = selectSource(source, mode);
  const documents = parseSelectedDocuments(selected);

  return {
    version: FORMAT_VERSION,
    mode: selected.mode,
    units: selected.units.map((selectedUnit) => selectedUnit.sourceUnit),
    documents,
    diagnostics: [...selected.diagnostics, ...documents.flatMap((document) => document.diagnostics)]
  };
}

export function compileSource(source: string, mode: SourceParseMode = "document"): CompiledSource {
  const selected = selectSource(source, mode);
  const documents = parseSelectedDocuments(selected);
  const graphs = documents.map(compileGraph);

  return {
    version: FORMAT_VERSION,
    mode: selected.mode,
    units: selected.units.map((selectedUnit) => selectedUnit.sourceUnit),
    documents,
    graphs,
    diagnostics: [...selected.diagnostics, ...graphs.flatMap((graph) => graph.diagnostics)]
  };
}

export function explainSource(source: string, mode: SourceParseMode = "document"): ExplainedSource {
  const selected = selectSource(source, mode);
  const documents = parseSelectedDocuments(selected);
  const compilations = documents.map(compileGraphWithExplain);
  const graphs = compilations.map((compilation) => compilation.graph);

  return {
    version: FORMAT_VERSION,
    mode: selected.mode,
    units: selected.units.map((selectedUnit) => selectedUnit.sourceUnit),
    documents,
    graphs,
    explanations: compilations.map((compilation) => compilation.explain),
    diagnostics: [...selected.diagnostics, ...graphs.flatMap((graph) => graph.diagnostics)]
  };
}

function parseSelectedDocuments(selected: SelectedSource): DocumentAst[] {
  return selected.units.map((unit) =>
    parseDocument(unit.sourceUnit.source, {
      lineOffset: unit.sourceUnit.startLine - 1,
      lineColumnOffsets: unit.lineColumnOffsets
    })
  );
}

function selectSource(source: string, requestedMode: SourceParseMode): SelectedSource {
  if (requestedMode === "document") {
    return { mode: "document", units: [selectedDocumentUnit(source)], diagnostics: [] };
  }

  if (requestedMode !== "host") {
    throw new TypeError("Source context must be document or host; auto selection is retired. Pass host explicitly for Markdown.");
  }
  return { mode: "host", ...extractHostUnits(source) };
}

function selectedDocumentUnit(source: string): SelectedSourceUnit {
  return { sourceUnit: documentUnit(source), lineColumnOffsets: [] };
}

function documentUnit(source: string): CogitatumSourceUnit {
  return {
    kind: "document",
    source,
    startLine: 1,
    endLine: source.replace(/\r\n/g, "\n").split("\n").length
  };
}

function extractHostUnits(source: string): Pick<SelectedSource, "units" | "diagnostics"> {
  const units: SelectedSourceUnit[] = [];
  const diagnostics: Diagnostic[] = [];
  const lines = source.split(/\r\n|\r|\n/);
  const initialBomLength = source.startsWith("\uFEFF") ? 1 : 0;
  const tree = markdownParser.parse(source);

  function visitBlock(block: Nodes, nested: boolean): void {
    if (block.type !== "code") {
      if ("children" in block) {
        for (const child of block.children) visitBlock(child, true);
      }
      return;
    }
    const fenceInfo = block.lang === "cog" || block.lang === "cogitatum" ? block.lang : undefined;
    if (!fenceInfo || !block.position) return;
    const { start, end } = block.position;
    if (nested) {
      diagnostics.push({
        severity: "error",
        code: "UNSUPPORTED_NESTED_COGITATUM_FENCE",
        message: "Cogitatum fences inside Markdown containers are unsupported. Move this fence to document level.",
        sourceSpan: { startLine: start.line, startColumn: start.column + (start.line === 1 ? initialBomLength : 0), endLine: end.line, endColumn: end.column + (end.line === 1 ? initialBomLength : 0) }
      });
      return;
    }

    const openingLine = lines[start.line - 1].slice(start.line === 1 ? initialBomLength : 0);
    const opening = FENCE_RE.exec(openingLine);
    if (!opening) return;
    const markerText = opening[2];
    if (end.line <= start.line || !isClosingFence(lines[end.line - 1], markerText[0], markerText.length)) {
      diagnostics.push({
        severity: "error",
        code: "UNCLOSED_COGITATUM_FENCE",
        message: "Cogitatum source fence opened on line " + start.line + " is not closed.",
        sourceSpan: span(start.line, 1 + (start.line === 1 ? initialBomLength : 0), lines[start.line - 1].length + 1)
      });
      return;
    }

    const content = lines.slice(start.line, end.line - 1)
      .map(line => stripOpeningFenceIndent(line, opening[1].length));
    units.push({
      sourceUnit: {
        kind: "fence",
        source: content.map(line => line.line).join("\n"),
        startLine: start.line + 1,
        endLine: end.line - 1,
        fenceInfo
      },
      lineColumnOffsets: content.map(line => line.removedSpaces)
    });
    if (content.every(line => line.line.trim() === "")) {
      diagnostics.push({
        severity: "error",
        code: "EMPTY_COGITATUM_FENCE",
        message: "Cogitatum source fence is empty.",
        sourceSpan: span(start.line, 1 + (start.line === 1 ? initialBomLength : 0), lines[start.line - 1].length + 1)
      });
    }
  }

  for (const block of tree.children) visitBlock(block, false);
  return { units, diagnostics };
}

function isClosingFence(line: string, marker: string, fenceLength: number): boolean {
  return new RegExp("^ {0,3}" + marker + "{" + fenceLength + ",}[ \\t]*$").test(line);
}

function stripOpeningFenceIndent(line: string, indentation: number): { line: string; removedSpaces: number } {
  let removedSpaces = 0;
  while (removedSpaces < indentation && line[removedSpaces] === " ") {
    removedSpaces += 1;
  }
  return { line: line.slice(removedSpaces), removedSpaces };
}

function span(line: number, startColumn: number, endColumn: number): SourceSpan {
  return { startLine: line, startColumn, endLine: line, endColumn };
}
