import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { webcrypto } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import webpack from 'webpack'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const probe = mkdtempSync(join(tmpdir(), 'signed-defs-webpack-'))
const fixture = JSON.parse(readFileSync(join(root, 'testdata/webcrypto-fixture.json'), 'utf8'))
const der = JSON.parse(readFileSync(join(root, 'testdata/der-signatures.json'), 'utf8'))
const hashes = JSON.parse(readFileSync(join(root, 'testdata/hash-depth-signatures.json'), 'utf8'))

try {
  const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', probe], {
    cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(probe, '.cache') },
  }).trim()
  writeFileSync(join(probe, 'package.json'), JSON.stringify({ private: true }))
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(probe, tarball)], {
    cwd: probe, stdio: 'inherit', env: { ...process.env, npm_config_cache: join(probe, '.cache') },
  })
  const manifestPath = join(probe, 'node_modules/@ops-ai/toggly-signed-defs/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entry = `
import { computeKid, verifySignedDefinitions } from '@ops-ai/toggly-signed-defs'
const fixture = ${JSON.stringify(fixture)}
const der = ${JSON.stringify(der)}
const hashes = ${JSON.stringify(hashes)}
globalThis.verification = (async () => {
  const kid = await computeKid('AA', 'AA')
  await verifySignedDefinitions(fixture.defs, fixture, fixture.jwks)
  await verifySignedDefinitions(fixture.defs, { ...fixture, signature: der.valid }, fixture.jwks)
  await verifySignedDefinitions(fixture.defs, { ...fixture, signature: fixture.signature.replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '') }, fixture.jwks)
  await verifySignedDefinitions(hashes.defs, { ...hashes, signature: hashes.signatures.double }, hashes.jwks)
  let rejected = 0
  for (const signature of [hashes.signatures.single, hashes.signatures.triple]) {
    try { await verifySignedDefinitions(hashes.defs, { ...hashes, signature }, hashes.jwks) }
    catch (error) { if (error.message !== 'invalid signature') throw error; rejected += 1 }
  }
  for (const signature of Object.values(der.invalid)) {
    try { await verifySignedDefinitions(fixture.defs, { ...fixture, signature }, fixture.jwks) }
    catch { rejected += 1 }
  }
  try { await verifySignedDefinitions(fixture.defs + ' ', fixture, fixture.jwks) }
  catch { rejected += 1 }
  return { kid, rejected }
})()
`
  writeFileSync(join(probe, 'entry.js'), entry)
  writeFileSync(join(probe, 'entry-cjs.js'), entry.replace(
    "import { computeKid, verifySignedDefinitions } from '@ops-ai/toggly-signed-defs'",
    "const { computeKid, verifySignedDefinitions } = require('@ops-ai/toggly-signed-defs')",
  ))

  let failures = 0
  for (const mode of ['conditional', 'legacy-module', 'legacy-cjs', 'ci-dist-overlay', 'ci-dist-overlay-esm']) {
    // The CI action copies only dist into an older installed package. Its
    // root manifest cannot be relied upon to select the new browser export.
    const legacy = { name: manifest.name, main: manifest.main, module: manifest.module }
    if (mode.startsWith('ci-dist-overlay')) {
      legacy.exports = { '.': { types: './dist/index.d.ts', import: './dist/esm/index.js', require: './dist/index.js' } }
    }
    writeFileSync(manifestPath, JSON.stringify(mode === 'conditional' ? manifest : legacy))
    const resolve = mode === 'legacy-module' ? { mainFields: ['module', 'main'] }
      : mode === 'legacy-cjs' || mode === 'ci-dist-overlay' ? { mainFields: ['main'] } : {}
    try {
      const stats = await new Promise((resolveBuild, reject) => {
        const compiler = webpack({
          mode: 'production', target: 'web', context: probe,
          entry: mode === 'ci-dist-overlay' ? './entry-cjs.js' : './entry.js',
          output: { path: join(probe, mode), filename: 'bundle.js' }, resolve,
        })
        compiler.run((error, result) => compiler.close((closeError) => {
          if (error || closeError) reject(error || closeError)
          else resolveBuild(result)
        }))
      })
      assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }))
      const bundle = readFileSync(join(probe, mode, 'bundle.js'), 'utf8')
      assert.doesNotMatch(bundle, /node:crypto/)
      // Browser-like globals: no require, process, or Buffer. Real WebCrypto
      // checks prove the compiled bundle selected a working browser provider.
      const sandbox = { crypto: webcrypto, atob, TextEncoder, TextDecoder }
      runInNewContext(bundle, sandbox)
      const result = await sandbox.verification
      assert.equal(result.kid, '1489F923C4DCA729178B3E3233458550D8DDDF29ES256')
      assert.equal(result.rejected, Object.keys(der.invalid).length + 3)
      // Browser selection must fail closed when platform WebCrypto is absent;
      // changing process.versions in a Node-loaded module cannot prove this.
      for (const crypto of [undefined, {}]) {
        const missingProvider = { crypto, atob, TextEncoder, TextDecoder }
        runInNewContext(bundle, missingProvider)
        await assert.rejects(missingProvider.verification, /WebCrypto is required/)
      }
      console.log(`${mode}: packed browser verifies P1363/URL-safe/DER; rejects single/triple hashes, tampering, malformed DER, and missing WebCrypto`)
    } catch (error) {
      failures += 1
      console.error(`${mode}: ${error.message}`)
    }
  }
  assert.equal(failures, 0, `${failures} webpack browser consumers failed`)
} finally {
  rmSync(probe, { recursive: true, force: true })
}
