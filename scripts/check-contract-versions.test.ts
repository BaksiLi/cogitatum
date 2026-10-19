import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = join(root, "scripts/check-contract-versions.mjs");
const packageNames = ["core", "cli", "view"];
const schemaNames = ["ast", "graph-ir", "explain", "source"];
const currentVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version as string;
const [major, minor, patch] = currentVersion.split(".").map(Number);
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(version = currentVersion): string {
  const directory = mkdtempSync(join(tmpdir(), "cog-contract-versions-"));
  directories.push(directory);
  const paths = ["package.json", "package-lock.json", "packages/core/src/types.ts",
    ...packageNames.map(name => `packages/${name}/package.json`),
    ...schemaNames.map(name => `spec/${name}.schema.json`)];
  for (const path of paths) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    copyFileSync(join(root, path), join(directory, path));
  }
  update(directory, "package.json", pkg => { pkg.version = version; });
  for (const name of packageNames) {
    update(directory, `packages/${name}/package.json`, pkg => {
      pkg.version = version;
      if (name !== "core") pkg.dependencies["@cogitatum/core"] = version;
    });
  }
  update(directory, "package-lock.json", lock => {
    lock.version = version;
    lock.packages[""].version = version;
    for (const name of packageNames) {
      const pkg = lock.packages[`packages/${name}`];
      pkg.version = version;
      if (name !== "core") pkg.dependencies["@cogitatum/core"] = version;
    }
  });
  return directory;
}

function update(directory: string, path: string, change: (value: any) => void): void {
  const file = join(directory, path);
  const value = JSON.parse(readFileSync(file, "utf8"));
  change(value);
  writeFileSync(file, JSON.stringify(value));
}

function verify(directory: string) {
  return spawnSync(process.execPath, [script], { cwd: directory, encoding: "utf8" });
}

describe("package and format version checks", () => {
  it.each([`${major}.${minor}.${patch + 1}`, `${major}.${minor + 1}.0`])("allows package %s with unchanged language and schema contracts", version => {
    const result = verify(fixture(version));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Package versions aligned at ${version}; format contracts at`);
  });

  it("still rejects a stale Core dependency", () => {
    const directory = fixture();
    update(directory, "packages/cli/package.json", pkg => { pkg.dependencies["@cogitatum/core"] = "0.0.0"; });
    const result = verify(directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("CLI core dependency: 0.0.0");
  });

  it("still rejects a stale lockfile", () => {
    const directory = fixture();
    update(directory, "package-lock.json", lock => { lock.packages["packages/core"].version = "0.0.0"; });
    const result = verify(directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("locked core package: 0.0.0");
  });

  it("still rejects schema version drift", () => {
    const directory = fixture();
    update(directory, "spec/graph-ir.schema.json", schema => { schema.properties.version.const = "0.0.0"; });
    const result = verify(directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Graph IR schema: 0.0.0");
  });

  it("still rejects an unversioned schema identifier", () => {
    const directory = fixture();
    update(directory, "spec/ast.schema.json", schema => { schema.$id = "https://cogitatum.baksili.codes/schemas/ast.schema.json"; });
    const result = verify(directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Schema identifier must be versioned");
  });
});
