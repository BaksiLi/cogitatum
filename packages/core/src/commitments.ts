import { FORMAT_VERSION } from "./types.js";
import type { Bearing, BearingKind, BearingTarget, GraphIR, PointRef } from "./types.js";

/**
 * One relation a graph commits its author to: a kind, an unordered set of
 * source Points and a target. Several Bearings may state the same commitment;
 * they remain distinct entities when something targets them.
 */
export type Commitment = {
  kind: BearingKind;
  /** Source Point keys, sorted and unique: order is presentation. */
  sources: string[];
  target: BearingTarget;
  /** The Bearings stating it, in graph order. */
  bearings: string[];
};

/**
 * Which entity of a later graph continues which entity of an earlier one,
 * keyed by earlier key. Continuity is asserted, not inferred: an edit tool
 * knows what it moved, and suggestCorrespondence only proposes the
 * unambiguous cases. Unmapped entities were removed or added.
 */
export type Correspondence = {
  points: Record<string, string>;
  bearings: Record<string, string>;
};

export type CorrespondenceBasis = "name" | "text" | "relation" | "endpoints";

export type CorrespondenceSuggestion = {
  correspondence: Correspondence;
  /** Why each pair was proposed; weaker bases deserve review. */
  matches: { kind: "point" | "bearing"; before: string; after: string; basis: CorrespondenceBasis }[];
  /**
   * Earlier entities left unpaired because several continuations fit equally,
   * once each, at the strongest basis that found more than one.
   */
  ambiguous: { kind: "point" | "bearing"; before: string; candidates: string[]; basis: CorrespondenceBasis }[];
};

export type CommitmentRelation = "equivalent" | "refinement" | "weakening" | "revision";

export type CommitmentComparison =
  | {
      status: "compared";
      /**
       * refinement only adds; weakening only retracts; revision does both.
       * It says what changed, never which reading is right.
       */
      relation: CommitmentRelation;
      /** Earlier commitments the later graph does not entail. */
      retracted: Commitment[];
      /** Later commitments the earlier graph did not entail. */
      added: Commitment[];
      /**
       * Selecting a Point records it as part of the inquiry, so removing or
       * adding one counts toward the relation. A continued Point whose text or
       * declaration changed is reported only: the order cannot weigh prose.
       */
      points: { removed: string[]; added: string[]; changed: { before: string; after: string; text: boolean; declaration: boolean }[] };
      /**
       * Bearings without continuation. They do not count by themselves: what
       * a removed Bearing stated is either entailed or listed as retracted,
       * and a relation addressing it is retracted with its target.
       */
      bearings: { removed: string[]; added: string[] };
    }
  | { status: "indeterminate"; reason: "unsupported-version" | "source-errors" | "invalid-correspondence"; message: string };

/** The distinct commitments a graph states, in first-statement order. */
export function graphCommitments(graph: GraphIR): Commitment[] {
  const byKey = new Map<string, Commitment>();
  for (const bearing of graph.bearings) {
    const commitment = { kind: bearing.kind, sources: sourceSet(bearing.sources), target: bearing.target };
    const key = commitmentKey(commitment);
    const known = byKey.get(key);
    if (known) known.bearings.push(bearing.key);
    else byKey.set(key, { ...commitment, bearings: [bearing.key] });
  }
  return [...byKey.values()];
}

/**
 * The commitments that entail one commitment, or undefined when none do.
 * Exactly two rules hold:
 *
 * - A commitment entails itself.
 * - Every kind is a species of relevance, so commitments to one target whose
 *   source sets lie within S, of any kinds, entail that S concerns it once
 *   their sources together cover S. Joint relevance asserts no member is
 *   necessary, so it holds of any set whose members are each committed as
 *   relevant; the cover keeps an uncommitted Point from joining.
 *
 * Nothing else follows. Joint support gives no member support of its own;
 * separate supports are not one joint support; a joint relation entails
 * nothing about a subset of its sources; and bearing on a step is not
 * bearing on its conclusion.
 */
export function entailment(
  stated: readonly Omit<Commitment, "bearings">[],
  commitment: Omit<Commitment, "bearings">
): Omit<Commitment, "bearings">[] | undefined {
  const key = commitmentKey(commitment);
  const exact = stated.find(c => commitmentKey(c) === key);
  if (exact) return [exact];
  if (commitment.kind !== "concerns") return undefined;
  const wanted = new Set(commitment.sources);
  const parts = stated.filter(c => sameTarget(c.target, commitment.target) && c.sources.every(s => wanted.has(s)));
  const covered = new Set(parts.flatMap(c => c.sources));
  return covered.size === wanted.size ? parts : undefined;
}

