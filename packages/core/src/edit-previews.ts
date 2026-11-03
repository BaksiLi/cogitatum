import { previewRelationEditFrom } from "./relation-edit.js";
import type { RelationEdit, RelationEditPreview } from "./relation-edit.js";
import { locateSourceBlock, parentBlock } from "./source-edit.js";
import { explainSource } from "./source.js";
import { previewTargetFormFrom } from "./target-form.js";
import type { TargetForm, TargetFormPreview } from "./target-form.js";
import type { Diagnostic, SourceParseMode } from "./types.js";

export type SourceEditRequest =
  | { kind: "target-form"; line: number; form: TargetForm }
  | { kind: "relation"; edit: RelationEdit };
export type SourceEditPreview = TargetFormPreview | RelationEditPreview;
export type SourceEditAnalysis = {
  diagnostics: Diagnostic[];
  siblingsAt(line: number): { lines: number[]; index: number };
  preview(request: SourceEditRequest): SourceEditPreview;
};

/**
 * Analyze one immutable source snapshot for several checked edit previews.
 * The original analysis stays private; every proposed source is still compiled
 * and checked independently. Results and sibling lines are detached values.
 * Analyze the new source again after editing; no cache or editor state is held.
 */
export function analyzeSourceEdits(source: string, mode: SourceParseMode = "document"): SourceEditAnalysis {
  const before = explainSource(source, mode);
  return {
    diagnostics: structuredClone(before.diagnostics),
    siblingsAt(line) {
      const located = locateSourceBlock(before, line);
      if (!located) return { lines: [], index: -1 };
      const blocks = before.documents[located.unitIndex].blocks;
      const siblings = parentBlock(blocks, located.block)?.children ?? blocks;
      return { lines: siblings.map(block => block.sourceSpan.startLine), index: siblings.indexOf(located.block) };
    },
    preview(request) {
      const result = request.kind === "target-form"
        ? previewTargetFormFrom(source, before, request)
        : previewRelationEditFrom(source, before, request.edit);
      // Diagnostics and retracted commitment targets can refer into before.
      // Detach each result before it can affect this analysis or another result.
      return structuredClone(result);
    }
  };
}
