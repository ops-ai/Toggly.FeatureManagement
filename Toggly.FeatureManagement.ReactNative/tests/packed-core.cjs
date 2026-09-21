const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

// A storage companion's packed host must exercise the checkout's freshly built
// Core, even before that Core version is published to the registry.
module.exports.packCore = function packCore() {
  const temporary = mkdtempSync(join(tmpdir(), 'toggly-core-artifact-'));
  const core = resolve(__dirname, '../libs/core');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    execFileSync(npm, ['run', 'build'], { cwd: core, stdio: 'pipe' });
    const output = execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: core, encoding: 'utf8' });
    const archive = join(temporary, JSON.parse(output)[0].filename);
    return { archive, dispose: () => rmSync(temporary, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
};