/**
 * Compare two compiled revisions of one source unit through a correspondence.
 * Error-bearing graphs and an invalid correspondence are indeterminate: a
 * partial graph omits commitments, so no classification would be sound.
 */
export function compareCommitments(before: GraphIR, after: GraphIR, correspondence: Correspondence): CommitmentComparison {
  if (before.version !== FORMAT_VERSION || after.version !== FORMAT_VERSION) {
    return { status: "indeterminate", reason: "unsupported-version", message: `Compare graphs of format ${FORMAT_VERSION}; reparse older sources rather than relabelling them.` };
  }
  if ([before, after].some(g => g.diagnostics.some(d => d.severity === "error"))) {
    return { status: "indeterminate", reason: "source-errors", message: "Compare only graphs compiled without errors; a partial graph omits commitments." };
  }
  const invalid = correspondenceError(before, after, correspondence);
  if (invalid) return { status: "indeterminate", reason: "invalid-correspondence", message: invalid };

  const maps = { point: entries(correspondence.points), bearing: entries(correspondence.bearings) };
  const earlier = graphCommitments(before);
  const later = graphCommitments(after);
  // Restate earlier commitments over later keys. One whose endpoint has no
  // continuation is retracted outright: it can neither be entailed nor entail.
  const restated = earlier.map(c => {
    const sources = c.sources.map(key => maps.point.get(key));
    const target = maps[c.target.kind].get(c.target.key);
    if (target === undefined || sources.some(key => key === undefined)) return undefined;
    return { kind: c.kind, sources: sourceSetOf(sources as string[]), target: { kind: c.target.kind, key: target } as BearingTarget };
  });
  const continuing = restated.filter(c => c !== undefined);
  const retracted = earlier.filter((_, i) => !restated[i] || !entailment(later, restated[i]));
  const added = later.filter(c => !entailment(continuing, c));

  const removed = <T extends { key: string }>(items: T[], map: Map<string, string>) => items.filter(e => !map.has(e.key)).map(e => e.key);
  const introduced = <T extends { key: string }>(items: T[], map: Map<string, string>) => {
    const continued = new Set(map.values());
    return items.filter(e => !continued.has(e.key)).map(e => e.key);
  };
  const points = {
    removed: removed(before.points, maps.point),
    added: introduced(after.points, maps.point),
    changed: changedPoints(before, after, maps.point)
  };
  const lost = retracted.length + points.removed.length > 0;
  const gained = added.length + points.added.length > 0;
  const relation: CommitmentRelation = lost ? gained ? "revision" : "weakening" : gained ? "refinement" : "equivalent";
  return {
    status: "compared", relation, retracted, added, points,
    bearings: { removed: removed(before.bearings, maps.bearing), added: introduced(after.bearings, maps.bearing) }
  };
}

function changedPoints(before: GraphIR, after: GraphIR, points: Map<string, string>) {
  const later = new Map(after.points.map(p => [p.key, p]));
  return before.points.flatMap(p => {
    const continuation = points.get(p.key);
    const next = continuation === undefined ? undefined : later.get(continuation);
    if (!next) return [];
    const text = p.text !== next.text;
    const declaration = JSON.stringify(p.declaration) !== JSON.stringify(next.declaration);
    return text || declaration ? [{ before: p.key, after: next.key, text, declaration }] : [];
  });
}

/**
 * Propose a correspondence for review, never silently choosing among equals.
 * Points continue by authored name, else by text unique on both sides.
 * Bearings continue by handle, else by kind and continued endpoints, else by
 * continued endpoints alone; the last basis lets a target's kind be refined
 * while a relation that addresses it keeps its target.
 */
