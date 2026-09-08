import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  compileGraph,
  compileGraphWithExplain,
  compileSource,
  explainSource,
  extractCogitatumSourceUnits,
  parseDocument,
  parseSource
} from "./index.js";
import type { AstBlock, GraphIR, SourceParseMode } from "./types.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function fixture(name: string): string {
  return readFileSync(join(repoRoot, "fixtures", name), "utf8");
}

function example(name: string): string {
  return readFileSync(join(repoRoot, "examples", name), "utf8");
}

function blockAnchor(block: AstBlock): string | undefined {
  return block.annotation && "anchor" in block.annotation ? block.annotation.anchor : undefined;
}

function findBlock(blocks: AstBlock[], id: string): AstBlock {
  for (const block of blocks) {
    if (blockAnchor(block) === id) {
      return block;
    }
    const child = findBlockOptional(block.children, id);
    if (child) {
      return child;
    }
  }
  throw new Error(`Block @${id} not found.`);
}

function findBlockOptional(blocks: AstBlock[], id: string): AstBlock | undefined {
  for (const block of blocks) {
    if (blockAnchor(block) === id) {
      return block;
    }
    const child = findBlockOptional(block.children, id);
    if (child) {
      return child;
    }
  }
  return undefined;
}

type FixtureManifest = {
  fixtures: Array<{
    file: string;
    input?: SourceParseMode;
    purpose: string;
    expected: string;
  }>;
};

type ExampleManifest = {
  examples: Array<{
    file: string;
    purpose: string;
    expectedDiagnosticCodes: string[];
  }>;
};

function loadFixtureManifest(): FixtureManifest {
  return JSON.parse(readFileSync(join(repoRoot, "fixtures", "manifest.json"), "utf8")) as FixtureManifest;
}

function loadExampleManifest(): ExampleManifest {
  return JSON.parse(readFileSync(join(repoRoot, "examples", "manifest.json"), "utf8")) as ExampleManifest;
}

function listCogFixtureFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listCogFixtureFiles(path));
    } else if (entry.name.endsWith(".cog.md") || (basename(directory) === "host" && entry.name.endsWith(".md"))) {
      files.push(path);
    }
  }

  return files;
}

function pointRef(graph: GraphIR, id: string) {
  const point = graph.points.find((point) => point.id === id);
  if (!point) throw new Error(`Expected authored Point @${id}.`);
  return { key: point.key, kind: "point" as const };
}

function bearingRef(graph: GraphIR, handle: string) {
  const bearing = graph.bearings.find((bearing) => bearing.handle === handle);
  if (!bearing) throw new Error(`Expected authored Bearing @${handle}.`);
  return { key: bearing.key, kind: "bearing" as const };
}

