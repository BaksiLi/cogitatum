import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";

const roots = ["package.json", "package-lock.json", "docs/manifest.json", "spec", "fixtures", "examples"];
if (existsSync("benchmarks")) roots.push("benchmarks");
const files = [];

for (const root of roots) {
  await collectJson(root, files);
}

const failures = [];
for (const file of files.sort()) {
  try {
    JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Parsed ${files.length} JSON files.\n`);
}

async function collectJson(path, output) {
  if (extname(path) === ".json") {
    output.push(path);
    return;
  }

  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      await collectJson(child, output);
    } else if (entry.name.endsWith(".json")) {
      output.push(child);
    }
  }
}
