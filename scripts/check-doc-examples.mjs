import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import { compileSource } from "@cogitatum/core";

// Research examples remain executable evidence without becoming public docs.
const files = ["README.md", ...markdownFiles("docs")];
const failures = [];
let checked = 0;

for (const file of files) {
  const tree = unified().use(remarkParse).parse(readFileSync(file, "utf8"));

  visit(tree, "code", (node) => {
    const meta = node.meta?.split(/\s+/).filter(Boolean) ?? [];
    if (!meta.includes("cog-check")) {
      return;
    }

    checked += 1;
    const input = meta.find((part) => part.startsWith("input="))?.slice("input=".length) ?? "document";
    if (!["document", "host", "auto"].includes(input)) {
      failures.push({ file, line: node.position?.start.line, invalidInput: input });
      return;
    }
    const result = compileSource(node.value, input);
    const points = result.graphs.flatMap((graph) => graph.points);
    const bearings = result.graphs.flatMap((graph) => graph.bearings);
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    const requiredKinds = meta
      .find((part) => part.startsWith("require="))
      ?.slice("require=".length)
      .split(",")
      .filter(Boolean) ?? [];
    const actualKinds = new Set(bearings.map((bearing) => bearing.kind));
    const missingKinds = requiredKinds.filter((kind) => !actualKinds.has(kind));
    // Counts also check examples whose lesson is the absence of a connection.
    const counts = { points: points.length, bearings: bearings.length, diagnostics: result.diagnostics.length };
    const countMismatches = Object.entries(counts).flatMap(([name, actual]) => {
      const value = meta.find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
      if (value === undefined) return [];
      const expected = Number(value);
      return /^\d+$/.test(value) && expected === actual ? [] : [{ name, expected: value, actual }];
    });

    if (errors.length > 0 || missingKinds.length > 0 || countMismatches.length > 0) {
      failures.push({
        file,
        line: node.position?.start.line,
        errors: errors.map((diagnostic) => diagnostic.code),
        missingKinds,
        countMismatches
      });
    }
  });
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith(".md") ? [path] : [];
  });
}

if (checked === 0) {
  throw new Error("No executable documentation examples were marked with cog-check.");
}
if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ failures }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Checked ${checked} executable documentation examples.\n`);
}
