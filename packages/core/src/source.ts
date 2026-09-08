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
const FENCE_CANDIDATE_RE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;

type SelectedSourceUnit = {
  sourceUnit: CogitatumSourceUnit;
  lineColumnOffsets: number[];
};

type SelectedSource = {
  mode: Exclude<SourceParseMode, "auto">;
  units: SelectedSourceUnit[];
  diagnostics: Diagnostic[];
};

export function extractCogitatumSourceUnits(source: string, mode: SourceParseMode = "auto"): CogitatumSourceUnit[] {
  return selectSource(source, mode).units.map((selected) => selected.sourceUnit);
}

export function parseSource(source: string, mode: SourceParseMode = "auto"): ParsedSource {
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

export function compileSource(source: string, mode: SourceParseMode = "auto"): CompiledSource {
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

export function explainSource(source: string, mode: SourceParseMode = "auto"): ExplainedSource {
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

  const host = extractHostUnits(source);
  if (requestedMode === "host" || host.sawCogitatumFence || host.sawUnsupportedCogitatumFence) {
    const diagnostics = [...host.diagnostics];
    if (!host.sawCogitatumFence && !host.sawUnsupportedCogitatumFence) {
      diagnostics.push({
        severity: "error",
        code: "NO_COGITATUM_FENCE",
        message: "Host mode requires at least one fenced `cog` or `cogitatum` source unit."
      });
    }
    return { mode: "host", units: host.units, diagnostics };
  }

  return { mode: "document", units: [selectedDocumentUnit(source)], diagnostics: [] };
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

function extractHostUnits(source: string): {
  units: SelectedSourceUnit[];
  diagnostics: Diagnostic[];
  sawCogitatumFence: boolean;
  sawUnsupportedCogitatumFence: boolean;
} {
  const units: SelectedSourceUnit[] = [];
  const diagnostics: Diagnostic[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let sawCogitatumFence = false;
  let sawUnsupportedCogitatumFence = false;
  let ignoredFence: { marker: "`" | "~"; fenceLength: number } | undefined;
  let open:
    | {
        marker: "`" | "~";
        fenceLength: number;
        fenceInfo: "cog" | "cogitatum";
        openingLine: number;
        startLine: number;
        indentation: number;
        content: string[];
        contentColumnOffsets: number[];
      }
    | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (ignoredFence) {
      if (isClosingFence(line, ignoredFence.marker, ignoredFence.fenceLength)) {
        ignoredFence = undefined;
      }
      continue;
    }

    if (open) {
      if (isClosingFence(line, open.marker, open.fenceLength)) {
        const unit: CogitatumSourceUnit = {
          kind: "fence",
          source: open.content.join("\n"),
          startLine: open.startLine,
          endLine: lineNumber - 1,
          fenceInfo: open.fenceInfo
        };
        units.push({ sourceUnit: unit, lineColumnOffsets: open.contentColumnOffsets });
        if (open.content.every((contentLine) => contentLine.trim() === "")) {
          diagnostics.push({
            severity: "error",
            code: "EMPTY_COGITATUM_FENCE",
            message: "Cogitatum source fence is empty.",
            sourceSpan: span(open.openingLine, 1, lines[open.openingLine - 1].length + 1)
          });
        }
        open = undefined;
      } else {
        const stripped = stripOpeningFenceIndent(line, open.indentation);
        open.content.push(stripped.line);
        open.contentColumnOffsets.push(stripped.removedSpaces);
      }
      continue;
    }

    const fence = parseOpeningFence(line);
    if (!fence) {
      if (isUnsupportedCogitatumFenceCandidate(line)) {
        sawUnsupportedCogitatumFence = true;
        diagnostics.push({
          severity: "error",
          code: "UNSUPPORTED_HOST_FENCE_INDENTATION",
          message: "Text host mode supports Cogitatum opening fences preceded by at most three spaces.",
          explanation:
            "Use a document-level fence or a native host adapter for list, blockquote, or block-tree containment.",
          sourceSpan: span(lineNumber, 1, line.length + 1)
        });
      }
      continue;
    }
    if (!fence.fenceInfo) {
      ignoredFence = { marker: fence.marker, fenceLength: fence.fenceLength };
      continue;
    }

    sawCogitatumFence = true;
    open = {
      marker: fence.marker,
      fenceLength: fence.fenceLength,
      fenceInfo: fence.fenceInfo,
      openingLine: lineNumber,
      startLine: lineNumber + 1,
      indentation: fence.indentation,
      content: [],
      contentColumnOffsets: []
    };
  }

  if (open) {
    diagnostics.push({
      severity: "error",
      code: "UNCLOSED_COGITATUM_FENCE",
      message: `Cogitatum source fence opened on line ${open.openingLine} is not closed.`,
      sourceSpan: span(open.openingLine, 1, lines[open.openingLine - 1].length + 1)
    });
  }

  return { units, diagnostics, sawCogitatumFence, sawUnsupportedCogitatumFence };
}

function normalizeFenceInfo(info: string): "cog" | "cogitatum" | undefined {
  const firstWord = info.trim().split(/[ \t]+/, 1)[0];
  if (firstWord === "cog" || firstWord === "cogitatum") {
    return firstWord;
  }
  return undefined;
}

function isClosingFence(line: string, marker: "`" | "~", fenceLength: number): boolean {
  const re = new RegExp(`^ {0,3}${marker}{${fenceLength},}[ \\t]*$`);
  return re.test(line);
}

function parseOpeningFence(line: string):
  | {
      marker: "`" | "~";
      fenceLength: number;
      fenceInfo?: "cog" | "cogitatum";
      indentation: number;
    }
  | undefined {
  const match = FENCE_RE.exec(line);
  if (!match) {
    return undefined;
  }

  const markerText = match[2];
  const rawInfo = match[3].trim();
  if (markerText[0] === "`" && rawInfo.includes("`")) {
    return undefined;
  }

  return {
    marker: markerText[0] as "`" | "~",
    fenceLength: markerText.length,
    fenceInfo: normalizeFenceInfo(rawInfo),
    indentation: match[1].length
  };
}

function isUnsupportedCogitatumFenceCandidate(line: string): boolean {
  const match = FENCE_CANDIDATE_RE.exec(line);
  if (!match || (!match[1].includes("\t") && match[1].length <= 3)) {
    return false;
  }

  const markerText = match[2];
  const rawInfo = match[3].trim();
  if (markerText[0] === "`" && rawInfo.includes("`")) {
    return false;
  }
  return normalizeFenceInfo(rawInfo) !== undefined;
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
