import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('published ESM artifact', () => {
  const esmReady = existsSync(join(root, 'dist/esm/package.json'))
  const browserReady = existsSync(join(root, 'dist/browser/package.json'))

  it.skipIf(!esmReady || !browserReady)('verifies signatures in packed webpack browser consumers including legacy and dist overlay paths', () => {
    execFileSync(process.execPath, [join(root, 'scripts/verify-webpack-consumers.mjs')], {
      cwd: root, stdio: 'pipe', timeout: 30000,
    })
  }, 35000)

  it('publishes a browser condition before Node import and require conditions', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      exports?: Record<string, Record<string, unknown>>
    }

    expect(manifest.exports?.['.']?.browser).toEqual({
      types: './dist/browser/index.d.ts',
      default: './dist/browser/index.js',
    })
  })

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

  it.skipIf(!browserReady)('keeps Node-only crypto imports out of the browser module graph', () => {
    const browserDir = join(root, 'dist/browser')
    const files = readdirSync(browserDir).filter((file) => file.endsWith('.js'))
    const browserSources = files
      .map((file) => readFileSync(join(browserDir, file), 'utf8'))
      .join('\n')

    expect(browserSources).not.toMatch(/(?:from\s*|require\s*\(|import\s*\()\s*['"](?:node:|crypto['"])/)
  })
})
