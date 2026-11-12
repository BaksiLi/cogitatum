import type { BearingKind, BearingTarget } from "@cogitatum/core";
import { bearingLabel, pointMark } from "./marks.js";
import type { ReadingCommitment, ReadingUnit } from "./reading-projection.js";

const REJECTED: Record<string, string> = {
  "annotation-syntax-error": "the annotation has a syntax error",
  "explicit-bearing-descendant-requires-target": "beneath a Bearing with listed sources, the first Point needs ^/ or a named target",
  "bearing-use-requires-explicit-target": "a Bearing use exposes no Point for ^",
  "failed-context-requires-explicit-target": "its enclosing context failed, and no outer Point is searched instead",
  "no-local-attachment": "the nearest context exposes no Bearing for ^/",
  "no-local-point": "there is no enclosing Point for ^",
  "validation-error": "the relation failed validation",
  "unsupported-profile": "by example requires a supports Bearing",
  "invalid-local-bearing": "the constructor or its members are invalid"
};

const INTENTIONS: Record<BearingKind, string> = {
  supports: "support", challenges: "challenge", concerns: "relevance",
  answers: "answer", respondsTo: "response", interprets: "interpretation"
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
  const crossed = commitment.crossedOccurrenceIds.length ? `, passing through ordinary body at ${lines(commitment.crossedOccurrenceIds)}` : "";
  const frame = commitment.frame;
  const unbound = frame?.framing === "unbound"
    ? `Presented as ${pointMark(mark ?? "Material").name}; ${INTENTIONS[frame.intention]} target unstated` : "";
  const opposed = frame?.framing === "opposed" ? " (opposed framing)" : "";
  switch (commitment.basis) {
    case "indentation": {
      const relation = bearingLabel(commitment.kind!, commitment.profile);
      const nearest = commitment.target!.kind === "point" ? "the nearest enclosing Point" : "the nearest exposed step";
      const members = commitment.memberOccurrenceIds;
      const joint = members.length ? `, with source${members.length > 1 ? "s" : ""} ${lines(members)}` : "";
      const selected = unbound ? `${unbound}; placement records relevance`
        : frame?.focus === "question" && mark === "C" ? "C beneath a Question offers a candidate answer"
        : frame?.focus && commitment.kind === "concerns" ? "Placement records relevance"
        : "From indentation";
      const stated = commitment.relationBy === "clause" ? `; the written clause states the relation${opposed}`
        : commitment.relationBy === "default" ? "; the constructor defaults to concerns"
        : frame?.focus && !unbound ? `; the mark and ${frame.focus === "question" ? "Question" : "Point"} focus select the relation`
        : !unbound ? "; the mark states the relation" : "";
      return `${selected}${joint}: ${relation} ${name(commitment.target!, commitment.contextOccurrenceId)}, ${nearest}${crossed}; moving it can change the target${stated}.`;
    }
    case "explicit":
      return `Named target: ${bearingLabel(commitment.kind!, commitment.profile)} ${name(commitment.target!)}${opposed}; indentation does not choose this target.`;
    case "member": {
      const header = unit.commitments.find(item => item.occurrenceId === commitment.contextOccurrenceId);
      const at = lines([commitment.contextOccurrenceId!]);
      return header?.basis === "failed"
        ? `Eligible source for the constructor at ${at}, which was rejected; no relation was created.`
        : `Source of the constructor at ${at}; it adds no relation of its own.`;
    }
    case "note":
      return `From indentation: a note on ${name(commitment.target!, commitment.contextOccurrenceId)}${crossed}.`;
    case "failed": {
      const why = commitment.reason ? REJECTED[commitment.reason] ?? commitment.reason : "no object was selected";
      const context = commitment.contextOccurrenceId ? `; its context is ${lines([commitment.contextOccurrenceId])}` : "";
      // The occurrence's own error usually names the remedy; repeat it beside the decision.
      const error = row(commitment.occurrenceId).diagnostics.find(diagnostic => diagnostic.severity === "error");
      return `No relation: ${why}${context}.${error ? " " + error.message : ""}`;
    }
    case "none": {
      const neutral = recognition.kind === "material" || (recognition.kind === "use" && !mark);
      const noun = mark ? pointMark(mark).name : neutral ? "neutral Point" : "occurrence";
      if (unbound) return `${unbound}; its position creates no relation.`;
      if (commitment.reason === "no-eligible-ancestor") return "No enclosing Point or step; its position creates no relation.";
      return `This ${noun} creates no relation from its position.`;
    }
  }
}
