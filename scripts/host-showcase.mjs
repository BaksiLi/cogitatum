import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Wrap one shared source without editing its annotations or choosing host-specific semantics. */
export function renderShowcase(source, host) {
  if (host === "document") return source;
  // A longer fence also preserves a future example containing literal backticks.
  const fence = "`".repeat(Math.max(3, ...[...source.matchAll(/`+/g)].map(match => match[0].length + 1)));
  const lines = [`${fence}cog`, ...source.replace(/\r?\n$/, "").split(/\r?\n/), fence];
  if (host === "obsidian") return lines.join("\n") + "\n";
  if (host === "logseq") return lines.map((line, index) => (index ? "  " : "- ") + line).join("\n") + "\n";
  throw new Error("Choose document, obsidian or logseq.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [host, path, ...extra] = process.argv.slice(2);
  if (!host || extra.length) throw new Error("Usage: node scripts/host-showcase.mjs <document|obsidian|logseq> [source.cog.md]");
  const source = readFileSync(path ?? new URL("../examples/host-showcase.cog.md", import.meta.url), "utf8");
  process.stdout.write(renderShowcase(source, host));
}
