import { readFileSync, writeFileSync } from 'node:fs'

const cjsEntryPoint = 'dist/cjs/index.cjs'
writeFileSync(
  cjsEntryPoint,
  readFileSync(cjsEntryPoint, 'utf8').replaceAll('\r\n', '\n'),
)
