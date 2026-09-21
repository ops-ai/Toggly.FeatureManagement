const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { run } = require('./packed-process.cjs');
module.exports.packCore = async function packCore() {
  const temporary = mkdtempSync(join(tmpdir(), 'toggly-core-artifact-'));
  const core = resolve(__dirname, '../libs/core');
  try {
    await run('npm', ['run', 'build'], {cwd:core,capture:true});
    const output = await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], {cwd:core,capture:true});
    const archive = join(temporary, JSON.parse(output)[0].filename);
    return { archive, dispose: () => rmSync(temporary, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
};
