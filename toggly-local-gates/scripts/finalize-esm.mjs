import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Node resolves module type from the nearest package.json. Without this marker the
// ESM output would be parsed as CommonJS on Node versions that predate automatic
// module syntax detection (< 20.19 and < 22.7).
const esmDir = fileURLToPath(new URL('../dist/esm/', import.meta.url))
writeFileSync(join(esmDir, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`)
