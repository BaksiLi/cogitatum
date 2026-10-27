import type { BearingTarget } from "@cogitatum/core";
import { bearingMark, pointMark } from "./marks.js";
import type { ReadingCommitment, ReadingUnit } from "./reading-projection.js";

const REJECTED: Record<string, string> = {
  "annotation-syntax-error": "the annotation has a syntax error",
  "explicit-bearing-descendant-requires-target": "beneath an explicit Bearing, the first Point needs a selector or an explicit target",
  "bearing-use-requires-explicit-target": "a Bearing use exposes no Point target",
  "failed-context-requires-explicit-target": "its enclosing context failed, and no outer Point is searched instead",
  "no-local-attachment": "the nearest context exposes no Bearing",
  "validation-error": "the relation failed validation",
  "invalid-local-bearing": "the local Bearing is invalid"
};

/**
 * One sentence on what an occurrence's position commits it to, from its Reading commitment.
 * It restates Core's decision; it never judges the prose or proposes another target.
 */
export function describeCommitment(unit: ReadingUnit, commitment: ReadingCommitment): string {
  const row = (id: string) => unit.occurrences.find(occurrence => occurrence.id === id)!;
  const lines = (ids: string[]) => ids.map(id => `L${row(id).line}`).join(", ");
  const name = (ref: BearingTarget, at?: string) => {
    const entity = ref.kind === "point" ? unit.graph.points.find(point => point.key === ref.key) : unit.graph.bearings.find(bearing => bearing.key === ref.key);
    const authored = entity && ("declaration" in entity ? entity.id : entity.handle);
    const where = at ? `L${row(at).line}` : undefined;
    const label = authored ? `@${authored}` : ref.kind === "point" ? "the Point" : "the step";
    return authored && where ? `${label} (${where})` : where ? `${label} at ${where}` : label;
  };
  const recognition = row(commitment.occurrenceId).recognition;
  const mark = "role" in recognition && recognition.role ? recognition.role : undefined;
  const crossed = commitment.crossedOccurrenceIds.length ? ` It passes through ordinary body at ${lines(commitment.crossedOccurrenceIds)}.` : "";
  switch (commitment.basis) {
    case "indentation": {
      const relation = bearingMark(commitment.kind!).name;
      const nearest = commitment.target!.kind === "point" ? "the nearest enclosing Point" : "the nearest exposed step";
      const members = commitment.memberOccurrenceIds;
      const joint = members.length ? `, with source${members.length > 1 ? "s" : ""} ${lines(members)}` : "";
      return `From indentation${joint}: ${relation} ${name(commitment.target!, commitment.contextOccurrenceId)}, ${nearest}.${crossed} Moving it or changing its mark can change this.`;
    }
    case "explicit":
      return `Explicit: ${bearingMark(commitment.kind!).name} ${name(commitment.target!)}. Indentation does not choose this relation or target.`;
    case "member": {
      const header = unit.commitments.find(item => item.occurrenceId === commitment.contextOccurrenceId);
      const at = lines([commitment.contextOccurrenceId!]);
      return header?.basis === "failed"
        ? `Eligible source for the local Bearing at ${at}, which was rejected; no relation was created.`
        : `Source of the local Bearing at ${at}; it adds no relation of its own.`;
    }
    case "note":
      return `From indentation: a note on ${name(commitment.target!, commitment.contextOccurrenceId)}.${crossed}`;
    case "failed": {
      const why = commitment.reason ? REJECTED[commitment.reason] ?? commitment.reason : "no object was selected";
      const context = commitment.contextOccurrenceId ? ` Its context is ${lines([commitment.contextOccurrenceId])}.` : "";
      // The occurrence's own error usually names the remedy; repeat it beside the decision.
      const error = row(commitment.occurrenceId).diagnostics.find(diagnostic => diagnostic.severity === "error");
      return `No relation: ${why}.${context}${error ? " " + error.message : ""}`;
    }
    case "none": {
      const neutral = recognition.kind === "material" || (recognition.kind === "use" && !mark);
      const noun = mark ? pointMark(mark).name : neutral ? "neutral Point" : "occurrence";
      if (commitment.reason === "no-eligible-ancestor") return "No enclosing Point or step; its position creates no relation.";
      if (mark === "Q" || mark === "C") return `${mark} marks presentation only; its position creates no relation.`;
      return `This ${noun} creates no relation from its position.`;
    }
  }
}
