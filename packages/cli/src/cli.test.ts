import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const cliPath = join(repoRoot, "packages", "cli", "src", "index.ts");
const tsxImport = createRequire(import.meta.url).resolve("tsx");
let workingDirectory: string;

beforeAll(() => {
  workingDirectory = mkdtempSync(join(tmpdir(), "cogitatum-cli-"));
  writeFileSync(join(workingDirectory, "valid.cog.md"), "- [C] A claim.\n", "utf8");
  writeFileSync(join(workingDirectory, "-named.cog.md"), "- [C] A named claim.\n", "utf8");
  writeFileSync(join(workingDirectory, "--help"), "- [C] A file named like an option.\n", "utf8");
  const fence = String.fromCharCode(96).repeat(3);
  writeFileSync(join(workingDirectory, "host.md"), ["<!--", fence + "cog", "- [C @hidden] Hidden.", fence, "-->"].join("\n"), "utf8");
});

afterAll(() => {
  rmSync(workingDirectory, { recursive: true, force: true });
});

describe("cog CLI", () => {
  it("keeps note literals inert and advice nonblocking while retired claims fail", () => {
    writeFileSync(join(workingDirectory, "notes.cog.md"), "- [C @c] Claim.\n  - [note]\n    - [C? @c]\n    - [G +> @missing]\n  - Group\n    - [G] Reason.");
    const notes = runCli("explain", "notes.cog.md");
    expect(notes.status).toBe(0);
    const explanation = JSON.parse(notes.stdout);
    expect(explanation.diagnostics).toEqual([expect.objectContaining({ code: "IMPLICIT_ATTACHMENT_THROUGH_BODY", severity: "suggestion" })]);
    expect(explanation.entries[1].recognition).toEqual({ kind: "note" });
    writeFileSync(join(workingDirectory, "retired.cog.md"), "- [C?] Old claim.\n  - [G] Cannot fall back.");
    const retired = runCli("check", "retired.cog.md");
    expect(retired.status).toBe(1);
    expect(JSON.parse(retired.stdout).diagnostics.map((diagnostic: { code: string }) => diagnostic.code)).toContain("RETIRED_CLAIM_OPENNESS");
  });

  it("requires an explicit context instead of accepting auto", () => {
    const result = runCli("check", "--input", "auto", "valid.cog.md");
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).diagnostics).toEqual([expect.objectContaining({ code: "INVALID_INPUT_MODE", message: expect.stringContaining("Auto selection is retired") })]);
    expect(result.stderr).toBe("");
  });

  it("leaves comment-contained annotations inactive in explicit host context", () => {
    const result = runCli("graph", "--input", "host", "host.md");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ mode: "host", units: [], documents: [], graphs: [], diagnostics: [] });
  });

  it("prints Alpha help and version information", () => {
    const help = runCli("--help");
    const version = runCli("--version");

    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Cogitatum 0.4.9 (format 0.4.0)");
    expect(help.stdout).toContain("cog <command>");
    expect(version.status).toBe(0);
    expect(version.stdout).toContain("cog 0.4.9 (format 0.4.0)");
  });

  it("checks valid source and preserves compiler diagnostics", () => {
    const valid = runCli("check", "valid.cog.md");
    const invalid = runCli(
      "check",
      join(repoRoot, "fixtures", "diagnostics", "bearing-handle-without-bearing.cog.md")
    );

    expect(valid.status).toBe(0);
    expect(JSON.parse(valid.stdout)).toMatchObject({ version: "0.4.0", diagnostics: [] });
    expect(invalid.status).toBe(1);
    expect(JSON.parse(invalid.stdout).diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "BEARING_HANDLE_WITHOUT_BEARING" })])
    );
  });

  it("rejects unknown short options instead of treating them as files", () => {
    const result = runCli("check", "-x");

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).diagnostics).toEqual([
      expect.objectContaining({ code: "UNKNOWN_OPTION", message: "Unknown option -x." })
    ]);
    expect(result.stderr).toBe("");
  });

  it("accepts a dash-prefixed filename after the option terminator", () => {
    const result = runCli("check", "--", "-named.cog.md");

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ diagnostics: [] });
  });

  it("treats --help after the option terminator as a filename", () => {
    const result = runCli("graph", "--", "--help");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).points[0].text).toBe("A file named like an option.");
  });
});

function runCli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--conditions", "development", "--import", tsxImport, cliPath, ...args], {
    cwd: workingDirectory,
    encoding: "utf8"
  });

  return {
    status: result.status,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString()
  };
}
