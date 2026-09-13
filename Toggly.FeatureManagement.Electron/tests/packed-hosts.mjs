import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const sdkDirectory = dirname(packageDirectory)
const workspace = mkdtempSync(join(tmpdir(), 'toggly-electron-packed-hosts-'))
const rows = [
  { name: 'electron28-retained-floor', electron: '28.3.3' },
  { name: 'electron44-current', electron: '44.3.0' },
]

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    timeout: 60_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`)
  }
  return result
}

function writeHost(hostDirectory, tarball) {
  writeFileSync(join(hostDirectory, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    main: 'main.mjs',
    dependencies: {
      '@ops-ai/electron-feature-flags-toggly': tarball,
      electron: 'PLACEHOLDER_ELECTRON',
      esbuild: '0.25.10',
      react: '18.3.1',
      'react-dom': '18.3.1',
      typescript: '5.9.3',
      '@types/react': '18.3.28',
      '@types/react-dom': '18.3.7',
    },
  }, null, 2))
  writeFileSync(join(hostDirectory, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
      jsx: 'react-jsx', strict: true, skipLibCheck: false, noEmit: true,
    },
    include: ['consumer.tsx'],
  }, null, 2))
  writeFileSync(join(hostDirectory, 'consumer.tsx'), `
import { initToggly, registerTogglyIpc } from '@ops-ai/electron-feature-flags-toggly/main'
import { exposeToggly } from '@ops-ai/electron-feature-flags-toggly/preload'
import { isFeatureOn } from '@ops-ai/electron-feature-flags-toggly/renderer'
import { Feature, useFeatureFlag } from '@ops-ai/electron-feature-flags-toggly/react'
void initToggly
void registerTogglyIpc
void exposeToggly
void isFeatureOn
void Feature
void useFeatureFlag
`)
  writeFileSync(join(hostDirectory, 'renderer.tsx'), `
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Feature, useFeatureFlag } from '@ops-ai/electron-feature-flags-toggly/react'

function publish(attempt = 0) {
  const feature = Boolean(document.querySelector('#feature'))
  const negated = Boolean(document.querySelector('#negated'))
  if ((!feature || !negated) && attempt < 20) {
    setTimeout(() => publish(attempt + 1), 10)
    return
  }
  void window.toggly.getFlags().then((flags) => {
    window.__togglyPackedHost = {
      bridge: typeof window.toggly,
      getFlags: typeof window.toggly.getFlags,
      enabled: window.toggly.isFeatureOn('PackedEnabled'),
      flags,
      feature,
      negated,
      hook: document.querySelector('#hook')?.textContent,
    }
  })
}

function App() {
  const { isEnabled } = useFeatureFlag('PackedEnabled')
  useEffect(() => { publish() }, [isEnabled])
  return <>
    <span id="hook">{String(isEnabled)}</span>
    <Feature featureKey="PackedEnabled"><span id="feature">enabled</span></Feature>
    <Feature featureKey="PackedDisabled" negate><span id="negated">disabled</span></Feature>
  </>
}

createRoot(document.getElementById('root')).render(<App />)
`)
  writeFileSync(join(hostDirectory, 'index.html'), '<!doctype html><div id="root"></div><script src="renderer.js"></script>')
  writeFileSync(join(hostDirectory, 'build-renderer.mjs'), `
import { build } from 'esbuild'
await build({ entryPoints: ['renderer.tsx'], outfile: 'renderer.js', bundle: true, format: 'iife', platform: 'browser', target: 'chrome100' })
`)
  writeFileSync(join(hostDirectory, 'main.mjs'), `
import { app, BrowserWindow, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initToggly, closeToggly, registerTogglyIpc } from '@ops-ai/electron-feature-flags-toggly/main'

const require = createRequire(import.meta.url)
const hostDirectory = dirname(fileURLToPath(import.meta.url))
const reportPath = process.env.TOGGLY_PACKED_REPORT
if (!reportPath) throw new Error('TOGGLY_PACKED_REPORT is required')
const pidPath = process.env.TOGGLY_PACKED_PID
if (pidPath) await writeFile(pidPath, String(process.pid))
let phase = 'boot'
const complete = async (code, report) => {
  await writeFile(reportPath, JSON.stringify(report))
  app.exit(code)
}
const fail = error => { void complete(3, { passed: false, phase, error: String(error) }) }
process.once('uncaughtException', fail)
process.once('unhandledRejection', fail)
setTimeout(() => fail(new Error('packed Electron host did not complete within 20 seconds')), 20_000)

