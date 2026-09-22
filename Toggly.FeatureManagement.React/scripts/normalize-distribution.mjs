import { readFileSync, writeFileSync } from 'node:fs'

for (const entryPoint of ['dist/cjs/index.cjs', 'dist/esm/index.js']) {
  writeFileSync(
    entryPoint,
    readFileSync(entryPoint, 'utf8').replaceAll('\r\n', '\n').replace(/[ \t]+$/gm, ''),
  )
}
