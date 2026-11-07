import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const runtime = fileURLToPath(new URL("../editors/vim", import.meta.url));
const vim = spawnSync("vim", ["--version"], { encoding: "utf8" });
const directory = mkdtempSync(join(tmpdir(), "cogitatum-vim-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

/** Opens `file` in a clean Vim with only this runtime, returning the filetype and the syntax group at each position. */
function inspect(file: string, positions: [number, number][]): string[] {
  const script = join(directory, "inspect.vim");
  const output = join(directory, "out.txt");
  writeFileSync(script, [
    "set nocompatible",
    `let &rtp = ${JSON.stringify(runtime)} . ',' . &rtp`,
    "let g:markdown_fenced_languages = ['cog=cogitatum']",
    "filetype plugin on",
    "syntax on",
    `edit ${file}`,
    "let s:out = [&filetype]",
    `for [s:line, s:col] in ${JSON.stringify(positions)}`,
    "  call add(s:out, synIDattr(synID(s:line, s:col, 1), 'name'))",
    "endfor",
    `call writefile(s:out, ${JSON.stringify(output)})`,
    "qall!"
  ].join("\n"));
  const result = spawnSync("vim", ["-Nu", "NONE", "-i", "NONE", "-n", "-es", "-S", script], { encoding: "utf8" });
  expect(result.status).toBe(0);
  return readFileSync(output, "utf8").trim().split("\n");
}

describe.skipIf(vim.status !== 0)("Vim runtime", () => {
  it("detects dedicated documents and highlights each header token", () => {
    const file = join(directory, "inquiry.cog.md");
    writeFileSync(file, [
      "- [C @claim] A claim with `code` and [G] in prose.",
      "  - [G use @claim; @route] Because.",
      "    - [O/ -> ^/] Against.",
      "  - [_ linked] Retired."
    ].join("\n"));
    expect(inspect(file, [[1, 1], [1, 4], [1, 6], [1, 13], [1, 27], [1, 39], [2, 6], [2, 8], [2, 12], [2, 18], [3, 8], [3, 11], [3, 14], [4, 6], [4, 8]])).toEqual([
      "cogitatum",
      "cogBullet", "cogClaim", "cogName", "", "cogCode", "",
      "cogGround", "cogKeyword", "cogName", "cogSeparator",
      "cogObjection", "cogOperator", "cogTarget",
      "cogFamily", "cogRetired"
    ]);
  });

  it("highlights cog fences inside ordinary Markdown", () => {
    const file = join(directory, "notes.md");
    writeFileSync(file, ["# Notes", "", "```cog", "- [C @claim] A claim.", "```"].join("\n"));
    expect(inspect(file, [[4, 4], [4, 6]])).toEqual(["markdown", "cogClaim", "cogName"]);
  });
});
