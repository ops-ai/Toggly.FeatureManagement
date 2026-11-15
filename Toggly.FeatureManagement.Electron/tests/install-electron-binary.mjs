import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

// Electron 28 ships extract-zip@2, which does not finish under Node 26
// (process exits before path.txt exists, or extract hangs). Download with
// @electron/get, then unzip(1) so packed hosts stay installable on current LTS.

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) process.exit(0)

const electronDir = join(process.cwd(), 'node_modules', 'electron')
const require = createRequire(join(electronDir, 'package.json'))
const { version } = require('./package.json')
const { downloadArtifact } = require('@electron/get')

const platform = process.env.npm_config_platform || process.platform
const arch = process.env.npm_config_arch || process.arch
const platformPath =
  platform === 'win32'
    ? 'electron.exe'
    : platform === 'darwin' || platform === 'mas'
      ? 'Electron.app/Contents/MacOS/Electron'
      : 'electron'

const distPath = process.env.ELECTRON_OVERRIDE_DIST_PATH || join(electronDir, 'dist')
const electronPath = join(distPath, platformPath)
const pathFile = join(electronDir, 'path.txt')
const versionFile = join(distPath, 'version')

if (
  existsSync(versionFile) &&
  existsSync(pathFile) &&
  existsSync(electronPath) &&
  readFileSync(versionFile, 'utf8').replace(/^v/, '') === version &&
  readFileSync(pathFile, 'utf8') === platformPath
) {
  process.exit(0)
}

const zipPath = await downloadArtifact({
  version,
  artifactName: 'electron',
  force: process.env.force_no_cache === 'true',
  cacheRoot: process.env.electron_config_cache,
  checksums: process.env.electron_use_remote_checksums
    ? undefined
    : require('./checksums.json'),
  platform,
  arch,
})

rmSync(distPath, { recursive: true, force: true })
mkdirSync(distPath, { recursive: true })
execFileSync('unzip', ['-qo', zipPath, '-d', distPath], { stdio: 'inherit' })

const srcTypeDefPath = join(distPath, 'electron.d.ts')
if (existsSync(srcTypeDefPath)) {
  renameSync(srcTypeDefPath, join(electronDir, 'electron.d.ts'))
}
writeFileSync(pathFile, platformPath)
assert.ok(existsSync(electronPath), `Electron binary missing at ${electronPath}`)
