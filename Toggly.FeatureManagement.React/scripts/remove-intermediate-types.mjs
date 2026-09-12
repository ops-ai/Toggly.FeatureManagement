import { rmSync } from 'node:fs'

for (const directory of ['dist/cjs/types', 'dist/esm/types']) {
  rmSync(directory, { recursive: true, force: true })
}
