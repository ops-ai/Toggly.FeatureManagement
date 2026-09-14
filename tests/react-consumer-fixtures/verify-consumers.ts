import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sdkDirectory = process.cwd()
// Keep independently installed hosts outside the SDK source root. Sonar analyzes
// that root as production code, while these are executable consumer tests.
const packageDirectory = join(sdkDirectory, '..', 'tests', 'react-consumer-fixtures')
const runnerDirectory = join(fileURLToPath(new URL('.', import.meta.url)))
const packageManifest = JSON.parse(
  readFileSync(join(sdkDirectory, 'package.json'), 'utf8'),
)
const rollupConfig = readFileSync(join(sdkDirectory, 'rollup.config.js'), 'utf8')

assert.equal(packageManifest.peerDependencies?.react, '^18.2.0 || ^19.0.0')
assert.equal(packageManifest.peerDependencies?.['react-dom'], '^18.2.0 || ^19.0.0')
assert.equal(packageManifest.dependencies?.react, undefined)
assert.equal(packageManifest.dependencies?.['@ops-ai/toggly-signed-defs'], '^1.2.7')
assert.equal(packageManifest.exports?.['.']?.import, './dist/esm/index.js')
assert.equal(packageManifest.exports?.['.']?.require, './dist/cjs/index.cjs')
assert.match(rollupConfig, /external:\s*\[[\s\S]*['"]react['"][\s\S]*['"]react\/jsx-runtime['"][\s\S]*['"]@ops-ai\/toggly-signed-defs['"][\s\S]*\]/)

const isolatedDirectory = mkdtempSync(join(tmpdir(), 'toggly-react-isolated-'))
console.log(`Isolated packed consumers: ${isolatedDirectory}`)
const artifactsDirectory = join(isolatedDirectory, 'artifacts')
const packedArtifact = join(artifactsDirectory, 'toggly-react.tgz')
const signedDefinitionsArtifact = join(artifactsDirectory, 'toggly-signed-defs.tgz')
const localSignedDefinitionsArtifact = process.env.TOGGLY_SIGNED_DEFS_TARBALL
const npmCacheDirectory = mkdtempSync(join(tmpdir(), 'toggly-react-consumer-npm-cache-'))
const npmEnvironment = { ...process.env, npm_config_cache: npmCacheDirectory }

const npmCli = process.env.npm_execpath
if (!npmCli || !npmCli.startsWith('/')) {
  throw new Error('npm_execpath must be an absolute path')
}
const commandEnvironment = { ...npmEnvironment, PATH: '/usr/bin:/bin' }

function runCommand(command: string, arguments_: readonly string[], options: Parameters<typeof execFileSync>[2]) {
  const executable = command === 'npm' || command === 'node' ? process.execPath : command
  const executableArguments = command === 'npm' ? [npmCli, ...arguments_] : [...arguments_]
  return execFileSync(executable, executableArguments, { ...options, env: command === 'npm' || command === 'node' ? commandEnvironment : options.env })
}

rmSync(artifactsDirectory, { recursive: true, force: true })
mkdirSync(artifactsDirectory, { recursive: true })

try {
  const packed = JSON.parse(
    String(runCommand('npm', ['pack', '--json', '--pack-destination', artifactsDirectory], {
      cwd: sdkDirectory,
      encoding: 'utf8',
      env: npmEnvironment,
    })))
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
  if (localSignedDefinitionsArtifact) {
    assert.ok(existsSync(localSignedDefinitionsArtifact), `Missing signed-definitions artifact: ${localSignedDefinitionsArtifact}`)
    copyFileSync(localSignedDefinitionsArtifact, signedDefinitionsArtifact)
  }

  for (const fixture of ['react-18-min', 'react-18', 'react-19']) {
    const fixtureDirectory = join(isolatedDirectory, fixture)
    cpSync(join(packageDirectory, fixture), fixtureDirectory, {
      recursive: true,
      filter: path => !/(?:^|\/)(?:node_modules|dist|dist-ssr)(?:\/|$)/.test(path),
    })
    rmSync(join(fixtureDirectory, 'node_modules'), { recursive: true, force: true })
    rmSync(join(fixtureDirectory, 'dist'), { recursive: true, force: true })
    if (localSignedDefinitionsArtifact) {
      const fixtureLockPath = join(fixtureDirectory, 'package-lock.json')
      const fixtureLock = JSON.parse(readFileSync(fixtureLockPath, 'utf8'))
      fixtureLock.packages['node_modules/@ops-ai/toggly-signed-defs'].resolved = 'file:../artifacts/toggly-signed-defs.tgz'
      writeFileSync(fixtureLockPath, `${JSON.stringify(fixtureLock, null, 2)}\n`)
    }

    runCommand(
      'npm',
      ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: fixtureDirectory, env: npmEnvironment, stdio: 'inherit' },
    )
    runCommand('npm', ['ls', '@ops-ai/react-feature-flags-toggly', 'react', 'react-dom', '--depth=0'], {
      cwd: fixtureDirectory,
      env: npmEnvironment,
      stdio: 'inherit',
    })
    runCommand('node', [join(fixtureDirectory, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json', '--noEmit'], { cwd: fixtureDirectory, env: commandEnvironment, stdio: 'inherit' })
    runCommand('node', [join(fixtureDirectory, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: fixtureDirectory, env: commandEnvironment, stdio: 'inherit' })
    runCommand('node', [join(runnerDirectory, 'browser-check.js')], { cwd: fixtureDirectory, env: commandEnvironment, stdio: 'inherit' })
    runCommand('node', [join(fixtureDirectory, 'node_modules/vite/bin/vite.js'), 'build', '--ssr', 'src/verify.tsx', '--outDir', 'dist-ssr'], { cwd: fixtureDirectory, env: commandEnvironment, stdio: 'inherit' })
    runCommand('node', [join(fixtureDirectory, 'dist-ssr/verify.js')], { cwd: fixtureDirectory, env: commandEnvironment, stdio: 'inherit' })
    runCommand(
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
