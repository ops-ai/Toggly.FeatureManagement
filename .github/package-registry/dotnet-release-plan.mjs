/** Resolve every selected package independently; only legacy server manifests support CI bumping. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  loadDotnetInventory,
  validateSources,
  selectPackages,
  repoRoot,
} from "./dotnet-inventory.mjs";

export async function createReleasePlan(
  packages,
  { releaseMode = "publish", bumpType = "patch", resolve } = {},
) {
  if (!["publish", "auto_bump"].includes(releaseMode)) {
    throw new Error("Unknown release mode");
  }

  const server = packages.find((pkg) => pkg.family === "server");
  if (releaseMode === "auto_bump" && !server) {
    throw new Error("Legacy auto_bump requires selected server packages");
  }

  // The legacy server uses one shared manifest; bump it once before resolving siblings.
  let legacy;
  if (releaseMode === "auto_bump") {
    legacy = await resolve(server, releaseMode, bumpType);
  }

  const planned = [];
  for (const pkg of packages) {
    const result =
      pkg === server && legacy
        ? legacy
        : await resolve(pkg, "publish", bumpType);
    if (!["publish", "skip"].includes(result.action)) {
      throw new Error(
        `Version validation failed for ${pkg.id}: ${result.reason}`,
      );
    }

    planned.push({ ...pkg, ...result });
  }

  return {
    packages: planned,
    manifestChanged: legacy?.manifest_changed === "true",
    serverManifest: server?.manifest,
    serverVersion: planned.find((pkg) => pkg.family === "server")?.version,
  };
}

/** Reuse the existing registry/version policy without leaking child outputs between packages. */
function resolvePackage(pkg, releaseMode, bumpType) {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "toggly-nuget-version-"),
  );
  const output = path.join(temporary, "outputs");
  fs.writeFileSync(output, "");
  try {
    execFileSync(
      process.execPath,
      [".github/actions/resolve-release-version/resolve.mjs"],
      {
        cwd: repoRoot,
        stdio: "inherit",
        env: {
          ...process.env,
          MANIFEST_PATH: pkg.manifest,
          MANIFEST_TYPE: pkg.manifest.endsWith(".props") ? "props" : "csproj",
          REGISTRY: "nuget",
          PACKAGE_NAME: pkg.id,
          RELEASE_MODE: releaseMode,
          BUMP_TYPE: bumpType,
          GITHUB_OUTPUT: output,
        },
      },
    );
    return Object.fromEntries(
      fs
        .readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const inventory = loadDotnetInventory();
  const selected = selectPackages(
    validateSources(inventory),
    process.env.PACKAGES ?? "all",
  );
  const plan = await createReleasePlan(selected, {
    releaseMode: process.env.RELEASE_MODE ?? "publish",
    bumpType: process.env.BUMP_TYPE ?? "patch",
    resolve: resolvePackage,
  });
  fs.mkdirSync("release-candidate/nupkgs", { recursive: true });
  fs.writeFileSync(
    "release-candidate/plan.json",
    JSON.stringify(plan, null, 2),
  );
  if (plan.manifestChanged) {
    fs.copyFileSync(
      plan.serverManifest,
      "release-candidate/Directory.Build.props",
    );
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `publish=${plan.packages.some((pkg) => pkg.action === "publish")}\n`,
    );
  }
}
