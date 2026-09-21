import { createServer } from 'node:http'
import { gunzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { withResources, closeServer, ownBrowser } from './host-resources.mjs'
const require = createRequire(join(process.cwd(), 'package.json'))
const {default: puppeteer} = await import(require.resolve('puppeteer-core'))
export async function verifyBrowser(port, launch = () => puppeteer.launch({executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox']})) {
return withResources(async defer => {
const telemetry = []
const headers = []
let preflights = 0
const collector = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', request.headers.origin ?? '*')
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Encoding')
  if (request.method === 'OPTIONS') {preflights++; response.writeHead(204); response.end(); return}
  if (request.method !== 'POST' || request.url !== '/api/frontend/telemetry') {response.writeHead(404); response.end(); return}
  const chunks = []
  request.on('data', chunk => chunks.push(chunk))
  request.on('end', () => {
    const bytes = Buffer.concat(chunks)
    headers.push(request.headers)
    telemetry.push(JSON.parse((request.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes).toString()))
    response.writeHead(202); response.end()
  })
})
defer(() => closeServer(collector))
await new Promise((resolve, reject) => {collector.once('error', reject); collector.listen(0, '127.0.0.1', resolve)})
  const browser = await launch()
  ownBrowser(defer, browser)
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text())})
  let remoteEnabled = true
  const identities = []
  const cacheRequests = []
  await page.setRequestInterception(true)
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/cache-fixture/')) {
      const token=url.searchParams.get('i'), revision=`rev-${token}`
      const conditional=request.headers()['if-none-match']?.replaceAll('"','')
      cacheRequests.push({token, conditional})
      void request.respond(conditional===revision ? {status:304} : {status:200,contentType:'application/json',headers:{etag:revision},body:JSON.stringify({defs:{On:token==='cache-a'}})})
    } else if (url.pathname.startsWith('/definitions-fixture/')) {
      identities.push({i:url.searchParams.get('i'),u:url.searchParams.get('u'),g:url.searchParams.get('g'),claim:url.searchParams.get('claim.role')})
      const enabled = url.pathname.includes('/replacement/') ? false : remoteEnabled
      void request.respond({status: 200, contentType: 'application/json', body: JSON.stringify({defs: {On: enabled, Off: false, Second: true}})})
    } else void request.continue()
  })
  await page.goto(`http://127.0.0.1:${port}/?metrics=${encodeURIComponent(`http://127.0.0.1:${collector.address().port}`)}`)
  const state = async expected => {
    await page.waitForFunction(value => ['flag', 'gate', 'variant', 'switch'].every(id => document.querySelector(`[data-testid="${id}"]`)?.textContent === value)
      && !!document.querySelector('[data-testid="visible"]') === (value === 'on')
      && !!document.querySelector('[data-testid="negated"]') === (value === 'off')
      && window.fixture.current.isReady, {timeout: 10000}, expected)
  }
  await state('on')
  await page.click('#local-off'); await state('off')
  await page.click('#local-on'); await state('on')
  // Identity refresh must preserve already queued events on this owner.
  await page.evaluate(() => window.fixture.current.telemetry.recordUsage('Queued'))
  remoteEnabled = false; await page.click('#context'); await page.waitForFunction(() => window.fixture.current.identity === 'second-user'); await state('off')
  assert.ok(identities.some(value => value.u === 'second-user'))
  assert.ok(identities.some(value => value.i === 'mint-a' && value.u === null && value.g === null && value.claim === null))
  remoteEnabled = true; await page.click('#refresh'); await state('on')
  await page.evaluate(() => window.fixture.current.telemetry.flushTelemetry())
  assert.ok(telemetry.some(body => body.f?.On?.enabled?.[0] > 1))
  assert.ok(telemetry.some(body => body.f?.On?.disabled?.[0] > 0))
  assert.ok(telemetry.some(body => body.i === 'mint-a' && !body.u && body.f?.Queued?.enabled?.[1] === 1))
  assert.ok(telemetry.some(body => body.u === 'second-user' && !body.i && body.f?.On?.disabled?.[0] > 0))
  assert.ok(telemetry.every(body => Object.entries(body.f ?? {}).filter(([key]) => key !== 'Queued').every(([, variants]) => Object.values(variants).every(counts => counts.length === 1))), 'rendering is not an implicit view or usage')
  telemetry.length = 0
  await page.evaluate(async () => {window.fixture.recordTelemetry(); await window.fixture.current.telemetry.flushTelemetry()})
  const expected = {k: 'fixture', e: 'Test', u: 'second-user', f: {On: {enabled: [0, 1], control: [0, 0, 1]}}, m: {orders: 2, cart: 3}}
  assert.deepEqual(telemetry, [expected])
  assert.ok(preflights > 0, 'real cross-origin preflight')
  assert.ok(headers.some(value => value['content-encoding'] === 'gzip'), 'native browser gzip')
  assert.ok(headers.every(value => !value.cookie && !value.authorization), 'credential-free telemetry')
  const count = async expectedCount => {
    const deadline = Date.now() + 5000
    while (telemetry.length < expectedCount && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(telemetry.length, expectedCount)
  }
  await page.evaluate(() => {window.fixture.recordTelemetry(); window.dispatchEvent(new Event('pagehide'))})
  await count(2); assert.deepEqual(telemetry[1], expected)
  assert.ok(headers.some(value => !value['content-encoding']), 'plain keepalive lifecycle body')
  await page.evaluate(() => {window.fixture.recordTelemetry(); window.fixture.unmount()})
  await count(3); assert.deepEqual(telemetry[2], expected)
  await page.evaluate(() => window.fixture.remount()); await state('on')
  await page.evaluate(() => window.fixture.current.telemetry.flushTelemetry())
  assert.ok(telemetry[3].f.On.enabled[0] > 0)
  telemetry.length = 0
  await page.evaluate(() => window.fixture.replaceOwner()); await state('off')
  await page.evaluate(() => window.fixture.current.telemetry.flushTelemetry())
  assert.ok(telemetry.length > 0)
  assert.ok(telemetry.every(body => body.k === 'replacement' && body.e === 'New' && !body.f?.On?.enabled && body.f?.On?.disabled?.[0] > 0), 'no retained old snapshot under the replacement owner')
  telemetry.length = 0
  await page.evaluate(async () => {
    const owner = window.fixture.current
    await owner.setContext({instanceId: 'mint-b'})
    owner.client.recordUsage('TokenB', 'ignored-user', 'control')
    await owner.setContext({instanceId: 'mint-c'})
    owner.client.recordView('TokenC', 'ignored-user', 'treatment')
    await owner.setContext({instanceId: ''})
    owner.telemetry.incrementCounter('afterClear', 1)
    await owner.telemetry.flushTelemetry()
  })
  assert.ok(telemetry.some(body => body.i === 'mint-b' && !body.u && body.f?.TokenB?.control?.[1] === 1))
  assert.ok(telemetry.some(body => body.i === 'mint-c' && !body.u && body.f?.TokenC?.treatment?.[2] === 1))
  assert.ok(telemetry.some(body => body.u === 'first-user' && !body.i && body.m?.afterClear === 1))
  assert.ok(telemetry.every(body => !body.groups && !body.claims && !body.entity && body.u !== 'ignored-user'))
  const cache=await page.evaluate(()=>window.fixture.verifyCache())
  assert.deepEqual(cache,{first:{On:true},second:false,restored:{On:true},active:true,persisted:{On:true},persistedActive:true})
  assert.ok(cacheRequests.filter(value=>value.token==='cache-a' && value.conditional==='rev-cache-a').length>=3,'A-B-A and persisted reload use matching body and revision')
  assert.ok(cacheRequests.some(value=>value.token==='cache-b' && value.conditional===undefined),'new token never sends an orphan revision')
  telemetry.length=0
  assert.equal(await page.evaluate(()=>window.fixture.verifyReentrantCheck()),true)
  assert.deepEqual(telemetry,[{k:'cache-fixture',e:'Test',i:'cache-a',f:{On:{enabled:[1]}}},{k:'cache-fixture',e:'Test',i:'cache-b',f:{After:{enabled:[0,1]}}}])
  await page.evaluate(() => window.fixture.unmount())
  assert.deepEqual(errors, [])
  console.log('Browser passed: hooks/components/cache/local/identity/refresh, CORS/gzip/compact metrics, pagehide/unmount/remount/replacement; token A-B-A/persisted 304 public results and reentrant check capture')
})
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifyBrowser(process.argv[2])
