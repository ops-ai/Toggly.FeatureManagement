import {verifyBrowserCleanup} from './browser-cleanup.mjs'
import {bounded,withResources,closeServer,stopChild,runOwned,launchBrowser,readHttp,clearBrowserHeaders} from './owned-resources.mjs'
import { mkdtemp, cp, writeFile, readFile, mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer as createHttpServer } from 'node:http'
import { gunzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { verifyAutomaticStartup } from './automatic-startup.test.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const version = process.argv[2] || '4.5.2'
const lockMode = process.argv[3] || 'fresh'
const lockOnly = process.argv.includes('--lock-only')
assert(['fresh', 'record', 'locked'].includes(lockMode), 'use fresh, record, or locked mode')
const retainedNode18 = version === '3.16.2'
assert(!retainedNode18 || lockMode === 'locked' || (lockMode === 'record' && lockOnly), 'Nuxt 3.16.2 is the frozen Node 18 compatibility profile; use locked mode')
const lockDir = join(root, 'tests/hosts/locks', version)
await withResources(async own => {
const work = await mkdtemp(join(tmpdir(), `nuxt-toggly-${version}-`))
own(() => rm(work,{recursive:true,force:true}))
console.log(`Host evidence: ${work}; Nuxt ${version}; Node ${process.version}`)
const telemetryRequests = []
async function waitForTelemetry(start,predicate) {
  const deadline = Date.now() + 5000
  do {
    const request = telemetryRequests.slice(start).find(request => request.payload && predicate(request))
    if (request) return request
    await new Promise(resolve => setTimeout(resolve,20))
  } while (Date.now() < deadline)
  throw Error('Expected telemetry POST did not reach collector')
}
const collector = createHttpServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Encoding')
  if (request.method === 'OPTIONS') {
    telemetryRequests.push({ method: 'OPTIONS', headers: request.headers })
    response.writeHead(204).end()
    return
  }
  const chunks = []
  request.on('data', chunk => chunks.push(chunk))
  request.on('end', () => {
    const bytes = Buffer.concat(chunks)
    const json = request.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes
    telemetryRequests.push({ method: request.method, headers: request.headers, payload: JSON.parse(json.toString()) })
    response.writeHead(202).end()
  })
})
own(() => closeServer(collector))
await new Promise(resolve => collector.listen(0, '127.0.0.1', resolve))
collector.unref()
process.env.NUXT_TEST_COLLECTOR = `http://127.0.0.1:${collector.address().port}`
const run = (command,args,cwd=work) => runOwned(command,args,{cwd,stdio:'inherit',env:process.env})
const collectFiles = async directory => {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(path))
    else files.push(path)
  }
  return files
}
await run(process.execPath,['--test',join(root,'tests/hosts/owned-resources.test.mjs')],root)
await cp(join(root, 'tests/hosts/fixture'), work, { recursive: true })
if (version.startsWith('3.')) await cp(join(work, 'app/app.vue'), join(work, 'app.vue'))
if (version === '3.0.0') {
  const configPath = join(work, 'nuxt.config.ts')
  const config = await readFile(configPath, 'utf8')
  await writeFile(configPath, config.replace(/  compatibilityDate:.*\n/, '').replace(/  devtools:.*\n/, ''))
}
await mkdir(join(work, 'artifacts'))
const dependencies = retainedNode18
  ? { nuxt: version, '@nuxt/kit': '3.16.2', vue: '3.5.13', playwright: '1.51.1', typescript: '5.7.3', 'vue-tsc': '2.2.4' }
  : { nuxt: version, vue: '3.5.42', playwright: '1.58.2', typescript: '5.9.3', 'vue-tsc': '3.2.4' }
