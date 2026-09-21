import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const matrix = JSON.parse(readFileSync(join(here, 'matrix.json'), 'utf8'));
mkdirSync(join(here, '.runs'), { recursive: true });
const artifacts = mkdtempSync(join(here, '.runs', 'packed-'));

function command(executable, args, cwd, env = process.env) {
  const result = spawnSync(executable, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${executable} ${args.join(' ')} failed (${result.status})`);
  }
}

command('npm', ['run', 'build'], pkg);
command('npm', ['pack', '--pack-destination', artifacts], pkg);
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
  const version = spawnSync(node, ['--version'], { encoding: 'utf8' }).stdout.trim();
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
  command('npm', ['install', '--ignore-scripts'], host, env);
  command('npm', ['ls', 'react', 'react-dom', 'react-router'], host, env);
  for (const task of ['typecheck', 'build', 'test']) {
    command('npm', ['run', task], host, env);
  }
  writeFileSync(
    join(host, 'evidence.json'),
    JSON.stringify({ ...row, nodeVersion: version, artifact: tarball }, null, 2),
  );
}

console.log(`Packed host evidence: ${artifacts}`);
