// Four boundaries: one packed SDK, public registry dependencies, actual npm ci,
// and a temporary real SolidStart host with independent resource ownership.
import assert from 'node:assert/strict';
import { resolveNpmCli } from './npm-cli.mjs';
import { withResources, runOwned } from './owned-resources.mjs';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('..', import.meta.url));
const npm = resolveNpmCli();
for (const key of [
  'TOGGLY_NODE_CORE_TARBALL',
  'TOGGLY_SIGNED_DEFS_TARBALL',
  'TOGGLY_CLIENT_TELEMETRY_TARBALL',
])
  assert.equal(process.env[key], undefined, 'Shared dependencies must resolve from public npm');
await withResources(async (own) => {
  const work = await mkdtemp(join(tmpdir(), 'solidstart-registry-'));
  own(() => rm(work, { recursive: true, force: true }));
  console.log('Owned SolidStart host', work, 'Node', process.version);
  const run = (args, cwd = work) =>
    runOwned(process.execPath, args, { cwd, env: process.env, stdio: 'inherit' });
  await cp(join(root, 'tests/host'), join(work, 'host'), {
    recursive: true,
    filter: (path) =>
      !['node_modules', '.output', '.solid', '.vinxi', 'dist', 'package-lock.json'].includes(
        path.split('/').at(-1),
      ),
  });
  for (const file of ['npm-cli.mjs', 'owned-resources.mjs', 'owned-resources.test.mjs'])
    await cp(join(root, 'tests', file), join(work, file));
  await cp(join(root, 'tests/fixtures'), join(work, 'fixtures'), { recursive: true });
  await run(['--test', join(work, 'owned-resources.test.mjs')]);
  await run([npm, 'pack', '--pack-destination', work], root);
  const pkg = JSON.parse(await readFile(join(root, 'package.json')));
  const archive = join(work, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`);
  const bytes = await readFile(archive);
  const hash = createHash('sha256').update(bytes).digest('hex');
  console.log('Candidate archive SHA256', hash);
  const host = join(work, 'host');
  const manifest = JSON.parse(await readFile(join(host, 'package.json')));
  manifest.dependencies[pkg.name] = `file:../${archive.split('/').at(-1)}`;
  await writeFile(join(host, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  // Install the consumer graph at the common parent of host and fixture support.
  await writeFile(
    join(work, 'package.json'),
    JSON.stringify(
      {
        ...manifest,
        dependencies: {
          ...manifest.dependencies,
          [pkg.name]: `file:./${archive.split('/').at(-1)}`,
        },
      },
      null,
      2,
    ) + '\n',
  );
  await run([npm, 'install', '--no-audit', '--no-fund', '--engine-strict']);
  await run([npm, 'ci', '--no-audit', '--no-fund', '--engine-strict']);
  const lock = JSON.parse(await readFile(join(work, 'package-lock.json')));
  for (const [name, value] of Object.entries(lock.packages)) {
    if (!name) continue;
    if (name === `node_modules/${pkg.name}`) {
      assert.equal(
        value.integrity,
        'sha512-' + createHash('sha512').update(bytes).digest('base64'),
      );
      continue;
    }
    assert(
      value.resolved?.startsWith('https://registry.npmjs.org/'),
      `${name} must resolve from public npm`,
    );
    assert(value.integrity);
  }
  assert.equal(lock.packages['node_modules/@ops-ai/toggly-client-telemetry'].version, '1.1.0');
  console.log(
    'Registry versions',
    JSON.stringify(
      Object.fromEntries(
        ['@solidjs/start', 'solid-js', 'playwright', '@ops-ai/toggly-client-telemetry'].map(
          (name) => [name, lock.packages[`node_modules/${name}`].version],
        ),
      ),
    ),
  );
  const previous = process.cwd();
  own(() => process.chdir(previous));
  process.chdir(host);
  // Same process owns Chrome; an outer Node worker deadline cannot strand it.
  await import(pathToFileURL(join(host, 'verify.mjs')).href);
});
