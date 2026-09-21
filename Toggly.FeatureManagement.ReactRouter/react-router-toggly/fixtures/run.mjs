import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { cleanupOwned, runOwnedCommand } from './template/owned-resources.mjs';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const matrix = JSON.parse(readFileSync(join(here, 'matrix.json'), 'utf8'));
mkdirSync(join(here, '.runs'), { recursive: true });
const artifacts = mkdtempSync(join(here, '.runs', 'packed-'));

async function command(executable, args, cwd, env = process.env) {
  return runOwnedCommand(executable, args, { cwd, env, stdio: 'inherit' });
}
let failure;
try {
await command(process.execPath, ['--test', join(here, 'cleanup.test.mjs')], pkg);
await command('npm', ['run', 'build'], pkg);
await command('npm', ['pack', '--pack-destination', artifacts], pkg);
const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
const tarball = join(
  artifacts,
  `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`,
);
if (!existsSync(tarball)) {
  throw new Error(`Expected packed tarball at ${tarball}`);
}

if (process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL) console.log('LOCAL TELEMETRY ARTIFACT: registry acceptance remains pending');
const selected = matrix.filter((row) => !process.env.HOST || row.name === process.env.HOST);
for (const row of selected) {
  const node = process.env[`NODE${row.nodeMajor}`] || process.execPath;
  const version = (await runOwnedCommand(node, ['--version'], {})).trim();
  if (!version.startsWith(`v${row.nodeMajor}.`)) {
    throw new Error(
      `${row.name} requires NODE${row.nodeMajor} pointing to Node ${row.nodeMajor}; found ${version}`,
    );
  }
  const env = { ...process.env, PATH: `${dirname(node)}:${process.env.PATH}` };
  const host = join(artifacts, row.name);
  cpSync(join(here, 'template'), host, { recursive: true });
  const hostManifest = {
    name: row.name,
    private: true,
    type: 'module',
    scripts: {
      build: 'react-router build',
      typecheck: 'react-router typegen && tsc --noEmit',
      // Trusted server action clients have no fixture teardown API; retain the existing worker exit.
      // The supervising command bounds and reaps the entire owned process group.
      test: 'node --test --test-force-exit host.test.mjs browser.test.mjs',
    },
    dependencies: {
      '@ops-ai/react-router-toggly': tarball,
      react: row.react,
      'react-dom': row.react,
      'react-router': row.router,
      '@react-router/node': row.router,
      isbot: '^5.1.0',
      ...(process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL ? {'@ops-ai/toggly-client-telemetry': process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL} : {}),
    },
    devDependencies: {
      '@react-router/dev': row.router,
      vite: row.vite,
      typescript: '5.9.3',
      'puppeteer-core': '25.10.0',
      '@types/react': row.react.startsWith('18.') ? '18.3.28' : '19.2.14',
      '@types/react-dom': row.react.startsWith('18.') ? '18.3.7' : '19.2.3',
      '@types/node': '^22.0.0',
    },
  };
  writeFileSync(join(host, 'package.json'), JSON.stringify(hostManifest, null, 2));
  console.log(`\n${row.name}: ${version}, React ${row.react}, Router ${row.router}, Vite ${row.vite}`);
  await command('npm', ['install', '--ignore-scripts'], host, env);
  await command('npm', ['ls', 'react', 'react-dom', 'react-router'], host, env);
  for (const task of ['typecheck', 'build']) {
    await command('npm', ['run', task], host, env);
  }
  // These controls must exit naturally and do not share the trusted-server worker's force-exit boundary.
  await command(node, ['--test', 'browser-cleanup.test.mjs'], host, env);
  await command('npm', ['run', 'test'], host, env);
  writeFileSync(
    join(here, '.runs', `${row.name}-evidence.json`),
    JSON.stringify({ ...row, nodeVersion: version, sdkVersion: manifest.version, reporterVersion: JSON.parse(readFileSync(join(host, 'node_modules/@ops-ai/toggly-client-telemetry/package.json'),'utf8')).version }, null, 2),
  );
  rmSync(host, {recursive:true,force:true});
}
} catch(error) { failure=error; }
await cleanupOwned([()=>rmSync(artifacts,{recursive:true,force:true})],failure);

console.log(`Packed host evidence: ${join(here, '.runs')}; temporary hosts removed`);
