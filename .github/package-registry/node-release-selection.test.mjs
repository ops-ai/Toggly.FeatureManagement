import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const workspace = path.join(repository, "Toggly.FeatureManagement.Node");
const workflow = fs.readFileSync(
  path.join(repository, ".github/workflows/sdk-node-server-release.yml"),
  "utf8",
);
const selectionScript = path.join(
  repository,
  ".github/package-registry/node-release-selection.mjs",
);
const packages = fs
  .readdirSync(workspace)
  .filter((name) => name.startsWith("toggly-"));

function execute(selection, failPackage) {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "node-release-tests-"),
  );
  const output = path.join(temporary, "executed.jsonl");
  try {
    fs.copyFileSync(
      path.join(workspace, "pnpm-workspace.yaml"),
      path.join(temporary, "pnpm-workspace.yaml"),
    );
    fs.writeFileSync(
      path.join(temporary, "package.json"),
      JSON.stringify({ private: true }),
    );
    for (const directory of packages) {
      const original = JSON.parse(
        fs.readFileSync(
          path.join(workspace, directory, "package.json"),
          "utf8",
        ),
      );
      const target = path.join(temporary, directory);
      fs.mkdirSync(target);
      // Real pnpm computes the same workspace dependency graph. Fixture suites
      // record execution without invoking registry-dependent adapter consumers.
      const manifest = {
        name: original.name,
        version: original.version,
        scripts: { test: "node suite.mjs" },
      };
      for (const field of [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
      ]) {
        manifest[field] = Object.fromEntries(
          Object.entries(original[field] ?? {}).filter(([, version]) =>
            version.startsWith("workspace:"),
          ),
        );
      }
      fs.writeFileSync(
        path.join(target, "package.json"),
        JSON.stringify(manifest),
      );
      fs.writeFileSync(
        path.join(target, "suite.mjs"),
        `import fs from 'node:fs';\nfs.appendFileSync(process.env.EXECUTED, JSON.stringify(${JSON.stringify(original.name)})+'\\n');\nif(process.env.FAIL_PACKAGE===${JSON.stringify(original.name)}) process.exit(7);\n`,
      );
    }
    const result = spawnSync(
      "node",
      [selectionScript, "test"],
      {
        cwd: temporary,
        env: {
          ...process.env,
          GITHUB_WORKSPACE: repository,
          RELEASE_PACKAGES: selection,
          EXECUTED: output,
          FAIL_PACKAGE: failPackage ?? "",
        },
        encoding: "utf8",
      },
    );
    assert.ifError(result.error);
    const executed = fs.existsSync(output)
      ? fs.readFileSync(output, "utf8").trim().split("\n").map(JSON.parse)
      : [];
    return { ...result, executed };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

for (const [selection, expected] of [
  ["core", ["toggly-node-core"]],
  ["hono", ["toggly-node-core", "toggly-hono"]],
  ["express,koa", ["toggly-node-core", "toggly-express", "toggly-koa"]],
  ["core,hono,core", ["toggly-node-core", "toggly-hono"]],
  ["all", packages],
]) {
  test(`release ${selection} executes complete selected suites and workspace dependencies`, () => {
    const result = execute(selection);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.deepEqual(
      [...result.executed].sort(),
      expected.map((name) => `@ops-ai/${name}`).sort(),
    );
    if (expected.length > 1)
      assert.equal(result.executed[0], "@ops-ai/toggly-node-core");
  });
}
for (const selection of [
  "",
  "unknown",
  "core,unknown",
  "all,core",
  "core,",
  "core;echo injected",
]) {
  test(`invalid release selection ${JSON.stringify(selection)} fails before any suite runs`, () => {
    const result = execute(selection);
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.executed, []);
  });
}
test("selected suite failures fail the release command", () => {
  const result = execute("hono", "@ops-ai/toggly-hono");
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.executed, [
    "@ops-ai/toggly-node-core",
    "@ops-ai/toggly-hono",
  ]);
});
test("release workflow uses analysis gates and retains Node publish matrix", () => {
  assert.match(
    workflow,
    /uses: \.\/\.github\/workflows\/analysis-javascript\.yml/,
  );
  assert.match(workflow, /sdks: node-server/);
  assert.match(
    workflow,
    /RELEASE_PACKAGES: \$\{\{ github\.event\.inputs\.packages \|\| 'all' \}\}/,
  );
  assert.match(workflow, /name: Build all packages\n\s+run: pnpm -r build/);
  const analysis = fs.readFileSync(
    path.join(repository, ".github/workflows/analysis-javascript.yml"),
    "utf8",
  );
  assert.match(analysis, /node-version: \['18\.x', '20\.x', '22\.x'\]/);
});
