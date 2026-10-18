import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptsDir, '..')
const coreRoot = resolve(scriptsDir, '..', '..', 'core')
const telemetryRoot = resolve(coreRoot, '..', '..', '..', 'toggly-client-telemetry')
const coreLink = join(packageRoot, 'node_modules', '@ops-ai', 'react-native-toggly-core')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const artifacts = JSON.parse(process.env.TOGGLY_SHARED_ARTIFACTS ?? '[]')
if (!Array.isArray(artifacts) || artifacts.some(value => typeof value !== 'string')) {
  throw new Error('TOGGLY_SHARED_ARTIFACTS must be a JSON string array')
}

execFileSync(npm, ['ci', '--ignore-scripts'], { cwd: coreRoot, stdio: 'inherit' })

const overlays = [...artifacts]
if (!overlays.length && existsSync(join(telemetryRoot, 'package.json'))) {
  if (!existsSync(join(telemetryRoot, 'dist', 'cjs', 'index.js'))) {
    execFileSync(npm, ['ci'], { cwd: telemetryRoot, stdio: 'inherit' })
    execFileSync(npm, ['run', 'build'], { cwd: telemetryRoot, stdio: 'inherit' })
  }
  const packDir = join(tmpdir(), `toggly-client-telemetry-pack-${process.pid}`)
  mkdirSync(packDir, { recursive: true })
  execFileSync(npm, ['pack', '--pack-destination', packDir], {
    cwd: telemetryRoot,
    stdio: 'inherit',
  })
  const packed = readdirSync(packDir).find((name) => name.endsWith('.tgz'))
  if (!packed) {
    throw new Error('failed to pack local toggly-client-telemetry for linked Core host')
  }
  overlays.push(join(packDir, packed))
}

if (overlays.length) {
  execFileSync(npm, ['install', '--no-save', '--package-lock=false', ...overlays], {
    cwd: coreRoot,
    stdio: 'inherit',
  })
}

execFileSync(npm, ['run', 'build'], { cwd: coreRoot, stdio: 'inherit' })

if (!existsSync(join(coreRoot, 'dist', 'cjs', 'index.js'))) {
  throw new Error('linked Core build did not produce dist/cjs/index.js')
}

rmSync(coreLink, { recursive: true, force: true })
mkdirSync(dirname(coreLink), { recursive: true })
symlinkSync(coreRoot, coreLink, process.platform === 'win32' ? 'junction' : 'dir')
