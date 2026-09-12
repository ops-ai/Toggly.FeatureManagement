/** Prepare immutable batch evidence so partial-family releases can safely share a tag. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const directory = process.argv[2] ?? "release-candidate";
const plan = JSON.parse(
  fs.readFileSync(path.join(directory, "plan.json"), "utf8"),
);
const groups = new Map();

for (const pkg of plan.packages.filter((item) => item.action === "publish")) {
  const tag = `${pkg.family === "server" ? "dotnet" : `dotnet-${pkg.family}`}-sdk-v${pkg.version}`;
  const group = groups.get(tag) ?? [];
  group.push(pkg);
  groups.set(tag, group);
}

// One immutable pair covers this exact signed batch, even if it spans several families.
const batch = createHash("sha256")
  .update(fs.readFileSync(path.join(directory, "SHA256SUMS")))
  .digest("hex");
const assets = [`SHA256SUMS-${batch}`, `SHA256SUMS-${batch}.asc`];
fs.copyFileSync(
  path.join(directory, "SHA256SUMS"),
  path.join(directory, assets[0]),
);
fs.copyFileSync(
  path.join(directory, "SHA256SUMS.asc"),
  path.join(directory, assets[1]),
);
const releases = [];

for (const [tag, packages] of groups) {
  const notes = path.join(directory, `${tag}.md`);
  const marker = `<!-- dotnet-publication:${batch} -->`;
  const packageList = packages
    .map((pkg) => `- ${pkg.id} ${pkg.version}`)
    .join("\n");
  fs.writeFileSync(
    notes,
    `${marker}\n## .NET packages\n\n${packageList}\n\nPackages and symbols are NuGet-signed with the existing Key Vault certificate. The immutable ${assets[0]} and its .asc signature cover this publication batch. Source workflow commit: ${process.env.GITHUB_SHA ?? "unknown"}. Family tags retain their first publication commit.\n`,
  );
  releases.push({ tag, notes, marker, assets });
}

fs.writeFileSync(
  path.join(directory, "releases.json"),
  JSON.stringify(releases, null, 2),
);
