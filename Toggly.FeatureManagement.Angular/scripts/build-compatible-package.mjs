import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packaging = path.join(root, 'packaging');
const source = path.join(packaging, '.build');
// Compile the published APF with the oldest supported Angular ABI. Keep the
// Angular 22 workspace compiler for source/browser tests, never patch generated DTS.
execFileSync('npm', ['exec', '--yes', '--package=node@18.20.8', '--package=npm@10.8.2', '--',
  'npm', 'ci', '--prefix', packaging, '--no-audit', '--no-fund'], { stdio: 'inherit' });
fs.rmSync(source, { recursive: true, force: true });
fs.cpSync(path.join(root, 'projects/ngx-feature-flags-toggly'), source, { recursive: true, filter: file => !file.split(path.sep).includes('node_modules') });
const configPath = path.join(source, 'ng-package.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.dest = '../../dist/ngx-feature-flags-toggly';
fs.writeFileSync(configPath, JSON.stringify(config));
try {
  execFileSync('npm', ['exec', '--yes', '--package=node@18.20.8', '--', 'node',
    path.join(packaging, 'node_modules/ng-packagr/cli/main.js'), '-p', configPath,
    '-c', path.join(packaging, 'tsconfig.json')], { cwd: packaging, stdio: 'inherit' });
} finally {
  fs.rmSync(source, { recursive: true, force: true });
}