if (process.env.TOGGLY_CLIENT_TELEMETRY_SOURCE) {
  const reporterSource = resolve(process.env.TOGGLY_CLIENT_TELEMETRY_SOURCE)
  const reporterPackage = JSON.parse(await readFile(join(reporterSource, 'package.json')))
  await run('npm', ['pack', '--pack-destination', join(work, 'artifacts')], reporterSource)
  dependencies[reporterPackage.name] = `file:artifacts/${reporterPackage.name.replace('@', '').replace('/', '-')}-${reporterPackage.version}.tgz`
  console.log('Frontend reporter resolution: local packed intermediate (registry publication pending)')
}
for (const name of ['core', 'client', 'server', '']) {
  const dir = name ? `nuxt-toggly-${name}` : 'nuxt-toggly'
  const pkg = JSON.parse(await readFile(join(root, dir, 'package.json')))
  await run('pnpm', ['pack', '--pack-destination', join(work, 'artifacts')], join(root, dir))
  dependencies[pkg.name] = `file:artifacts/${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`
}
assert(!process.env.TOGGLY_SIGNED_DEFS_ARTIFACT, 'shared dependencies must resolve from the public registry')
dependencies['@ops-ai/toggly-signed-defs'] = '1.2.7'
const manifest = { private: true, type: 'module', dependencies }
const packedSdkDependencies = Object.entries(dependencies).filter(([name]) => name.startsWith('@ops-ai/nuxt-toggly'))
const packedCandidateDependencies = Object.entries(dependencies).filter(([name]) =>
  name.startsWith('@ops-ai/nuxt-toggly') ||
  (process.env.TOGGLY_CLIENT_TELEMETRY_SOURCE && name === '@ops-ai/toggly-client-telemetry'),
)
const artifactPath = spec => spec.replace(/^file:(?:\.\/)?/, '')
const artifactIntegrity = async spec => `sha512-${createHash('sha512').update(await readFile(join(work, artifactPath(spec)))).digest('base64')}`
if (lockMode === 'locked') {
  const lockedManifest = JSON.parse(await readFile(join(lockDir, 'package.json'), 'utf8'))
  assert.deepEqual(lockedManifest, manifest, 'consumer lock must match the packed candidate versions and dependency mode')
  await cp(join(lockDir, 'package-lock.json'),join(work, 'package-lock.json'))
}
await writeFile(join(work, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
await writeFile(join(work, 'tsconfig.json'), JSON.stringify({ extends: './.nuxt/tsconfig.json' }))
const publicGraph = lock => Object.fromEntries(Object.entries(lock.packages).filter(([path]) => path && !packedSdkDependencies.some(([name]) => path === `node_modules/${name}`)))
if (lockMode === 'record' || lockMode === 'locked') {
  if (lockMode === 'record') {
    try {await cp(join(lockDir,'package-lock.json'),join(work,'package-lock.json'))} catch(error) {if(error.code!=='ENOENT')throw error}
  }
  const before = lockMode === 'locked' ? publicGraph(JSON.parse(await readFile(join(work,'package-lock.json'),'utf8'))) : null
  // pnpm packs workspace dependency keys in varying order. Let npm bind the
  // genuine current archives, while locked mode retains every registry entry.
  await run('npm', ['uninstall', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', ...packedSdkDependencies.map(([name])=>name)])
  await run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', ...packedSdkDependencies.map(([,spec])=>spec)])
  if (before) assert.deepEqual(publicGraph(JSON.parse(await readFile(join(work,'package-lock.json'),'utf8'))),before,'locked public-registry graph must remain byte-equivalent')
  if (lockMode === 'record') {
    await mkdir(lockDir, { recursive: true })
    await cp(join(work, 'package.json'), join(lockDir, 'package.json'))
    await cp(join(work, 'package-lock.json'), join(lockDir, 'package-lock.json'))
  }
}
if (lockOnly) {assert.equal(lockMode,'record');return}
await run('npm', [lockMode === 'fresh' ? 'install' : 'ci', '--no-audit', '--no-fund', ...(retainedNode18 ? ['--engine-strict'] : [])])
// Install the browser through this consumer's own Playwright dependency. This
// keeps Nuxt 3's locked host and Nuxt 4's fresh host aligned with the exact
// Playwright revision that each packed consumer resolved.
await run('npx', ['playwright', 'install', 'chromium'])
const consumerLock = JSON.parse(await readFile(join(work, 'package-lock.json'), 'utf8'))
for (const [name, spec] of packedCandidateDependencies) {
  assert.equal(consumerLock.packages[`node_modules/${name}`]?.integrity, await artifactIntegrity(spec), `${name} integrity must match its packed candidate`)
}
for (const [path, pkg] of Object.entries(consumerLock.packages)) {
  if (!path || packedCandidateDependencies.some(([name]) => path === `node_modules/${name}`)) continue
  if (pkg.resolved) assert(pkg.resolved.startsWith('https://registry.npmjs.org/'), `${path} must resolve from public npm`)
}
assert.equal(consumerLock.packages['node_modules/@ops-ai/toggly-signed-defs'].version, '1.2.7')
assert.equal(consumerLock.packages['node_modules/@ops-ai/toggly-client-telemetry'].version, '1.1.0')
console.log('Installed registry versions',JSON.stringify(Object.fromEntries(['nuxt','vue','typescript','@ops-ai/nuxt-toggly-core','@ops-ai/nuxt-toggly-client','@ops-ai/nuxt-toggly-server','@ops-ai/nuxt-toggly','@ops-ai/toggly-client-telemetry'].map(name=>[name,consumerLock.packages[`node_modules/${name}`].version]))))
console.log(`Consumer resolution: ${lockMode === 'fresh' ? 'fresh install' : 'npm ci from recorded lock'}; ${version}`)
await run('npx', ['nuxt', 'prepare'])
await run('npx', ['nuxt', 'typecheck'])
await run('npx', ['nuxt', 'build'])
const browserChunks = (await collectFiles(join(work, '.output/public/_nuxt'))).filter(path => path.endsWith('.js'))
const browserBundle = (await Promise.all(browserChunks.map(path => readFile(path, 'utf8')))).join('\n')
for (const forbidden of ['api/usage/stats', 'api/metrics', '@grpc/grpc-js', '@grpc/proto-loader', 'UsageBatcher', 'MetricsBatcher']) {
  assert(!browserBundle.includes(forbidden), `browser output must exclude trusted telemetry transport: ${forbidden}`)
}
const { chromium } = await import(pathToFileURL(join(work, 'node_modules/playwright/index.mjs')).href)
await verifyBrowserCleanup(chromium)
const { createServer: createNetServer } = await import('node:net')
const probe = createNetServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r))
const host = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: work, stdio: 'inherit', env: { ...process.env, PORT: String(port), NITRO_PORT: String(port), HOST: '127.0.0.1' } })
const url = `http://127.0.0.1:${port}`
await withResources(async ownHost => {
  ownHost(()=>stopChild(host))
  let browser
  let response
  for (let i = 0; i < 100; i++) { try { response = await readHttp(url,{},1000); if (response.ok) break } catch {} await new Promise(r => setTimeout(r, 100)) }
  assert(response?.ok, 'production host starts')
  const html = response.body
  assert.match(html, /id="gate"/); assert.match(html, /id="negated"/); assert.doesNotMatch(html, /id="all"/)
  const [alice, bob] = await Promise.all(['alice', 'bob'].map(async identity => {
    const headers = { 'x-toggly-identity': identity }
    const data = JSON.parse((await readHttp(url + '/api/context', { headers })).body)
    const html = (await readHttp(url, { headers })).body
    return { data, html }
  }))
  assert.equal(alice.data.enabled, true); assert.equal(bob.data.enabled, false)
  assert.equal(alice.data.identity, 'server-default'); assert.equal(bob.data.identity, 'server-default')
  assert.equal(alice.data.off, true); assert.equal(alice.data.any, true)
  assert.match(alice.html, /id="target">true/); assert.match(bob.html, /id="target">false/)
  assert.match(alice.html, /id="ssr-core">true/); assert.match(bob.html, /id="ssr-core">false/)
  assert.doesNotMatch(alice.html, /Audience.Users/)
  browser = await launchBrowser(chromium,ownHost)
  const blockProduction = async page => {
    // Native network blocking avoids Playwright routing's CORS interception.
    // Every fixture URL is explicit loopback; block SDK production endpoints.
    const protocol = await page.context().newCDPSession(page)
    await protocol.send('Network.enable')
    await protocol.send('Network.setBlockedURLs',{urls:['https://*','http://definitions.toggly.io/*','http://metrics.toggly.io/*']})
    return protocol
  }

  if (process.env.NUXT_TRACE_EVALUATIONS === '1') {
    const diagnostic = await browser.newPage({extraHTTPHeaders:{'x-toggly-identity':'alice'}})
    ownHost(()=>bounded(()=>diagnostic.close(),'diagnostic page close'))
    const diagnosticProtocol = await blockProduction(diagnostic)
    diagnostic.on('requestfailed', request => console.log('DIAGNOSTIC_REQUEST_FAILURE', request.url(), request.failure()?.errorText))
    diagnostic.on('console', message => console.log('DIAGNOSTIC_CONSOLE', message.text()))
    await diagnostic.goto(url+'?evaluationDiagnostic=1')
    await diagnostic.waitForFunction(()=>document.querySelector('#mounted')?.textContent==='true')
    await clearBrowserHeaders(diagnostic,diagnosticProtocol)
    for (const phase of ['initialize','identity','refresh']) {
      const start=telemetryRequests.length
      const calls=await bounded(()=>diagnostic.evaluate(phase=>window.evaluationDiagnostic(phase),phase),'diagnostic evaluation',30000)
      const packets = telemetryRequests.slice(start).filter(request=>request.payload).map(request=>request.payload)
      console.log('EVALUATION_PROVENANCE',JSON.stringify({phase,calls,packets,requests:telemetryRequests.slice(start).map(request=>({method:request.method,headers:request.headers}))}))
      const expected = {initialize:{Enabled:{enabled:[7]},Disabled:{disabled:[2]}},identity:{Enabled:{enabled:[6],disabled:[10]},Disabled:{disabled:[5]},Targeted:{disabled:[2]}},refresh:{Enabled:{disabled:[6]},Disabled:{disabled:[3]},Targeted:{disabled:[2]}}}
      assert.deepEqual(packets.map(packet=>packet.f),[expected[phase]],'diagnostic phase retains exact effective and skipped-leaf counts')
    }
    await diagnostic.close()
    telemetryRequests.length=0
  }
  const page = await browser.newPage()
  await page.setExtraHTTPHeaders({ 'x-toggly-identity': 'alice' })
  const errors = []
  const outbound = []
  const pageProtocol = await blockProduction(page)
  page.on('request',request=>{const target=new URL(request.url());if(target.hostname!=='127.0.0.1')outbound.push(target.origin)})
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', msg => { if (/hydration|mismatch/i.test(msg.text())) errors.push(msg.text()); if (/Toggly|telemetry/i.test(msg.text())) console.log(`Browser console: ${msg.text()}`) })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#mounted')?.textContent === 'true')
  // The request-scoped SSR identity header belongs only to the initial page
  // request. Remove the Playwright context header before frontend telemetry so
  // the collector can verify owner attribution without ambient identity headers.
  await clearBrowserHeaders(page,pageProtocol)
  assert.equal(await page.locator('#target').textContent(), 'true')
  assert.equal(await page.locator('#core-target').textContent(), 'true', 'public core agrees with hydrated Vue flags')
  assert.equal(await page.locator('#core-gate').textContent(), 'true', 'public core gates use hydrated flags')
  assert.equal(await page.locator('#gate').count(), 1)
  await page.locator('#init').click()
  await page.waitForFunction(() => document.querySelector('#initialized')?.textContent === 'true')
  const beforeColdFlush = telemetryRequests.length
  await page.locator('#flush-telemetry').click()
  const coldPayload = (await waitForTelemetry(beforeColdFlush,request => request.payload.k === 'fixture')).payload
  assert(coldPayload?.f?.Enabled, 'cold browser UI evaluations are reported')
  assert.deepEqual(coldPayload.f, {Enabled:{enabled:[7]},Disabled:{disabled:[2]}}, 'cold initialization counts actual consumers and skips the any gate later leaf')
  assert.equal(coldPayload.m, undefined, 'cold hydration/refresh projection emits no business metrics')
  await page.locator('#identity').click()
  await page.waitForFunction(() => document.querySelector('#flag')?.textContent === 'false')
  await page.waitForFunction(() => document.querySelector('#core-target')?.textContent === 'false')
  assert.equal(await page.locator('#core-gate').textContent(), 'false')
  assert.equal(await page.locator('#gate').count(), 0)
  assert.equal(await page.locator('#directive').isVisible(), false)
  const beforeIdentityFlush = telemetryRequests.length
  await page.locator('#flush-telemetry').click()
  let identityPayload
  for (let i = 0; i < 50; i++) {
    identityPayload = telemetryRequests.slice(beforeIdentityFlush).find(request => request.payload?.k === 'fixture')?.payload
    if (identityPayload) break
    await new Promise(r => setTimeout(r,100))
  }
  assert.deepEqual(identityPayload?.f, {Enabled:{enabled:[6],disabled:[10]},Disabled:{disabled:[5]},Targeted:{disabled:[2]}}, 'identity phase counts restored consumers and only evaluated leaves')
  const refreshed = page.waitForResponse(response => response.url().includes('/api/definitions/'))
  await page.locator('#refresh').click()
  await refreshed
  await page.waitForFunction(() => document.querySelector('#target')?.textContent === 'false')
  const beforeProjectionFlush = telemetryRequests.length
  await page.locator('#flush-telemetry').click()
  const projectionPayload = (await waitForTelemetry(beforeProjectionFlush,request => request.payload.k === 'fixture')).payload
  assert(projectionPayload?.f?.Enabled?.disabled, 'post-identity UI evaluations use the effective disabled outcome')
  assert.deepEqual(projectionPayload.f, {Enabled:{disabled:[6]},Disabled:{disabled:[3]},Targeted:{disabled:[2]}}, 'refresh phase checks every actual consumer with effective outcomes')
  assert.deepEqual([identityPayload.f.Enabled.enabled[0],identityPayload.f.Enabled.disabled[0]+projectionPayload.f.Enabled.disabled[0]], [6,16], 'combined identity and refresh counts preserve all actual Enabled checks')
  const beforeTelemetry = telemetryRequests.length
  await page.locator('#telemetry').click()
  const compact = await waitForTelemetry(beforeTelemetry,request => request.payload.m?.['fixture-counter'] === 2)
  assert(compact, 'explicit frontend telemetry reaches the cross-origin collector')
  assert.deepEqual(Object.keys(compact.payload).sort(), ['e', 'f', 'k', 'm', 'u'])
  assert.equal(compact.payload.u,'bob')
  assert.equal(compact.headers['content-encoding'], 'gzip')
  assert.equal(compact.headers.cookie, undefined)
  assert.equal(compact.headers.authorization, undefined)
  assert.equal(compact.headers['x-toggly-identity'], undefined, 'SSR-only identity header is absent from native SDK telemetry')
  assert(telemetryRequests.some(request => request.method === 'OPTIONS'), 'collector observed a real CORS preflight')
  assert.deepEqual(compact.payload.f.Enabled.disabled, [1])
  assert.deepEqual(compact.payload.f.Enabled.blue, [0, 1])
  assert.deepEqual(compact.payload.f.Enabled.green, [0, 0, 1])
  assert.equal(compact.payload.m['fixture-gauge'], 3)
  const beforePagehide = telemetryRequests.length
  await page.locator('#pagehide').click()
  for (let i = 0; telemetryRequests.length <= beforePagehide && i < 50; i++) await new Promise(r => setTimeout(r, 100))
  assert(telemetryRequests.some(request => request.payload?.m?.['pagehide-counter'] === 1), 'pagehide flushes with browser lifecycle handling')
  await page.locator('#replace-owner').click()
  for (let i = 0; !telemetryRequests.some(request => request.payload?.k === 'new-app') && i < 50; i++) await new Promise(r => setTimeout(r, 100))
  assert(!telemetryRequests.some(request => request.payload?.k === 'old-app'), 'replacement discards retired owner events')
  assert(telemetryRequests.some(request => request.payload?.k === 'new-app' && request.payload?.m?.['new-owner-count'] === 1))
  assert(!JSON.stringify(telemetryRequests).includes('stale-owner-count'))
  const mintedRequests=[]
  page.on('request',request=>{
    const target=new URL(request.url())
    if(!target.pathname.startsWith('/minted-definitions/'))return
    mintedRequests.push({token:target.searchParams.get('i'),local:target.pathname.includes('/definitions-signed'),conditional:request.headers()['if-none-match'],query:[...target.searchParams.keys()],identityHeader:request.headers()['x-toggly-identity']})
  })
  const mintedStart=telemetryRequests.length
  assert.deepEqual(await bounded(()=>page.evaluate(()=>window.verifyMinted()),'minted browser checks',30000),[true,false,true,true,true,true,true])
  const mintedPackets=telemetryRequests.slice(mintedStart).filter(request=>request.payload?.k==='minted-fixture')
  // Context changes seal batches. Returning to token-a retains separate earlier
  // batches; reentrant capture also stays separate from the sealed pre-hook check.
  assert.deepEqual(mintedPackets.map(request=>request.payload),[
    {k:'minted-fixture',e:'Production',i:'token-a',f:{Flag:{enabled:[1]}}},
    {k:'minted-fixture',e:'Production',i:'token-b',f:{Flag:{disabled:[1]}}},
    {k:'minted-fixture',e:'Production',i:'token-a',f:{Flag:{enabled:[2]},Raw:{enabled:[1]}}},
    {k:'minted-fixture',e:'Production',i:'token-a',f:{Flag:{enabled:[1]}}},
    {k:'minted-fixture',e:'Production',i:'token-a',f:{Flag:{enabled:[1]}}},
    {k:'minted-fixture',e:'Production',i:'token-b',m:{'minted-pagehide':1}},
  ])
  assert.equal(mintedPackets.at(-1).headers['content-encoding'],undefined,'pagehide uses plain keepalive')
  assert(mintedRequests.every(request=>!request.identityHeader&&!request.query.some(key=>['u','g','claim.plan'].includes(key))))
  assert(mintedRequests.some(request=>request.token==='token-a'&&!request.local&&request.conditional==='remote-token-a'))
  assert(mintedRequests.some(request=>request.local&&!request.conditional),'local mode cannot send remote validator')
  console.log('PASS minted context: i precedence, owner replacement, captured reentrant check, mode/body/304 public results and plain keepalive')
  assert.deepEqual(outbound, [])
  assert.deepEqual(errors, [])
  console.log(`PASS Nuxt ${version}: packed install, types, build, SSR gates, request isolation, hydration, initialization, identity, refresh, directives`)
})
await verifyAutomaticStartup(work, chromium)
})
