#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import {
  analyzeSourceReferences,
  compileGraphWithExplain,
  compileSource,
  explainSource,
  FORMAT_VERSION,
  formatExplain,
  formatGraph,
  parseDocument,
  parseSource,
  previewTargetForm
} from "@cogitatum/core";
import type { Diagnostic, SourceParseMode, TargetForm } from "@cogitatum/core";

type Command = "ast" | "graph" | "explain" | "export" | "check" | "target-form";
const COMMANDS: readonly string[] = ["ast", "graph", "explain", "export", "check", "target-form"];
// Published commands keep a diagnosed boundary instead of a silent alias.
const RETIRED_COMMANDS = new Map([
  ["explicit-target", "explicit-target was retired in 0.6. Use target-form --line <n> --to named, which also restores a positional target with --to positional."]
]);

const PACKAGE_VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

type CliArgs = {
  command?: Command;
  file?: string;
  inputMode: SourceParseMode;
  references: boolean;
  line?: number;
  to?: TargetForm;
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

  if (args.command === "explain" && args.format === "text") {
    const explained = explainSource(source, args.inputMode);
    process.stdout.write(formatExplain(explained));
    process.exitCode = hasErrors(explained.diagnostics) ? 1 : 0;
    return;
  }

  if (args.command === "export") {
    const explained = explainSource(source, args.inputMode);
    printJson(explained);
    process.exitCode = hasErrors(explained.diagnostics) ? 1 : 0;
    return;
  }

  if (args.command === "target-form") {
    const preview = previewTargetForm(source, { line: args.line!, form: args.to!, mode: args.inputMode });
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
  return value !== undefined && COMMANDS.includes(value);
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

  const retired = commandArg === undefined ? undefined : RETIRED_COMMANDS.get(commandArg);
  if (retired) {
    diagnostics.push({ severity: "error", code: "RETIRED_COMMAND", message: retired });
    return args;
  }
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
      if (args.command !== "target-form" || args.line !== undefined || !value || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        diagnostics.push({ severity: "error", code: "INVALID_LINE_OPTION", message: "--line requires one positive integer and is available only with target-form." });
        break;
      }
      args.line = Number(value);
      index += 1;
      continue;
    }
    if (!optionsEnded && arg === "--to") {
      const value = argv[index + 1];
      if (args.command !== "target-form" || args.to !== undefined || (value !== "named" && value !== "positional")) {
        diagnostics.push({ severity: "error", code: "INVALID_FORM_OPTION", message: "--to requires named or positional, once, and is available only with target-form." });
        break;
      }
      args.to = value;
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
      if ((args.command !== "graph" && args.command !== "explain") || (value !== "json" && value !== "text")) {
        diagnostics.push({ severity: "error", code: "INVALID_OUTPUT_FORMAT", message: "--format requires json or text and is available only with graph or explain." });
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

  if (args.command === "target-form" && args.line === undefined && !diagnostics.length) {
    diagnostics.push({ severity: "error", code: "INVALID_LINE_OPTION", message: "target-form requires --line with a one-based line in the complete input file." });
  }
  if (args.command === "target-form" && args.to === undefined && !diagnostics.length) {
    diagnostics.push({ severity: "error", code: "INVALID_FORM_OPTION", message: "target-form requires --to named or --to positional." });
  }
  if (args.command === "graph" && args.format === "text" && args.inputMode === "host") {
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
  ast              Parse source to an ordered AST as JSON; no reference validation
  graph            Compile source to Point-Bearing Graph IR; JSON by default
  explain          Inspect compiler decisions; JSON by default, optional text
  export           Preserve selected source, AST, graph and Explain together as JSON
  target-form      Preview naming a relation's target, or making it positional
                   again, as one JSON source edit; never write it

Options:
  --input <mode>   document (default) or host (Markdown Cogitatum fences)
  --format <kind>  json or text (graph or explain; graph text is document-only)
  --line <number>  Required for target-form; one-based line in the full file
  --to <form>      Required for target-form: named or positional
  --references     Include written-name references (check only)
  --               End options before an option-like filename
  -h, --help       Show this help
  -v, --version    Show CLI and format version

graph reads Cogitatum source, not saved Graph IR JSON.
--format selects output notation; it does not format or rewrite source.
All commands run locally without an LLM and leave input files unchanged.
check, graph, explain and export all compile; ast stops at parsing.
check validates markup; explain traces compilation. Neither evaluates reasoning.

Output:
  Results and source/option diagnostics go to stdout; I/O failures go to stderr.
  Host JSON preserves source units; graph text accepts one document only.
  Explain text includes every selected unit and source-selection diagnostic.
  Graph-only JSON omits note prose; graph text also omits note source/target records.
  export preserves note prose, literal subtrees, targets and source locations.
  Keep the original host file for surrounding Markdown outside selected fences.
  Error-bearing graphs are partial; inspect diagnostics and the exit status.

Exit status:
  0  Successful inspection/check, or a ready preview
  1  Source/I/O error, or an unavailable preview
  2  Invalid or missing arguments
An unavailable preview can have valid source; read its reason and message.

Examples:
  cog check inquiry.cog.md
  cog check --references inquiry.cog.md
  cog graph inquiry.cog.md
  cog graph --format text inquiry.cog.md
  cog graph --input host --format json notes.md
  cog explain inquiry.cog.md
  cog explain --input host --format text notes.md
  cog export inquiry.cog.md
  cog target-form --line 3 --to named inquiry.cog.md
  cog target-form --line 3 --to positional inquiry.cog.md
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
