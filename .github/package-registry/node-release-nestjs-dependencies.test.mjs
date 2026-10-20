import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = fileURLToPath(
  new URL("../../Toggly.FeatureManagement.NestJS/", import.meta.url),
);
const workflow = readFileSync(
  new URL("../workflows/sdk-nestjs-release.yml", import.meta.url),
  "utf8",
);

test(
  "NestJS publisher builds declarations from public dependencies without sibling build outputs",
  { timeout: 180_000 },
  () => {
    const publish = workflow.slice(workflow.indexOf("\n  publish:"));
    const command = publish.match(/^      - run: (npm ci[^\n]*)$/m)?.[1];
    assert.ok(command, "expected the real publisher dependency/build command");
    const temporary = mkdtempSync(
      join(tmpdir(), "nestjs-publisher-dependencies-"),
    );
    const isolatedPackage = join(temporary, "nestjs");

    try {
      // Copy only build inputs, so a workspace symlink cannot borrow stale dist
      // files from a sibling. Execute the publisher command, not a test substitute.
      for (const entry of [
        "package.json",
        "package-lock.json",
        "src",
        "tsconfig.json",
        "tsup.config.ts",
      ]) {
        cpSync(join(packageRoot, entry), join(isolatedPackage, entry), {
          recursive: true,
        });
      }
      const result = spawnSync(
        "bash",
        ["-e", "-o", "pipefail", "-c", command],
        {
          cwd: isolatedPackage,
          env: {
            ...process.env,
            PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
            npm_config_registry: "https://registry.npmjs.org",
          },
          encoding: "utf8",
          timeout: 150_000,
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      assert.ifError(result.error);
      assert.equal(
        result.status,
        0,
        `clean publisher failed:\n${result.stdout}\n${result.stderr}`,
      );

      const segments = join(
        isolatedPackage,
        "node_modules/@ops-ai/toggly-segments",
      );
      assert.equal(
        lstatSync(segments).isSymbolicLink(),
        false,
        "publisher must install the public artifact",
      );
      const lock = JSON.parse(
        readFileSync(join(isolatedPackage, "package-lock.json"), "utf8"),
      );
      const dependency = lock.packages["node_modules/@ops-ai/toggly-segments"];
      assert.match(
        dependency.resolved,
        /^https:\/\/registry\.npmjs\.org\/@ops-ai\/toggly-segments\/-\/toggly-segments-[\d.]+\.tgz$/,
      );
      assert.match(dependency.integrity, /^sha512-/);
      const manifest = JSON.parse(
        readFileSync(join(isolatedPackage, "package.json"), "utf8"),
      );
      for (const format of ["import", "require"]) {
        const entry = manifest.exports["."][format];
        for (const artifact of [entry.default, entry.types]) {
          assert.ok(
            statSync(join(isolatedPackage, artifact)).size > 0,
            `publisher must emit ${artifact}`,
          );
        }
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  },
);
