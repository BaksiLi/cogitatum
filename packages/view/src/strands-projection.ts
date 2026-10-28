import type { Bearing, BearingTarget, GraphIR, Point, PointRef } from "@cogitatum/core";
import { endingPoints, referenceKey } from "./projection.js";

/**
 * Strands: a lane reading of the lines of reasoning that end at one focus Point.
 * A strand follows `supports` and `answers` Bearings with a Point target, downward from the focus.
 * Everything else that bears on a strand is a knot, placed at the Point or step it addresses,
 * so a contest sits on the line it contests instead of beside it as another line.
 * This is a projection of the compiled graph. It adds no strength, weighting, resolution or outcome.
 */
export type StrandKnot = {
  bearing: Bearing;
  /** The strand Point, or the strand step, that this Bearing targets. */
  on: BearingTarget;
  polarity: "challenge" | "support" | "neutral";
  /** Relations addressing the knot's sources or the knot itself, one level only. */
  relations: Bearing[];
  /** Further Bearings below those relations, counted rather than drawn. */
  further: number;
};

export type StrandRow =
  | {
      kind: "point";
      point: Point;
      lane: number;
      /** Lane slots before and after the row; each holds the Point it continues to, or null. */
      before: (string | null)[];
      after: (string | null)[];
      /** Strand steps whose target is this Point, each with the lanes its sources continue in. */
      steps: { bearing: Bearing; lanes: number[] }[];
      /** How this Point carries its strand upward; absent for the focus. */
      via: Bearing[];
      knots: StrandKnot[];
      /** Sources already placed above: the strand closes a cycle instead of repeating them. */
      cycles: Point[];
    }
  | {
      kind: "knot";
      knot: StrandKnot;
      /** The lane of the step's segment that the knot sits on. */
      lane: number;
      before: (string | null)[];
      after: (string | null)[];
    };

export type StrandsProjection = {
  focus: Point;
  /** Candidate focus Points: those that carry no strand further up, in source order. */
  roots: Point[];
  rows: StrandRow[];
  laneCount: number;
  /** Graph entities not shown in these strands. */
  outside: { points: number; bearings: number };
};

const line = (entity: { sourceSpan?: { startLine: number } }) => entity.sourceSpan?.startLine ?? Number.MAX_SAFE_INTEGER;
const key = referenceKey;
/** A strand step carries reasoning toward a Point: support, or an answer to a Question. */
export const isStrandStep = (bearing: Bearing) =>
  (bearing.kind === "supports" || bearing.kind === "answers") && bearing.target.kind === "point";

/**
 * Candidate focus Points, in source order: those that bear on nothing and have something bearing on them.
 * Without any, Points that carry no strand further up.
 */
export function strandRoots(graph: GraphIR): Point[] {
  const carriers = new Set(graph.bearings.filter(isStrandStep).flatMap(bearing => bearing.sources.map(source => source.key)));
  const endings = endingPoints(graph);
  return endings.length ? endings : graph.points.filter(point => !carriers.has(point.key)).sort((a, b) => line(a) - line(b));
}

/** Find an ending through actual relation targets, including a Point presented inside a knot. */
export function strandRootOf(graph: GraphIR, point: PointRef): Point | undefined {
  const up = new Map<string, BearingTarget[]>();
  const byBearing = new Map(graph.bearings.map(bearing => [bearing.key, bearing]));
  for (const bearing of graph.bearings) for (const source of bearing.sources) {
    up.set(source.key, [...up.get(source.key) ?? [], bearing.target]);
  }
  const seen = new Set<string>(), queue: BearingTarget[] = [point];
  const roots = new Set(strandRoots(graph).map(root => root.key));
  for (const current of queue) {
    if (seen.has(key(current))) continue;
    seen.add(key(current));
    if (current.kind === "point") {
      if (roots.has(current.key)) return graph.points.find(p => p.key === current.key);
      queue.push(...up.get(current.key) ?? []);
    } else {
      const target = byBearing.get(current.key)?.target;
      if (target) queue.push(target);
    }
  }
  return graph.points.find(p => p.key === point.key);
}

