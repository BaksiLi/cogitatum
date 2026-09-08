import { readFile } from "node:fs/promises";

const rootPackage = await readJson("package.json");
const corePackage = await readJson("packages/core/package.json");
const cliPackage = await readJson("packages/cli/package.json");
const astSchema = await readJson("spec/ast.schema.json");
const graphSchema = await readJson("spec/graph-ir.schema.json");
const explainSchema = await readJson("spec/explain.schema.json");
const typesSource = await readFile("packages/core/src/types.ts", "utf8");
const formatVersion = /FORMAT_VERSION\s*=\s*"([^"]+)"/.exec(typesSource)?.[1];

const expectedPackage = rootPackage.version;
const expectedFormat = expectedPackage.split("-")[0];
const packages = new Map([
  ["root package", rootPackage.version],
  ["core package", corePackage.version],
  ["CLI package", cliPackage.version],
  ["CLI core dependency", cliPackage.dependencies?.["@cogitatum/core"]]
]);
for (const workspace of rootPackage.workspaces ?? []) {
  if (workspace === "site") {
    packages.set("site core dependency", (await readJson("site/package.json")).dependencies?.["@cogitatum/core"]);
  }
}
const formats = new Map([
  ["FORMAT_VERSION", formatVersion],
  ["AST schema", astSchema.properties?.version?.const],
  ["Graph IR schema", graphSchema.properties?.version?.const],
  ["Explain schema", explainSchema.properties?.version?.const]
]);
for (const [name, schema] of [["ast", astSchema], ["graph-ir", graphSchema], ["explain", explainSchema]]) {
  const expectedId = `https://cogitatum.baksili.codes/schemas/${expectedFormat}/${name}.schema.json`;
  if (schema.$id !== expectedId) throw new Error(`Schema identifier must be versioned: ${expectedId}`);
}
const mismatches = [
  ...[...packages].filter(([, version]) => version !== expectedPackage),
  ...[...formats].filter(([, version]) => version !== expectedFormat)
];

if (mismatches.length > 0) {
  const detail = mismatches.map(([name, version]) => `${name}: ${String(version)}`).join("\n");
  throw new Error(`Expected package ${expectedPackage} and format ${expectedFormat}.\n${detail}`);
}

process.stdout.write(`Package versions aligned at ${expectedPackage}; format contracts at ${expectedFormat}.\n`);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
