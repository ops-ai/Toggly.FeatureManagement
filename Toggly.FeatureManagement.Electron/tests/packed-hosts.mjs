import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { run, launchOwnedElectron, stopOwnedElectron, assertNoOwnedElectron } from './owned-process.mjs'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
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
import { ElectronTogglyClient, initToggly, getToggly, closeToggly, registerTogglyIpc, attachTogglyLifecycle } from '@ops-ai/electron-feature-flags-toggly/main'
import {createServer} from 'node:http'
import {gunzipSync} from 'node:zlib'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const hostDirectory = dirname(fileURLToPath(import.meta.url))
app.setPath('userData', join(hostDirectory, '.electron-profile'))
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
  const packets=[]; const requests=[]; const definitions=[]
  const collector=createServer(async(request,response)=>{
    assert.equal(request.url,'/base/api/frontend/telemetry');assert.equal(request.headers.origin,undefined);assert.equal(request.headers.cookie,undefined)
    const chunks=[];const deadline=setTimeout(()=>request.destroy(new Error('Collector body deadline')),2000);try{for await(const chunk of request)chunks.push(chunk)}finally{clearTimeout(deadline)}
    const bytes=Buffer.concat(chunks);const json=request.headers['content-encoding']==='gzip'?gunzipSync(bytes).toString():bytes.toString()
    packets.push(JSON.parse(json));requests.push(request.headers);response.writeHead(202).end()
  });await new Promise(resolve=>collector.listen(0,'127.0.0.1',resolve))
  for(const mode of ['headers','body']) {
    let closed=false
    const held=createServer((request,response)=>{request.socket.once('close',()=>{closed=true});if(mode==='body'){response.writeHead(200,{'content-type':'application/json'});response.write('{')}})
    await new Promise(resolve=>held.listen(0,'127.0.0.1',resolve))
    const client=new ElectronTogglyClient({appKey:'deadline',enableTelemetry:false,enableLiveUpdates:false,featureFlagsRefreshInterval:0,connectTimeout:150,baseURI:'http://127.0.0.1:'+held.address().port,userDataPath:join(hostDirectory,'deadline-'+mode),flagDefaults:{Fallback:true}})
    try {
      const started=Date.now();assert.deepEqual(await client.init(),{Fallback:true});assert.ok(Date.now()-started<2000)
      const deadline=Date.now()+1000;while(!closed&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(closed,true)
    } finally {client.close();held.closeAllConnections();await new Promise(resolve=>held.close(resolve))}
  }
  await initToggly({
    appKey:'electron-packed',environment:'Test',identity:'packed-user',metricsBaseUrl:'http://127.0.0.1:'+collector.address().port+'/base',
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
  assert.deepEqual(packets,[{k:'electron-packed',e:'Test',u:'packed-user',f:{PackedEnabled:{enabled:[3]},PackedDisabled:{disabled:[1]}}}])
  assert.equal(requests[0]['content-encoding'],'gzip');assert.equal(requests[0].origin,undefined);assert.equal(requests[0].cookie,undefined)
  await window.webContents.executeJavaScript("window.toggly.recordUsage('Action');window.toggly.recordView('Panel','blue');window.toggly.incrementCounter('orders',2);window.toggly.setGauge('cart',3.5);window.toggly.flushTelemetry()")
  assert.deepEqual(packets[1],{k:'electron-packed',e:'Test',u:'packed-user',f:{Action:{enabled:[0,1]},Panel:{blue:[0,0,1]}},m:{orders:2,cart:3.5}})
  await getToggly().refresh();await new Promise(resolve=>setTimeout(resolve,100));await getToggly().flushTelemetry();assert.equal(packets.length,2)
  await window.webContents.executeJavaScript('window.unmount()')
  await window.webContents.executeJavaScript('window.remount()')
  await new Promise(resolve=>setTimeout(resolve,100));await getToggly().flushTelemetry()
  assert.deepEqual(packets[2],{k:'electron-packed',e:'Test',u:'packed-user',f:{PackedEnabled:{enabled:[2]},PackedDisabled:{disabled:[1]}}})
  const previous=getToggly()
  await initToggly({userDataPath:join(hostDirectory,'.new-owner'),appKey:'replacement',environment:'New',identity:'next-user',metricsBaseUrl:'http://127.0.0.1:'+collector.address().port+'/base',enableLiveUpdates:false,baseURI:'https://defs.test/prefix/?i=retired&i=older&u=old&userId=old&g=one&g=two&claim.role=old&keep=one&keep=two',fetch:async(url,init)=>{definitions.push({url:String(url),headers:init.headers});return new Response(JSON.stringify({defs:{PackedEnabled:new URL(url).searchParams.get('i')==='token-a',PackedDisabled:false}}))}})
  registerTogglyIpc(ipcMain,()=>BrowserWindow.getAllWindows());attachTogglyLifecycle(app)
  await new Promise(resolve=>setTimeout(resolve,100));await previous.flushTelemetry();await getToggly().flushTelemetry()
  assert.deepEqual(packets[3],{k:'replacement',e:'New',u:'next-user',f:{PackedEnabled:{disabled:[2]},PackedDisabled:{disabled:[1]}}})
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('#hook').textContent"),'false')
  const other = new BrowserWindow({show:false,webPreferences:{preload:require.resolve('@ops-ai/electron-feature-flags-toggly/preload/entry'),contextIsolation:true,nodeIntegration:false}})
  await other.loadURL('data:text/html,<p>Second window</p>')
  await other.webContents.executeJavaScript("window.toggly.recordUsage('SecondWindow');window.toggly.isFeatureOn('PackedEnabled');window.toggly.flushTelemetry()")
  assert.deepEqual(packets[4],{k:'replacement',e:'New',u:'next-user',f:{SecondWindow:{enabled:[0,1]},PackedEnabled:{disabled:[1]}}})
  window.destroy()
  await other.webContents.executeJavaScript("window.toggly.recordView('AfterOtherClosed');window.toggly.flushTelemetry()")
  assert.equal(packets[5].f.AfterOtherClosed.enabled[2],1)
  const beforeInvalid=definitions.length
  for(const invalid of [{instanceId:42},{instanceId:'ok',appKey:'forbidden'},{groups:[42]}]) {
    assert.equal(await other.webContents.executeJavaScript('window.toggly.setContext('+JSON.stringify(invalid)+').then(()=>false,()=>true)'),true)
  }
  assert.equal(definitions.length,beforeInvalid)
  let finalUser='next-user'
  const changes=[{input:{instanceId:' token-a ',groups:['team'],claims:{role:'member'}},i:'token-a',enabled:true},{input:{instanceId:'token-b'},i:'token-b',enabled:false},{input:{groups:['other']},i:'token-b',enabled:false},{input:{instanceId:' '},u:'next-user',enabled:false},{input:{identity:'bob'},u:'bob',enabled:false},{clear:true,enabled:false}]
  for(const change of changes) {
    await other.webContents.executeJavaScript(change.clear?'window.toggly.clearContext()':'window.toggly.setContext('+JSON.stringify(change.input)+')')
    const definition=new URL(definitions.at(-1).url)
    assert.equal(definition.pathname,'/prefix/evaluated-signed/replacement/New');assert.deepEqual(definition.searchParams.getAll('keep'),['one','two'])
    const identity=change.clear?definition.searchParams.get('u'):change.u
    if(change.clear)assert.match(identity,/^[a-f0-9-]{36}$/)
    assert.deepEqual(definition.searchParams.getAll('i'),change.i?[change.i]:[])
    if(change.i)assert.deepEqual(Array.from(definition.searchParams.keys()).filter(key=>['u','userId','g'].includes(key)||key.startsWith('claim.')),[])
    else {assert.equal(definition.searchParams.get('u'),identity);finalUser=identity}
    const count=packets.length
    assert.equal(await other.webContents.executeJavaScript("window.toggly.isFeatureOn('PackedEnabled')"),change.enabled)
    await other.webContents.executeJavaScript("window.toggly.recordUsage('Token');window.toggly.flushTelemetry()")
    assert.equal(packets.length,count+1)
    assert.deepEqual(packets.at(-1),{k:'replacement',e:'New',...(change.i?{i:change.i}:{u:identity}),f:{PackedEnabled:{[change.enabled?'enabled':'disabled']:[1]},Token:{enabled:[0,1]}}})
  }
  const finalIndex=packets.length
  getToggly().recordUsage('Final');const closing=getToggly()
  app.once('will-quit', event => {
    event.preventDefault()
    void (async()=>{
      assert.equal(requests[finalIndex]['content-encoding'],undefined)
      assert.deepEqual(packets[finalIndex],{k:'replacement',e:'New',u:finalUser,f:{Final:{enabled:[0,1]}}})
      closing.recordUsage('Late');await closing.flushTelemetry();assert.equal(packets.length,finalIndex+1)
      collector.closeAllConnections();collector.close();unregister();closeToggly();await complete(0,{passed:true,result})
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

function launchElectron(hostDirectory, reportPath, timeoutMs = 30000, ownershipRoot = hostDirectory) {
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

  const application = process.platform === 'darwin' ? dirname(dirname(dirname(executable))) : executable
  return launchOwnedElectron(command, args, ownershipRoot, application, environment, timeoutMs).then(() => {
    if (!existsSync(reportPath)) throw new Error('Electron exited without a completion report')
  }).catch(error => {
    const details = [stderrPath, reportPath].filter(existsSync).map(path => readFileSync(path, 'utf8')).join('\n')
    throw new Error(String(error) + '\n' + details, {cause:error})
  })
}


async function cleanupControls(hostDirectory) {
  const executable = realpathSync(createRequire(join(hostDirectory, 'package.json'))('electron'))
  const application = process.platform === 'darwin' ? dirname(dirname(dirname(executable))) : executable
  for (const mode of ['blocked', 'abrupt', 'negative']) {
    const root = join(hostDirectory, 'control-' + mode)
    mkdirSync(root)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', main: 'main.mjs' }))
    writeFileSync(join(root, 'main.mjs'), `import {app,BrowserWindow} from 'electron';import {createServer} from 'node:http';import {writeFileSync} from 'node:fs';app.setPath('userData',${JSON.stringify(join(root, 'profile'))});app.whenReady().then(async()=>{const win=new BrowserWindow({show:false});await win.loadURL('data:text/html,<p>owned resource control</p>');const server=createServer((_q,r)=>r.end('owned'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));writeFileSync(${JSON.stringify(join(root, 'started.json'))},JSON.stringify({pid:process.pid,port:server.address().port}));${mode === 'abrupt' ? 'process.exit(7)' : mode === 'blocked' ? 'while(true){}' : 'setInterval(()=>{},1000)'}}).catch(error=>{console.error(error);app.exit(3)})`)
    const launch = launchElectron(root, join(root, 'report.json'), 8000, hostDirectory)
    // Observe rejection immediately while waiting for the independent marker.
    const result = launch.then(() => ({ok:true}), error => ({error}))
    let marker, primary
    try {
      const deadline=Date.now()+6000
      while (!existsSync(join(root, 'started.json')) && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,25))
      assert.ok(existsSync(join(root,'started.json')), `Actual Electron ${mode} must start: ${existsSync(join(root,'electron.stderr.log')) ? readFileSync(join(root,'electron.stderr.log'),'utf8') : 'no stderr'}`)
      marker=JSON.parse(readFileSync(join(root,'started.json'),'utf8'))
      if (mode === 'negative') {
        await assert.rejects(assertNoOwnedElectron(hostDirectory,application), /Owned Electron resources remain/)
        await stopOwnedElectron(hostDirectory,application)
      }
      const outcome=await result
      assert.ok(outcome.error, `${mode} cannot count as a successful host`)
      if(mode==='blocked') assert.match(String(outcome.error), /exceeded/)
      await assertNoOwnedElectron(hostDirectory,application)
      try {process.kill(marker.pid,0);assert.fail('Actual Electron PID survived')} catch(error) {assert.equal(error.code,'ESRCH')}
      const {createConnection}=await import('node:net')
      const connected=await new Promise((resolve,reject)=>{const socket=createConnection({host:'127.0.0.1',port:marker.port});socket.setTimeout(1000,()=>{socket.destroy();reject(new Error('Owned port probe timed out'))});socket.once('connect',()=>{socket.destroy();resolve(true)});socket.once('error',()=>resolve(false))})
      assert.equal(connected,false)
      console.log(`Actual Electron ${mode} cleanup passed: PID ${marker.pid}, port ${marker.port}`)
    } catch(error) {
      primary=error
      throw error
    } finally {
      const cleanup=[]
      try {await stopOwnedElectron(hostDirectory,application)} catch(error) {cleanup.push(error)}
      await result
      try {rmSync(root,{recursive:true,force:true})} catch(error) {cleanup.push(error)}
      if(cleanup.length)throw new AggregateError([...(primary?[primary]:[]),...cleanup],'Independent Electron control cleanup failed')
    }
  }
}

try {
  if (process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL) throw new Error('Genuine registry acceptance requires the published reporter')
  await run('npm', ['run', 'build'], sdkDirectory)
  await run('npm', ['pack', '--pack-destination', workspace], sdkDirectory)
  const { version } = JSON.parse(
    readFileSync(join(sdkDirectory, 'package.json'), 'utf8'),
  )
  const tarball = join(
    workspace,
    `ops-ai-electron-feature-flags-toggly-${version}.tgz`,
  )
  console.log('Packed archive SHA256', createHash('sha256').update(readFileSync(tarball)).digest('hex'))
  for (const row of rows.filter(
    (row) => !process.env.HOST || row.name === process.env.HOST,
  )) {
    const hostDirectory = join(workspace, row.name)
    console.log(`Owned Electron host: ${hostDirectory}`)
    await run('mkdir', ['-p', hostDirectory], workspace)
    writeHost(hostDirectory, tarball)
    const manifestPath = join(hostDirectory, 'package.json')
    writeFileSync(
      manifestPath,
      readFileSync(manifestPath, 'utf8').replace(
        'PLACEHOLDER_ELECTRON',
        row.electron,
      ),
    )
    const env = { ...process.env, npm_config_cache: join(hostDirectory, 'npm-cache'), electron_config_cache: join(hostDirectory, 'electron-cache') }
    await run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], hostDirectory, { env })
    await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], hostDirectory, { env })
    await run(process.execPath, ['node_modules/electron/install.js'], hostDirectory, { env })
    await run('npm', ['ls', '--all'], hostDirectory, { env })
    const reporter = JSON.parse(readFileSync(join(hostDirectory, 'node_modules/@ops-ai/toggly-client-telemetry/package.json'), 'utf8'))
    const lock = JSON.parse(readFileSync(join(hostDirectory, 'package-lock.json'), 'utf8'))
    assert.equal(reporter.version, '1.1.0')
    assert.match(lock.packages['node_modules/@ops-ai/toggly-client-telemetry'].resolved, /^https:\/\/registry.npmjs.org\//)
    console.log(`Public reporter: ${reporter.version} ${lock.packages['node_modules/@ops-ai/toggly-client-telemetry'].integrity}`)
    console.log('Registry dependencies', JSON.stringify(Object.fromEntries(['electron','@ops-ai/toggly-hooks-types','@ops-ai/toggly-signed-defs','@ops-ai/toggly-local-gates'].map(name=>[name,JSON.parse(readFileSync(join(hostDirectory,'node_modules',name,'package.json'),'utf8')).version]))))
    await run(
      join(hostDirectory, 'node_modules', '.bin', 'tsc'),
      ['--noEmit'],
      hostDirectory,
    )
    await run('node', ['build-renderer.mjs'], hostDirectory)
    assert.doesNotMatch(
      readFileSync(join(hostDirectory, 'renderer.js'), 'utf8'),
      /node:zlib|node:http|createTelemetryReporter|metrics\.toggly\.io/,
    )
    await cleanupControls(hostDirectory)
    await run(process.execPath, [fileURLToPath(new URL('./native-owner-controls.mjs', import.meta.url)), hostDirectory], sdkDirectory, {timeoutMs:90000})
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
    rmSync(hostDirectory, {recursive:true,force:true})
    console.log(`Removed Electron host: ${hostDirectory}`)
  }
} finally {
  rmSync(workspace, { recursive: true, force: true })
  console.log(`Removed Electron workspace: ${workspace}`)
}
