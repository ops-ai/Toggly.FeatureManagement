/** Check the packed package graph, not only the version used by the release planner. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function readCommonVersion(manifest) {
  const version = fs
    .readFileSync(manifest, "utf8")
    .match(/<Version>([^<]+)<\/Version>/)?.[1];
  if (!version) {
    throw new Error(`Missing common version in ${manifest}`);
  }
  return version;
}

export function verifyPackageVersions(packages, packDir, version) {
  const internalIds = new Set(
    packages.flatMap((pkg) => [pkg.id, ...pkg.dependencies]),
  );
  for (const pkg of packages) {
    const artifact = path.join(packDir, `${pkg.id}.${version}.nupkg`);
    if (!fs.existsSync(artifact)) {
      throw new Error(`Missing ${pkg.id} package at common version ${version}`);
    }
    const manifest = execFileSync("unzip", ["-p", artifact, "*.nuspec"], {
      encoding: "utf8",
    });
    if (
      !manifest.includes(`<id>${pkg.id}</id>`) ||
      !manifest.includes(`<version>${version}</version>`)
    ) {
      throw new Error(`${pkg.id} packed version must be ${version}`);
    }
    const found = new Set();
    for (const match of manifest.matchAll(
      /<dependency\s+id="([^"]+)"\s+version="([^"]+)"/g,
    )) {
      const [, id, dependencyVersion] = match;
      if (!internalIds.has(id)) {
        continue;
      }
      found.add(id);
      // NuGet emits a bare minimum for ProjectReferences; accept its equivalent explicit range.
      if (![version, `[${version}, )`].includes(dependencyVersion)) {
        throw new Error(
          `${pkg.id} dependency ${id} must use common version ${version}, received ${dependencyVersion}`,
        );
      }
    }
    for (const dependency of pkg.dependencies) {
      if (!found.has(dependency)) {
        throw new Error(`Missing dependency ${dependency} in ${pkg.id}`);
      }
    }
  }
}