app.whenReady().then(async () => {
phase = 'ready'
try {
  await initToggly({
    userDataPath: join(hostDirectory, '.toggly-user-data'),
    flagDefaults: { PackedEnabled: true, PackedDisabled: false },
    enableLiveUpdates: false,
  })
  phase = 'initialized'
  const unregister = registerTogglyIpc(ipcMain, () => BrowserWindow.getAllWindows())
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: require.resolve('@ops-ai/electron-feature-flags-toggly/preload/entry'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  await window.loadFile(join(hostDirectory, 'index.html'))
  phase = 'loaded-renderer'
  const result = await window.webContents.executeJavaScript(
    "new Promise((resolve, reject) => { const deadline = Date.now() + 5000; const poll = () => { if (window.__togglyPackedHost) return resolve(window.__togglyPackedHost); if (Date.now() > deadline) return reject(new Error('renderer did not publish bridge results')); setTimeout(poll, 10); }; poll(); })",
  )
  phase = 'received-renderer-result'
  unregister()
  await closeToggly()
  await complete(0, { passed: true, result })
} catch (error) {
  fail(error)
}
}).catch(fail)
`)
}

function launchElectron(hostDirectory, reportPath) {
  const requireFromHost = createRequire(join(hostDirectory, 'package.json'))
  const executable = realpathSync(requireFromHost('electron'))
  const stderrPath = join(hostDirectory, 'electron.stderr.log')
  const pidPath = join(hostDirectory, 'electron.pid')
  const environment = {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    TOGGLY_PACKED_REPORT: reportPath,
    TOGGLY_PACKED_PID: pidPath,
  }
  const [command, args] = process.platform === 'darwin'
    ? ['/usr/bin/open', ['-W', '-n', '-g', '--stderr', stderrPath, '--env', 'ELECTRON_DISABLE_SECURITY_WARNINGS=true', '--env', `TOGGLY_PACKED_REPORT=${reportPath}`, '--env', `TOGGLY_PACKED_PID=${pidPath}`, dirname(dirname(dirname(executable))), '--args', hostDirectory, '--headless', '--disable-gpu', '--disable-software-rasterizer']]
    : [executable, [hostDirectory, '--headless', '--disable-gpu', '--disable-software-rasterizer', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])]]

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: hostDirectory, env: environment, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { stderr += chunk })
    const timeout = setTimeout(() => {
      const pid = existsSync(pidPath) ? Number(readFileSync(pidPath, 'utf8')) : NaN
      if (Number.isSafeInteger(pid) && pid > 0) {
        try { process.kill(pid, 'SIGTERM') } catch { /* Electron may have already exited. */ }
      }
      child.kill('SIGTERM')
    }, 25_000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('close', exitCode => {
      clearTimeout(timeout)
      const fileStderr = existsSync(stderrPath) ? readFileSync(stderrPath, 'utf8') : ''
      if (!existsSync(reportPath)) {
        reject(new Error(`Electron exited with ${exitCode} without a completion report.\n${stderr}${fileStderr}`))
        return
      }
      resolve()
    })
  })
}

try {
  run('npm', ['run', 'build'], sdkDirectory)
  run('npm', ['pack', '--pack-destination', workspace], sdkDirectory)
  const { version } = JSON.parse(readFileSync(join(sdkDirectory, 'package.json'), 'utf8'))
  const tarball = join(workspace, `ops-ai-electron-feature-flags-toggly-${version}.tgz`)
  for (const row of rows.filter(row => !process.env.HOST || row.name === process.env.HOST)) {
    const hostDirectory = join(workspace, row.name)
    run('mkdir', ['-p', hostDirectory], workspace)
    writeHost(hostDirectory, tarball)
    const manifestPath = join(hostDirectory, 'package.json')
    writeFileSync(manifestPath, readFileSync(manifestPath, 'utf8').replace('PLACEHOLDER_ELECTRON', row.electron))
    run('npm', ['install'], hostDirectory)
    run(join(hostDirectory, 'node_modules', '.bin', 'tsc'), ['--noEmit'], hostDirectory)
    run('node', ['build-renderer.mjs'], hostDirectory)
    const reportPath = join(hostDirectory, 'report.json')
    await launchElectron(hostDirectory, reportPath)
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    assert.deepEqual(report, {
      passed: true,
      result: {
        bridge: 'object', getFlags: 'function', enabled: true,
        flags: { PackedEnabled: true, PackedDisabled: false },
        feature: true, negated: true, hook: 'true',
      },
    })
    console.log(`PACKED_ELECTRON_${row.electron}_HOST_PASS`)
  }
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
