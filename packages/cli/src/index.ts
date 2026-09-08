#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import {
  compileGraphWithExplain,
  compileSource,
  explainSource,
  FORMAT_VERSION,
  parseDocument,
  parseSource
} from "@cogitatum/core";
import type { Diagnostic, SourceParseMode } from "@cogitatum/core";

type Command = "ast" | "graph" | "explain" | "check";

const PACKAGE_VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

type CliArgs = {
  command?: Command;
  file?: string;
  inputMode: SourceParseMode;
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
    process.stdout.write(`cog ${PACKAGE_VERSION} (Alpha; format ${FORMAT_VERSION})\n`);
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
    printJson(graph);
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
  return value === "ast" || value === "graph" || value === "explain" || value === "check";
}

function parseArgs(argv: string[]): CliArgs {
  const diagnostics: Diagnostic[] = [];
  const commandArg = argv[0];
  let optionsEnded = false;
  const args: CliArgs = {
    command: isCommand(commandArg) ? commandArg : undefined,
    inputMode: "document",
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
    if (!optionsEnded && arg === "--input") {
      const value = argv[index + 1];
      if (!isInputMode(value)) {
        diagnostics.push({
          severity: "error",
          code: "INVALID_INPUT_MODE",
          message: "--input must be document, host, or auto."
        });
        break;
      }
      args.inputMode = value;
      index += 1;
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

  return args;
}

function isInputMode(value: string | undefined): value is SourceParseMode {
  return value === "document" || value === "host" || value === "auto";
}

function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printUsage(stream: NodeJS.WritableStream = process.stderr): void {
  stream.write(`Cogitatum ${PACKAGE_VERSION} (Alpha; format ${FORMAT_VERSION})\n\n`);
  stream.write("Usage: cog <command> [--input document|host|auto] <file>\n\n");
  stream.write("Commands:\n");
  stream.write("  check    Report deterministic syntax and reference diagnostics\n");
  stream.write("  ast      Print the ordered source AST as JSON\n");
  stream.write("  graph    Print compiled Point-Bearing Graph IR as JSON\n");
  stream.write("  explain  Print an Alpha compiler trace as JSON (optional debugging)\n\n");
  stream.write("Options:\n");
  stream.write("  --input <mode>  document (default), host, or auto\n");
  stream.write("  -h, --help      Show this help\n");
  stream.write("  -v, --version   Show CLI and format version\n\n");
  stream.write("Examples:\n");
  stream.write("  cog check inquiry.cog.md\n");
  stream.write("  cog graph inquiry.cog.md\n");
  stream.write("  cog explain inquiry.cog.md\n");
  stream.write("  cog check --input host notes.md\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
