import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  loadDotnetInventory,
  validateSources,
  repoRoot,
} from "./dotnet-inventory.mjs";

// These evaluations need the SDK, but do not restore packages or build runtime code.
// The shared analysis pack job enables them; Node-only governance jobs stay portable.
test(
  "all evaluated MSBuild package versions follow an isolated common-version change",
  {
    skip: process.env.DOTNET_VERSION_CHECK !== "1",
  },
  (t) => {
    const inventory = loadDotnetInventory();
    const packages = validateSources(inventory);
    const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "dotnet-common-version-"),
    );
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    for (const relative of new Set(
      packages.flatMap((pkg) => [
        pkg.projectPath,
        pkg.manifest,
        `${pkg.sdkRoot}/Directory.Build.props`,
      ]),
    )) {
      const destination = path.join(temporary, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(repoRoot, relative), destination);
    }
    const common = path.join(temporary, packages[0].manifest);
    const original = fs.readFileSync(common, "utf8");
    const version = original.match(/<Version>([^<]+)<\/Version>/)[1];
    for (const expected of [version, "9.8.7"]) {
      fs.writeFileSync(
        common,
        original.replace(
          `<Version>${version}</Version>`,
          `<Version>${expected}</Version>`,
        ),
      );
      for (const pkg of packages) {
        const output = execFileSync(
          process.env.DOTNET_COMMAND ?? "dotnet",
          [
            "msbuild",
            path.join(temporary, pkg.projectPath),
            "-getProperty:Version,PackageVersion",
            "-nologo",
          ],
          { encoding: "utf8" },
        );
        const properties = JSON.parse(output).Properties;
        assert.equal(properties.Version, expected, pkg.id);
        assert.equal(properties.PackageVersion, expected, pkg.id);
      }
    }
  },
);

import { verifyPackageVersions } from "./dotnet-version.mjs";

test("packed versions and internal dependency constraints must match the shared manifest", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "dotnet-packed-version-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const packages = [
    { id: "Client", dependencies: [] },
    { id: "Blazor", dependencies: ["Client"] },
  ];
  const writePackage = (id, version, dependency) => {
    const name = `${id}.3.7.0.nupkg`;
    const artifact = path.join(directory, name);
    fs.rmSync(artifact, { force: true });
    fs.writeFileSync(
      path.join(directory, `${id}.nuspec`),
      `<package><metadata><id>${id}</id><version>${version}</version><dependencies><group>${dependency ?? ""}</group></dependencies></metadata></package>`,
    );
    execFileSync("zip", ["-q", name, `${id}.nuspec`], { cwd: directory });
  };
  writePackage("Client", "3.7.0");
  writePackage("Blazor", "0.1.0", '<dependency id="Client" version="3.7.0" />');
  assert.throws(
    () => verifyPackageVersions(packages, directory, "3.7.0"),
    /Blazor.*version/,
  );
  writePackage("Blazor", "3.7.0", '<dependency id="Client" version="0.1.0" />');
  assert.throws(
    () => verifyPackageVersions(packages, directory, "3.7.0"),
    /Blazor.*Client/,
  );
  writePackage("Blazor", "3.7.0");
  assert.throws(
    () => verifyPackageVersions(packages, directory, "3.7.0"),
    /Missing dependency Client/,
  );
  writePackage("Blazor", "3.7.0", '<dependency id="Client" version="3.7.0" />');
  assert.doesNotThrow(() =>
    verifyPackageVersions(packages, directory, "3.7.0"),
  );
});
