import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = fs.readFileSync(
  path.join(repositoryRoot, ".github/workflows/analysis-dotnet.yml"),
  "utf8",
);

test(".NET analysis scans and covers the CLI executable", () => {
  const sourceInclusion = /sonar\.inclusions=.*Toggly\.CLI\/\*\*/g;

  assert.equal([...workflow.matchAll(sourceInclusion)].length, 2);
  assert.match(
    workflow,
    /dotnet test Toggly\.CLI\.Tests\/Toggly\.CLI\.Tests\.csproj[\s\S]*--collect:"XPlat Code Coverage"/,
  );
  assert.match(
    workflow,
    /Build every additional \.NET family inside the server scanner[\s\S]*dotnet build Toggly\.CLI\.Tests\/Toggly\.CLI\.Tests\.csproj -c Release/,
  );
  assert.match(
    workflow,
    /name: Verify \.NET analysis workflow contract\s+run: node --test \.github\/workflows\/analysis-dotnet\.test\.mjs/,
  );
});
