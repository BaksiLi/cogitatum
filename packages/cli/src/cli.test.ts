import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeSourceReferences, compileGraph, formatGraph, formatExplain, parseDocument, explainSource, previewRelationEdit, previewTargetForm } from "../../core/src/index.js";
import type { SourceParseMode } from "../../core/src/index.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const cliPath = join(repoRoot, "packages", "cli", "src", "index.ts");
const tsxImport = createRequire(import.meta.url).resolve("tsx");
const packageVersion = JSON.parse(readFileSync(join(repoRoot, "packages/cli/package.json"), "utf8")).version as string;
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
  it.each(["document", "host"] as const)("prints all compiler decisions and structural previews in %s input without writing", mode => {
    const content = "- [C @claim] Claim.\n  - [G @reason; @step] Reason.\n    - [_ -> ^/; @review]\n      - [. @first] First.\n      - [. @second] Second.";
    const source = mode === "host" ? "Host prose.\r\n  ```cog\r\n" + content.split("\n").map(l => "  " + l).join("\r\n") + "\r\n  ```" : content;
    const file = join(workingDirectory, "target-form.md");
    writeFileSync(file, source);
    const line = mode === "host" ? 5 : 3;
    const result = runCli("target-form", "--input", mode, "--line", String(line), "--to", "named", file);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(previewTargetForm(source, { mode, line, form: "named" }));
    const explain = runCli("explain", "--input", mode, "--format", "text", file);
    expect(explain.status).toBe(0);
    expect(explain.stdout).toBe(formatExplain(explainSource(source, mode)));
    expect(readFileSync(file, "utf8")).toBe(source);
    const proposed = JSON.parse(result.stdout).proposedSource as string;
    expect(proposed).toBe(source.replace("[_ -> ^/; @review]", "[_ -> @step; @review]"));
    writeFileSync(file, proposed);
    const restored = runCli("target-form", "--input", mode, "--line", String(line), "--to", "positional", file);
    expect(restored.status).toBe(0);
    expect(JSON.parse(restored.stdout).proposedSource).toBe(source);
    writeFileSync(file, source.replace("[G @reason; @step]", "[G @reason]"));
    expect(runCli("target-form", "--input", mode, "--line", String(line), "--to", "named", file).status).toBe(1);
  });

  it("prints relation-edit previews as the core API does, without writing", () => {
    const source = "- [C] Claim.\n  - [_]\n    - [.] A.\n    - [.] B.\n";
    const file = join(workingDirectory, "relation-edit.md");
    writeFileSync(file, source);
    const decided = runCli("relation-edit", "--line", "2", "--decide", "supports", file);
    expect(decided.status).toBe(0);
    expect(JSON.parse(decided.stdout)).toEqual(previewRelationEdit(source, { operation: "decide", line: 2, kind: "supports" }));
    expect(JSON.parse(decided.stdout).comparison.relation).toBe("refinement");
    const separated = runCli("relation-edit", "--separate", "--line", "2", file);
    expect(separated.status).toBe(0);
    const proposed = JSON.parse(separated.stdout).proposedSource as string;
    writeFileSync(file, proposed);
    const joined = runCli("relation-edit", "--join", "2,3", file);
    expect(joined.status).toBe(0);
    expect(JSON.parse(joined.stdout).proposedSource).toBe(source);
    expect(readFileSync(file, "utf8")).toBe(proposed);
    expect(runCli("relation-edit", "--line", "1", "--separate", file).status).toBe(1);
  });

  it("prints source-selection errors in text Explain without a selected unit", () => {
    const file = join(workingDirectory, "unclosed-explain.md");
    writeFileSync(file, "```cog\n- [C] Unclosed.");
    const result = runCli("explain", "--input", "host", "--format", "text", file);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("UNCLOSED_COGITATUM_FENCE");
  });

  it.each([
    ["target-form", "--line", "1", "valid.cog.md"],
    ["target-form", "--to", "named", "valid.cog.md"],
    ["target-form", "--to", "named", "--to", "positional", "--line", "1", "valid.cog.md"],
    ["target-form", "--to", "local", "--line", "1", "valid.cog.md"],
    ["target-form", "--to", "explicit", "--line", "1", "valid.cog.md"],
    ["target-form", "--to", "named", "--line", "0", "valid.cog.md"],
    ["graph", "--to", "named", "valid.cog.md"],
    ["target-form", "--to", "named", "--line", "1", "--format", "text", "valid.cog.md"],
    ["relation-edit", "--line", "1", "valid.cog.md"],
    ["relation-edit", "--separate", "valid.cog.md"],
    ["relation-edit", "--line", "1", "--decide", "supported", "valid.cog.md"],
    ["relation-edit", "--line", "1", "--decide", "supports", "--separate", "valid.cog.md"],
    ["relation-edit", "--join", "1", "valid.cog.md"],
    ["relation-edit", "--join", "1,2", "--line", "1", "valid.cog.md"],
    ["relation-edit", "--to", "named", "--line", "1", "valid.cog.md"],
    ["graph", "--separate", "valid.cog.md"]
  ])("rejects invalid preview arguments %j", (...args) => {
    expect(runCli(...args).status).toBe(2);
  });
  it.each(["document", "host"] as const)("exports complete multiline note ownership and literal content in %s mode", mode => {
    const inquiry = [
      "- [C @c] Claim",
      "  with a qualification.",
      "  - [G; @r] Reason.",
      "    - [bearing note] Here yesterday.",
      "      Continued here.",
      "",
      "      Another paragraph.",
      "      - [point @ignored] Literal",
      "        continuation.",
      "- [edge use @r] This occurrence",
      "  has its own prose."
    ].join("\n");
    const source = (mode === "host" ? "Prose.\n  ```cog\n" + inquiry.split("\n").map(line => "  " + line).join("\n") + "\n  ```" : inquiry).replace(/\n/g, "\r\n");
    const file = join(workingDirectory, "notes-export.md");
    writeFileSync(file, source);
    const result = runCli("export", "--input", mode, file);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const exported = JSON.parse(result.stdout);
    expect(exported).toEqual(JSON.parse(JSON.stringify(explainSource(source, mode))));
    expect(exported.graphs[0].notes).toHaveLength(1);
    expect(exported.graphs[0].points.map((point: { text: string }) => point.text)).toEqual(["Claim\nwith a qualification.", "Reason."]);
    const note = exported.documents[0].blocks[0].children[0].children[0];
    expect(note.text).toBe("Here yesterday.\nContinued here.\n\nAnother paragraph.");
    expect(note.children[0].text).toBe("[point @ignored] Literal\ncontinuation.");
    expect(note.sourceSpan).toEqual({
      startLine: mode === "host" ? 6 : 4,
      startColumn: mode === "host" ? 9 : 7,
      endLine: mode === "host" ? 9 : 7,
      endColumn: (mode === "host" ? 2 : 0) + inquiry.split("\n")[6].length + 1
    });
    expect(exported.graphs[0].notes[0].sourceSpan).toEqual(note.sourceSpan);
    expect(exported.documents[0].blocks[1].text).toBe("This occurrence\nhas its own prose.");
    expect(readFileSync(file, "utf8")).toBe(source);
    expect(runCli("export", "--format", "text", file).status).toBe(2);
    expect(runCli("export", "--references", file).status).toBe(2);
    writeFileSync(file, source.replace("[bearing note]", "[bearing note @bad]"));
    const failed = runCli("export", "--input", mode, file);
    expect(failed.status).toBe(1);
    expect(JSON.parse(failed.stdout).graphs[0].notes).toEqual([]);
    expect(JSON.parse(failed.stdout).diagnostics.map((d: { code: string }) => d.code)).toContain("MALFORMED_NOTE");
  });

  it.each([
    ["document", "- [C @c] Claim.\r\n  - [G] Reason.", 2, 0],
    ["document", "- [C @c] Claim.\r\n  - [G] Reason\r\n    continued here.", 3, 0],
    ["document", "- [C @c] Claim.\r\n\t- [G] Reason\r\n\t  continued here.", 3, 0],
    ["document", "- [C @c] Claim.\n  - [G] Reason \u2028 with \u2029 separators.\n    - [note] Literal \u2028 note.\n      - [G +> @missing] Inert.", 2, 0],
    ["host", "Intro 🌧️\n  ```cog\n  - [C @c] Claim.\n    - [O] Concern.\n  ```", 4, 0],
    ["host", "Intro 🌧️\r  ```cog\r  - [C @c] Claim.\r    - [G] Reason.\r  ```", 4, 0],
    ["host", "Intro.\r\n  ```cog\r\n  - [C @c] Claim.\r\n    - [G] Reason\r\n      continued here.\r\n  ```", 5, 0],
    ["host", "Intro.\r\n  ```cog\r\n  - [C @c] Claim.\r\n  \t- [G] Reason\r\n  \t  continued here.\r\n  ```", 5, 0],
    ["document", "- [C] Anonymous.\n  - [G] Reason.", 2, 1],
    ["document", "- [C @c] Claim.\n  - [G] Reason.\n- [O -> @missing] Invalid.", 2, 1]
  ] as const)("previews named targets in %s mode with API parity and no file writes", (mode, source, line, status) => {
    const file = join(workingDirectory, "edit-preview.md");
    writeFileSync(file, source);
    const result = runCli("target-form", "--input", mode, "--line", String(line), "--to", "named", file);
    expect(result.status).toBe(status);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual(previewTargetForm(source, { line, mode, form: "named" }));
    expect(readFileSync(file, "utf8")).toBe(source);
  });

  it.each([
    ["target-form", "--to", "named", "valid.cog.md"],
    ["target-form", "--to", "named", "--line", "0", "valid.cog.md"],
    ["target-form", "--to", "named", "--line", "1.2", "valid.cog.md"],
    ["target-form", "--to", "named", "--line", "-1", "valid.cog.md"],
    ["target-form", "--to", "named", "--line", "9007199254740992", "valid.cog.md"],
    ["target-form", "--to", "named", "--line", "1", "--line", "2", "valid.cog.md"],
    ["target-form", "--to", "named", "--line"],
    ["graph", "--line", "1", "valid.cog.md"]
  ])("rejects invalid line options: %j", (...args) => {
    const result = runCli(...args);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).diagnostics).toContainEqual(expect.objectContaining({ code: "INVALID_LINE_OPTION" }));
  });

  it("keeps option-like filenames available after -- and rejects unrelated options", () => {
    const source = "- [C @c] Claim.\n  - [G] Reason.";
    writeFileSync(join(workingDirectory, "--line"), source);
    expect(runCli("target-form", "--to", "named", "--line", "2", "--", "--line").status).toBe(0);
    expect(readFileSync(join(workingDirectory, "--line"), "utf8")).toBe(source);
    expect(runCli("target-form", "--to", "named", "--line", "2", "--format", "text", "valid.cog.md").status).toBe(2);
    expect(runCli("target-form", "--to", "named", "--line", "2", "--references", "valid.cog.md").status).toBe(2);
  });

  it.each([["explicit-target", "--line", "2", "valid.cog.md"], ["explicit-target"]])("diagnoses the retired command %j with its replacement", (...args) => {
    const result = runCli(...args);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).diagnostics).toEqual([expect.objectContaining({ code: "RETIRED_COMMAND", message: expect.stringContaining("target-form --line <n> --to named") })]);
  });

  it.each([
    '- [C @c] Claim.\n  - [G; @step] Reason.\n- [O -> @step] Objection.',
    '- [C] Survives.\n- [G +> @missing] Fails.',
    ''
  ])("prints single-graph text with unchanged exit status and source", source => {
    const path = join(workingDirectory, "inspect.cog.md");
    writeFileSync(path, source);
    const graph = compileGraph(parseDocument(source));
    const result = runCli("graph", "--format", "text", path);
    expect(result.stdout).toBe(formatGraph(graph));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(graph.diagnostics.some(d => d.severity === "error") ? 1 : 0);
    expect(runCli("graph", path).stdout).toBe(JSON.stringify(graph, null, 2) + "\n");
    expect(readFileSync(path, "utf8")).toBe(source);
  });

  it.each(["document", "host"])("keeps explicit and default JSON identical in %s mode", mode => {
    const file = mode === "host" ? "host.md" : "valid.cog.md";
    expect(runCli("graph", "--input", mode, "--format", "json", file)).toEqual(runCli("graph", "--input", mode, file));
  });

  it.each([
    ["graph", "--format"],
    ["graph", "--format", "html", "valid.cog.md"],
    ["check", "--format", "text", "valid.cog.md"],
    ["ast", "--format", "json", "valid.cog.md"],
    ["graph", "--input", "host", "--format", "text", "host.md"],
    ["graph", "--format", "text", "--input", "host", "host.md"]
  ])("rejects unsupported text scopes/options: %j", (...args) => {
    const result = runCli(...args);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).diagnostics).toContainEqual(expect.objectContaining({ code: "INVALID_OUTPUT_FORMAT" }));
  });

  it("treats --format as a filename after the option terminator", () => {
    writeFileSync(join(workingDirectory, "--format"), "- [C] Claim.");
    expect(runCli("graph", "--format", "text", "--", "--format").stdout).toContain('p1: role(C) text="Claim."');
  });

  it.each([
    ["document", "- [. use @record] Review.\r\n- [. @record] Calibration record.\r\n"],
    ["host", "```cog\n- [C @record] First.\n```\n```cog\n- [. use @record] Review.\n- [C @record] Second.\n```"],
    ["document", "- [C @record] Calibration record.\n- [. use @missing] Missing."],
    ["host", "```cog\n- [C @record] Calibration record.\n```\n```cog\n- [. use @record] Omitted."],
    ["host", "Ordinary prose with @record."]
  ] as const)("matches the public reference API and normal check diagnostics in %s mode", (mode: SourceParseMode, source) => {
    const path = join(workingDirectory, "reference-review.md");
    writeFileSync(path, source);
    const before = readFileSync(path);
    const expected = analyzeSourceReferences(source, mode);
    const normal = runCli("check", "--input", mode, path);
    const inventory = runCli("check", "--references", "--input", mode, path);
    expect(inventory.stderr).toBe("");
    expect(inventory.status).toBe(expected.references.status === "unavailable" ? 1 : 0);
    expect(inventory.status).toBe(normal.status);
    expect(JSON.parse(inventory.stdout)).toEqual(expected);
    expect(JSON.parse(normal.stdout)).toEqual({ version: expected.version, ...(mode === "host" ? { mode } : {}), diagnostics: expected.diagnostics });
    expect(readFileSync(path)).toEqual(before);
    const explanation = JSON.parse(runCli("explain", "--input", mode, path).stdout);
    const compiled = explainSource(source, mode);
    expect(explanation).toEqual(mode === "document" ? compiled.explanations[0] : {
      version: compiled.version, mode, units: compiled.units, explanations: compiled.explanations, diagnostics: compiled.diagnostics
    });
  });

  it.each(["ast", "graph", "explain"])("rejects --references on %s without altering that output contract", command => {
    const result = runCli(command, "--references", "valid.cog.md");
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).diagnostics).toEqual([{ severity: "error", code: "INVALID_OPTION", message: "--references is only available with check." }]);
  });

  it("allows a file named --references after the option terminator", () => {
    writeFileSync(join(workingDirectory, "--references"), "- [C @claim] A claim.");
    const result = runCli("check", "--", "--references");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ version: "0.6.0", diagnostics: [] });
  });

  it("prints valid partial output and exits with failure after a misindented annotation", () => {
    writeFileSync(join(workingDirectory, "misindented.cog.md"), "-    [C @outer] Outer.\n  - Spaced.\n\t- [C @failed] Failed.\n    - [G @inner] Inner.\n      - [G @detail] Detail.");
    const result = runCli("graph", "misindented.cog.md");
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    const graph = JSON.parse(result.stdout);
    expect(graph.points.map((point: { id: string }) => point.id)).toEqual(["outer", "inner", "detail"]);
    expect(graph.points[0].sourceSpan.startColumn).toBe(6);
    expect(graph.bearings).toEqual([expect.objectContaining({ sources: [{ key: graph.points[2].key, kind: "point" }], target: { key: graph.points[1].key, kind: "point" } })]);
    expect(graph.diagnostics.map((diagnostic: { code: string }) => diagnostic.code)).toEqual(["MIXED_INDENTATION", "FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET"]);
  });

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

  it("prints package and format version information", () => {
    const help = runCli("--help");
    const version = runCli("--version");

    expect(help.status).toBe(0);
    expect(help.stdout).toContain(`Cogitatum ${packageVersion} (format 0.6.0)`);
    expect(help.stdout).toContain("cog <command>");
    expect(version.status).toBe(0);
    expect(version.stdout).toContain(`cog ${packageVersion} (format 0.6.0)`);
  });

  it.each(["document", "host"])("keeps parsing separate from reference validation in %s mode", mode => {
    const source = '- [C @claim] Claim.\n  - [G +> @missing] Reason.';
    const input = mode === "host" ? ["Context.", "", "```cog", source, "```"].join("\n") : source;
    const file = join(workingDirectory, "unresolved-target.md");
    writeFileSync(file, input);
    const ast = runCli("ast", "--input", mode, file);
    expect(ast.status).toBe(0);
    const parsed = JSON.parse(ast.stdout);
    expect(parsed.diagnostics).toEqual([]);
    const document = mode === "host" ? parsed.documents[0] : parsed;
    expect(document.blocks[0].children[0].annotation.operatorClause.target).toEqual({ id: "missing" });
    for (const command of ["check", "graph", "explain"]) {
      const result = runCli(command, "--input", mode, file);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).diagnostics.map((d: { code: string }) => d.code)).toEqual(["UNKNOWN_TARGET"]);
    }
    expect(readFileSync(file, "utf8")).toBe(input);
  });

  it("checks valid source and preserves compiler diagnostics", () => {
    const valid = runCli("check", "valid.cog.md");
    const invalid = runCli(
      "check",
      join(repoRoot, "fixtures", "diagnostics", "bearing-handle-without-bearing.cog.md")
    );

    expect(valid.status).toBe(0);
    expect(JSON.parse(valid.stdout)).toMatchObject({ version: "0.6.0", diagnostics: [] });
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
