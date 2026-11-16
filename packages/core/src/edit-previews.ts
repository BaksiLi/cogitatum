import { previewFramingEditFrom } from "./framing-edit.js";
import type { FramingEdit, FramingEditPreview } from "./framing-edit.js";
import { previewRelationEditFrom } from "./relation-edit.js";
import type { RelationEdit, RelationEditPreview } from "./relation-edit.js";
import { locateSourceBlock, parentBlock } from "./source-edit.js";
import { explainSource } from "./source.js";
import { previewTargetFormFrom } from "./target-form.js";
import type { TargetForm, TargetFormPreview } from "./target-form.js";
import type { Diagnostic, SourceParseMode } from "./types.js";
import { FORMAT_VERSION } from "./types.js";

export type SourceEditRequest =
  | { kind: "target-form"; line: number; form: TargetForm }
  | { kind: "relation"; edit: RelationEdit }
  | { kind: "framing"; edit: FramingEdit };
export type SourceEditPreview = TargetFormPreview | RelationEditPreview | FramingEditPreview;
export type SourceEditAnalysis = {
  diagnostics: Diagnostic[];
  siblingsAt(line: number): { lines: number[]; index: number };
  preview(request: SourceEditRequest): SourceEditPreview;
};

export type SourceEditApplication =
  | { status: "applied"; source: string }
  | { status: "unavailable"; reason: "unavailable-preview" | "unsupported-version" | "stale-source" | "invalid-preview"; message: string };

export function applySourceEdit(source: string, preview: SourceEditPreview): SourceEditApplication {
  const unavailable = (reason: Extract<SourceEditApplication, { status: "unavailable" }>["reason"], message: string): SourceEditApplication =>
    ({ status: "unavailable", reason, message });
  if (preview.status !== "ready") return unavailable("unavailable-preview", "Only a ready preview supplies an edit.");
  if (preview.version !== FORMAT_VERSION) return unavailable("unsupported-version", "Reanalyse the source with this format before applying an edit.");
  if (source !== preview.originalSource) return unavailable("stale-source", "The source has changed since this preview; reanalyse before editing.");
  const { offset, remove, insert } = preview.edit;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length || source.slice(offset, offset + remove.length) !== remove) {
    return unavailable("invalid-preview", "The edit does not match its source snapshot.");
  }
  const proposed = source.slice(0, offset) + insert + source.slice(offset + remove.length);
  if (proposed !== preview.proposedSource) return unavailable("invalid-preview", "The edit does not produce its checked source.");
  return { status: "applied", source: proposed };
}

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
        : request.kind === "framing" ? previewFramingEditFrom(source, before, request.edit)
        : previewRelationEditFrom(source, before, request.edit);
      // Diagnostics and retracted commitment targets can refer into before.
      // Detach each result before it can affect this analysis or another result.
      return structuredClone(result);
    }
  };
}
