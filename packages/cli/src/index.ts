#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import {
  analyzeSourceReferences,
  compileGraphWithExplain,
  compileSource,
  explainSource,
  FORMAT_VERSION,
  formatGraph,
  parseDocument,
  parseSource,
  previewExplicitTarget
} from "@cogitatum/core";
import type { Diagnostic, SourceParseMode } from "@cogitatum/core";

type Command = "ast" | "graph" | "explain" | "check" | "explicit-target";

const PACKAGE_VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

type CliArgs = {
  command?: Command;
  file?: string;
  inputMode: SourceParseMode;
  references: boolean;
  line?: number;
  format: "json" | "text";
  diagnostics: Diagnostic[];
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  const terminator = argv.indexOf("--");
  const optionArgs = terminator === -1 ? argv : argv.slice(0, terminator);
  if (optionArgs.includes("--help") || optionArgs.includes("-h")) {
    printUsage(process.stdout);
    return;
  }

  if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
    process.stdout.write(`cog ${PACKAGE_VERSION} (format ${FORMAT_VERSION})\n`);
    return;
  }

  const args = parseArgs(argv);
  if (!args.command || !args.file || args.diagnostics.length > 0) {
    if (args.diagnostics.length > 0) {
      printJson({ diagnostics: args.diagnostics });
      process.exitCode = 2;
      return;
    }
    printUsage();
    process.exitCode = 2;
    return;
  }

  const source = await readFile(args.file, "utf8");

  if (args.command === "explicit-target") {
    const preview = previewExplicitTarget(source, { line: args.line!, mode: args.inputMode });
    printJson(preview);
    process.exitCode = preview.status === "ready" ? 0 : 1;
    return;
  }

  if (args.references) {
    const analysis = analyzeSourceReferences(source, args.inputMode);
    printJson(analysis);
    // The opt-in inventory adds no diagnostics or new failure conditions.
    // Source errors withhold it and retain check's usual exit status.
    process.exitCode = hasErrors(analysis.diagnostics) ? 1 : 0;
    return;
  }

  if (args.command === "ast") {
    const parsed = args.inputMode === "document" ? parseDocument(source) : parseSource(source, args.inputMode);
    printJson(parsed);
    process.exitCode = hasErrors(parsed.diagnostics) ? 1 : 0;
    return;
  }

  if (args.inputMode !== "document") {
    if (args.command === "explain") {
      const explained = explainSource(source, args.inputMode);
      printJson({
        version: explained.version,
        mode: explained.mode,
        units: explained.units,
        explanations: explained.explanations,
        diagnostics: explained.diagnostics
      });
      process.exitCode = hasErrors(explained.diagnostics) ? 1 : 0;
      return;
    }
    const compiled = compileSource(source, args.inputMode);
    if (args.command === "graph") {
      printJson(compiled);
    } else {
      printJson({ version: compiled.version, mode: compiled.mode, diagnostics: compiled.diagnostics });
    }
    process.exitCode = hasErrors(compiled.diagnostics) ? 1 : 0;
    return;
  }

  const compilation = compileGraphWithExplain(parseDocument(source));
  const graph = compilation.graph;

  if (args.command === "graph") {
    if (args.format === "text") process.stdout.write(formatGraph(graph));
    else printJson(graph);
    process.exitCode = hasErrors(graph.diagnostics) ? 1 : 0;
    return;
  }

  if (args.command === "explain") {
    printJson(compilation.explain);
    process.exitCode = hasErrors(compilation.explain.diagnostics) ? 1 : 0;
    return;
  }

  printJson({ version: graph.version, diagnostics: graph.diagnostics });
  process.exitCode = hasErrors(graph.diagnostics) ? 1 : 0;
}

function isCommand(value: string | undefined): value is Command {
  return value === "ast" || value === "graph" || value === "explain" || value === "check" || value === "explicit-target";
}

