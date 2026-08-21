import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('published ESM artifact', () => {
  const esmReady = existsSync(join(root, 'dist/esm/package.json'))

  it.skipIf(!esmReady)('marks dist/esm as an ES module and uses extensioned specifiers', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'dist/esm/package.json'), 'utf8')) as { type?: string }
    expect(pkg.type).toBe('module')

    const index = readFileSync(join(root, 'dist/esm/index.js'), 'utf8')
    expect(index).toMatch(/from ['"]\.\/freshness\.js['"]/)
    expect(index).toMatch(/from ['"]\.\/signed-defs-verify\.js['"]/)
  })

  it.skipIf(!esmReady)('loads named exports through Node ESM', async () => {
    const loaded = await import(join(root, 'dist/esm/index.js'))
    expect(typeof loaded.parseSignedEnvelope).toBe('function')
    expect(typeof loaded.parseEvaluatedResponseBody).toBe('function')
    expect(typeof loaded.unwrapDefsPayload).toBe('function')
  })
})
