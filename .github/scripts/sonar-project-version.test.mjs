import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applySonarVersionSuffix, resolveSonarProjectVersion } from './sonar-project-version.mjs';

test('empty suffix applies +baseline cutover', () => {
  assert.equal(applySonarVersionSuffix('1.2.3', ''), '1.2.3+baseline');
  assert.equal(applySonarVersionSuffix('1.2.3', undefined), '1.2.3+baseline');
});

test('none suffix sends the package version unchanged', () => {
  assert.equal(applySonarVersionSuffix('1.2.3', 'none'), '1.2.3');
  assert.equal(applySonarVersionSuffix('1.2.3', '-'), '1.2.3');
  assert.equal(applySonarVersionSuffix('1.2.3', 'off'), '1.2.3');
});

test('custom suffix is appended', () => {
  assert.equal(applySonarVersionSuffix('1.2.3', '+cutover'), '1.2.3+cutover');
  assert.equal(applySonarVersionSuffix('1.2.3', 'rc1'), '1.2.3+rc1');
});

test('reads npm package.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sonar-ver-'));
  const manifest = join(dir, 'package.json');
  writeFileSync(manifest, JSON.stringify({ name: 'x', version: '9.8.7' }));
  try {
    const result = resolveSonarProjectVersion({ manifestPath: manifest, suffixEnv: 'none' });
    assert.equal(result.packageVersion, '9.8.7');
    assert.equal(result.version, '9.8.7');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reads pom project version outside parent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sonar-ver-'));
  const manifest = join(dir, 'pom.xml');
  writeFileSync(manifest, `
    <project>
      <parent><version>1.0.0</version></parent>
      <artifactId>toggly-parent</artifactId>
      <version>2.2.0</version>
    </project>
  `);
  try {
    const result = resolveSonarProjectVersion({ manifestPath: manifest, suffixEnv: '' });
    assert.equal(result.version, '2.2.0+baseline');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
