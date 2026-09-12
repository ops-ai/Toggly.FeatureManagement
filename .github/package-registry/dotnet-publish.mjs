/** Publish signed, prebuilt artifacts in dependency order; never rebuild inside the credentialed job. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifySignedCandidate } from "./dotnet-signed-candidate.mjs";
import { orderPackages } from "./dotnet-inventory.mjs";

export async function publishPackages(plan, directory, push) {
  const artifacts = [];
  for (const pkg of orderPackages(plan.packages).filter(
    (item) => item.action === "publish",
  )) {
    if (
      !/^[A-Za-z0-9_.-]+$/.test(pkg.id) ||
      !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(pkg.version)
    ) {
      throw new Error("Invalid package identity in release plan");
    }

    for (const extension of ["nupkg", "snupkg"]) {
      const artifact = path.join(
        directory,
        "nupkgs",
        `${pkg.id}.${pkg.version}.${extension}`,
      );
      if (!fs.existsSync(artifact)) {
        throw new Error(`Missing signed artifact: ${artifact}`);
      }

      artifacts.push(artifact);
    }
  }
  // Validate the complete artifact set and its frozen signing-job checksums before any push.
  verifySignedCandidate(directory);
  for (const artifact of artifacts) {
    await push(artifact);
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const directory = path.resolve(process.argv[2] ?? "release-candidate");
  const plan = JSON.parse(
    fs.readFileSync(path.join(directory, "plan.json"), "utf8"),
  );
  if (!process.env.NUGET_API_KEY) {
    throw new Error("NuGet OIDC login did not return a token");
  }
  await publishPackages(plan, directory, (artifact) => {
    try {
      execFileSync(
        "dotnet",
        [
          "nuget",
          "push",
          artifact,
          "--api-key",
          process.env.NUGET_API_KEY,
          "--source",
          "https://api.nuget.org/v3/index.json",
          "--skip-duplicate",
        ],
        { stdio: "inherit" },
      );
    } catch {
      // child_process errors include command arguments; never print the ephemeral OIDC token.
      throw new Error(
        `NuGet publication failed for ${path.basename(artifact)}`,
      );
    }
  });
}
