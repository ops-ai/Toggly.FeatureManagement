import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Run the real package coverage configuration against a controlled source tree. */
export function verifyCoverageAccounting(packageRoot: string, extension: 'ts' | 'tsx'): void {
  const fixture = mkdtempSync(join(tmpdir(), 'toggly-coverage-accounting-'));
  try {
    mkdirSync(join(fixture, 'src/nested'), { recursive: true });
    symlinkSync(join(packageRoot, 'node_modules'), join(fixture, 'node_modules'), 'dir');
    writeFileSync(join(fixture, 'src/visible.ts'), 'export const visible = () => 42;\n');
    writeFileSync(join(fixture, `src/nested/unimported.${extension}`), [
      'export function unimported() {',
      '  const first = 1;',
      '  const second = 2;',
      '  return first + second;',
      '}',
      '',
    ].join('\n'));
    writeFileSync(join(fixture, 'src/visible.test.ts'), [
      "import { expect, test } from 'vitest';",
      "import { visible } from './visible';",
      "test('executes the visible source', () => expect(visible()).toBe(42));",
    ].join('\n'));
    writeFileSync(join(fixture, 'src/types.d.ts'), 'export interface Types { value: string }\n');
    writeFileSync(join(fixture, 'smoke.mjs'), 'export const smokeHarness = () => 42;\n');
    const setup = join(packageRoot, 'src/test-setup.ts');
    if (existsSync(setup)) copyFileSync(setup, join(fixture, 'src/test-setup.ts'));

    const result = spawnSync(process.execPath, [
      join(packageRoot, 'node_modules/vitest/vitest.mjs'), 'run',
      '--config', join(packageRoot, 'vitest.config.ts'), '--root', fixture,
      '--coverage', '--pool=forks', '--maxWorkers=1', '--minWorkers=1',
    ], { cwd: fixture, encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    const report = readFileSync(join(fixture, 'coverage/lcov.info'), 'utf8');
    const records = report.split('end_of_record').filter(record => record.includes('SF:'));
    assert.equal(records.length, 2, 'only the two executable source modules belong in the denominator');
    const unimported = records.find(record => record.includes(`SF:src/nested/unimported.${extension}\n`));
    assert.ok(unimported, 'unimported executable source must contribute coverage records');
    const hits = [...unimported.matchAll(/^DA:\d+,(\d+)/gm)].map(match => Number(match[1]));
    assert.ok(hits.length >= 3, 'the uncovered function body must contribute executable lines');
    assert.ok(hits.every(hit => hit === 0), 'unimported source must count as uncovered');
    assert.equal(result.status, 1, 'below-floor full-source coverage must reject the run');
    const rejectedFloor = (result.stdout + result.stderr).match(/Coverage for lines .* does not meet global threshold \((\d+(?:\.\d+)?)%\)/);
    assert.ok(rejectedFloor, 'the failure must come from the package line floor');
    assert.ok(Number(rejectedFloor[1]) > 80, 'the package line floor must exceed 80%');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}
