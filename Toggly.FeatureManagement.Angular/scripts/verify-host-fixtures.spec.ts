import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyBrowser } from './verify-host-browser.spec.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli || !path.isAbsolute(npmCli)) throw new Error('npm_execpath must be an absolute path');
const commandEnvironment = { ...process.env, PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) };
const fixtures = path.join(root, 'host-fixtures');
const packageDirectory = path.join(root, 'dist/ngx-feature-flags-toggly');
const metadata = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json')));
const packed = JSON.parse(execFileSync(process.execPath, [npmCli, 'pack', '--json'], { cwd: packageDirectory, encoding: 'utf8', env: commandEnvironment }));
const tarball = path.join(packageDirectory, packed[0].filename);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toggly-angular-hosts-'));
const matrix = JSON.parse(fs.readFileSync(path.join(fixtures, 'matrix.json')));
try {
  for (const entry of matrix.filter(entry => !process.env.TOGGLY_HOST || process.env.TOGGLY_HOST.split(',').includes(entry.fixture))) {
    const cwd = path.join(temporaryRoot, entry.fixture);
    fs.cpSync(path.join(fixtures, entry.fixture), cwd, { recursive: true });
    fs.copyFileSync(path.join(fixtures, 'host.spec.ts'), path.join(cwd, 'src/host.spec.ts'));
    const run = args => execFileSync(process.execPath, [npmCli, 'exec', '--yes', `--package=node@${entry.node}`, '--package=npm@10.8.2', '--', ...args], { cwd, stdio: 'inherit', env: commandEnvironment });
    console.log(`HOST ${JSON.stringify(entry)}`);
    run(['node', '--version']);
    run(['npm', 'ci', '--no-audit', '--no-fund']);
    if (entry.retainedLock) {
      const locked = JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules/@ops-ai/ngx-feature-flags-toggly/package.json')));
      if (locked.version !== '2.8.1') throw new Error('Retained consumer baseline drifted');
      console.log('Retained locked Angular SDK baseline 2.8.1 installed before upgrade');
    }
    const install = ['npm', 'install', '--no-save', '--package-lock=false', '--no-audit', '--no-fund', tarball];
    if (process.env.TOGGLY_SIGNED_DEFS_TARBALL) install.push(path.resolve(process.env.TOGGLY_SIGNED_DEFS_TARBALL));
    run(install);
    const installed = JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules/@ops-ai/ngx-feature-flags-toggly/package.json')));
    const signer = JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules/@ops-ai/toggly-signed-defs/package.json')));
    if (installed.version !== metadata.version || installed.dependencies['@ops-ai/toggly-signed-defs'] !== '^1.2.6') throw new Error('Unexpected packed graph');
    console.log(`PACKED SDK ${installed.version}; signer ${signer.version}; ${process.env.TOGGLY_SIGNED_DEFS_TARBALL ? 'LOCAL INTEGRATION ARTIFACT' : 'REGISTRY RESOLUTION'}`);
    run(['npm', 'run', 'typecheck']);
    run(['npm', 'run', 'build']);
    await verifyBrowser(cwd, entry);
    console.log(`PASS ${entry.fixture}: locked resolution, strict declarations, production build, packed browser behavior`);
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  fs.rmSync(tarball, { force: true });
}
