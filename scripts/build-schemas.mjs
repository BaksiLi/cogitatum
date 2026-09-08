import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// spec/ is the authoritative source; npm receives byte-identical build artefacts.
const output = new URL("../packages/core/dist/schemas/", import.meta.url);
mkdirSync(output, { recursive: true });
for (const name of ["ast", "graph-ir", "explain"]) {
  copyFileSync(new URL(`../spec/${name}.schema.json`, import.meta.url), new URL(`${name}.schema.json`, output));
}
process.stdout.write(`Copied compiler schemas to ${fileURLToPath(output)}\n`);
