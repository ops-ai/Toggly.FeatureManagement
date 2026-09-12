// Resolve the explicitly pinned npm-exec tools together, without changing app locks.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const candidate = process.env.PATH.split(delimiter)
  .map((directory) => join(directory, 'prettier'))
  .find((path) => existsSync(path));
if (!candidate) throw new Error('Run the package format script to provision pinned tools');
const cli = realpathSync(candidate);
const require = createRequire(cli);
const prettierManifest = JSON.parse(
  readFileSync(join(dirname(dirname(cli)), 'package.json'), 'utf8'),
);
const plugin = require.resolve('prettier-plugin-svelte');
const pluginManifest = JSON.parse(readFileSync(join(dirname(plugin), 'package.json'), 'utf8'));
if (prettierManifest.version !== '3.6.2' || pluginManifest.version !== '3.4.1') {
  throw new Error('Unexpected formatter versions; use the pinned package scripts');
}
const mode = process.argv[2];
if (!['--check', '--write'].includes(mode)) throw new Error('Expected --check or --write');
const result = spawnSync(
  process.execPath,
  [
    cli,
    '--plugin',
    plugin,
    '--no-error-on-unmatched-pattern',
    mode,
    'src/**/*.{ts,js,svelte,css,html}',
    'tests/**/*.{ts,js,svelte,mjs,json,md,css,html}',
    'scripts/**/*.mjs',
    '*.{ts,js,mjs,json,md,html}',
  ],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
