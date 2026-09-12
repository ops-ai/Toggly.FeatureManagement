/** Shared commands keep every declared .NET family inside the same analysis and release workflows. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  families,
  loadDotnetInventory,
  validateSources,
  orderPackages,
  repoRoot,
} from "./dotnet-inventory.mjs";
import { verifyPackedNupkgs } from "./verify-nuget-metadata.mjs";
const inventory = loadDotnetInventory();
const packages = validateSources(inventory);
const command = process.argv[2];
const plan = process.argv[3]
  ? JSON.parse(fs.readFileSync(process.argv[3], "utf8"))
  : null;
const selected = plan
  ? plan.packages.filter((pkg) => pkg.action === "publish")
  : orderPackages(packages);
const selectedFamilies = families(inventory).filter((family) =>
  selected.some((pkg) => pkg.family === family.name),
);
const run = (binary, args) =>
  execFileSync(binary, args, { cwd: repoRoot, stdio: "inherit" });
if (command === "validate") {
  console.log(`Validated ${packages.length} NuGet projects.`);
} else if (command === "summary") {
  console.log(`### Packages Analyzed (${packages.length})\n`);
  for (const family of families(inventory)) {
    console.log(`#### ${family.name}\n`);
    for (const pkg of packages.filter((item) => item.family === family.name)) {
      console.log(`- ${pkg.id}`);
    }
    console.log();
  }
} else if (command === "source-inclusions") {
  console.log(
    families(inventory)
      .map((family) => `${family.sdkRoot}/**`)
      .join(","),
  );
} else if (command === "scan-args") {
  console.log(
    families(inventory)
      .map((family) => `--scan /github/workspace/${family.sdkRoot}`)
      .join(" "),
  );
} else if (command === "test" || command === "test-families") {
  for (const family of selectedFamilies) {
    if (family.name === "server") {
      if (command === "test") {
        run("dotnet", [
          "test",
          `${family.sdkRoot}/Toggly.FeatureManagement.sln`,
          "-c",
          "Release",
        ]);
      }
      continue;
    }

    if (
      !family.testProject ||
      !family.coverageSettings ||
      !family.coverageCheck
    ) {
      throw new Error(`Missing test contract for ${family.name}`);
    }

    const results = `TestResults/${family.name}`;
    run("dotnet", [
      "test",
      family.testProject,
      "-c",
      "Release",
      "--collect:XPlat Code Coverage",
      "--settings",
      family.coverageSettings,
      "--results-directory",
      results,
    ]);
    run("python3", [family.coverageCheck, results]);
    if (family.browserTests) {
      run("bash", [family.browserTests]);
    }
  }
} else if (command === "build-families") {
  for (const pkg of packages.filter((pkg) => pkg.family !== "server")) {
    run("dotnet", [
      "build",
      pkg.projectPath,
      "-c",
      "Release",
      "--no-incremental",
    ]);
  }
} else if (command === "verify-pack") {
  const output = path.resolve(
    plan ? "release-candidate/nupkgs" : "nuget-analysis-pack",
  );
  const result = verifyPackedNupkgs({
    inventory: { ...inventory, packages: selected },
    packDir: output,
  });
  if (!result.ok) {
    throw new Error(result.errors.join("\n"));
  }

  const artifacts = fs.readdirSync(output);
  for (const pkg of selected) {
    if (
      !artifacts.some(
        (file) => file.startsWith(`${pkg.id}.`) && file.endsWith(".snupkg"),
      )
    ) {
      throw new Error(`Missing symbols for ${pkg.id}`);
    }
  }
} else if (command === "pack") {
  const output = path.resolve(
    plan ? "release-candidate/nupkgs" : "nuget-analysis-pack",
  );
  fs.mkdirSync(output, { recursive: true });
  for (const pkg of selected) {
    run("dotnet", [
      "build",
      pkg.projectPath,
      "-c",
      "Release",
      "-p:GeneratePackageOnBuild=false",
      "-p:ContinuousIntegrationBuild=true",
    ]);
    run("dotnet", [
      "pack",
      pkg.projectPath,
      "-c",
      "Release",
      "--no-build",
      "-p:ContinuousIntegrationBuild=true",
      "-o",
      output,
    ]);
  }
} else {
  throw new Error(`Unknown .NET CI command: ${command}`);
}
