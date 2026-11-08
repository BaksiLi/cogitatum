#!/usr/bin/env node
// Usage: node scripts/vendor-hosts.mjs <commit> [host-directory...]
//
// Hosts consume Core and View as tarballs packed from one committed public source, never from a working tree.
// This builds and packs that commit in isolation, prints the digests, and pins each named host to them:
// vendor/ tarballs, package.json `cogitatumSource` and `file:vendor/...` dependencies, npm's lockfile,
// and pin.mjs, the verifier each host's own checks run (scripts/host-pin.mjs).
// Packing is deterministic, so rerunning on a pinned commit reproduces the host's recorded SHA-256 digests.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const [ref, ...hosts] = process.argv.slice(2);
if (!ref) throw new Error("Usage: node scripts/vendor-hosts.mjs <commit> [host-directory...]");
const run = (command, args, cwd, options = {}) => execFileSync(command, args, { cwd, encoding: "utf8", ...options });
const commit = run("git", ["rev-parse", "--verify", `${ref}^{commit}`], root).trim();
const repository = run("git", ["remote", "get-url", "origin"], root).trim().match(/github\.com[:/](.+?)(?:\.git)?$/)?.[1];
if (!repository) throw new Error("Cannot name the public repository from its origin remote.");

// Dependencies are borrowed from this checkout, so they must be the ones the commit locks.
if (run("git", ["show", `${commit}:package-lock.json`], root) !== readFileSync(join(root, "package-lock.json"), "utf8")) {
  throw new Error(`${commit.slice(0, 7)} locks different dependencies than this checkout; install them here first.`);
}

const temporary = mkdtempSync(join(tmpdir(), "cogitatum-vendor-"));
try {
  const source = join(temporary, "source"), out = join(temporary, "out");
  mkdirSync(source); mkdirSync(out);
  execFileSync("tar", ["-x", "-C", source], { input: execFileSync("git", ["archive", commit], { cwd: root, maxBuffer: 1 << 30 }) });
  // Copy rather than link node_modules: its workspace links are relative and must resolve inside the archive.
  cpSync(join(root, "node_modules"), join(source, "node_modules"), { recursive: true, verbatimSymlinks: true });
  run("npm", ["run", "build", "-w", "@cogitatum/core", "-w", "@cogitatum/view"], source, { stdio: ["ignore", "ignore", "inherit"] });
  const packages = {};
  for (const name of ["core", "view"]) {
    const [packed] = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", out], join(source, "packages", name)));
    const sha256 = createHash("sha256").update(readFileSync(join(out, packed.filename))).digest("hex");
    packages[name] = { file: packed.filename, sha256 };
  }
  process.stdout.write(`${JSON.stringify({ repository, ref: commit, packages }, null, 2)}\n`);

  for (const host of hosts.map(path => resolve(path))) {
    const manifestPath = join(host, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!manifest.cogitatumSource) throw new Error(`${host} does not declare cogitatumSource.`);
    mkdirSync(join(host, "vendor"), { recursive: true });
    for (const file of readdirSync(join(host, "vendor"))) {
      if (/^cogitatum-(core|view)-.+\.tgz$/.test(file)) rmSync(join(host, "vendor", file));
    }
    const specs = [];
    for (const [name, { file, sha256 }] of Object.entries(packages)) {
      copyFileSync(join(out, file), join(host, "vendor", file));
      manifest.dependencies[`@cogitatum/${name}`] = `file:vendor/${file}`;
      manifest.cogitatumSource.sha256 = { ...manifest.cogitatumSource.sha256, [name]: sha256 };
      specs.push(`@cogitatum/${name}@file:vendor/${file}`);
    }
    Object.assign(manifest.cogitatumSource, { repository, ref: commit });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    copyFileSync(join(root, "scripts", "host-pin.mjs"), join(host, "pin.mjs"));
    run("npm", ["install", "--prefer-offline", "--no-audit", "--no-fund", ...specs], host, { stdio: ["ignore", "ignore", "inherit"] });
    run(process.execPath, [join(host, "pin.mjs")], host, { stdio: ["ignore", "ignore", "inherit"] });
    process.stdout.write(`Pinned ${host} to ${commit}.\n`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