export function projectStrands(graph: GraphIR, focusRef?: PointRef): StrandsProjection | undefined {
  const roots = strandRoots(graph);
  const points = new Map(graph.points.map(point => [point.key, point]));
  const point = (k: string) => points.get(k)!;
  // A closed cycle has no ending, but it still has Points to inspect.
  const focus = focusRef ? graph.points.find(p => p.key === focusRef.key) : roots[0] ?? graph.points[0];
  if (!focus) return undefined;
  const bySource = (a: Bearing, b: Bearing) => line(a) - line(b) || Math.min(...a.sources.map(s => line(point(s.key)))) - Math.min(...b.sources.map(s => line(point(s.key))));
  const into = new Map<string, Bearing[]>();
  for (const bearing of graph.bearings) into.set(key(bearing.target), [...into.get(key(bearing.target)) ?? [], bearing]);
  const stepsByTarget = new Map(graph.points.map(point => [point.key, (into.get(`point:${point.key}`) ?? []).filter(isStrandStep).sort(bySource)]));
  const stepsInto = (k: string) => stepsByTarget.get(k)!;

  // Reverse depth-first postorder from the focus: every Point sits above all of its sources,
  // and a strand reads as one continuous thread. Visiting sources last-first keeps source order.
  const placed = new Set<string>(), active = new Set<string>(), post: Point[] = [], back = new Set<string>();
  const visit = (p: Point) => {
    if (placed.has(p.key)) return;
    placed.add(p.key); active.add(p.key);
    const sources = stepsInto(p.key).flatMap(step => step.sources.map(source => ({ step, key: source.key })));
    for (const source of sources.reverse()) {
      if (active.has(source.key)) back.add(`${source.step.key}:${source.key}`);
      else visit(point(source.key));
    }
    active.delete(p.key); post.push(p);
  };
  visit(focus);
  const order = post.reverse();
  const strandSteps = new Set(graph.bearings.filter(b => isStrandStep(b) && placed.has(b.target.key)).map(b => b.key));

  const shown = new Set<string>([...placed].map(k => `point:${k}`));
  const knotOf = (bearing: Bearing, on: BearingTarget): StrandKnot => {
    const own = [...bearing.sources.map(s => `point:${s.key}`), `bearing:${bearing.key}`];
    const relations = own.flatMap(k => into.get(k) ?? []).filter(b => b.key !== bearing.key && !strandSteps.has(b.key)).sort(bySource);
    const displayed = new Set([bearing.key, ...relations.map(relation => relation.key), ...strandSteps]);
    const further = new Set(relations.flatMap(relation => [...relation.sources.map(s => `point:${s.key}`), `bearing:${relation.key}`])
      .flatMap(k => into.get(k) ?? []).filter(b => !displayed.has(b.key)).map(b => b.key)).size;
    for (const b of [bearing, ...relations]) { shown.add(`bearing:${b.key}`); b.sources.forEach(s => shown.add(`point:${s.key}`)); }
    return { bearing, on, relations, further,
      polarity: bearing.kind === "challenges" ? "challenge" : bearing.kind === "supports" ? "support" : "neutral" };
  };
  const knotsOn = (target: BearingTarget) =>
    (into.get(key(target)) ?? []).filter(b => !strandSteps.has(b.key)).sort(bySource).map(b => knotOf(b, target));

  // Lane slots stay in place once opened, so a strand keeps its column from row to row.
  let slots: (string | null)[] = [focus.key];
  const rows: StrandRow[] = [];
  const stepKnots = new Map<string, StrandKnot[]>();
  for (const step of graph.bearings.filter(b => strandSteps.has(b.key))) {
    shown.add(`bearing:${step.key}`);
    const knots = knotsOn({ kind: "bearing", key: step.key });
    if (knots.length) stepKnots.set(step.key, knots);
  }
  const via = new Map<string, Bearing[]>();
  for (const bearing of graph.bearings) if (strandSteps.has(bearing.key)) for (const source of bearing.sources) {
    via.set(source.key, [...via.get(source.key) ?? [], bearing]);
  }
  const knotsPlaced = new Set<string>();
  for (const p of order) {
    // A knot on a step sits on that step's segment, just above the step's first-placed source.
    for (const step of via.get(p.key) ?? []) {
      if (knotsPlaced.has(step.key) || !stepKnots.has(step.key)) continue;
      knotsPlaced.add(step.key);
      const lane = Math.max(0, slots.indexOf(p.key));
      for (const knot of stepKnots.get(step.key)!) rows.push({ kind: "knot", knot, lane, before: [...slots], after: [...slots] });
    }
    const before = [...slots];
    let lane = slots.indexOf(p.key);
    if (lane < 0) { lane = slots.indexOf(null); if (lane < 0) lane = slots.length; }
    const after = [...slots];
    for (let i = 0; i < after.length; i++) if (after[i] === p.key) after[i] = null;
    after[lane] = null;
    const steps: { bearing: Bearing; lanes: number[] }[] = [], cycles: Point[] = [];
    let first = true;
    for (const step of stepsInto(p.key)) {
      const lanes: number[] = [];
      for (const source of step.sources) {
        if (back.has(`${step.key}:${source.key}`)) { if (!cycles.includes(point(source.key))) cycles.push(point(source.key)); continue; }
        let slot = after.indexOf(source.key);
        if (slot < 0) {
          slot = first ? lane : after.indexOf(null);
          if (slot < 0 || (slot === lane && !first)) slot = after.length;
          after[slot] = source.key;
        }
        first = false;
        lanes.push(slot);
      }
      steps.push({ bearing: step, lanes });
    }
    while (after.length && after.at(-1) === null) after.pop();
    rows.push({ kind: "point", point: p, lane, before, after: [...after], steps, via: via.get(p.key) ?? [], knots: knotsOn({ kind: "point", key: p.key }), cycles });
    slots = after;
  }
  const laneCount = Math.max(1, ...rows.flatMap(row => [row.before.length, row.after.length, row.lane + 1]));
  return {
    focus, roots, rows, laneCount,
    outside: {
      points: graph.points.filter(p => !shown.has(`point:${p.key}`)).length,
      bearings: graph.bearings.filter(b => !shown.has(`bearing:${b.key}`)).length
    }
  };
}

