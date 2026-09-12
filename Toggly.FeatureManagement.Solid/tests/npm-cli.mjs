import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export function validateNpmCli(candidate) {
  if (!isAbsolute(candidate)) throw new Error('npm CLI path must be absolute');
  const cli = realpathSync(candidate);
  if (basename(cli) !== 'npm-cli.js' || !statSync(cli).isFile()) {
    throw new Error('npm CLI must be an npm-cli.js file');
  }
  const npmRoot = resolve(dirname(cli), '..');
  const metadata = JSON.parse(readFileSync(join(npmRoot, 'package.json'), 'utf8'));
  if (
    metadata.name !== 'npm' ||
    typeof metadata.bin?.npm !== 'string' ||
    resolve(npmRoot, metadata.bin.npm) !== cli
  ) {
    throw new Error('npm CLI does not match the npm package executable');
  }
  return cli;
}

export function resolveNpmCli(environment = process.env, executable = process.execPath) {
  // npm run provides its own CLI. Direct invocation uses only npm beside the
  // current Node runtime; neither branch searches PATH for a command name.
  if (environment.npm_execpath) return validateNpmCli(environment.npm_execpath);
  const runtimeDirectory = dirname(executable);
  const candidates = [
    join(runtimeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(runtimeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const candidate = candidates.find((path) => existsSync(path));
  if (!candidate) throw new Error('npm CLI is unavailable beside the Node runtime');
  return validateNpmCli(candidate);
}
