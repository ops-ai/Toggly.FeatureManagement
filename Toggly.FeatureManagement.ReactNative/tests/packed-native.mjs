import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './packed-process.cjs';

const family = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hosts = [
  { name: 'rn70-peer-floor', fixture: 'packed-native-floor', reactNative: '0.70.15' },
  { name: 'rn88-current', fixture: 'packed-native', reactNative: '0.88.1' },
];
const selected = process.env.HOST
  ? hosts.filter(host => host.name === process.env.HOST)
  : hosts;
if (process.env.HOST && selected.length === 0) {
  throw new Error(`Unknown HOST=${process.env.HOST}; expected one of ${hosts.map(host => host.name).join(', ')}`);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function runHost(host) {
  const fixture = join(family, 'tests/fixtures', host.fixture);
  const temp = await mkdtemp(join(tmpdir(), `toggly-${host.name}-`));
  const env = { ...process.env, npm_config_cache: join(temp, 'npm-cache') };
  const execute = (command, args, cwd = temp, capture = false) => run(command, args, { cwd, capture, env });
  try {
    if (process.env.TOGGLY_SHARED_ARTIFACTS) throw new Error('Packed acceptance requires public registry dependencies');
    console.log(`Owned native host ${host.name} (RN ${host.reactNative}): ${temp}`);
    await execute(process.execPath, ['--test', join(family, 'tests/packed-process.test.mjs')]);
    await cp(fixture, temp, { recursive: true });
    for (const [name, archive] of [['core', 'core.tgz'], ['react-native', 'adapter.tgz']]) {
      const cwd = join(family, 'libs', name);
      await execute(npm, ['run', 'build'], cwd);
      const packed = JSON.parse(await execute(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], cwd, true));
      await cp(join(temp, packed[0].filename), join(temp, archive));
      const digest = createHash('sha256').update(await readFile(join(temp, archive))).digest('hex');
      console.log(`${host.name} ${name} archive SHA256 ${digest}`);
    }
    if (process.env.TOGGLY_UPDATE_PACKED_LOCK === '1') {
      await execute(npm, ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', './core.tgz', './adapter.tgz']);
      for (const file of ['package.json', 'package-lock.json']) await cp(join(temp, file), join(fixture, file));
      console.log(`Genuine npm packed fixture lock generated for ${host.name}; no host acceptance claimed.`);
      return;
    }
    const lock = JSON.parse(await readFile(join(temp, 'package-lock.json'), 'utf8'));
    for (const [name, archive] of [['react-native-toggly-core', 'core.tgz'], ['react-native-toggly', 'adapter.tgz']]) {
      const integrity = 'sha512-' + createHash('sha512').update(await readFile(join(temp, archive))).digest('base64');
      if (lock.packages[`node_modules/@ops-ai/${name}`].integrity !== integrity) {
        throw new Error(`Packed ${name} changed for ${host.name}: regenerate its genuine npm fixture lock`);
      }
    }
    await execute(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    await execute(npm, ['ls', '--all']);
    const reporter = JSON.parse(await readFile(join(temp, 'node_modules/@ops-ai/toggly-client-telemetry/package.json'), 'utf8'));
    const provenance = lock.packages['node_modules/@ops-ai/toggly-client-telemetry'];
    const coreManifest = JSON.parse(await readFile(join(temp, 'node_modules/@ops-ai/react-native-toggly-core/package.json'), 'utf8'));
    const reporterRange = coreManifest.dependencies['@ops-ai/toggly-client-telemetry'];
    const range = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(reporterRange || '');
    const actual = /^(\d+)\.(\d+)\.(\d+)$/.exec(reporter.version || '');
    if (!range || !actual || Number(actual[1]) !== Number(range[1])
      || Number(actual[2]) < Number(range[2])
      || (Number(actual[2]) === Number(range[2]) && Number(actual[3]) < Number(range[3]))
      || !provenance.resolved.startsWith('https://registry.npmjs.org/')) {
      throw new Error(`Expected genuine public reporter satisfying ${reporterRange}, got ${reporter.version}`);
    }
    const installedRn = JSON.parse(await readFile(join(temp, 'node_modules/react-native/package.json'), 'utf8'));
    if (installedRn.version !== host.reactNative) {
      throw new Error(`Expected react-native ${host.reactNative} for ${host.name}, got ${installedRn.version}`);
    }
    console.log(`Public reporter ${reporter.version}, ${provenance.resolved}, ${provenance.integrity}; RN ${installedRn.version}`);
    // skipLibCheck: RN 0.70 floor uses @types/react 18.0.x which still imports
    // removed scheduler/tracing under TypeScript 5.9; consumer API types still checked.
    await execute(join(temp, 'node_modules/.bin/tsc'), ['--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2020', '--module', 'Node16', '--moduleResolution', 'Node16', '--lib', 'ES2020', '--esModuleInterop', 'consumer.ts']);
    await execute(process.execPath, ['verify.cjs']);
    await execute(process.execPath, ['build.cjs']);
  } finally {
    await rm(temp, { recursive: true, force: true });
    console.log(`Removed native host ${host.name}: ${temp}`);
  }
}

for (const host of selected) {
  await runHost(host);
}