export type StrandContest = {
  rows: Set<number>;
  pointKeys: Set<string>;
  bearingKeys: Set<string>;
};

/**
 * Challenge Focus follows particular steps, not just their endpoints: two routes
 * may share a Ground without sharing the objection that bears on one of them.
 */
export function projectContest(projection: StrandsProjection, knotBearing: string): StrandContest {
  const rows = projection.rows;
  const scope: StrandContest = { rows: new Set(), pointKeys: new Set(), bearingKeys: new Set() };
  const knots = rows.flatMap(row => row.kind === "knot" ? [row.knot] : row.knots);
  const knot = knots.find(item => item.bearing.key === knotBearing);
  if (!knot) return scope;
  const points = rows.filter((row): row is Extract<StrandRow, { kind: "point" }> => row.kind === "point");
  const byPoint = new Map(points.map(row => [row.point.key, row]));
  const byStep = new Map(points.flatMap(row => row.steps.map(step => [step.bearing.key, step.bearing] as const)));
  const step = knot.on.kind === "bearing" ? byStep.get(knot.on.key) : undefined;
  const target = step ? step.target.key : knot.on.key;

  const up = new Set([target]);
  for (const key of up) {
    scope.pointKeys.add(key);
    for (const via of byPoint.get(key)?.via ?? []) {
      scope.bearingKeys.add(via.key); up.add(via.target.key);
    }
  }
  const down = new Set(step ? step.sources.map(source => source.key) : [target]);
  if (step) scope.bearingKeys.add(step.key);
  for (const key of down) {
    scope.pointKeys.add(key);
    for (const child of byPoint.get(key)?.steps ?? []) {
      scope.bearingKeys.add(child.bearing.key);
      child.bearing.sources.forEach(source => down.add(source.key));
    }
  }
  const relevant = (item: StrandKnot) => item.on.kind === "point"
    ? scope.pointKeys.has(item.on.key) : scope.bearingKeys.has(item.on.key);
  for (const item of knots) if (relevant(item)) {
    scope.bearingKeys.add(item.bearing.key);
    item.relations.forEach(relation => scope.bearingKeys.add(relation.key));
  }
  rows.forEach((row, index) => {
    if (row.kind === "point" ? scope.pointKeys.has(row.point.key) : relevant(row.knot)) scope.rows.add(index);
  });
  return scope;
}
