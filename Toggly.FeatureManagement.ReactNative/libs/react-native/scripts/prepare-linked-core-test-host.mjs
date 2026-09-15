import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptsDir, '..')
const coreRoot = resolve(scriptsDir, '..', '..', 'core')
const coreLink = join(packageRoot, 'node_modules', '@ops-ai', 'react-native-toggly-core')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

execFileSync(npm, ['ci', '--ignore-scripts'], { cwd: coreRoot, stdio: 'inherit' })
execFileSync(npm, ['run', 'build'], { cwd: coreRoot, stdio: 'inherit' })

if (!existsSync(join(coreRoot, 'dist', 'cjs', 'index.js'))) {
  throw new Error('linked Core build did not produce dist/cjs/index.js')
}

rmSync(coreLink, { recursive: true, force: true })
mkdirSync(dirname(coreLink), { recursive: true })
symlinkSync(coreRoot, coreLink, process.platform === 'win32' ? 'junction' : 'dir')
