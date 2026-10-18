import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyBrowser } from './verify-host-browser.spec.ts';
import { withHostResources } from './host-resources.spec.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli || !path.isAbsolute(npmCli)) throw new Error('npm_execpath must be an absolute path');
await withHostResources(async defer => {
  // The public Node installer invokes npm by name, even when Node and npm
  // are installed separately. Bind that lookup to the validated CLI on POSIX.
  const npmBin = fs.mkdtempSync(path.join(os.tmpdir(), 'toggly-angular-npm-'));
  defer(() => fs.rmSync(npmBin, { recursive: true, force: true }));
  fs.symlinkSync(npmCli, path.join(npmBin, 'npm'));
  const commandEnvironment = { ...process.env, PATH: [npmBin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) };
  const fixtures = path.join(root, 'host-fixtures');
  const packageDirectory = path.join(root, 'dist/ngx-feature-flags-toggly');
  const metadata = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json')));
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toggly-angular-hosts-'));
  defer(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const packed = JSON.parse(execFileSync(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', temporaryRoot], { cwd: packageDirectory, encoding: 'utf8', env: commandEnvironment }));
  const tarball = path.join(temporaryRoot, packed[0].filename);
  const matrix = JSON.parse(fs.readFileSync(path.join(fixtures, 'matrix.json')));
  const selected = matrix.filter(entry => !process.env.TOGGLY_HOST || process.env.TOGGLY_HOST.split(',').includes(entry.fixture));
  if (!selected.length) throw new Error('TOGGLY_HOST selected no fixtures');
  for (const entry of selected) {
    const cwd = path.join(temporaryRoot, entry.fixture);
    fs.cpSync(path.join(fixtures, entry.fixture), cwd, { recursive: true });
    fs.copyFileSync(path.join(fixtures, 'host.spec.ts'), path.join(cwd, 'src/host.spec.ts'));
    // Angular 21+ hits npm 10 `edgesOut` null on any install after `npm ci`.
    // npm 11 completes the same classic tarball install. Older hosts stay on 10.8.2.
    const angularMajor = Number(String(entry.angular || '0').split('.')[0]);
    const npmVersion = angularMajor >= 21 ? '11.6.2' : '10.8.2';
    const run = args => execFileSync(process.execPath, [npmCli, 'exec', '--yes', `--package=node@${entry.node}`, `--package=npm@${npmVersion}`, '--', ...args], { cwd, stdio: 'inherit', env: commandEnvironment });
    console.log(`HOST ${JSON.stringify(entry)}`);
    run(['node', '--version']);
    run(['npm', 'ci', '--no-audit', '--no-fund']);
    if (entry.retainedLock) {
      const locked = JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules/@ops-ai/ngx-feature-flags-toggly/package.json')));
      if (locked.version !== '2.8.1') throw new Error('Retained consumer baseline drifted');
      console.log('Retained locked Angular SDK baseline 2.8.1 installed before upgrade');
    }
    // Temp hosts may update their lockfile; avoid --package-lock=false — npm@10
    // arborist crashes with edgesOut null on Angular 21+ when overlaying a tarball
    // without a lock update (retries alone do not clear it).
    const install = ['npm', 'install', '--no-save', '--no-audit', '--no-fund', tarball];
    if (process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL) install.push(path.resolve(process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL));
    if (process.env.TOGGLY_SIGNED_DEFS_TARBALL) install.push(path.resolve(process.env.TOGGLY_SIGNED_DEFS_TARBALL));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        run(install);
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        console.warn(`npm install failed on ${entry.fixture}; retry ${attempt + 1}/2`);
        for (const name of ['ngx-feature-flags-toggly', 'toggly-client-telemetry', 'toggly-signed-defs']) {
          fs.rmSync(path.join(cwd, 'node_modules/@ops-ai', name), { recursive: true, force: true });
        }
      }
    }
    const installed = JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules/@ops-ai/ngx-feature-flags-toggly/package.json')));
    const reporter = JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules/@ops-ai/toggly-client-telemetry/package.json')));
    const signer = JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules/@ops-ai/toggly-signed-defs/package.json')));
    const host = Object.fromEntries(Object.entries({ angular: '@angular/core', cli: '@angular/cli', typescript: 'typescript' })
      .map(([name, packageName]) => [name, JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules', packageName, 'package.json'))).version]));
    if (Object.entries(host).some(([name, version]) => version !== entry[name])) throw new Error(`Installed host versions drifted: ${JSON.stringify(host)}`);
    console.log(`INSTALLED HOST ${JSON.stringify({ fixture: entry.fixture, ...host })}`);
    const telemetryRange = installed.dependencies['@ops-ai/toggly-client-telemetry'];
    if (
      installed.version !== metadata.version ||
      (telemetryRange !== '^1.1.0' && telemetryRange !== '^1.2.0') ||
      installed.dependencies['@ops-ai/toggly-signed-defs'] !== '^1.2.6'
    ) {
      throw new Error('Unexpected packed graph');
    }
    const present = (name) => fs.existsSync(path.join(cwd, 'node_modules', ...name.split('/'), 'package.json'));
    if (!present('@ops-ai/toggly-hooks-types') || !present('@ops-ai/toggly-local-gates')) {
      throw new Error('Angular host is missing SDK peer/dependency modules');
    }
    console.log(`PACKED SDK ${installed.version}; reporter ${reporter.version}; signer ${signer.version}; ${(process.env.TOGGLY_SIGNED_DEFS_TARBALL || process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL) ? 'LOCAL INTEGRATION ARTIFACT' : 'REGISTRY RESOLUTION'}`);
    run(['npm', 'run', 'typecheck']);
    run(['npm', 'run', 'build']);
    await verifyBrowser(cwd, entry);
    console.log(`PASS ${entry.fixture}: locked host baseline, strict declarations, production build, packed browser behavior`);
    // A full nine-host matrix must retain only the current host installation.
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
