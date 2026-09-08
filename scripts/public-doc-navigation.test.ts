import { readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import manifest from "../docs/manifest.json";

const PUBLIC_DOC_IDS = manifest.pages;

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const docsRoot = join(repoRoot, "docs");
const publicIds = new Set<string>(PUBLIC_DOC_IDS);
const publicFilenames = PUBLIC_DOC_IDS.flatMap((id) => [
  `${id}.md`,
  basename(`${id}.md`)
]);

describe("public documentation navigation", () => {
  it("uses titles rather than repository filenames as visible navigation", () => {
    for (const id of PUBLIC_DOC_IDS) {
      const tree = parsePublicDoc(id);
      visit(tree, (node: { type?: string; value?: string }) => {
        if (node.type !== "text" && node.type !== "inlineCode") return;
        for (const filename of publicFilenames) {
          expect(node.value, `${id} exposes ${filename}`).not.toContain(filename);
        }
        if (node.type === "inlineCode" && !node.value?.includes(".cog.md")) {
          expect(node.value, `${id} exposes a repository Markdown filename`).not.toMatch(/\.md\b/);
        }
      });
    }
  });

  it("keeps every relative Markdown link inside the public allowlist", () => {
    for (const id of PUBLIC_DOC_IDS) {
      const sourcePath = join(docsRoot, `${id}.md`);
      const tree = parsePublicDoc(id);
      visit(tree, "link", (node: { url: string }) => {
        const match = node.url.match(/^([^?#]+\.md)(?:[?#].*)?$/);
        if (!match) return;
        const target = resolve(dirname(sourcePath), match[1]);
        const targetId = relative(docsRoot, target).replaceAll("\\", "/").slice(0, -3);
        expect(publicIds.has(targetId), `${id} links to non-public ${targetId}`).toBe(true);
      });
    }
  });

  it("uses absolute website links so docs also work in a source checkout", () => {
    for (const id of PUBLIC_DOC_IDS) {
      visit(parsePublicDoc(id), "link", (node: { url: string }) => {
        expect(node.url, `${id} has a website-relative link`).not.toMatch(/^\//);
      });
    }
  });

});

function parsePublicDoc(id: string) {
  const source = readFileSync(join(docsRoot, `${id}.md`), "utf8");
  return unified().use(remarkParse).parse(source);
}
