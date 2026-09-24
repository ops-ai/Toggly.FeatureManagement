import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixturesDirectory = join(packageDirectory, 'tests', 'compat', 'fixtures')

function run(command: string, args: string[], cwd: string) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' })
}

function pack(directory: string, destination: string) {
  run('pnpm', ['pack', '--pack-destination', destination], directory)
  const tarballs = readdirSync(destination).filter((file) => file.endsWith('.tgz'))
  assert.equal(tarballs.length, 1, `Expected one tarball from ${directory}`)
  return join(destination, tarballs[0])
}

function installAndVerify(koaVersion: string) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), `toggly-koa-${koaVersion}-`))

  try {
    cpSync(fixturesDirectory, temporaryDirectory, { recursive: true })
    const packagesDirectory = join(temporaryDirectory, 'packages')
    const koaPackagesDirectory = join(packagesDirectory, 'koa')
    const corePackagesDirectory = join(packagesDirectory, 'core')
    mkdirSync(koaPackagesDirectory, { recursive: true })
    mkdirSync(corePackagesDirectory, { recursive: true })
    const koaTarball = pack(packageDirectory, koaPackagesDirectory)
    const coreTarball = pack(resolve(packageDirectory, '../toggly-node-core'), corePackagesDirectory)
    const evalDirectory = resolve(packageDirectory, '../../toggly-eval')
    const evalPackagesDirectory = join(packagesDirectory, 'eval')
    mkdirSync(evalPackagesDirectory, { recursive: true })
    // Prefer npm pack for the sibling eval package (not in the Node pnpm workspace).
    run('npm', ['pack', '--pack-destination', evalPackagesDirectory], evalDirectory)
    const evalTarballs = readdirSync(evalPackagesDirectory).filter((file) => file.endsWith('.tgz'))
    assert.equal(evalTarballs.length, 1, 'Expected one eval tarball')
    const evalTarball = join(evalPackagesDirectory, evalTarballs[0])

    const packageJsonPath = join(temporaryDirectory, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    packageJson.dependencies.koa = koaVersion
    packageJson.dependencies['@types/koa'] = koaVersion.startsWith('2.') ? '^2.15.0' : '^3.0.0'
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        evalTarball,
        coreTarball,
        koaTarball,
      ],
      temporaryDirectory
    )
    run('npm', ['run', 'typecheck'], temporaryDirectory)
    run('npm', ['run', 'build'], temporaryDirectory)
    run('npm', ['run', 'verify'], temporaryDirectory)
    run('npm', ['run', 'verify:cjs'], temporaryDirectory)
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true })
  }
}

test('packed release installs, typechecks, and handles Koa 2 requests', () => {
  installAndVerify('2.16.3')
}, 120000)

test('packed release installs, typechecks, and handles Koa 3 requests', () => {
  installAndVerify('3.2.1')
}, 120000)
