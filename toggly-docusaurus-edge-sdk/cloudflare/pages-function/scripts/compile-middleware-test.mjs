import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(packageRoot, '.test-runtime');

rmSync(outputDirectory, { recursive: true, force: true });

execFileSync(
  process.execPath,
  [
    resolve(packageRoot, 'node_modules/typescript/bin/tsc'),
    '--project', resolve(packageRoot, 'tsconfig.json'),
    '--outDir', outputDirectory,
    '--rootDir', packageRoot,
    '--noEmit', 'false',
    '--sourceMap',
    '--inlineSources',
  ],
  { cwd: packageRoot, stdio: 'inherit' },
);

writeFileSync(resolve(outputDirectory, 'package.json'), '{"type":"module"}\n');
