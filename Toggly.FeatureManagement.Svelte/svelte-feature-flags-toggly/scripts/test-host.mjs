import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'toggly-svelte-host-'));
const run = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });

const hosts = [
  { directory: 'svelte-4-minimum', version: '4.0.0' },
  { directory: 'svelte-4', version: '4.2.20' },
  { directory: 'svelte-5', version: '5.57.0' },
];

try {
  await run('npm', ['run', 'build'], root);
  await run('npm', ['pack', '--pack-destination', temporary], root);
  const archive = (await readdir(temporary)).find((entry) => entry.endsWith('.tgz'));
  if (!archive) throw new Error('npm pack did not produce a Svelte SDK archive');

  for (const fixture of hosts) {
    const host = join(temporary, fixture.directory);
    await cp(join(root, 'tests', 'host', fixture.directory), host, { recursive: true });
    await run(
      'npm',
      ['install', '--no-save', '--package-lock=false', join(temporary, archive)],
      host,
    );
    await run('npm', ['run', 'check'], host);
    await run('npm', ['run', 'build'], host);
    const installed = JSON.parse(
      await readFile(join(host, 'node_modules', 'svelte', 'package.json'), 'utf8'),
    );
    if (installed.version !== fixture.version)
      throw new Error(`Expected Svelte ${fixture.version}, received ${installed.version}`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
