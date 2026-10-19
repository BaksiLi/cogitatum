import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { explainSource, FORMAT_VERSION, formatGraph } from "@cogitatum/core";

const fixture = new URL("./wet-ground.cog.md", import.meta.url);
const compilerVersion = JSON.parse(readFileSync(new URL("../../packages/core/package.json", import.meta.url), "utf8")).version;
const sourceSha256 = "11e5d0703891918adbe5bf9ad167598c415e47b2000a4e6ac8dc758910a77aac";
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");

// A deliberately finite experiment, not a formula language or public theory API.
// Predicates below and the displayed formula labels are reviewed together.
const worlds = [false, true].flatMap(W => [false, true].flatMap(R => [false, true].map(S => ({ W, R, S }))));
const wet = world => world.W;
const rain = world => world.R;
const sprinkler = world => world.S;
const rainWets = world => !world.R || world.W;
const sprinklerWets = world => !world.S || world.W;

export function checkFiniteEntailment(premises, conclusion) {
  const models = worlds.filter(world => premises.every(premise => premise(world)));
  // Classical explosion is real, but it is not useful evidence that a proposed
  // reading explains this observation. Report inconsistency before entailment.
  if (!models.length) return { status: "inconsistent-assumptions", modelCount: 0 };
  const counterexample = models.find(world => !conclusion(world));
  return counterexample
    ? { status: "counterexample", modelCount: models.length, counterexample: { ...counterexample } }
    : { status: "entailed", modelCount: models.length, witness: { ...models[0] } };
}

export function runProbe(source = readFileSync(fixture, "utf8")) {
  // Pin the whole document, including occurrence prose and literal notes that a
  // graph-only comparison would discard. Never silently rebind a saved reading.
  if (digest(source) !== sourceSha256) throw new Error("STALE_INTERPRETATION: source changed; review the translation and assumptions before rebinding this probe.");
  if (compilerVersion !== "0.5.0" || FORMAT_VERSION !== "0.5.0") throw new Error("UNSUPPORTED_COMPILER: review this probe against the new compiler and format.");
  const recorded = explainSource(source, "document");
  if (recorded.diagnostics.some(d => d.severity === "error") || recorded.graphs.length !== 1) throw new Error("INVALID_SOURCE: the probe requires one successfully compiled document.");
  const graph = recorded.graphs[0];
  const point = id => {
    const matches = graph.points.filter(p => p.id === id);
    if (matches.length !== 1) throw new Error(`INVALID_SELECTION: expected one Point @${id}.`);
    const p = matches[0];
    return { ref: { graphIndex: 0, kind: "point", key: p.key }, id, text: p.text, sourceSpan: p.sourceSpan };
  };
  const bearing = handle => {
    const matches = graph.bearings.filter(b => b.handle === handle);
    if (matches.length !== 1) throw new Error(`INVALID_SELECTION: expected one Bearing @${handle}.`);
    return matches[0];
  };
  const wetPoint = point("wet"), rainPoint = point("rain"), objectionPoint = point("sprinkler");
  const route = bearing("weather-route"), objection = bearing("alternative");
  if (route.kind !== "supports" || route.sources.length !== 1 || route.sources[0].key !== wetPoint.ref.key || route.target.kind !== "point" || route.target.key !== rainPoint.ref.key ||
      objection.kind !== "challenges" || objection.sources.length !== 1 || objection.sources[0].key !== objectionPoint.ref.key || objection.target.kind !== "bearing" || objection.target.key !== route.key) {
    throw new Error("INVALID_SELECTION: the interpreted relations no longer match the recorded route and challenge.");
  }
  const selected = [route, objection].map(b => ({ graphIndex: 0, kind: "bearing", key: b.key }));
  const snapshot = { sourceSha256, compilerVersion, formatVersion: FORMAT_VERSION, mode: "document", compiledSha256: digest(JSON.stringify(recorded)) };
  const theory = { id: "finite-classical-propositional", version: "probe-1", atoms: ["W", "R", "S"], valuations: worlds.length };
  const mappings = [
    { ...wetPoint, formula: "W", reading: "The ground is wet in the selected situation." },
    { ...rainPoint, formula: "R", reading: "It rained in the selected situation." }
  ];
  const interpretations = [
    {
      id: "deductive-reading", snapshot, selected, theory, mappings,
      assumptions: [], query: "Does W entail R?",
      result: checkFiniteEntailment([wet], rain)
    },
    {
      id: "explanatory-reading", snapshot, selected, theory, mappings,
      introducedAtoms: [{ atom: "S", reading: "A sprinkler operated in the selected situation.", origin: "interpretation", assertedAsFact: false }],
      assumptions: [
        { formula: "R -> W", origin: "interpretation", reading: "Rain suffices to wet this ground in the simplified model.", status: "assumed-for-check" },
        { formula: "S -> W", origin: objectionPoint, reading: "Read the sprinkler objection as a sufficient alternative cause in this model.", status: "assumed-for-check" }
      ],
      query: "Which of the specified candidates consistently entails W with the assumed background?",
      result: {
        candidates: [
          { hypothesis: "R", check: checkFiniteEntailment([rainWets, sprinklerWets, rain], wet) },
          { hypothesis: "S", check: checkFiniteEntailment([rainWets, sprinklerWets, sprinkler], wet) }
        ],
        observationEntailsRain: checkFiniteEntailment([rainWets, sprinklerWets, wet], rain),
        ranking: "not-assessed", undercutClassification: "not-assessed"
      }
    }
  ];
  return {
    experiment: "wet-ground-interpretations-1", snapshot, recorded, inspection: formatGraph(graph), interpretations,
    limits: [
      "The translations and background are proposed readings, not verified facts or additional source Points.",
      "Explanatory sufficiency and consistency do not establish causation, probability, the best explanation, or a theory-specific undercut.",
      "The checked candidate list is explicit, not an exhaustive account of possible causes.",
      "Results do not resolve the inquiry or remove its original support and challenge."
    ]
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3) throw new Error("Usage: npm run probe:interpretation -- [source.cog.md]");
    const source = process.argv[2] ? readFileSync(process.argv[2], "utf8") : undefined;
    process.stdout.write(JSON.stringify(runProbe(source), null, 2) + "\n");
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  }
}
