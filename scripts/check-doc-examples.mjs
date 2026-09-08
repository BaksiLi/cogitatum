import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import { compileGraph, parseDocument } from "@cogitatum/core";

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
    const graph = compileGraph(parseDocument(node.value));
    const errors = graph.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    const requiredKinds = meta
      .find((part) => part.startsWith("require="))
      ?.slice("require=".length)
      .split(",")
      .filter(Boolean) ?? [];
    const actualKinds = new Set(graph.bearings.map((bearing) => bearing.kind));
    const missingKinds = requiredKinds.filter((kind) => !actualKinds.has(kind));

    if (errors.length > 0 || missingKinds.length > 0) {
      failures.push({
        file,
        line: node.position?.start.line,
        errors: errors.map((diagnostic) => diagnostic.code),
        missingKinds
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
