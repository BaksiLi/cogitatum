import { explainSource } from "./source.js";
import type { AstBlock, BearingTarget, ExplainedSource, SourceParseMode, SourceSpan } from "./types.js";

/** An active, written operand, located by its containing block (not a token span). */
export type WrittenReference = { sourceSpan: SourceSpan } & (
  | { kind: "point-use" | "bearing-use" | "target" }
  | { kind: "source"; sourceIndex: number }
);

export type ReferencedName = {
  name: string;
  ref: BearingTarget;
  sourceSpan: SourceSpan;
  references: WrittenReference[];
};

export type SourceReferenceAnalysis = Pick<ExplainedSource, "version" | "mode" | "units" | "diagnostics"> & {
  references:
    | { status: "complete"; units: ReferencedName[][] }
    | { status: "unavailable"; reason: "source-errors" };
};

/**
 * Inventory written references in the complete supplied document or host.
 * Names and keys are local to each selected unit. No edits or unused-name advice.
 * Any source/selection error withholds the inventory, including empty counts.
 */
export function analyzeSourceReferences(source: string, mode: SourceParseMode = "document"): SourceReferenceAnalysis {
  const explained = explainSource(source, mode);
  const { version, units, diagnostics } = explained;
  const base = { version, mode: explained.mode, units, diagnostics };
  if (diagnostics.some(diagnostic => diagnostic.severity === "error")) {
    return { ...base, references: { status: "unavailable", reason: "source-errors" } };
  }

  const inventories = explained.explanations.map((explanation, unitIndex) => {
    const names: ReferencedName[] = [];
    const byEntity = new Map<string, ReferencedName>();
    const entityKey = (ref: BearingTarget) => `${ref.kind}:${ref.key}`;

    // Use compiler emissions for declarations and resolution, including forward
    // references. This is an index of validated results, not another resolver.
    for (const entry of explanation.entries) {
      for (const effect of entry.effects) {
        const name = effect.kind === "emitPoint" ? effect.id : effect.kind === "emitBearing" ? effect.bearing.handle : undefined;
        if (name && (effect.kind === "emitPoint" || effect.kind === "emitBearing")) {
          const declared: ReferencedName = {
            name,
            ref: { kind: effect.ref.kind, key: effect.ref.key },
            sourceSpan: entry.sourceSpan,
            references: []
          };
          names.push(declared);
          byEntity.set(entityKey(declared.ref), declared);
        }
      }
    }

    const blocks = new Map<number, AstBlock>();
    function visit(block: AstBlock): void {
      // The outline parser emits one block per non-empty source line.
      blocks.set(block.sourceSpan.startLine, block);
      if (block.annotation?.kind !== "note") block.children.forEach(visit);
    }
    explained.documents[unitIndex].blocks.forEach(visit);

    function add(name: string, ref: BearingTarget, occurrence: WrittenReference): void {
      const declaration = byEntity.get(entityKey(ref));
      if (!declaration || declaration.name !== name) {
        throw new Error("Reference analysis disagrees with compiler name resolution.");
      }
      declaration.references.push(occurrence);
    }

    for (const entry of explanation.entries) {
      const { sourceSpan } = entry;
      for (const effect of entry.effects) {
        if (effect.kind === "focusPoint" || effect.kind === "focusBearing") {
          add(effect.operand.id, effect.ref, { kind: effect.kind === "focusPoint" ? "point-use" : "bearing-use", sourceSpan });
        }
      }

      const block = blocks.get(sourceSpan.startLine);
      if (!block) throw new Error("Reference analysis cannot locate a compiler occurrence in the source AST.");
      const annotation = block.annotation;
      const clause = annotation && "operatorClause" in annotation ? annotation.operatorClause : undefined;
      if (!clause) continue;
      const emission = entry.effects.find(effect => effect.kind === "emitBearing");
      if (!emission) {
        throw new Error("Reference analysis requires a validated explicit Bearing.");
      }
      // Only explicit operands are written references. Self sources, local
      // selectors, linked membership and implicit targets are deliberately absent.
      if (clause.sources !== "self") {
        clause.sources.forEach((operand, sourceIndex) => {
          add(operand.id, emission.bearing.sources[sourceIndex], { kind: "source", sourceIndex, sourceSpan });
        });
      }
      add(clause.target.id, emission.bearing.target, { kind: "target", sourceSpan });
    }
    return names;
  });
  return { ...base, references: { status: "complete", units: inventories } };
}
