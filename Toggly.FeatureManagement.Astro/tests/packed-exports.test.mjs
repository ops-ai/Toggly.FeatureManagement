import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import semver from 'semver';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run with npm run test:package');
const [artifact] = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--dry-run', '--json'], { encoding: 'utf8' }));
const files = new Set(artifact.files.map(({ path }) => `./${path}`));
for (const [name, entry] of Object.entries(manifest.exports)) {
  test(`packed export ${name} includes its implementation and public types`, () => {
    for (const target of typeof entry === 'string' ? [entry] : Object.values(entry)) {
      assert.ok(files.has(target), `Missing ${target} in npm artifact`);
    }
  });
}
for (const version of ['5.0.0', '5.18.2', '6.0.0', '6.4.8', '7.0.0', '7.3.2']) {
  test(`Astro ${version} can install the packed peer contract`, () => {
    assert.ok(semver.satisfies(version, manifest.peerDependencies.astro));
  });
}
for (const version of ['1.0.0', '1.1.0', '2.0.1']) {
  test(`Nano Stores React ${version} can install the packed peer contract`, () => {
    assert.ok(semver.satisfies(version, manifest.peerDependencies['@nanostores/react']));
  });
}
