import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const esmDir = fileURLToPath(new URL('../dist/esm/', import.meta.url))
writeFileSync(join(esmDir, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`)

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(path)
      continue
    }
    if (!entry.name.endsWith('.js')) {
      continue
    }

    const next = readFileSync(path, 'utf8').replace(
      /from ['"](\.[^'"]+)['"]/g,
      (full, specifier) => {
        if (specifier.endsWith('.js') || specifier.endsWith('.json')) {
          return full
        }
        return full.replace(specifier, `${specifier}.js`)
      },
    )
    writeFileSync(path, next)
  }
}

walk(esmDir)
