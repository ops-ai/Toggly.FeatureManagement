import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const script = path.join(root, 'scripts/build-compatible-package.mjs');
for (const npmCli of [undefined, 'relative/npm-cli.js']) {
  test(`rejects an untrusted npm executable path: ${npmCli}`, () => {
    const env = { ...process.env, PATH: '/nonexistent', npm_execpath: npmCli };
    if (npmCli === undefined) delete env.npm_execpath;
    const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /npm_execpath must be an absolute path/);
  });
}

test('builds the published Angular 15 declaration ABI and cleans its staging directory', () => {
  const result = spawnSync(process.execPath, [script], { env: process.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const manifest = JSON.parse(fs.readFileSync('dist/ngx-feature-flags-toggly/package.json', 'utf8'));
  assert.equal(manifest.peerDependencies['@angular/core'], '>=15.0.0');
  assert.equal(manifest.dependencies['@ops-ai/toggly-signed-defs'], '^1.2.6');
  const declaration = fs.readFileSync('dist/ngx-feature-flags-toggly/lib/feature.component.d.ts', 'utf8');
  assert.match(declaration, /ɵɵComponentDeclaration/);
  assert.doesNotMatch(declaration, /isSignal|isRequired/);
  assert.equal(fs.existsSync('packaging/.build'), false);
});
