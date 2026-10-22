import { describe, expect, it, vi } from "vitest";
import { previewExplicitTarget, explainSource, formatGraph } from "./index.js";
import * as sourceModule from "./source.js";
import type { ExplicitTargetPreview } from "./explicit-target.js";
import type { ExplainedSource } from "./types.js";

function ready(preview: ExplicitTargetPreview) {
  expect(preview.status, JSON.stringify(preview)).toBe("ready");
  if (preview.status !== "ready") throw new Error(preview.message);
  expect(preview.proposedSource).toBe(preview.originalSource.slice(0, preview.edit.offset) + preview.edit.insert + preview.originalSource.slice(preview.edit.offset));
  return preview;
}

describe("explicit target previews", () => {
  it.each(["\u2028", "\u2029"])("preserves %j in prose, literal boundaries and occurrence identity", separator => {
    const source = [
      "- [. @shared] Shared " + separator + " content.",
      "- [C @claim] Claim.",
      "  - [G use @shared; @step] Local " + separator + " qualification.",
      "    - [note] Literal " + separator + " explanation.",
      "      - [G @shared +> @missing] Inert duplicate and unresolved target.",
      "    - [O/] Review this occurrence's attachment."
    ].join("\n");
    const before = explainSource(source);
    expect(before.diagnostics).toEqual([]);
    expect(before.graphs[0].points.map(point => point.id)).toEqual(["shared", "claim", undefined]);
    expect(before.graphs[0].points[0].text).toBe("Shared " + separator + " content.");
    expect(before.documents[0].blocks[1].children[0].text).toBe("Local " + separator + " qualification.");
    expect(before.explanations[0].entries.map(entry => entry.sourceSpan.startLine)).toEqual([1, 2, 3, 4, 6]);
    const preview = ready(previewExplicitTarget(source, { line: 3 }));
    expect(preview.proposedSource).toBe(source.replace("[G use @shared;", "[G use @shared +> @claim;"));
    expect(preview.edit.offset).toBe(source.indexOf("; @step"));
    expect(preview.proposedDiagnostics).toEqual([]);
    expect(formatGraph(explainSource(preview.proposedSource).graphs[0])).toBe(formatGraph(before.graphs[0]));
    expect(previewExplicitTarget(source, { line: 5 })).toMatchObject({ status: "unavailable", reason: "no-attachment" });
  });

  it.each([["G", "+>"], ["O", "->"], ["?", "~>"]])("makes %s explicit without changing its prose, mark, name or handle", (mark, symbol) => {
    const source = `- [C @claim] Claim.\n  - [ ${mark} @point   ; @step ] Reason [G] stays prose.\n    - [O/] Review this particular step.\n    - [note] Qualification.\n      - [G +> @missing] Inert syntax.`;
    const preview = ready(previewExplicitTarget(source, { line: 2 }));
    expect(preview.proposedSource).toBe(source.replace(`${mark} @point   ;`, `${mark} @point ${symbol} @claim   ;`));
    expect(preview.proposedDiagnostics).toEqual([]);
    const before = explainSource(source).graphs[0], after = explainSource(preview.proposedSource).graphs[0];
    expect(formatGraph(after)).toBe(formatGraph(before));
    expect(after.bearings[0]).toMatchObject({ handle: "step", derivedBy: "operator" });
    expect(after.bearings[1].target).toEqual({ kind: "bearing", key: after.bearings[0].key });
    expect(preview.consequence).toContain("Later moves will retain that target");
  });

  it("preserves forward reuse, the shared declaration and occurrence prose", () => {
    const source = '- [C @claim] Claim.\n  - [G use @shared; @route] Local qualification.\n- [. @shared] Shared content.\n- [C @other] Another claim.\n  - [G use @shared; @second] Other context.';
    const preview = ready(previewExplicitTarget(source, { line: 2 }));
    expect(preview.proposedSource).toContain('[G use @shared +> @claim; @route] Local qualification.');
    const graph = explainSource(preview.proposedSource).graphs[0];
    expect(graph.points).toHaveLength(3);
    expect(graph.points.find(p => p.id === 'shared')?.text).toBe('Shared content.');
    expect(graph.bearings[0].sources).toEqual(graph.bearings[1].sources);
    expect(graph.bearings[0].target).not.toEqual(graph.bearings[1].target);
  });

  it("targets the canonical Point selected by a reused parent, not a nearby declaration", () => {
    const source = '- [C @first] First.\n- [C @second] Second.\n- [C use @first] Local reading.\n  - Body\n    - [O] Concern.';
    const preview = ready(previewExplicitTarget(source, { line: 5 }));
    expect(preview.edit.insert).toBe(' -> @first');
    expect(preview.diagnostics.map(d => d.code)).toEqual(['IMPLICIT_ATTACHMENT_THROUGH_BODY']);
    expect(preview.proposedDiagnostics).toEqual([]);
  });

  it("preserves UTF-16 offsets, CRLF, unusual spacing and no final newline", () => {
    const source = '- [C @claim] 🌧️ Claim.\r\n\r\n  -     [G\t ] Reason.  ';
    const preview = ready(previewExplicitTarget(source, { line: 3 }));
    expect(preview.proposedSource).toBe(source.replace('[G\t ]', '[G +> @claim\t ]'));
    expect(preview.edit.offset).toBe(source.indexOf('[G') + 2);
  });

  it("edits only the selected host fence with the original host columns and namespace", () => {
    const source = 'Host 🌧️ @claim\r\n\r\n  ```cog\r\n  - [C @claim] First unit.\r\n    - [G] First reason.\r\n  ```\r\n\r\n```cogitatum\r\n- [C @claim] Second unit.\r\n  - [O] Second reason.\r\n```\r\nTrailing prose.';
    const preview = ready(previewExplicitTarget(source, { line: 5, mode: 'host' }));
    expect(preview.proposedSource).toBe(source.replace('[G]', '[G +> @claim]'));
    const first = explainSource(source, 'host'), second = explainSource(preview.proposedSource, 'host');
    expect(second.graphs[1]).toEqual(first.graphs[1]);
    expect(second.units[0].source).toContain('[G +> @claim]');
  });

  it.each(["\n", "\r\n", "\r", "mixed"])("preserves original host line endings %j when locating the edit", lineEnding => {
    const lines = ["Host 🌧️ prose.", "  ```cog", "  - [C @claim] Claim.", "    - [G] Reason.", "  ```", "", "```cog", "- [C @other] Other unit.", "```"];
    const source = lines.map((line, index) => line + (index === lines.length - 1 ? "" : lineEnding === "mixed" ? ["\r", "\n", "\r\n"][index % 3] : lineEnding)).join("");
    const preview = ready(previewExplicitTarget(source, { line: 4, mode: "host" }));
    expect(preview.edit.offset).toBe(source.indexOf("[G]") + 2);
    expect(preview.proposedSource).toBe(source.replace("[G]", "[G +> @claim]"));
    expect(preview.proposedDiagnostics).toEqual([]);
    const before = explainSource(source, "host"), after = explainSource(preview.proposedSource, "host");
    expect(formatGraph(after.graphs[0])).toBe(formatGraph(before.graphs[0]));
    expect(after.graphs[1]).toEqual(before.graphs[1]);
  });

  it("retains unrelated diagnostics and removes only the selected implicit advice", () => {
    const source = '- [. @alone] Isolated material.\n- [C @a] Claim.\n  - Group\n    - [G] One.\n    - [O] Two.';
    const preview = ready(previewExplicitTarget(source, { line: 4 }));
    expect(preview.diagnostics).toHaveLength(3);
    expect(preview.proposedDiagnostics).toHaveLength(2);
    expect(preview.proposedDiagnostics.map(d => d.code)).toEqual(['DISCONNECTED_ANCHORED_MATERIAL', 'IMPLICIT_ATTACHMENT_THROUGH_BODY']);
    expect(preview.proposedDiagnostics[1].sourceSpan?.startLine).toBe(5);
  });

  it("makes the intentional difference after moving the same occurrence explicit", () => {
    const source = '- [C @first] First.\n  - [G; @route] Reason.\n- [C @second] Second.';
    const preview = ready(previewExplicitTarget(source, { line: 2 }));
    const move = (s: string) => { const [first, reason, second] = s.split('\n'); return [first, second, reason].join('\n'); };
    const implicit = explainSource(move(source)).graphs[0];
    const explicit = explainSource(move(preview.proposedSource)).graphs[0];
    expect(implicit.points.find(p => p.key === implicit.bearings[0].target.key)?.id).toBe('second');
    expect(explicit.points.find(p => p.key === explicit.bearings[0].target.key)?.id).toBe('first');
    expect(preview.originalSource).not.toBe(move(source));
  });

  it.each([
    ['anonymous target', '- [C] Claim.\n  - [G] Reason.', 2, 'unnamed-target'],
    ['answer', '- [Q @q] Question.\n  - [C] Answer.', 2, 'unsupported-attachment'],
    ['reply', '- [O @o] Objection.\n  - [R] Reply.', 2, 'unsupported-attachment'],
    ['clarification', '- [C @c] Claim.\n  - [D] Distinction.', 2, 'unsupported-attachment'],
    ['local selector', '- [C @c] Claim.\n  - [G; @route] Reason.\n    - [O/] Concern.', 3, 'unsupported-attachment'],
    ['linked member', '- [C @c] Claim.\n  - [linked]\n    - [G] Reason.', 3, 'no-attachment'],
    ['linked header', '- [C @c] Claim.\n  - [linked]\n    - [G] Reason.', 2, 'no-attachment'],
    ['explicit clause', '- [C @c] Claim.\n  - [G +> @c] Reason.', 2, 'already-explicit'],
    ['literal child', '- [C @c] Claim.\n  - [note] Literal.\n    - [G] Not an active Point.', 3, 'no-attachment'],
    ['body', '- [C @c] Claim.\n  - Plain body.', 2, 'no-attachment'],
    ['unattached root', '- [G] Reason.', 1, 'no-attachment'],
    ['missing line', '- [C @c] Claim.', 100, 'no-attachment'],
    ['invalid source', '- [C @c] Claim.\n  - [G] Reason.\n- [O /> @c] Wrong target.', 2, 'source-errors']
  ] as const)("declines %s without a partial edit", (_label, source, line, reason) => {
    const preview = previewExplicitTarget(source, { line });
    expect(preview).toMatchObject({ status: 'unavailable', reason });
    expect(preview).not.toHaveProperty('edit');
    expect(preview).not.toHaveProperty('proposedSource');
  });

  it("explains why a joint target cannot be made explicit by editing a single member", () => {
    const source = "- [C @claim] Claim.\n  - [linked; @joint] Joint route.\n    - [G @first] First source.\n    - [G @second] Second source.";
    for (const [line, message] of [[2, "This linked header constructs one joint Bearing."], [3, "This Ground contributes to the enclosing joint Bearing."], [4, "This Ground contributes to the enclosing joint Bearing."]] as const) {
      const preview = previewExplicitTarget(source, { line });
      expect(preview).toMatchObject({ status: "unavailable", reason: "no-attachment", message: expect.stringContaining(message) });
      expect(preview).not.toHaveProperty("edit");
      expect(preview).not.toHaveProperty("proposedSource");
    }
  });

  it("keeps errors, independent clauses, selectors and literal notes ahead of joint-member advice", () => {
    const source = "- [C @claim] Claim.\n  - [linked; @joint] Joint route.\n    - [G @first] Source.\n    - [G +> @claim] Independent support.\n    - [O/] Review joint.\n    - [note] Literal.\n      - [G] Inert.";
    expect(previewExplicitTarget(source + "\n- [G +> @missing] Broken.", { line: 2 })).toMatchObject({ reason: "source-errors" });
    expect(previewExplicitTarget(source, { line: 4 })).toMatchObject({ reason: "already-explicit" });
    expect(previewExplicitTarget(source, { line: 5 })).toMatchObject({ reason: "unsupported-attachment" });
    for (const line of [6, 7]) {
      const preview = previewExplicitTarget(source, { line });
      expect(preview).toMatchObject({ reason: "no-attachment" });
      if (preview.status === "unavailable") expect(preview.message).not.toContain("joint");
    }
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid source line %s', line => {
    expect(previewExplicitTarget('- [C] Claim.', { line })).toMatchObject({ status: 'unavailable', reason: 'invalid-line' });
  });

  it("withholds edits when another host unit or its selection has errors", () => {
    for (const ending of ['```cog\n- [G +> @missing] Bad.\n```', '```cog\n- [C] Unclosed.']) {
      const source = '```cog\n- [C @c] Claim.\n  - [G] Reason.\n```\n' + ending;
      expect(previewExplicitTarget(source, { line: 3, mode: 'host' })).toMatchObject({ status: 'unavailable', reason: 'source-errors' });
    }
    expect(previewExplicitTarget('- [C @c] Markdown prose.', { line: 1, mode: 'host' })).toMatchObject({ status: 'unavailable', reason: 'no-attachment' });
  });

  it.each(['graph', 'literal text', 'diagnostic'])("withholds the preview if recompilation unexpectedly changes %s", changed => {
    const original = sourceModule.explainSource;
    const spy = vi.spyOn(sourceModule, 'explainSource').mockImplementation((source, mode): ExplainedSource => {
      const result = original(source, mode);
      if (source.includes('[G +> @c]')) {
        if (changed === 'graph') result.graphs[0].bearings[0].target.key = result.graphs[0].points[1].key;
        if (changed === 'literal text') result.documents[0].blocks[0].children[1].text = 'Changed qualification.';
        if (changed === 'diagnostic') result.diagnostics.push({ severity: 'suggestion', code: 'UNEXPECTED', message: 'New concern.' });
      }
      return result;
    });
    try {
      const preview = previewExplicitTarget('- [C @c] Claim.\n  - [G] Reason.\n  - [note] Qualification.', { line: 2 });
      expect(preview).toMatchObject({ status: 'unavailable', reason: 'preservation-failed' });
      expect(preview).not.toHaveProperty('proposedSource');
    } finally { spy.mockRestore(); }
  });
});
