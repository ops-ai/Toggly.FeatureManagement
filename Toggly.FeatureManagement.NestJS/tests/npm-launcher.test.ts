import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
const script = fileURLToPath(new URL('./check-packed.mjs', import.meta.url));
function launch(npmCli: string) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    // No npm is available through PATH: failures must describe CLI validation,
    // and must happen before any package install or pack operation.
    env: { ...process.env, PATH: '', npm_execpath: npmCli },
  });
}
describe('packed consumer npm CLI validation', () => {
  it('rejects a relative npm CLI path before invoking a package manager', () => {
    const result = launch('npm-cli.js');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('npm CLI path must be absolute');
  });
  it('rejects a missing absolute npm CLI path explicitly', () => {
    const result = launch(join(tmpdir(), 'toggly-does-not-exist', 'npm-cli.js'));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('npm CLI is unavailable');
  });
  it('rejects a directory supplied as the npm CLI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'toggly-npm-directory-'));
    try {
      const result = launch(dir);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('npm CLI must be an npm-cli.js file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('rejects a JavaScript file outside the npm package', () => {
    const dir = mkdtempSync(join(tmpdir(), 'toggly-npm-package-'));
    try {
      mkdirSync(join(dir, 'bin'));
      const cli = join(dir, 'bin', 'npm-cli.js');
      writeFileSync(cli, 'throw new Error("untrusted CLI executed")');
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'not-npm', bin: { npm: 'bin/npm-cli.js' } }),
      );
      const result = launch(cli);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('npm CLI does not match the npm package executable');
      expect(result.stderr).not.toContain('untrusted CLI executed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