export function suggestCorrespondence(before: GraphIR, after: GraphIR): CorrespondenceSuggestion {
  type Kind = "point" | "bearing";
  const maps = { point: new Map<string, string>(), bearing: new Map<string, string>() };
  const taken = { point: new Set<string>(), bearing: new Set<string>() };
  const matches: CorrespondenceSuggestion["matches"] = [];
  const ambiguous = new Map<string, CorrespondenceSuggestion["ambiguous"][number]>();

  // Pair each open earlier entity whose signature exactly one open later
  // entity shares. Report whether anything was paired.
  const pairUnique = <T extends { key: string }>(kind: Kind, earlier: T[], later: T[], basis: CorrespondenceBasis, signature: (entity: T, side: "before" | "after") => string | undefined): boolean => {
    const group = (items: T[], side: "before" | "after") => {
      const groups = new Map<string, T[]>();
      for (const item of items) {
        const sig = signature(item, side);
        if (sig !== undefined) groups.set(sig, [...groups.get(sig) ?? [], item]);
      }
      return groups;
    };
    const candidates = group(later.filter(e => !taken[kind].has(e.key)), "after");
    let paired = false;
    for (const [sig, from] of group(earlier.filter(e => !maps[kind].has(e.key)), "before")) {
      const to = candidates.get(sig) ?? [];
      if (from.length === 1 && to.length === 1) {
        maps[kind].set(from[0].key, to[0].key);
        taken[kind].add(to[0].key);
        matches.push({ kind, before: from[0].key, after: to[0].key, basis });
        paired = true;
      } else if (to.length) {
        for (const item of from) {
          const id = `${kind}:${item.key}`;
          if (!ambiguous.has(id)) ambiguous.set(id, { kind, before: item.key, candidates: to.map(e => e.key), basis });
        }
      }
    }
    return paired;
  };

  pairUnique("point", before.points, after.points, "name", p => p.id);
  pairUnique("point", before.points, after.points, "text", p => p.text);
  pairUnique("bearing", before.bearings, after.bearings, "name", b => b.handle);

  // Bearing endpoints may be Bearings, so pairing one can enable another.
  // Exhaust exact relations before falling back to endpoints alone, so an
  // unchanged Bearing is never reported on weaker evidence.
  const endpoints = (b: Bearing, side: "before" | "after") => {
    const sources = sourceSet(b.sources).map(key => side === "before" ? maps.point.get(key) : key);
    const target = side === "before" ? maps[b.target.kind].get(b.target.key) : b.target.key;
    if (target === undefined || sources.some(key => key === undefined)) return undefined;
    return JSON.stringify([sourceSetOf(sources as string[]), b.target.kind, target]);
  };
  const relation = (b: Bearing, side: "before" | "after") => {
    const e = endpoints(b, side);
    return e === undefined ? undefined : JSON.stringify([b.kind, e]);
  };
  do {
    while (pairUnique("bearing", before.bearings, after.bearings, "relation", relation));
  } while (pairUnique("bearing", before.bearings, after.bearings, "endpoints", endpoints));

  return {
    correspondence: { points: Object.fromEntries(maps.point), bearings: Object.fromEntries(maps.bearing) },
    matches,
    ambiguous: [...ambiguous.values()].filter(a => !maps[a.kind].has(a.before))
  };
}

function correspondenceError(before: GraphIR, after: GraphIR, correspondence: Correspondence): string | undefined {
  for (const [kind, map, from, to] of [
    ["Point", correspondence.points, before.points, after.points],
    ["Bearing", correspondence.bearings, before.bearings, after.bearings]
  ] as const) {
    const earlier = new Set(from.map(e => e.key));
    const later = new Set(to.map(e => e.key));
    const pairs = Object.entries(map);
    const images = pairs.map(([, key]) => key);
    if (pairs.some(([key]) => !earlier.has(key))) return `The correspondence names an earlier ${kind} the graph does not contain.`;
    if (images.some(key => !later.has(key))) return `The correspondence names a later ${kind} the graph does not contain.`;
    if (new Set(images).size !== images.length) return `Two earlier ${kind}s cannot continue as one later ${kind}.`;
  }
  return undefined;
}

function sourceSet(sources: PointRef[]): string[] {
  return sourceSetOf(sources.map(s => s.key));
}

function sourceSetOf(keys: string[]): string[] {
  return [...new Set(keys)].sort();
}

// Own entries only: a key such as "constructor" must not read as a mapping.
function entries(map: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(map));
}

function sameTarget(left: BearingTarget, right: BearingTarget): boolean {
  return left.kind === right.kind && left.key === right.key;
}

function commitmentKey(c: Omit<Commitment, "bearings">): string {
  return JSON.stringify([c.kind, c.sources, c.target.kind, c.target.key]);
}
