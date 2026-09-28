const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const packageDirectory = path.resolve(__dirname, '..');
const packageName = JSON.parse(readFileSync(path.join(packageDirectory, 'package.json'), 'utf8')).name;
const consumerDirectory = mkdtempSync(path.join(os.tmpdir(), 'toggly-ga4-hook-consumer-'));
let tarballPath;

try {
  const packOutput = execFileSync('npm', ['pack', '--json', '--ignore-scripts'], {
    cwd: packageDirectory,
    encoding: 'utf8',
  });
  tarballPath = path.join(packageDirectory, JSON.parse(packOutput)[0].filename);

  writeFileSync(path.join(consumerDirectory, 'package.json'), JSON.stringify({
    private: true,
    name: 'toggly-ga4-hook-packed-consumer',
  }));
  execFileSync('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    tarballPath,
  ], {
    cwd: consumerDirectory,
    stdio: 'inherit',
  });

  const { GA4Hook } = require(path.join(consumerDirectory, 'node_modules', packageName));
  const calls = [];
  globalThis.gtag = (...args) => calls.push(args);

  new GA4Hook().afterEvaluation('packed-consumer-flag', undefined, true);

  assert.deepEqual(calls, [[
    'event',
    'feature_flag_evaluated',
    {
      feature_key: 'packed-consumer-flag',
      feature_enabled: true,
      event_category: 'toggly',
    },
  ]]);
} finally {
  delete globalThis.gtag;
  rmSync(consumerDirectory, { recursive: true, force: true });
  if (tarballPath) {
    rmSync(tarballPath, { force: true });
  }
}
