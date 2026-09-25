import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// This is a local readiness check. It does not publish, authenticate, or alter metadata.
const root = fileURLToPath(new URL("..", import.meta.url));
const problems = [];
for (const name of ["core", "cli"]) {
  const directory = join(root, "packages", name);
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  if (pkg.private) problems.push(`${pkg.name}: publication is disabled by private: true.`);
  if (!pkg.license || pkg.license === "UNLICENSED") problems.push(`${pkg.name}: choose a public license.`);
  const licenseExists = [directory, root].some((base) =>
    ["LICENSE", "LICENSE.md", "LICENSE.txt"].some((file) => existsSync(join(base, file)))
  );
  if (!licenseExists) problems.push(`${pkg.name}: include the chosen license text.`);
  // Repository metadata connects the tarball to the public source and contribution path.
  if (!pkg.repository?.url || pkg.repository.directory !== `packages/${name}`) {
    problems.push(`${pkg.name}: set the public Git repository URL and packages/${name} directory.`);
  }
  if (!/^\d+\.\d+\.\d+-alpha\.\d+$/.test(pkg.version) || pkg.publishConfig?.tag !== "alpha" || pkg.publishConfig?.access !== "public") {
    problems.push(`${pkg.name}: expected an Alpha version with public access and the alpha tag.`);
  }
}
for (const name of ["view"]) {
  const pkg = JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8"));
  if (pkg.private !== true) problems.push(`${pkg.name}: experimental package must stay private until its release is reviewed.`);
}

if (problems.length) {
  process.stderr.write(`Publication is not ready:\n${problems.map((problem) => `- ${problem}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Local publication metadata is ready. Run npm run check, then verify public repository access and npm publishing permissions before publishing.\n");
}
