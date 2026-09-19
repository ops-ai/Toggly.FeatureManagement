import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true });
for (const [dir, module] of [['cjs', 'commonjs'], ['esm', 'ES2020']]) {
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--module', module, '--outDir', `dist/${dir}`], { stdio: 'inherit' });
}
writeFileSync('dist/esm/package.json', '{"type":"module"}\n');
