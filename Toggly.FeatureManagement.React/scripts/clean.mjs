import { rmSync } from 'node:fs'

for (const directory of ['dist', '.types']) {
  rmSync(directory, { recursive: true, force: true })
}
