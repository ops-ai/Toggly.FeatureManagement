import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
    )
  }
  return result
}

function writeHost(hostDirectory, tarball) {
  writeFileSync(
    join(hostDirectory, 'package.json'),
    JSON.stringify(
      {
        private: true,
        type: 'module',
        main: 'main.mjs',
        dependencies: {
          '@ops-ai/electron-feature-flags-toggly': tarball,
          electron: 'PLACEHOLDER_ELECTRON',
          ...(process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL
            ? {
                '@ops-ai/toggly-client-telemetry':
                  process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL,
              }
            : {}),
          esbuild: '0.25.10',
          react: '18.3.1',
          'react-dom': '18.3.1',
          typescript: '5.9.3',
          '@types/react': '18.3.28',
          '@types/react-dom': '18.3.7',
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(hostDirectory, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          jsx: 'react-jsx',
          strict: true,
          skipLibCheck: false,
          noEmit: true,
        },
        include: ['consumer.tsx'],
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(hostDirectory, 'consumer.tsx'),
    `
import { initToggly, registerTogglyIpc } from '@ops-ai/electron-feature-flags-toggly/main'
import { exposeToggly } from '@ops-ai/electron-feature-flags-toggly/preload'
import { isFeatureOn, recordUsage, recordView, incrementCounter, setGauge, flushTelemetry, type TogglyTelemetry } from '@ops-ai/electron-feature-flags-toggly/renderer'
import { Feature, useFeatureFlag } from '@ops-ai/electron-feature-flags-toggly/react'
void initToggly
void registerTogglyIpc
void exposeToggly
void isFeatureOn
void Feature
void useFeatureFlag
const telemetry: TogglyTelemetry = {recordUsage, recordView, incrementCounter, setGauge, flushTelemetry}
telemetry.recordUsage('Action', 'blue'); telemetry.recordView('Panel'); telemetry.incrementCounter('orders', 2); telemetry.setGauge('cart', 3); void telemetry.flushTelemetry()
`,
  )
  writeFileSync(
    join(hostDirectory, 'renderer.tsx'),
    `
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
  if (window.__publishing) return
  window.__publishing = true
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

function Abandoned() {useFeatureFlag('NeverCommitted');throw new Promise(()=>{})}
function App() {
  const { isEnabled } = useFeatureFlag('PackedEnabled')
  useEffect(() => { publish() }, [isEnabled])
  return <>
    <React.Suspense fallback={null}><Abandoned /></React.Suspense>
    <span id="hook">{String(isEnabled)}</span>
    <Feature featureKey="PackedEnabled"><span id="feature">enabled</span></Feature>
    <Feature featureKey="PackedDisabled" negate><span id="negated">disabled</span></Feature>
  </>
}

let root=createRoot(document.getElementById('root')); window.unmount=()=>root.unmount();
window.remount=()=>{root=createRoot(document.getElementById('root'));root.render(<React.StrictMode><App /></React.StrictMode>)};
root.render(<React.StrictMode><App /></React.StrictMode>)
`,
  )
  writeFileSync(
    join(hostDirectory, 'index.html'),
    '<!doctype html><div id="root"></div><script src="renderer.js"></script>',
  )
  writeFileSync(
    join(hostDirectory, 'build-renderer.mjs'),
    `
import { build } from 'esbuild'
await build({ entryPoints: ['renderer.tsx'], outfile: 'renderer.js', bundle: true, format: 'iife', platform: 'browser', target: 'chrome100' })
`,
  )
  writeFileSync(
    join(hostDirectory, 'main.mjs'),
    `
import { app, BrowserWindow, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initToggly, getToggly, closeToggly, registerTogglyIpc, attachTogglyLifecycle } from '@ops-ai/electron-feature-flags-toggly/main'
import {createServer} from 'node:http'
import {gunzipSync} from 'node:zlib'
import assert from 'node:assert/strict'

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
  const packets=[]; const requests=[]
  const collector=createServer(async(request,response)=>{
    assert.equal(request.url,'/base/api/frontend/telemetry');assert.equal(request.headers.origin,undefined);assert.equal(request.headers.cookie,undefined)
    const chunks=[];for await(const chunk of request)chunks.push(chunk)
    const bytes=Buffer.concat(chunks);const json=request.headers['content-encoding']==='gzip'?gunzipSync(bytes).toString():bytes.toString()
    packets.push(JSON.parse(json));requests.push(request.headers);response.writeHead(202).end()
  });await new Promise(resolve=>collector.listen(0,'127.0.0.1',resolve))
  await initToggly({
    appKey:'electron-packed',environment:'Test',metricsBaseUrl:'http://127.0.0.1:'+collector.address().port+'/base',
    fetch:async()=>new Response(JSON.stringify({defs:{PackedEnabled:true,PackedDisabled:false}})),
    userDataPath: join(hostDirectory, '.toggly-user-data'),
    flagDefaults: { PackedEnabled: true, PackedDisabled: false },
    enableLiveUpdates: false,
  })
  phase = 'initialized'
  attachTogglyLifecycle(app)
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
  await getToggly().flushTelemetry()
  assert.deepEqual(packets,[{k:'electron-packed',e:'Test',f:{PackedEnabled:{enabled:[3]},PackedDisabled:{disabled:[1]}}}])
  assert.equal(requests[0]['content-encoding'],'gzip');assert.equal(requests[0].origin,undefined);assert.equal(requests[0].cookie,undefined)
  await window.webContents.executeJavaScript("window.toggly.recordUsage('Action');window.toggly.recordView('Panel','blue');window.toggly.incrementCounter('orders',2);window.toggly.setGauge('cart',3.5);window.toggly.flushTelemetry()")
  assert.deepEqual(packets[1],{k:'electron-packed',e:'Test',f:{Action:{enabled:[0,1]},Panel:{blue:[0,0,1]}},m:{orders:2,cart:3.5}})
  await getToggly().refresh();await new Promise(resolve=>setTimeout(resolve,100));await getToggly().flushTelemetry();assert.equal(packets.length,2)
  await window.webContents.executeJavaScript('window.unmount()')
  await window.webContents.executeJavaScript('window.remount()')
  await new Promise(resolve=>setTimeout(resolve,100));await getToggly().flushTelemetry()
  assert.deepEqual(packets[2],{k:'electron-packed',e:'Test',f:{PackedEnabled:{enabled:[2]},PackedDisabled:{disabled:[1]}}})
  const previous=getToggly()
  await initToggly({userDataPath:join(hostDirectory,'.new-owner'),appKey:'replacement',environment:'New',metricsBaseUrl:'http://127.0.0.1:'+collector.address().port+'/base',enableLiveUpdates:false,fetch:async()=>new Response(JSON.stringify({defs:{PackedEnabled:false,PackedDisabled:false}}))})
  registerTogglyIpc(ipcMain,()=>BrowserWindow.getAllWindows());attachTogglyLifecycle(app)
  await new Promise(resolve=>setTimeout(resolve,100));await previous.flushTelemetry();await getToggly().flushTelemetry()
  assert.deepEqual(packets[3],{k:'replacement',e:'New',f:{PackedEnabled:{disabled:[2]},PackedDisabled:{disabled:[1]}}})
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('#hook').textContent"),'false')
  const other = new BrowserWindow({show:false,webPreferences:{preload:require.resolve('@ops-ai/electron-feature-flags-toggly/preload/entry'),contextIsolation:true,nodeIntegration:false}})
  await other.loadURL('data:text/html,<p>Second window</p>')
  await other.webContents.executeJavaScript("window.toggly.recordUsage('SecondWindow');window.toggly.isFeatureOn('PackedEnabled');window.toggly.flushTelemetry()")
  assert.deepEqual(packets[4],{k:'replacement',e:'New',f:{SecondWindow:{enabled:[0,1]},PackedEnabled:{disabled:[1]}}})
  window.destroy()
  await other.webContents.executeJavaScript("window.toggly.recordView('AfterOtherClosed');window.toggly.flushTelemetry()")
  assert.equal(packets[5].f.AfterOtherClosed.enabled[2],1)
  getToggly().recordUsage('Final');const closing=getToggly()
  app.once('will-quit', event => {
    event.preventDefault()
    void (async()=>{
      assert.equal(requests[6]['content-encoding'],undefined)
      assert.deepEqual(packets[6],{k:'replacement',e:'New',f:{Final:{enabled:[0,1]}}})
      closing.recordUsage('Late');await closing.flushTelemetry();assert.equal(packets.length,7)
      collector.close();unregister();closeToggly();await complete(0,{passed:true,result})
    })().catch(fail)
  })
  app.quit()
} catch (error) {
  fail(error)
}
}).catch(fail)
`,
  )
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
  const [command, args] =
    process.platform === 'darwin'
      ? [
          '/usr/bin/open',
          [
            '-W',
            '-n',
            '-g',
            '--stderr',
            stderrPath,
            '--env',
            'ELECTRON_DISABLE_SECURITY_WARNINGS=true',
            '--env',
            `TOGGLY_PACKED_REPORT=${reportPath}`,
            '--env',
            `TOGGLY_PACKED_PID=${pidPath}`,
            dirname(dirname(dirname(executable))),
            '--args',
            hostDirectory,
            '--headless',
            '--disable-gpu',
            '--disable-software-rasterizer',
          ],
        ]
      : [
          executable,
          [
            hostDirectory,
            '--headless',
            '--disable-gpu',
            '--disable-software-rasterizer',
            ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
          ],
        ]

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: hostDirectory,
      env: environment,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    const timeout = setTimeout(() => {
      const pid = existsSync(pidPath)
        ? Number(readFileSync(pidPath, 'utf8'))
        : NaN
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          /* Electron may have already exited. */
        }
      }
      child.kill('SIGTERM')
    }, 25_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (exitCode) => {
      clearTimeout(timeout)
      const fileStderr = existsSync(stderrPath)
        ? readFileSync(stderrPath, 'utf8')
        : ''
      if (!existsSync(reportPath)) {
        reject(
          new Error(
            `Electron exited with ${exitCode} without a completion report.\n${stderr}${fileStderr}`,
          ),
        )
        return
      }
      resolve()
    })
  })
}

