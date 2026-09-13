import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli || !path.isAbsolute(npmCli)) throw new Error('npm_execpath must be an absolute path');
// The public Node installer invokes npm by name, even when Node and npm
// are installed separately. Bind that lookup to the validated CLI on POSIX.
const npmBin = fs.mkdtempSync(path.join(os.tmpdir(), 'toggly-angular-npm-'));
process.once('exit', () => fs.rmSync(npmBin, { recursive: true, force: true }));
fs.symlinkSync(npmCli, path.join(npmBin, 'npm'));
const commandEnvironment = { ...process.env, PATH: [npmBin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) };
const packaging = path.join(root, 'packaging');
const source = path.join(packaging, '.build');
// Compile the published APF with the oldest supported Angular ABI. Keep the
// Angular 22 workspace compiler for source/browser tests, never patch generated DTS.
execFileSync(process.execPath, [npmCli, 'exec', '--yes', '--package=node@18.20.8', '--package=npm@10.8.2', '--',
  'npm', 'ci', '--prefix', packaging, '--no-audit', '--no-fund'], { stdio: 'inherit', env: commandEnvironment });
fs.rmSync(source, { recursive: true, force: true });
fs.cpSync(path.join(root, 'projects/ngx-feature-flags-toggly'), source, { recursive: true, filter: file => !file.split(path.sep).includes('node_modules') });
const configPath = path.join(source, 'ng-package.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.dest = '../../dist/ngx-feature-flags-toggly';
fs.writeFileSync(configPath, JSON.stringify(config));
try {
  execFileSync(process.execPath, [npmCli, 'exec', '--yes', '--package=node@18.20.8', '--', 'node',
    path.join(packaging, 'node_modules/ng-packagr/cli/main.js'), '-p', configPath,
    '-c', path.join(packaging, 'tsconfig.json')], { cwd: packaging, stdio: 'inherit', env: commandEnvironment });
} finally {
  fs.rmSync(source, { recursive: true, force: true });
}
