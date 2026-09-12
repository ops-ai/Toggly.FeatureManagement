import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const sdkDirectory = dirname(packageDirectory)
const packageManifest = JSON.parse(
  readFileSync(join(sdkDirectory, 'package.json'), 'utf8'),
)
const rollupConfig = readFileSync(join(sdkDirectory, 'rollup.config.js'), 'utf8')

assert.equal(packageManifest.peerDependencies?.react, '^18.2.0 || ^19.0.0')
assert.equal(packageManifest.peerDependencies?.['react-dom'], '^18.2.0 || ^19.0.0')
assert.equal(packageManifest.dependencies?.react, undefined)
assert.equal(packageManifest.exports?.['.']?.import, './dist/esm/index.js')
assert.equal(packageManifest.exports?.['.']?.require, './dist/cjs/index.cjs')
assert.match(rollupConfig, /external:\s*\[[\s\S]*['"]react['"][\s\S]*['"]react\/jsx-runtime['"][\s\S]*\]/)

const isolatedDirectory = mkdtempSync(join(tmpdir(), 'toggly-react-isolated-'))
console.log(`Isolated packed consumers: ${isolatedDirectory}`)
const artifactsDirectory = join(isolatedDirectory, 'artifacts')
const packedArtifact = join(artifactsDirectory, 'toggly-react.tgz')
const npmCacheDirectory = mkdtempSync(join(tmpdir(), 'toggly-react-consumer-npm-cache-'))
const npmEnvironment = { ...process.env, npm_config_cache: npmCacheDirectory }

rmSync(artifactsDirectory, { recursive: true, force: true })
mkdirSync(artifactsDirectory, { recursive: true })

try {
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', artifactsDirectory], {
      cwd: sdkDirectory,
      encoding: 'utf8',
      env: npmEnvironment,
    }),
  )
  const packedFiles = packed[0].files.map(({ path }) => path)
  assert.ok(packedFiles.includes('dist/cjs/index.cjs'))
  assert.equal(
    packedFiles.some((path) => /(?:\.spec|\.test)\.(?:d\.ts|[cm]?[jt]sx?)/.test(path)),
    false,
    'The published package must not include test declarations or test code.',
  )
  assert.equal(
    packedFiles.some((path) => path.includes('consumer-fixtures') || path.includes('.types/')),
    false,
    'The published package must not include consumer fixture or intermediate declaration files.',
  )
  copyFileSync(join(artifactsDirectory, packed[0].filename), packedArtifact)

  for (const fixture of ['react-18-min', 'react-18', 'react-19']) {
    const fixtureDirectory = join(isolatedDirectory, fixture)
    cpSync(join(packageDirectory, fixture), fixtureDirectory, {
      recursive: true,
      filter: path => !/(?:^|\/)(?:node_modules|dist|dist-ssr)(?:\/|$)/.test(path),
    })
    rmSync(join(fixtureDirectory, 'node_modules'), { recursive: true, force: true })
    rmSync(join(fixtureDirectory, 'dist'), { recursive: true, force: true })

    execFileSync(
      'npm',
      ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: fixtureDirectory, env: npmEnvironment, stdio: 'inherit' },
    )
    execFileSync('npm', ['ls', '@ops-ai/react-feature-flags-toggly', 'react', 'react-dom', '--depth=0'], {
      cwd: fixtureDirectory,
      env: npmEnvironment,
      stdio: 'inherit',
    })
    execFileSync('npm', ['run', 'typecheck'], { cwd: fixtureDirectory, env: npmEnvironment, stdio: 'inherit' })
    execFileSync('npm', ['run', 'build'], { cwd: fixtureDirectory, env: npmEnvironment, stdio: 'inherit' })
    execFileSync('node', [join(packageDirectory, 'browser-check.mjs')], { cwd: fixtureDirectory, env: npmEnvironment, stdio: 'inherit' })
    execFileSync('npm', ['run', 'verify'], { cwd: fixtureDirectory, env: npmEnvironment, stdio: 'inherit' })
    execFileSync(
      'node',
      ['-e', "const assert = require('node:assert/strict'); const sdk = require('@ops-ai/react-feature-flags-toggly'); assert.equal(typeof sdk.Toggly, 'function');"],
      { cwd: fixtureDirectory, env: npmEnvironment, stdio: 'inherit' },
    )
  }
} finally {
  if (existsSync(artifactsDirectory)) {
    rmSync(artifactsDirectory, { recursive: true, force: true })
  }
  rmSync(isolatedDirectory, { recursive: true, force: true })
  rmSync(npmCacheDirectory, { recursive: true, force: true })
}