try {
  if (process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL)
    console.log('LOCAL_TELEMETRY_TARBALL: registry acceptance pending')
  run('npm', ['run', 'build'], sdkDirectory)
  run('npm', ['pack', '--pack-destination', workspace], sdkDirectory)
  const { version } = JSON.parse(
    readFileSync(join(sdkDirectory, 'package.json'), 'utf8'),
  )
  const tarball = join(
    workspace,
    `ops-ai-electron-feature-flags-toggly-${version}.tgz`,
  )
  for (const row of rows.filter(
    (row) => !process.env.HOST || row.name === process.env.HOST,
  )) {
    const hostDirectory = join(workspace, row.name)
    run('mkdir', ['-p', hostDirectory], workspace)
    writeHost(hostDirectory, tarball)
    const manifestPath = join(hostDirectory, 'package.json')
    writeFileSync(
      manifestPath,
      readFileSync(manifestPath, 'utf8').replace(
        'PLACEHOLDER_ELECTRON',
        row.electron,
      ),
    )
    run('npm', ['install'], hostDirectory)
    run(
      join(hostDirectory, 'node_modules', '.bin', 'tsc'),
      ['--noEmit'],
      hostDirectory,
    )
    run('node', ['build-renderer.mjs'], hostDirectory)
    assert.doesNotMatch(
      readFileSync(join(hostDirectory, 'renderer.js'), 'utf8'),
      /node:zlib|node:http|createTelemetryReporter|metrics\.toggly\.io/,
    )
    const reportPath = join(hostDirectory, 'report.json')
    await launchElectron(hostDirectory, reportPath)
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    assert.deepEqual(report, {
      passed: true,
      result: {
        bridge: 'object',
        getFlags: 'function',
        enabled: true,
        flags: { PackedEnabled: true, PackedDisabled: false },
        feature: true,
        negated: true,
        hook: 'true',
      },
    })
    console.log(`PACKED_ELECTRON_${row.electron}_HOST_PASS`)
  }
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