describe("Cogitatum language contracts", () => {
  it("keeps unannotated children as body blocks", () => {
    const ast = parseDocument(fixture("core/body-vs-point.cog.md"));
    const root = ast.blocks[0];

    expect(root.children.filter((child) => !child.annotation)).toHaveLength(2);
    expect(root.children.filter((child) => child.annotation).map((child) => blockAnchor(child))).toEqual(["waiter-case", "too-social"]);
    expect(findBlock(ast.blocks, "waiter-case").children.filter((child) => !child.annotation)).toHaveLength(1);
  });

  it("preserves source order and compiles annotated descendants below body blocks", () => {
    const ast = parseDocument(fixture("core/body-reentry.cog.md"));
    const claim = findBlock(ast.blocks, "claim");
    const graph = compileGraph(ast);

    expect(claim.children[0].text).toBe("Expository grouping remains ordinary body.");
    expect(claim.children[0].children[0].annotation).toBeUndefined();
    expect(blockAnchor(claim.children[0].children[0].children[0])).toBe("ground");
    expect(graph.bearings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "supports",
          sources: [pointRef(graph, "ground")],
          target: pointRef(graph, "claim")
        })
      ])
    );
  });

  it("treats indentation defaults as partial without skipping an ineligible Point", () => {
    const graph = compileGraph(parseDocument(fixture("syntax/partial-indentation-defaults.cog.md")));
    const ground = graph.points.find((point) => point.form === "role" && point.role === "G");
    const objection = graph.points.find((point) => point.form === "role" && point.role === "O");

    expect(ground).toBeDefined();
    expect(objection).toBeDefined();
    expect(graph.bearings).toEqual([
      expect.objectContaining({
        kind: "answers",
        sources: [pointRef(graph, "answer")],
        target: pointRef(graph, "question")
      }),
      expect.objectContaining({
        kind: "supports",
        sources: [{ key: ground?.key, kind: "point" }],
        target: pointRef(graph, "elaboration")
      }),
      expect.objectContaining({
        kind: "challenges",
        sources: [{ key: objection?.key, kind: "point" }],
        target: pointRef(graph, "answer")
      })
    ]);
    expect(graph.bearings.some((bearing) => bearing.sources.some((source) => source.key === pointRef(graph, "elaboration").key))).toBe(
      false
    );
    expect(graph.diagnostics).toEqual([]);
  });

  it("does not add transitive support or coerce clarifications and replies to support", () => {
    const graph = compileGraph(parseDocument(fixture("syntax/no-transitive-connections.cog.md")));

    expect(graph.bearings).toEqual([
      expect.objectContaining({
        kind: "supports",
        sources: [pointRef(graph, "middle")],
        target: pointRef(graph, "conclusion")
      }),
      expect.objectContaining({
        kind: "supports",
        sources: [pointRef(graph, "first")],
        target: pointRef(graph, "middle")
      }),
      expect.objectContaining({
        kind: "clarifies",
        sources: [pointRef(graph, "distinction")],
        target: pointRef(graph, "conclusion")
      }),
      expect.objectContaining({
        kind: "challenges",
        sources: [pointRef(graph, "objection")],
        target: pointRef(graph, "conclusion")
      }),
      expect.objectContaining({
        kind: "repliesTo",
        sources: [pointRef(graph, "reply")],
        target: pointRef(graph, "objection")
      })
    ]);
    expect(
      graph.bearings.some(
        (bearing) => bearing.sources.some((source) => source.key === pointRef(graph, "first").key) && bearing.target.key === pointRef(graph, "conclusion").key
      )
    ).toBe(false);
    expect(graph.bearings.filter((bearing) => bearing.sources.some((source) => source.key === pointRef(graph, "distinction").key))).toEqual([
      expect.objectContaining({ kind: "clarifies" })
    ]);
    expect(graph.bearings.filter((bearing) => bearing.sources.some((source) => source.key === pointRef(graph, "reply").key))).toEqual([
      expect.objectContaining({ kind: "repliesTo" })
    ]);
    expect(graph.diagnostics).toEqual([]);
  });

  it("allows variable space widths when every dedent matches an active level", () => {
    const ast = parseDocument(fixture("syntax/variable-indentation.cog.md"));
    const graph = compileGraph(ast);

    expect(ast.blocks.map((block) => blockAnchor(block))).toEqual(["claim", "question"]);
    expect(ast.blocks[0].children.map((block) => blockAnchor(block))).toEqual(["first-ground", "second-ground"]);
    expect(ast.blocks[0].children[0].children[0].annotation).toMatchObject({ kind: "role", role: "O" });
    expect(graph.bearings.map((bearing) => bearing.kind)).toEqual(["supports", "challenges", "supports"]);
    expect(graph.diagnostics).toEqual([]);
  });

  it("fails closed on tabs, indented roots, and unmatched dedents in every text input mode", () => {
    const source = fixture("diagnostics/invalid-indentation.cog.md");
    const document = compileSource(source, "document");
    const host = compileSource(`# Host\n\n\`\`\`cog\n${source}\`\`\`\n`, "host");

    for (const compiled of [document, host]) {
      expect(compiled.graphs[0].points.map((point) => point.id)).toEqual(["claim", "deep-ground", "after"]);
      expect(compiled.graphs[0].bearings).toEqual([
        expect.objectContaining({
          kind: "supports",
          sources: [pointRef(compiled.graphs[0], "deep-ground")],
          target: pointRef(compiled.graphs[0], "claim")
        })
      ]);
      expect(compiled.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "UNMATCHED_DEDENT",
        "UNMATCHED_DEDENT"
      ]);
      expect(compiled.documents[0].blocks[0].children[1]).toMatchObject({
        annotation: undefined,
        text: "[O @misaligned] This dedent does not match an ancestor level."
      });
    }

    const tabbed = compileSource("- [C @root] Root.\n\t- [G @tabbed] Tabbed ground.\n", "document");
    expect(tabbed.graphs[0].points.map((point) => point.id)).toEqual(["root"]);
    expect(tabbed.diagnostics).toEqual([expect.objectContaining({ code: "TAB_INDENTATION_UNSUPPORTED" })]);
    expect(tabbed.documents[0].blocks[0].children[0]).toMatchObject({
      annotation: undefined,
      text: "[G @tabbed] Tabbed ground."
    });

    const indentedRoot = compileSource("  - [C @indented] Indented root.\n", "document");
    expect(indentedRoot.graphs[0].points).toEqual([]);
    expect(indentedRoot.documents[0].blocks[0].annotation).toBeUndefined();
    expect(indentedRoot.diagnostics).toEqual([
      expect.objectContaining({ code: "INDENTED_ROOT_UNSUPPORTED" })
    ]);
  });

  it("uses compilation keys for anonymous Points instead of source line numbers", () => {
    const source = "- [C] Claim.\n  - [G] Ground.\n";
    const shifted = "\n\n- [C] Claim.\n  - [G] Ground.\n";
    const first = compileGraph(parseDocument(source));
    const second = compileGraph(parseDocument(shifted));

    expect(first.points.map((point) => point.key)).toEqual(["_p1", "_p2"]);
    expect(second.points.map((point) => point.key)).toEqual(["_p1", "_p2"]);
    expect(first.bearings[0]).toMatchObject({
      sources: [{ key: "_p2", kind: "point" }],
      target: { key: "_p1", kind: "point" }
    });
  });

  it("explains recognition and compiler effects in source order", () => {
    const ast = parseDocument(fixture("core/body-reentry.cog.md"));
    const compilation = compileGraphWithExplain(ast);
    const [claim, firstBody, secondBody, ground] = compilation.explain.entries;

    expect(compilation.graph).toEqual(compileGraph(ast));
    expect(claim).toMatchObject({
      recognition: { kind: "role", role: "C" },
      effects: [
        { kind: "emitPoint", ref: pointRef(compilation.graph, "claim"), reason: "role-annotation" },
        { kind: "skipBearing", reason: "no-eligible-ancestor" }
      ]
    });
    expect(firstBody).toMatchObject({
      recognition: { kind: "body" },
      effects: [{ kind: "preserveBody" }]
    });
    expect(secondBody).toMatchObject({
      recognition: { kind: "body" },
      effects: [{ kind: "preserveBody" }]
    });
    expect(ground).toMatchObject({
      recognition: { kind: "role", role: "G" },
      effects: [
        { kind: "emitPoint", ref: pointRef(compilation.graph, "ground"), reason: "role-annotation" },
        {
          kind: "emitBearing",
          ref: { kind: "bearing", graphIndex: 0 },
          bearing: {
            kind: "supports",
            sources: [pointRef(compilation.graph, "ground")],
            target: pointRef(compilation.graph, "claim"),
            derivedBy: "structural"
          },
          reason: "annotated-containment"
        }
      ]
    });
    expect(compilation.explain.diagnostics).toEqual([]);
  });

  it("retains rejected Bearing candidates in Explain while Graph IR fails closed", () => {
    const compilation = compileGraphWithExplain(
      parseDocument(fixture("diagnostics/unknown-bearing-target.cog.md"))
    );
    const edge = compilation.explain.entries[2];

    expect(compilation.graph.bearings).toEqual([]);
    expect(edge).toMatchObject({
      recognition: { kind: "edge" },
      effects: [
        {
          kind: "rejectBearing",
          bearing: {
            kind: "about",
            sources: [pointRef(compilation.graph, "c1")],
            target: { id: "missing" },
            derivedBy: "operator"
          },
          reason: "validation-error"
        }
      ],
      diagnosticCodes: ["UNKNOWN_TARGET"]
    });
  });

  it("explains Point emission independently from an attached Bearing syntax failure", () => {
    const compilation = compileGraphWithExplain(
      parseDocument(fixture("diagnostics/invalid-bearing-handle.cog.md"))
    );
    const ground = compilation.explain.entries[2];

    expect(compilation.graph.points.map((point) => point.id)).toContain("g1");
    expect(compilation.graph.bearings).toEqual([]);
    expect(ground.effects).toEqual([
      { kind: "emitPoint", id: "g1", ref: pointRef(compilation.graph, "g1"), reason: "role-annotation" },
      { kind: "rejectBearing", reason: "annotation-syntax-error" }
    ]);
    expect(ground.diagnosticCodes).toEqual(["MALFORMED_BEARING_HANDLE"]);
  });

  it("does not invent a semantic entity for a malformed annotation prefix", () => {
    const compilation = compileGraphWithExplain(
      parseDocument(fixture("syntax/malformed-annotation-prefix.cog.md"))
    );
    const malformed = compilation.explain.entries.find((entry) => entry.sourceSpan.startLine === 2);

    expect(malformed).toMatchObject({
      recognition: { kind: "body" },
      effects: [{ kind: "preserveBody" }],
      diagnosticCodes: ["MALFORMED_ANNOTATION_PREFIX"]
    });
    expect(compilation.graph.points.map((point) => point.id)).toEqual(["survivor"]);
  });

  it("keeps authored Bearing identity distinct from its revision-local Explain reference", () => {
    const compilation = compileGraphWithExplain(parseDocument(fixture("core/naming-forms.cog.md")));
    const namedRoute = compilation.explain.entries.find(
      (entry) => entry.sourceSpan.startLine === 11
    );
    const effect = namedRoute?.effects.find((candidate) => candidate.kind === "emitBearing");

    expect(effect).toMatchObject({
      kind: "emitBearing",
      ref: { kind: "bearing", graphIndex: expect.any(Number), handle: "route" },
      bearing: { handle: "route", kind: "supports", derivedBy: "structural" }
    });
  });

  it("explains independent host units with host-relative source spans", () => {
    const compiled = explainSource(fixture("host/two-inquiries.md"), "host");

    expect(compiled.explanations).toHaveLength(2);
    expect(compiled.explanations[0].entries.map((entry) => entry.sourceSpan.startLine)).toEqual([6, 7, 8]);
    expect(compiled.explanations[1].entries.map((entry) => entry.sourceSpan.startLine)).toEqual([18, 19, 20]);
    expect(compiled.explanations.map((explanation) => explanation.diagnostics)).toEqual([[], []]);
    expect(compiled.diagnostics).toEqual([]);
  });

  it("compiles standalone document mode through the source envelope", () => {
    const compiled = compileSource(example("api-timeout.cog.md"), "document");

    expect(compiled.mode).toBe("document");
    expect(compiled.units).toEqual([expect.objectContaining({ kind: "document", startLine: 1 })]);
    expect(compiled.graphs).toHaveLength(1);
    expect(compiled.graphs[0].points.some((point) => point.id === "db-pool")).toBe(true);
    expect(compiled.diagnostics).toEqual([]);
  });

  it("extracts independent Cogitatum fences from host Markdown", () => {
    const source = fixture("host/two-inquiries.md");
    const units = extractCogitatumSourceUnits(source, "host");
    const compiled = compileSource(source, "host");

    expect(units).toHaveLength(2);
    expect(units.map((unit) => unit.kind)).toEqual(["fence", "fence"]);
    expect(compiled.mode).toBe("host");
    expect(compiled.graphs).toHaveLength(2);
    expect(compiled.graphs[0].points.map((point) => point.id)).toEqual(["q", "answer"]);
    expect(compiled.graphs[1].points.map((point) => point.id)).toEqual(["q", "answer"]);
    expect(compiled.graphs[0].points[0].sourceSpan?.startLine).toBe(7);
    expect(compiled.graphs[1].points[0].sourceSpan?.startLine).toBe(19);
    expect(compiled.diagnostics).toEqual([]);
  });

  it("normalizes optional CommonMark fence indentation and preserves host source spans", () => {
    const source = fixture("host/indented-fence.md");
    const units = extractCogitatumSourceUnits(source, "host");
    const compiled = compileSource(source, "host");

    expect(units).toEqual([
      expect.objectContaining({
        kind: "fence",
        startLine: 6,
        endLine: 8,
        fenceInfo: "cog",
        source:
          "- [Q @discrepancy] What explains the discrepancy?\n" +
          "  - [C @baseline] The measurements use different baselines.\n" +
          "    - [G @records] The calibration records name different reference dates."
      })
    ]);
    expect(compiled.graphs[0].points.map((point) => point.id)).toEqual(["discrepancy", "baseline", "records"]);
    expect(compiled.graphs[0].bearings).toEqual([
      expect.objectContaining({ kind: "answers", target: pointRef(compiled.graphs[0], "discrepancy") }),
      expect.objectContaining({ kind: "supports", target: pointRef(compiled.graphs[0], "baseline") })
    ]);
    expect(compiled.documents[0].blocks[0].sourceSpan).toMatchObject({ startLine: 6, startColumn: 5 });
    expect(compiled.documents[0].blocks[0].children[0].sourceSpan).toMatchObject({ startLine: 7, startColumn: 7 });
    expect(compiled.documents[0].blocks[0].children[0].children[0].sourceSpan).toMatchObject({
      startLine: 8,
      startColumn: 9
    });
    expect(compiled.diagnostics).toEqual([]);

    const unevenContent = extractCogitatumSourceUnits(
      "   ```cog\n - First root.\n- Second root.\n```\n",
      "host"
    );
    expect(unevenContent[0].source).toBe("- First root.\n- Second root.");
  });

  it("rejects Cogitatum fence candidates outside the text host indentation contract", () => {
    for (const indentation of ["    ", "\t"]) {
      const compiled = compileSource(
        `${indentation}\`\`\`cog\n${indentation}- [C @hidden] Not an extracted source unit.\n${indentation}\`\`\`\n`,
        "auto"
      );

      expect(compiled.mode).toBe("host");
      expect(compiled.units).toEqual([]);
      expect(compiled.graphs).toEqual([]);
      expect(compiled.diagnostics).toEqual([
        expect.objectContaining({
          code: "UNSUPPORTED_HOST_FENCE_INDENTATION",
          sourceSpan: { startLine: 1, startColumn: 1, endLine: 1, endColumn: indentation.length + 7 }
        })
      ]);
    }
  });

  it("fails closed inside one host unit without discarding independent units", () => {
    const compiled = compileSource(fixture("host/fail-closed.md"), "host");

    expect(compiled.graphs).toHaveLength(2);
    expect(compiled.graphs[0].points.map((point) => point.id)).toEqual(["cause", "logs"]);
    expect(compiled.graphs[0].bearings).toEqual([
      expect.objectContaining({ sources: [pointRef(compiled.graphs[0], "logs")], target: pointRef(compiled.graphs[0], "cause") })
    ]);
    expect(compiled.graphs[1].bearings).toEqual([
      expect.objectContaining({ kind: "answers", target: pointRef(compiled.graphs[1], "next") })
    ]);
    expect(compiled.diagnostics).toEqual([
      expect.objectContaining({ code: "MALFORMED_BEARING_SOURCES", sourceSpan: expect.objectContaining({ startLine: 9 }) })
    ]);
  });

  it("reports missing, empty, and unclosed Cogitatum host fences", () => {
    expect(compileSource("# Host only\n", "host").diagnostics).toEqual([
      expect.objectContaining({ code: "NO_COGITATUM_FENCE" })
    ]);
    expect(compileSource("```cog\n```\n", "host").diagnostics).toEqual([
      expect.objectContaining({ code: "EMPTY_COGITATUM_FENCE" })
    ]);
    expect(compileSource("# Host\n\n```cog\n- [C @c1] Claim.\n", "host").diagnostics).toEqual([
      expect.objectContaining({ code: "UNCLOSED_COGITATUM_FENCE" })
    ]);
  });

  it("does not extract Cogitatum-looking text from another code fence", () => {
    const source = "```text\n```cog\n- [C @hidden] Not a source unit.\n```\n```\n";
    const compiled = compileSource(source, "host");

    expect(compiled.units).toEqual([]);
    expect(compiled.diagnostics).toEqual([expect.objectContaining({ code: "NO_COGITATUM_FENCE" })]);
  });

  it("uses host fences in auto mode and otherwise falls back to document mode", () => {
    expect(parseSource(fixture("host/two-inquiries.md"), "auto").mode).toBe("host");
    expect(parseSource(example("syllogism.cog.md"), "auto").mode).toBe("document");
  });

  it("uses ordinary body containers for titled grouping", () => {
    const graph = compileGraph(
      parseDocument("- Case title\n  - [Q @q1] What follows?\n    - [C @c1] An answer.\n")
    );

    expect(graph.points.map((point) => point.id)).toEqual(["q1", "c1"]);
    expect(graph.bearings).toEqual([
      expect.objectContaining({
        kind: "answers",
        sources: [pointRef(graph, "c1")],
        target: pointRef(graph, "q1")
      })
    ]);
  });

  it("rejects the removed scope keyword while preserving its block as body", () => {
    const ast = parseDocument("- [scope @legacy] Legacy container\n  - [C @c1] Claim.\n");
    const graph = compileGraph(ast);

    expect(ast.blocks[0].annotation).toBeUndefined();
    expect(graph.points.map((point) => point.id)).toEqual(["c1"]);
    expect(graph.diagnostics).toEqual([expect.objectContaining({ code: "MALFORMED_ANNOTATION" })]);
  });

  it("diagnoses malformed Cogitatum prefixes without claiming all bracketed prose", () => {
    const source = fixture("syntax/malformed-annotation-prefix.cog.md");
    const ast = parseDocument(source);
    const graph = compileGraph(ast);
    const host = compileSource(`# Host\n\n\`\`\`cog\n${source}\`\`\`\n`, "host");

    expect(ast.blocks[0].children[0]).toMatchObject({
      annotation: undefined,
      text: "[C @claim Missing closing bracket."
    });
    expect(ast.blocks[0].children[0].children[0]).toMatchObject({ annotation: { kind: "role", anchor: "survivor", role: "G" } });
    expect(ast.blocks[0].children[3]).toMatchObject({
      annotation: undefined,
      text: "[Context for ordinary prose remains body."
    });
    expect(graph.points.map((point) => point.id)).toEqual(["survivor"]);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      Array(3).fill("MALFORMED_ANNOTATION_PREFIX")
    );
    expect(graph.diagnostics.map((diagnostic) => diagnostic.sourceSpan?.startLine)).toEqual([2, 4, 5]);
    expect(host.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      Array(3).fill("MALFORMED_ANNOTATION_PREFIX")
    );
    expect(host.diagnostics.map((diagnostic) => diagnostic.sourceSpan?.startLine)).toEqual([5, 7, 8]);
  });

  it("preserves closed and unclosed prose brackets without swallowing their text", () => {
    const content = ["[Context for later] Ordinary text.", "[Context for later", "[notes](https://example.org) A link."];
    for (const text of content) {
      const ast = parseDocument(`- ${text}\n  - [C] A marked descendant.\n`);
      expect(ast.blocks[0].text).toBe(text);
      expect(ast.blocks[0].annotation).toBeUndefined();
      const graph = compileGraph(ast);
      expect(graph.diagnostics).toEqual([]);
      expect(graph.points).toHaveLength(1);
      expect(graph.bearings).toEqual([]);
    }
  });

  it("still diagnoses reserved prefixes with invalid case or missing delimiters", () => {
    for (const prefix of ["[c]", "[Edge]", "[scope @legacy]", "[ ]", "[Q?]", "[c @claim", "[Edge @ground"]) {
      const graph = compileGraph(parseDocument(`- ${prefix} Text.\n`));
      expect(graph.points, prefix).toEqual([]);
      expect(graph.bearings, prefix).toEqual([]);
      expect(graph.diagnostics.some((item) => item.severity === "error"), prefix).toBe(true);
    }
  });

  it("preserves independent arguments below nested body grouping", () => {
    const graph = compileGraph(parseDocument(fixture("core/nested-grouping.cog.md")));

    expect(graph.points.map((point) => point.id)).toEqual([
      "paper-q",
      "paper-answer",
      "section-q",
      "section-answer"
    ]);
    expect(graph.bearings.filter((bearing) => bearing.kind === "answers")).toEqual([
      expect.objectContaining({
        sources: [pointRef(graph, "paper-answer")],
        target: pointRef(graph, "paper-q")
      }),
      expect.objectContaining({
        sources: [pointRef(graph, "section-answer")],
        target: pointRef(graph, "section-q")
      })
    ]);
    expect(graph.diagnostics).toEqual([]);
  });

  it("uses edge for Bearing supplements without creating a Point", () => {
    const ast = parseDocument(
      "- Serial argument\n  - [C @c1] Intermediate conclusion.\n  - [C @c2] Final conclusion.\n  - [edge @c1 +> @c2; @serial-step] Continue the argument.\n"
    );
    const graph = compileGraph(ast);

    expect(graph.points.map((point) => point.id)).toEqual(["c1", "c2"]);
    expect(ast.blocks[0].children[2].annotation?.operatorClause).toMatchObject({
      sources: [{ id: "c1" }],
      target: { id: "c2" }
    });
    expect(ast.blocks[0].children[2].annotation?.operatorClause?.target).not.toHaveProperty("kind");
    expect(graph.bearings).toEqual([
      expect.objectContaining({
        handle: "serial-step",
        kind: "supports",
        sources: [pointRef(graph, "c1")],
        target: pointRef(graph, "c2"),
        text: "Continue the argument.",
        derivedBy: "operator"
      })
    ]);
  });

  it("rejects a bare Bearing handle separator on a Point annotation", () => {
    const ast = parseDocument("- [C @claim] Claim.\n  - [G;] Ground.\n");
    const graph = compileGraph(ast);

    expect(graph.points).toEqual([
      expect.objectContaining({ id: "claim", role: "C" }),
      expect.objectContaining({ role: "G", text: "Ground." })
    ]);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics).toEqual([
      expect.objectContaining({ code: "MALFORMED_BEARING_HANDLE" })
    ]);
  });

  it("rejects a bare Bearing handle separator on an edge declaration", () => {
    const ast = parseDocument(
      "- [C @claim] Claim.\n- [G @ground] Ground.\n- [edge @ground +> @claim;] Route.\n"
    );
    const graph = compileGraph(ast);

    expect(graph.points.map((point) => point.id)).toEqual(["claim", "ground"]);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics).toEqual([
      expect.objectContaining({ code: "MALFORMED_BEARING_HANDLE" })
    ]);
  });

  it("does not accept ellipses or placeholder references as Bearing handles", () => {
    for (const annotation of ["G; ...", "G; @?"]) {
      const graph = compileGraph(parseDocument(`- [C] Claim.\n  - [${annotation}] Ground.\n`));

      expect(graph.bearings, annotation).toEqual([]);
      expect(graph.diagnostics, annotation).toEqual([
        expect.objectContaining({ code: "MALFORMED_BEARING_HANDLE" })
      ]);
    }
  });

  it("rejects an undelimited secondary Bearing-handle notation", () => {
    const graph = compileGraph(
      parseDocument("- [C] Claim.\n  - [G @ground @route] Ambiguous identities.\n")
    );

    expect(graph.points).toEqual([expect.objectContaining({ role: "C" })]);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics).toEqual([
      expect.objectContaining({ code: "MALFORMED_ROLE_ANNOTATION" })
    ]);
  });

  it("keeps authored identifiers to lowercase ASCII slugs", () => {
    const valid = compileGraph(parseDocument("- [C @zhu-zhang_2] 中文主張。\n"));

    expect(valid.points.map((point) => point.id)).toEqual(["zhu-zhang_2"]);
    expect(valid.diagnostics).toEqual([]);

    for (const ref of ["@主張", "@Claim", "@éclair", "@1claim"]) {
      const graph = compileGraph(parseDocument(`- [C ${ref}] Invalid identifier.\n`));

      expect(graph.points, ref).toEqual([]);
      expect(graph.diagnostics, ref).toEqual([
        expect.objectContaining({ code: "MALFORMED_ROLE_ANNOTATION" })
      ]);
    }
  });

  it("accepts open status only on C and keeps ? as a distinct Gap form", () => {
    const valid = compileGraph(parseDocument("- [C? @claim] Open claim.\n- [? @gap] Open gap.\n"));
    const invalid = compileGraph(
      parseDocument(
        ["Q?", "G?", "O?", "R?", "D?"].map((role) => `- [${role}] Invalid open role.`).join("\n")
      )
    );

    expect(valid.points).toEqual([
      expect.objectContaining({ id: "claim", role: "C", status: "open", form: "role" }),
      expect.objectContaining({ id: "gap", status: "open", form: "gap" })
    ]);
    expect(invalid.points).toEqual([]);
    expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      Array(5).fill("OPEN_STATUS_REQUIRES_CLAIM")
    );
  });

  it("keeps the edge keyword lowercase and rejects the role-like Edge spelling", () => {
    const graph = compileGraph(
      parseDocument(
        "- [C @claim] Claim.\n- [G @ground] Ground.\n- [Edge @ground +> @claim; @route] Invalid casing.\n"
      )
    );

    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics).toEqual([expect.objectContaining({ code: "MALFORMED_EXPLICIT_BEARING" })]);
  });

  it("requires explicit targets for annotated descendants below edge declarations", () => {
    const source = fixture("diagnostics/edge-descendant-requires-target.cog.md");

    for (const graph of [
      compileGraph(parseDocument(source)),
      compileSource(`Host prose.\n\n\`\`\`cog\n${source}\`\`\`\n`, "host").graphs[0]
    ]) {
      expect(graph.bearings).toEqual([
        expect.objectContaining({
          handle: "route",
          kind: "supports",
          target: pointRef(graph, "claim")
        }),
        expect.objectContaining({
          kind: "undercuts",
          sources: [pointRef(graph, "explicit-objection")],
          target: bearingRef(graph, "route")
        })
      ]);
      expect(graph.points.some((point) => point.id === "implicit-objection")).toBe(true);
      expect(graph.bearings.some((bearing) => bearing.kind === "challenges")).toBe(false);
      expect(graph.diagnostics).toEqual([
        expect.objectContaining({ code: "EDGE_DESCENDANT_REQUIRES_EXPLICIT_TARGET" })
      ]);
    }
  });

  it("distinguishes challenges to Points from undercuts of Bearings", () => {
    const graph = compileGraph(parseDocument(fixture("diagnostics/pressure-target-kind.cog.md")));

    expect(graph.points.map((point) => point.id)).toEqual([
      "claim",
      "ground",
      "point-undercut",
      "route-challenge"
    ]);
    expect(graph.bearings).toEqual([
      expect.objectContaining({ handle: "route", kind: "supports", target: pointRef(graph, "claim") })
    ]);
    expect(graph.diagnostics).toEqual([
      expect.objectContaining({ code: "UNDERCUT_REQUIRES_BEARING_TARGET" }),
      expect.objectContaining({ code: "CHALLENGE_REQUIRES_POINT_TARGET" })
    ]);
  });

  it("compiles an operator-introduced challenge and its structural reply", () => {
    const graph = compileGraph(parseDocument(fixture("core/explicit-challenge.cog.md")));
    const objection = graph.points.find((point) => point.form === "role" && point.role === "O");
    const reply = graph.points.find((point) => point.form === "role" && point.role === "R");

    expect(objection).toBeDefined();
    expect(reply).toBeDefined();

    expect(graph.bearings).toEqual([
      expect.objectContaining({
        kind: "challenges",
        sources: [{ key: objection?.key, kind: "point" }],
        target: pointRef(graph, "release-safe"),
        derivedBy: "operator"
      }),
      expect.objectContaining({
        kind: "repliesTo",
        sources: [{ key: reply?.key, kind: "point" }],
        target: { key: objection?.key, kind: "point" },
        derivedBy: "structural"
      })
    ]);
    expect(graph.diagnostics).toEqual([]);
  });

  it("requires the edge keyword for Bearing-only annotations", () => {
    const graph = compileGraph(
      parseDocument(
        "- Keyword boundary\n  - [C @c1] Claim.\n  - [@p1] Premise one.\n  - [@p2] Premise two.\n  - [@p1, @p2 +> @c1] Legacy ambiguous edge.\n"
      )
    );

    expect(graph.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "MALFORMED_EXPLICIT_BEARING" })])
    );
    expect(graph.bearings.some((bearing) => bearing.kind === "supports")).toBe(false);
  });

  it("keeps roleless materials as Points when they have annotated children", () => {
    const graph = compileGraph(
      parseDocument(
        "- Material pressure\n  - [C @c1] Claim.\n    - [@p1] Linked premise.\n      - [O @o1] Objection to the premise.\n    - [edge @p1 +> @c1; @route] Premise supports claim.\n"
      )
    );

    expect(graph.points.find((point) => point.id === "p1")).toMatchObject({ form: "material" });
    expect(graph.bearings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "challenges",
          sources: [pointRef(graph, "o1")],
          target: pointRef(graph, "p1")
        }),
        expect.objectContaining({
          handle: "route",
          kind: "supports",
          sources: [pointRef(graph, "p1")],
          target: pointRef(graph, "c1")
        })
      ])
    );
  });

  it("treats body children as prose rather than graph connectivity", () => {
    const graph = compileGraph(parseDocument(fixture("diagnostics/disconnected-anchored-material.cog.md")));

    expect(graph.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "DISCONNECTED_ANCHORED_MATERIAL" })])
    );
  });

  it("keeps the API timeout answer connected to its organizing question", () => {
    const graph = compileGraph(parseDocument(example("api-timeout.cog.md")));
    const question = graph.points.find((point) => point.form === "role" && point.role === "Q");

    expect(question).toBeDefined();

    expect(graph.bearings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "answers",
          sources: [pointRef(graph, "db-pool")],
          target: { key: question?.key, kind: "point" }
        }),
        expect.objectContaining({
          kind: "supports",
          sources: [pointRef(graph, "acq-fail")],
          target: pointRef(graph, "db-pool")
        })
      ])
    );
    expect(graph.diagnostics).toEqual([]);
  });

  it("supports naming neither, the Point, the Bearing, or both", () => {
    const graph = compileGraph(parseDocument(fixture("core/naming-forms.cog.md")));
    const namedBearings = graph.bearings.filter((bearing) => bearing.handle).map((bearing) => bearing.handle);

    expect(graph.points.some((point) => point.id === "ground")).toBe(true);
    expect(graph.points.some((point) => point.id === "named-ground")).toBe(true);
    expect(namedBearings).toEqual(["route", "named-route"]);
    expect(graph.bearings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "undercuts",
          target: bearingRef(graph, "route")
        }),
        expect.objectContaining({
          kind: "about",
          target: bearingRef(graph, "named-route")
        })
      ])
    );
    expect(graph.diagnostics).toEqual([]);
  });

  it("keeps optional edge descriptions separate from child body", () => {
    const ast = parseDocument(fixture("core/edge-description-and-body.cog.md"));
    const graph = compileGraph(ast);
    const bareBlock = ast.blocks[0].children.find((block) => block.annotation?.operatorClause?.op === "supports");
    const bareBearing = graph.bearings.find((bearing) => bearing.kind === "supports");
    const describedBearing = graph.bearings.find((bearing) => bearing.kind === "about");

    expect(bareBlock?.text).toBe("");
    expect(bareBlock?.children).toEqual([
      expect.objectContaining({ annotation: undefined, text: "Documentary explanation retained only in the AST." })
    ]);
    expect(bareBearing?.text).toBeUndefined();
    expect(describedBearing?.text).toBe("Contextual relevance, not support.");
    expect(graph.diagnostics).toEqual([]);
  });

  it("uses unannotated grouping without synthesizing another Bearing", () => {
    const ast = parseDocument(fixture("core/grouped-route-pressure.cog.md"));
    const graph = compileGraph(ast);
    const objection = graph.points.find((point) => point.form === "role" && point.role === "O");

    expect(ast.blocks[0].annotation).toBeUndefined();
    expect(objection).toBeDefined();
    expect(graph.points.map((point) => point.id)).toEqual(["claim", "premise", objection?.id]);
    expect(graph.bearings).toEqual([
      expect.objectContaining({
        handle: "route",
        kind: "supports",
        sources: [pointRef(graph, "premise")],
        target: pointRef(graph, "claim")
      }),
      expect.objectContaining({
        kind: "undercuts",
        sources: [{ key: objection?.key, kind: "point" }],
        target: bearingRef(graph, "route")
      })
    ]);
    expect(graph.diagnostics).toEqual([]);
  });

  it("compiles a gap about a Bearing handle without exposing compiler rule names", () => {
    const graph = compileGraph(parseDocument(fixture("core/gap-about-bearing.cog.md")));
    const gap = graph.points.find((point) => point.form === "gap");
    const bearing = graph.bearings.find((candidate) =>
      candidate.sources.some((source) => source.key === gap?.key)
    );

    expect(gap?.form).toBe("gap");
    expect(gap?.status).toBe("open");
    expect(bearing).toMatchObject({
      kind: "about",
      target: bearingRef(graph, "temporal-rebuttal"),
      derivedBy: "operator"
    });
    expect(graph.diagnostics).toEqual([]);
  });

  it("uses graph-local Point identities for anonymous self-sourced Bearings", () => {
    const source = fixture("syntax/anonymous-point-bearing.cog.md");
    const documentGraph = compileGraph(parseDocument(source));
    const hostGraph = compileSource(`# Host\n\n\`\`\`cog\n${source}\`\`\`\n`, "host").graphs[0];

    for (const graph of [documentGraph, hostGraph]) {
      const anonymousPoints = graph.points.filter((point) => point.form === "role" && point.role === "O");

      expect(anonymousPoints.every((point) => !Object.hasOwn(point, "id"))).toBe(true);
      expect(anonymousPoints.map((point) => point.key)).toEqual(["_p2", "_p4"]);
      expect(graph.bearings).toEqual([
        expect.objectContaining({
          kind: "challenges",
          sources: [{ key: "_p2", kind: "point" }],
          target: pointRef(graph, "claim"),
          derivedBy: "operator"
        }),
        expect.objectContaining({
          handle: "route",
          kind: "supports",
          sources: [pointRef(graph, "ground")],
          target: pointRef(graph, "claim")
        }),
        expect.objectContaining({
          kind: "undercuts",
          sources: [{ key: "_p4", kind: "point" }],
          target: bearingRef(graph, "route"),
          derivedBy: "operator"
        })
      ]);
      expect(graph.diagnostics).toEqual([]);
    }
  });

  it("compiles joint support without adding independent support routes", () => {
    const graph = compileGraph(parseDocument(example("syllogism.cog.md")));
    const supports = graph.bearings.filter((bearing) => bearing.kind === "supports");

    expect(supports).toEqual([
      expect.objectContaining({
        sources: [
          pointRef(graph, "human-mortal"),
          pointRef(graph, "socrates-human")
        ],
        target: pointRef(graph, "mortal"),
        derivedBy: "operator"
      })
    ]);
    expect(graph.diagnostics).toEqual([]);
  });

  it("keeps independent Grounds distinct from one explicit joint support route", () => {
    const graph = compileGraph(parseDocument(fixture("core/independent-and-joint-support.cog.md")));
    const supports = graph.bearings.filter((bearing) => bearing.kind === "supports");

    expect(supports).toEqual([
      expect.objectContaining({
        sources: [pointRef(graph, "latency")],
        target: pointRef(graph, "claim"),
        derivedBy: "structural"
      }),
      expect.objectContaining({
        sources: [pointRef(graph, "contract")],
        target: pointRef(graph, "claim"),
        derivedBy: "structural"
      }),
      expect.objectContaining({
        handle: "capacity-route",
        sources: [
          pointRef(graph, "capacity"),
          pointRef(graph, "forecast")
        ],
        target: pointRef(graph, "claim"),
        derivedBy: "operator"
      })
    ]);
    expect(graph.diagnostics).toEqual([]);
  });

  it("rejects operator clauses with multiple targets", () => {
    const graph = compileGraph(parseDocument(fixture("diagnostics/multiple-targets.cog.md")));

    expect(graph.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "MULTIPLE_BEARING_TARGETS_UNSUPPORTED"
        })
      ])
    );
    expect(graph.bearings.some((bearing) => bearing.sources.some((source) => source.key === pointRef(graph, "g1").key))).toBe(false);
  });

  it("diagnoses malformed Bearing targets without crashing", () => {
    const ast = parseDocument(fixture("diagnostics/malformed-bearing-target.cog.md"));
    const graph = compileGraph(ast);

    expect(ast.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "MALFORMED_BEARING_TARGETS"
        })
      ])
    );
    expect(graph.points.some((point) => point.id === "g1")).toBe(true);
    expect(graph.bearings.some((bearing) => bearing.sources.some((source) => source.key === pointRef(graph, "g1").key))).toBe(false);
  });

  it("keeps a valid Point while rejecting an attached Bearing with an invalid handle", () => {
    const graph = compileGraph(parseDocument(fixture("diagnostics/invalid-bearing-handle.cog.md")));

    expect(graph.points.some((point) => point.id === "g1")).toBe(true);
    expect(graph.bearings.some((bearing) => bearing.sources.some((source) => source.key === pointRef(graph, "g1").key))).toBe(false);
    expect(graph.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "MALFORMED_BEARING_HANDLE" })])
    );
  });

  it("keeps an invalid edge block in AST while producing no partial Bearing", () => {
    const ast = parseDocument(fixture("diagnostics/malformed-bearing-source.cog.md"));
    const graph = compileGraph(ast);
    const invalidEdge = ast.blocks[0].children[2];

    expect(invalidEdge.raw).toContain("[edge @g1, not-a-ref +> @c1]");
    expect(invalidEdge.annotation).toMatchObject({
      kind: "edge",
      syntaxErrors: ["operator"]
    });
    expect(graph.bearings.some((bearing) => bearing.kind === "supports")).toBe(false);
  });

  it("rejects unresolved Bearing sources and targets from canonical Graph IR", () => {
    for (const name of ["unknown-bearing-source.cog.md", "unknown-bearing-target.cog.md"]) {
      const graph = compileGraph(parseDocument(fixture(`diagnostics/${name}`)));

      expect(graph.bearings, name).toEqual([]);
    }
  });

  it("rejects Bearings that target another Bearing which failed compilation", () => {
    const graph = compileGraph(
      parseDocument(
        "- Dependent invalid Bearing\n  - [C @c1] Claim.\n  - [edge @missing +> @c1; @bad] Invalid base Bearing.\n  - [O @o1 _> @bad] Dependent undercut.\n"
      )
    );

    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNKNOWN_SOURCE" }),
        expect.objectContaining({ code: "UNRESOLVED_BEARING_TARGET" })
      ])
    );
  });

  it("rejects an entire Bearing when one source reference is malformed", () => {
    const graph = compileGraph(parseDocument(fixture("diagnostics/malformed-bearing-source.cog.md")));

    expect(graph.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "MALFORMED_BEARING_SOURCES"
        })
      ])
    );
    expect(graph.bearings.some((bearing) => bearing.kind === "supports")).toBe(false);
  });

  it("rejects duplicate Bearing handles", () => {
    const graph = compileGraph(parseDocument(fixture("diagnostics/duplicate-bearing-handle.cog.md")));

    expect(graph.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "DUPLICATE_BEARING_HANDLE"
        })
      ])
    );
  });

  it("rejects duplicate source references before Graph IR compilation", () => {
    const ast = parseDocument(fixture("diagnostics/duplicate-bearing-source.cog.md"));
    const graph = compileGraph(ast);
    const edge = ast.blocks[2];

    expect(edge.annotation).toMatchObject({ kind: "edge", syntaxErrors: ["operator"] });
    expect(graph.points.map((point) => point.id)).toEqual(["claim", "ground"]);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics).toEqual([
      expect.objectContaining({ code: "DUPLICATE_BEARING_SOURCES" })
    ]);
  });

  it("removes every Point and Bearing that depends on a duplicate Point anchor", () => {
    const graph = compileGraph(parseDocument(fixture("diagnostics/duplicate-point-anchor.cog.md")));

    expect(graph.points.map((point) => point.id)).toEqual(["ground"]);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics).toEqual([expect.objectContaining({ code: "DUPLICATE_ID" })]);
  });

  it("rejects Point/Bearing namespace conflicts without removing valid Points", () => {
    const graph = compileGraph(parseDocument(fixture("diagnostics/point-bearing-id-conflict.cog.md")));

    expect(graph.points.map((point) => point.id)).toEqual(["claim", "ground"]);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics).toEqual([expect.objectContaining({ code: "POINT_BEARING_ID_CONFLICT" })]);
  });

  it("rejects a Bearing used as a source while retaining its valid base Bearing", () => {
    const graph = compileGraph(parseDocument(fixture("diagnostics/bearing-used-as-source.cog.md")));

    expect(graph.bearings).toEqual([
      expect.objectContaining({ handle: "route", kind: "supports", target: pointRef(graph, "claim") })
    ]);
    expect(graph.diagnostics).toEqual([expect.objectContaining({ code: "BEARING_IS_NOT_BEARING_SOURCE" })]);
  });

  it("separates all compilation identities from authored names across revisions", () => {
    const source = "- Ordinary body.\n- [C @claim] Claim.\n  - [G; @route] Reason.\n- [O _> @route] Objection.\n";
    const first = compileGraphWithExplain(parseDocument(source));
    const revised = compileGraph(parseDocument("- [Q] An earlier question.\n" + source));

    expect(first.graph.points.map(({ key, id }) => ({ key, id }))).toEqual([
      { key: "_p1", id: "claim" }, { key: "_p2", id: undefined }, { key: "_p3", id: undefined }
    ]);
    expect(first.graph.bearings.map(({ key, handle }) => ({ key, handle }))).toEqual([
      { key: "_b1", handle: "route" }, { key: "_b2", handle: undefined }
    ]);
    expect(first.graph.bearings[1].target).toEqual({ key: "_b1", kind: "bearing" });
    expect(revised.points.find((point) => point.id === "claim")?.key).toBe("_p2");
    expect(revised.bearings[0].sources).toEqual([{ key: "_p3", kind: "point" }]);
    expect(first.graph.points[1]).not.toHaveProperty("id");
    expect(first.graph.bearings[1]).not.toHaveProperty("handle");
    expect(first.graph.bearings[0]).not.toHaveProperty("id");
    expect(compileGraphWithExplain(parseDocument(source))).toEqual(first);
  });

  it("does not confuse a rejected candidate key with an emitted graph index", () => {
    const { graph, explain } = compileGraphWithExplain(parseDocument(
      "- [C @claim] Claim.\n- [G @reason] Reason.\n- [edge @missing +> @claim; @bad]\n- [edge @reason +> @claim; @good]\n- [O _> @good] Objection.\n"
    ));
    expect(graph.bearings.map((bearing) => bearing.key)).toEqual(["_b2", "_b3"]);
    const effects = explain.entries.flatMap((entry) => entry.effects);
    expect(effects).toContainEqual(expect.objectContaining({
      kind: "emitBearing", ref: { key: "_b2", kind: "bearing", handle: "good", graphIndex: 0 }
    }));
    expect(graph.bearings[1].target).toEqual({ key: "_b2", kind: "bearing" });
    expect(effects).toContainEqual(expect.objectContaining({
      kind: "rejectBearing", bearing: expect.objectContaining({ key: "_b1", sources: [{ id: "missing" }] })
    }));
  });

  it("resolves every emitted reference within its own graph across all fixtures", () => {
    for (const entry of loadFixtureManifest().fixtures) {
      const compiled = explainSource(fixture(entry.file), entry.input ?? "document");
      compiled.graphs.forEach((graph, index) => {
        const points = new Set(graph.points.map((point) => point.key));
        const bearings = new Set(graph.bearings.map((bearing) => bearing.key));
        expect(points.size, entry.file).toBe(graph.points.length);
        expect(bearings.size, entry.file).toBe(graph.bearings.length);
        for (const bearing of graph.bearings) {
          expect(bearing.sources.every((ref) => points.has(ref.key)), entry.file).toBe(true);
          expect((bearing.target.kind === "point" ? points : bearings).has(bearing.target.key), entry.file).toBe(true);
        }
        for (const effect of compiled.explanations[index].entries.flatMap((entry) => entry.effects)) {
          if (effect.kind !== "emitBearing") continue;
          const bearing = graph.bearings[effect.ref.graphIndex];
          expect(effect.ref.key, entry.file).toBe(bearing.key);
          expect(effect.bearing.sources, entry.file).toEqual(bearing.sources);
          expect(effect.bearing.target, entry.file).toEqual(bearing.target);
        }
      });
    }
  });

  it("registers every Cogitatum fixture exactly once", () => {
    const registered = loadFixtureManifest().fixtures.map((entry) =>
      join(repoRoot, "fixtures", entry.file)
    );
    const discovered = listCogFixtureFiles(join(repoRoot, "fixtures"));

    expect(new Set(registered).size).toBe(registered.length);
    expect(registered.sort()).toEqual(discovered.sort());
  });

  it("registers and compiles every curated example without diagnostics", () => {
    const manifest = loadExampleManifest();
    const registered = manifest.examples.map((entry) => join(repoRoot, "examples", entry.file));
    const discovered = listCogFixtureFiles(join(repoRoot, "examples"));

    expect(new Set(registered).size).toBe(registered.length);
    expect(registered.sort()).toEqual(discovered.sort());

    for (const entry of manifest.examples) {
      const source = readFileSync(join(repoRoot, "examples", entry.file), "utf8");
      const actualCodes = compileGraph(parseDocument(source)).diagnostics.map((diagnostic) => diagnostic.code);

      expect(entry.purpose.length, entry.file).toBeGreaterThan(0);
      expect(actualCodes, entry.file).toEqual(entry.expectedDiagnosticCodes);
    }
  });

  it("validates corpus schemas and reconciles every compiler trace with its graph", () => {
    const ajv = new Ajv2020({ allErrors: true });
    const validateAst = ajv.compile(JSON.parse(readFileSync(join(repoRoot, "spec", "ast.schema.json"), "utf8")));
    const validateGraph = ajv.compile(
      JSON.parse(readFileSync(join(repoRoot, "spec", "graph-ir.schema.json"), "utf8"))
    );
    const validateExplain = ajv.compile(
      JSON.parse(readFileSync(join(repoRoot, "spec", "explain.schema.json"), "utf8"))
    );
    const cases = [
      ...loadFixtureManifest().fixtures.map((entry) => ({
        entry,
        path: join(repoRoot, "fixtures", entry.file),
        input: entry.input ?? "document"
      })),
      ...loadExampleManifest().examples.map((entry) => ({
        entry,
        path: join(repoRoot, "examples", entry.file),
        input: "document" as const
      }))
    ];

    for (const { entry, path, input } of cases) {
      const compiled = explainSource(readFileSync(path, "utf8"), input);
      for (const ast of compiled.documents) {
        const value = jsonValue(ast);
        expect(validateAst(value), `${entry.file}: ${JSON.stringify(validateAst.errors)}`).toBe(true);
      }
      for (const graph of compiled.graphs) {
        const value = jsonValue(graph);
        expect(validateGraph(value), `${entry.file}: ${JSON.stringify(validateGraph.errors)}`).toBe(true);
      }
      expect(compiled.explanations.length, entry.file).toBe(compiled.graphs.length);
      for (const [index, explanation] of compiled.explanations.entries()) {
        const value = jsonValue(explanation);
        expect(validateExplain(value), `${entry.file}: ${JSON.stringify(validateExplain.errors)}`).toBe(true);
        const graph = compiled.graphs[index];
        const effects = explanation.entries.flatMap((item) => item.effects);
        const points = effects.filter((effect) => effect.kind === "emitPoint");
        const bearings = effects.filter((effect) => effect.kind === "emitBearing");
        expect(points.map((effect) => effect.ref.key).sort(), entry.file).toEqual(graph.points.map((point) => point.key).sort());
        expect(bearings.map((effect) => effect.ref.key).sort(), entry.file).toEqual(graph.bearings.map((bearing) => bearing.key).sort());
        for (const effect of bearings) {
          const { text: _text, sourceSpan: _span, ...summary } = graph.bearings[effect.ref.graphIndex];
          expect(effect.ref.key, entry.file).toBe(summary.key);
          expect(effect.bearing, entry.file).toEqual(summary);
        }
        for (const effect of effects) {
          if (effect.kind === "rejectPoint") {
            expect(graph.points.some((point) => point.key === effect.ref.key), entry.file).toBe(false);
          } else if (effect.kind === "rejectBearing" && effect.bearing) {
            expect(graph.bearings.some((bearing) => bearing.key === effect.bearing?.key), entry.file).toBe(false);
          }
        }
        expect(explanation.diagnostics, entry.file).toEqual(graph.diagnostics);
      }
    }
  });

  it("locks schema versions and rejects duplicate source references in machine contracts", () => {
    const ajv = new Ajv2020({ allErrors: true });
    const validateAst = ajv.compile(JSON.parse(readFileSync(join(repoRoot, "spec", "ast.schema.json"), "utf8")));
    const validateGraph = ajv.compile(
      JSON.parse(readFileSync(join(repoRoot, "spec", "graph-ir.schema.json"), "utf8"))
    );
    const validateExplain = ajv.compile(
      JSON.parse(readFileSync(join(repoRoot, "spec", "explain.schema.json"), "utf8"))
    );
    const ast = jsonValue(parseDocument(example("syllogism.cog.md")));
    const compilation = compileGraphWithExplain(parseDocument(example("syllogism.cog.md")));
    const graph = jsonValue(compilation.graph);
    const explanation = jsonValue(compilation.explain);
    const edgeSources = ast.blocks[0].children[0].children[0].children[2].annotation?.operatorClause?.sources;

    expect(validateAst(ast), JSON.stringify(validateAst.errors)).toBe(true);
    expect(validateGraph(graph), JSON.stringify(validateGraph.errors)).toBe(true);
    expect(validateExplain(explanation), JSON.stringify(validateExplain.errors)).toBe(true);
    if (!edgeSources || edgeSources === "self") {
      throw new Error("Expected explicit edge sources in schema fixture.");
    }

    edgeSources.push(jsonValue(edgeSources[0]));
    graph.bearings[0].sources.push(jsonValue(graph.bearings[0].sources[0]));
    expect(validateAst(ast)).toBe(false);
    expect(validateGraph(graph)).toBe(false);

    const wrongAstVersion = jsonValue(parseDocument("- [C] Claim.\n"));
    const wrongGraphVersion = jsonValue(compileGraph(parseDocument("- [C] Claim.\n")));
    const wrongExplainVersion = jsonValue(compileGraphWithExplain(parseDocument("- [C] Claim.\n")).explain);
    wrongAstVersion.version = "0.2.0";
    wrongGraphVersion.version = "0.2.0";
    wrongExplainVersion.version = "0.2.0";
    expect(validateAst(wrongAstVersion)).toBe(false);
    expect(validateGraph(wrongGraphVersion)).toBe(false);
    expect(validateExplain(wrongExplainVersion)).toBe(false);
  });

  it("rejects missing keys, legacy identity fields, and unresolved emission references in schemas", () => {
    const ajv = new Ajv2020({ allErrors: true });
    const validateGraph = ajv.compile(JSON.parse(readFileSync(join(repoRoot, "spec", "graph-ir.schema.json"), "utf8")));
    const validateExplain = ajv.compile(JSON.parse(readFileSync(join(repoRoot, "spec", "explain.schema.json"), "utf8")));
    const compilation = compileGraphWithExplain(parseDocument("- [C @claim] Claim.\n  - [G; @route] Reason.\n"));
    for (const mutate of [
      (graph: any) => { delete graph.points[0].key; },
      (graph: any) => { delete graph.bearings[0].key; },
      (graph: any) => { graph.points[1].id = "_p2"; },
      (graph: any) => { graph.bearings[0].id = "route"; },
      (graph: any) => { graph.bearings[0].target = { id: "claim", kind: "point" }; }
    ]) {
      const graph = jsonValue(compilation.graph);
      mutate(graph);
      expect(validateGraph(graph)).toBe(false);
    }
    for (const field of ["sources", "target"]) {
      const explanation = jsonValue(compilation.explain);
      const effect = explanation.entries.flatMap((entry) => entry.effects).find((effect) => effect.kind === "emitBearing");
      if (!effect || effect.kind !== "emitBearing") throw new Error("Missing emitted Bearing.");
      (effect.bearing as Record<string, unknown>)[field] = field === "sources" ? [{ id: "claim" }] : { id: "claim" };
      expect(validateExplain(explanation)).toBe(false);
    }
  });

  it("rejects workflow origin fields and non-canonical Bearing derivation mechanisms", () => {
    const ajv = new Ajv2020({ allErrors: true });
    const validateGraph = ajv.compile(
      JSON.parse(readFileSync(join(repoRoot, "spec", "graph-ir.schema.json"), "utf8"))
    );
    const importedDerivation = jsonValue(compileGraph(parseDocument(example("syllogism.cog.md"))));
    const suggestedDerivation = jsonValue(compileGraph(parseDocument(example("syllogism.cog.md"))));
    const suggestedOrigin = jsonValue(compileGraph(parseDocument(example("syllogism.cog.md"))));

    (importedDerivation.bearings[0] as Record<string, unknown>).derivedBy = "imported";
    (suggestedDerivation.bearings[0] as Record<string, unknown>).derivedBy = "suggested";
    (suggestedOrigin.bearings[0] as Record<string, unknown>).origin = "suggested";

    expect(validateGraph(importedDerivation)).toBe(false);
    expect(validateGraph(suggestedDerivation)).toBe(false);
    expect(validateGraph(suggestedOrigin)).toBe(false);
  });

  it("rejects removed Scope fields from canonical Graph IR", () => {
    const ajv = new Ajv2020({ allErrors: true });
    const validateGraph = ajv.compile(
      JSON.parse(readFileSync(join(repoRoot, "spec", "graph-ir.schema.json"), "utf8"))
    );
    const graph = jsonValue(compileGraph(parseDocument(example("syllogism.cog.md"))));
    const legacyScopes = { ...graph, scopes: [] };
    const legacyPointScope = jsonValue(graph);

    (legacyPointScope.points[0] as Record<string, unknown>).scope = "legacy";

    expect(validateGraph(legacyScopes)).toBe(false);
    expect(validateGraph(legacyPointScope)).toBe(false);
  });

  it("rejects generalized role openness in AST and Graph IR schemas", () => {
    const ajv = new Ajv2020({ allErrors: true });
    const validateAst = ajv.compile(JSON.parse(readFileSync(join(repoRoot, "spec", "ast.schema.json"), "utf8")));
    const validateGraph = ajv.compile(
      JSON.parse(readFileSync(join(repoRoot, "spec", "graph-ir.schema.json"), "utf8"))
    );
    const ast = jsonValue(parseDocument("- [C? @claim] Open claim.\n"));
    const graph = jsonValue(compileGraph(parseDocument("- [C? @claim] Open claim.\n")));

    if (ast.blocks[0].annotation?.kind === "role") {
      ast.blocks[0].annotation.role = "G";
    }
    graph.points[0].role = "G";

    expect(validateAst(ast)).toBe(false);
    expect(validateGraph(graph)).toBe(false);

    const malformedMaterial = jsonValue(compileGraph(parseDocument("- [@material] Material.\n")));
    malformedMaterial.points[0].role = "G";
    expect(validateGraph(malformedMaterial)).toBe(false);
  });

  it("rejects every Point-only and Bearing-only target-kind mismatch in Graph IR schema", () => {
    const ajv = new Ajv2020({ allErrors: true });
    const validateGraph = ajv.compile(
      JSON.parse(readFileSync(join(repoRoot, "spec", "graph-ir.schema.json"), "utf8"))
    );
    const pointTargetSource =
      "- [Q @question] What follows?\n" +
      "  - [C @answer] An answer.\n" +
      "    - [O @objection] An objection.\n" +
      "      - [R @reply] A reply.\n" +
      "    - [D @distinction] A distinction.\n";
    const pointTargetGraph = jsonValue(compileGraph(parseDocument(pointTargetSource)));
    const undercutGraph = jsonValue(
      compileGraph(parseDocument(fixture("core/explicit-bearing-sources.cog.md")))
    );
    const supportToBearingGraph = jsonValue(
      compileGraph(parseDocument(fixture("core/route-handle-needed.cog.md")))
    );
    const aboutBearingGraph = jsonValue(
      compileGraph(parseDocument(fixture("core/gap-about-bearing.cog.md")))
    );
    const undercut = undercutGraph.bearings.find((bearing) => bearing.kind === "undercuts");

    if (!undercut) {
      throw new Error("Expected pressure Bearings in schema fixtures.");
    }
    expect(validateGraph(pointTargetGraph), JSON.stringify(validateGraph.errors)).toBe(true);
    expect(validateGraph(undercutGraph), JSON.stringify(validateGraph.errors)).toBe(true);
    expect(
      supportToBearingGraph.bearings.some(
        (bearing) => bearing.kind === "supports" && bearing.target.kind === "bearing"
      )
    ).toBe(true);
    expect(
      aboutBearingGraph.bearings.some((bearing) => bearing.kind === "about" && bearing.target.kind === "bearing")
    ).toBe(true);
    expect(validateGraph(supportToBearingGraph), JSON.stringify(validateGraph.errors)).toBe(true);
    expect(validateGraph(aboutBearingGraph), JSON.stringify(validateGraph.errors)).toBe(true);

    (undercut.target as { kind: string }).kind = "point";

    expect(validateGraph(undercutGraph)).toBe(false);
    for (const kind of ["challenges", "answers", "repliesTo", "clarifies"] as const) {
      const invalid = jsonValue(pointTargetGraph);
      const bearing = invalid.bearings.find((candidate) => candidate.kind === kind);
      if (!bearing) {
        throw new Error(`Expected ${kind} Bearing in schema fixture.`);
      }
      (bearing.target as { kind: string }).kind = "bearing";
      expect(validateGraph(invalid), kind).toBe(false);
    }
  });

  it("keeps authored ids and compiler-local Point keys distinct in schemas", () => {
    const ajv = new Ajv2020({ allErrors: true });
    const validateAst = ajv.compile(JSON.parse(readFileSync(join(repoRoot, "spec", "ast.schema.json"), "utf8")));
    const validateGraph = ajv.compile(
      JSON.parse(readFileSync(join(repoRoot, "spec", "graph-ir.schema.json"), "utf8"))
    );
    const anonymousGraph = jsonValue(compileGraph(parseDocument("- [C] Claim.\n  - [G] Ground.\n")));
    const authoredAst = jsonValue(parseDocument("- [C @claim] Claim.\n"));

    expect(validateGraph(anonymousGraph), JSON.stringify(validateGraph.errors)).toBe(true);

    if (authoredAst.blocks[0].annotation?.kind === "role") {
      authoredAst.blocks[0].annotation.anchor = "主張";
    }
    expect(validateAst(authoredAst)).toBe(false);

    anonymousGraph.points[0].id = "主張";
    expect(validateGraph(anonymousGraph)).toBe(false);
  });

  it("represents an optional Bearing description by absence rather than an empty string", () => {
    const ajv = new Ajv2020({ allErrors: true });
    const validateGraph = ajv.compile(
      JSON.parse(readFileSync(join(repoRoot, "spec", "graph-ir.schema.json"), "utf8"))
    );
    const graph = jsonValue(compileGraph(parseDocument(fixture("core/edge-description-and-body.cog.md"))));
    const bare = graph.bearings.find((bearing) => bearing.kind === "supports");
    const described = graph.bearings.find((bearing) => bearing.kind === "about");

    expect(bare?.text).toBeUndefined();
    expect(described?.text).toBe("Contextual relevance, not support.");
    expect(validateGraph(graph), JSON.stringify(validateGraph.errors)).toBe(true);

    if (!described) {
      throw new Error("Expected described Bearing in fixture.");
    }
    described.text = "";
    expect(validateGraph(graph)).toBe(false);
  });
});

function jsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