function parseArgs(argv: string[]): CliArgs {
  const diagnostics: Diagnostic[] = [];
  const commandArg = argv[0];
  let optionsEnded = false;
  const args: CliArgs = {
    command: isCommand(commandArg) ? commandArg : undefined,
    inputMode: "document",
    references: false,
    format: "json",
    diagnostics
  };

  if (commandArg && !args.command) {
    diagnostics.push({ severity: "error", code: "INVALID_COMMAND", message: `Unknown command ${commandArg}.` });
  }

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!optionsEnded && arg === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && arg === "--line") {
      const value = argv[index + 1];
      if (args.command !== "explicit-target" || args.line !== undefined || !value || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        diagnostics.push({ severity: "error", code: "INVALID_LINE_OPTION", message: "--line requires one positive integer and is available only with explicit-target." });
        break;
      }
      args.line = Number(value);
      index += 1;
      continue;
    }
    if (!optionsEnded && arg === "--input") {
      const value = argv[index + 1];
      if (!isInputMode(value)) {
        diagnostics.push({
          severity: "error",
          code: "INVALID_INPUT_MODE",
          message: "--input must be document or host. Auto selection is retired; choose host explicitly for Markdown."
        });
        break;
      }
      args.inputMode = value;
      index += 1;
      continue;
    }
    if (!optionsEnded && arg === "--format") {
      const value = argv[index + 1];
      if (args.command !== "graph" || (value !== "json" && value !== "text")) {
        diagnostics.push({ severity: "error", code: "INVALID_OUTPUT_FORMAT", message: "--format requires json or text and is available only with graph." });
        break;
      }
      args.format = value;
      index += 1;
      continue;
    }
    if (!optionsEnded && arg === "--references") {
      if (args.command !== "check") {
        diagnostics.push({ severity: "error", code: "INVALID_OPTION", message: "--references is only available with check." });
      }
      args.references = true;
      continue;
    }
    if (!optionsEnded && arg.startsWith("-")) {
      diagnostics.push({ severity: "error", code: "UNKNOWN_OPTION", message: `Unknown option ${arg}.` });
      break;
    }
    if (args.file) {
      diagnostics.push({ severity: "error", code: "TOO_MANY_FILES", message: "Expected exactly one input file." });
      break;
    }
    args.file = arg;
  }

  if (args.command === "explicit-target" && args.line === undefined && !diagnostics.length) {
    diagnostics.push({ severity: "error", code: "INVALID_LINE_OPTION", message: "explicit-target requires --line with a one-based line in the complete input file." });
  }
  if (args.format === "text" && args.inputMode === "host") {
    diagnostics.push({ severity: "error", code: "INVALID_OUTPUT_FORMAT", message: "Text inspection accepts one document graph. Use JSON for host input to retain every source unit and source-selection diagnostic." });
  }
  return args;
}

function isInputMode(value: string | undefined): value is SourceParseMode {
  return value === "document" || value === "host";
}

function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printUsage(stream: NodeJS.WritableStream = process.stderr): void {
  stream.write(`Cogitatum ${PACKAGE_VERSION} (format ${FORMAT_VERSION})

Usage: cog <command> [options] <file>

Commands:
  check            Check syntax and references; print diagnostics as JSON
  ast              Print the ordered source AST as JSON
  graph            Compile source to Point-Bearing Graph IR; JSON by default
  explain          Print an experimental compiler trace as JSON
  explicit-target  Preview one explicit target clause as JSON; never write it

Options:
  --input <mode>   document (default) or host (Markdown Cogitatum fences)
  --format <kind>  json or text (graph only; text requires document input)
  --line <number>  Required for explicit-target; one-based line in the full file
  --references     Include written-name references (check only)
  --               End options before an option-like filename
  -h, --help       Show this help
  -v, --version    Show CLI and format version

graph reads Cogitatum source, not saved Graph IR JSON.
--format selects output notation; it does not format or rewrite source.
All commands run locally without an LLM and leave input files unchanged.
check validates markup; explain traces compilation. Neither evaluates reasoning.

Output:
  Results and source/option diagnostics go to stdout; I/O failures go to stderr.
  Host JSON preserves source units; graph text accepts one document only.
  Error-bearing graphs are partial; inspect diagnostics and the exit status.

Exit status:
  0  Successful inspection/check, or a ready explicit-target preview
  1  Source/I/O error, or an unavailable explicit-target preview
  2  Invalid or missing arguments
An unavailable preview can have valid source; read its reason and message.

Examples:
  cog check inquiry.cog.md
  cog check --references inquiry.cog.md
  cog graph inquiry.cog.md
  cog graph --format text inquiry.cog.md
  cog graph --input host --format json notes.md
  cog explain inquiry.cog.md
  cog explicit-target --line 3 inquiry.cog.md
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
