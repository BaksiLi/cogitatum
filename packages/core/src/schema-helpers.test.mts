import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";

type SchemaName = "ast" | "graph-ir" | "explain" | "source";

export function schemaValidators(...names: SchemaName[]) {
  const ajv = new Ajv2020({ allErrors: true });
  const dependencies: SchemaName[] = names.includes("source") ? ["ast", "graph-ir", "explain", "source"] : names;
  const schemas = new Map(dependencies.map(name => [name,
    JSON.parse(readFileSync(new URL(`../../../spec/${name}.schema.json`, import.meta.url), "utf8"))
  ]));
  for (const schema of schemas.values()) ajv.addSchema(schema);
  return names.map(name => ajv.getSchema(schemas.get(name).$id)!);
}
