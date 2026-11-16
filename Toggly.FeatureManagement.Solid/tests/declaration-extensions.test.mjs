import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function emittedFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...emittedFiles(path));
    else if (/\.(d\.ts|js|jsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

test('emitted ESM keeps .js on every relative import', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'solid-dts-'));
  try {
    const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
    const result = spawnSync(
      process.execPath,
      [tsc, '-p', 'tsconfig.json', '--outDir', outDir, '--pretty', 'false', '--noEmitOnError'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const offenders = [];
    for (const file of emittedFiles(outDir)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/from '(\.[^']+)'/g)) {
        if (!match[1].endsWith('.js')) offenders.push(`${file}: ${match[1]}`);
      }
    }
    assert.deepEqual(offenders, []);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
