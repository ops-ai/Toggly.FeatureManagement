import { createServer } from 'node:http'
import { gunzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {withResources, closeServer, ownBrowser, bounded} from './host-resources.mjs'

// Both tools resolve from the isolated consumer, never the SDK source tree.
const require = createRequire(join(process.cwd(), 'package.json'))
const { preview } = await import(join(dirname(require.resolve('vite/package.json')), 'dist/node/index.js'))
async function launchBrowser() {
  const {default: puppeteer} = await import(require.resolve('puppeteer-core'))
  return puppeteer.launch({executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox']})
}
export async function verifyBrowser(launch = launchBrowser) {
return withResources(async defer => {
const server = await preview({ preview: { host: '127.0.0.1', port: 0 } })
defer(() => closeServer(server.httpServer))
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
  const page = await bounded(() => browser.newPage(), 'Browser page', 10000)
  const evaluate = (callback, argument) => bounded(() => page.evaluate(callback, argument), 'Browser evaluation', 10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text())})
  let remoteEnabled = true
  const identities = []
  const cacheRequests = []
  const urlRequests = []
  const refreshRequests = new Map()
  await page.setRequestInterception(true)
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/url-fixture')) {
      urlRequests.push(url.href)
      const variants = url.pathname.includes('evaluated-variants-signed')
      const active = !['retired', 'older'].includes(url.searchParams.get('i'))
      void request.respond({status: 200, contentType: 'application/json', body: JSON.stringify({defs: variants ? {On: {enabled: active, variant: 'blue'}} : {On: active}})})
    } else if (url.pathname.startsWith('/refresh-order/')) {
      const count = refreshRequests.get(url.pathname) ?? 0
      refreshRequests.set(url.pathname, count + 1)
      void request.respond({status: 200, contentType: 'application/json', body: JSON.stringify({defs: {On: count === 0}})})
    } else if (url.pathname.startsWith('/cache-fixture/')) {
      const variants = url.pathname.includes('evaluated-variants-signed')
      const token = url.searchParams.get('i')
      const revision = `${variants ? 'variants' : 'evaluated'}-${token}`
      const conditional = request.headers()['if-none-match']?.replaceAll('"', '')
      cacheRequests.push({token, variants, conditional})
      const defs = variants ? {On: {enabled: token !== 'token-b', variant: 'blue', configurationValue: 7}} : {On: false}
      void request.respond(conditional === revision ? {status: 304} : {status: 200, contentType: 'application/json', headers: {etag: revision}, body: JSON.stringify({defs})})
    } else if (url.pathname.startsWith('/definitions-fixture/')) {
      identities.push(Object.fromEntries(url.searchParams))
      void request.respond({status: 200, contentType: 'application/json', body: JSON.stringify({defs: {release: {enabled: remoteEnabled, variant: 'control'}, second: {enabled: true, variant: 'control'}}})})
    } else void request.continue()
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?metrics=${encodeURIComponent(`http://127.0.0.1:${collector.address().port}`)}`)
  const state = async expected => {
    await page.waitForFunction(value => ['flag', 'gate', 'render'].every(id => document.querySelector(`[data-testid="${id}"]`)?.textContent === value)
      && !!document.querySelector('[data-testid="visible"]') === (value === 'on')
      && !!document.querySelector('[data-testid="negated"]') === (value === 'off')
      && document.querySelector('[data-testid="variant"]')?.textContent === (value === 'on' ? 'control' : 'none'), {timeout: 5000}, expected)
  }
  await state('on')
  await page.click('#local-off'); await state('off')
  await page.click('#local-on'); await state('on')
  remoteEnabled = false
  const contextResponse = page.waitForResponse(response => new URL(response.url()).pathname.startsWith('/definitions-fixture/'))
  await page.click('#context'); await contextResponse; await state('off')
  assert.ok(identities.some(query => (query.u ?? query.userId) === 'second-user'))
  remoteEnabled = true; await page.click('#refresh'); await state('on')
  await evaluate(() => window.fixture.service.flushTelemetry())
  assert.ok(telemetry.some(body => body.f?.release?.control?.[0] > 1))
  assert.ok(telemetry.some(body => body.f?.release?.disabled?.[0] > 0))
  assert.ok(telemetry.every(body => Object.values(body.f ?? {}).every(variants => Object.values(variants).every(counts => counts.length === 1))), 'rendering is not an implicit view or usage')
  assert.ok(telemetry.some(body => body.u === 'first-user'))
  assert.ok(telemetry.some(body => body.u === 'second-user'))
  await evaluate(async () => {await window.fixture.service.setContext({instanceId: 'fixture-mint', groups: ['ignored'], claims: {role: 'ignored'}}); await window.fixture.service.flushTelemetry()})
  await state('on')
  await evaluate(() => window.fixture.service.flushTelemetry())
  assert.ok(identities.some(query => query.i === 'fixture-mint' && !query.u && !query.userId && !query.g && !query['claim.role']))
  telemetry.length = 0
  await evaluate(async () => {window.fixture.recordTelemetry(); await window.fixture.service.flushTelemetry()})
  const expected = {k: 'fixture', e: 'Test', i: 'fixture-mint', f: {release: {enabled: [0, 1], control: [0, 0, 1]}}, m: {orders: 2, cart: 3}}
  assert.deepEqual(telemetry, [expected])
  assert.ok(preflights > 0, 'real cross-origin preflight')
  assert.ok(headers.some(value => value['content-encoding'] === 'gzip'), 'native browser gzip')
  assert.ok(headers.every(value => !value.cookie && !value.authorization), 'credential-free collector requests')
  const count = async expectedCount => {
    const deadline = Date.now() + 5000
    while (telemetry.length < expectedCount && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(telemetry.length, expectedCount)
  }
  await evaluate(() => {window.fixture.recordTelemetry(); window.dispatchEvent(new Event('pagehide'))})
  await count(2); assert.deepEqual(telemetry[1], expected)
  assert.equal(headers.at(-1)['content-encoding'], undefined, 'pagehide is plain keepalive with i')
  await evaluate(() => {window.fixture.recordTelemetry(); window.fixture.unmount()})
  await count(3); assert.deepEqual(telemetry[2], expected)
  assert.equal(await evaluate(() => window.fixture.activeSubscriptions), 0)
  assert.equal(await page.$eval('#app', element => element.innerHTML), '')
  await evaluate(() => window.fixture.remount()); await state('on')
  assert.equal(await evaluate(() => window.fixture.service !== window.fixture.previousService), true)
  await evaluate(() => window.fixture.service.flushTelemetry())
  assert.ok(telemetry[3].f.release.control[0] > 0)
  assert.equal(telemetry[3].u, 'first-user'); assert.equal(telemetry[3].i, undefined)
  await evaluate(() => window.fixture.unmount())
  assert.equal(await evaluate(() => window.fixture.activeSubscriptions), 0)
  telemetry.length = 0
  const cache = await evaluate(() => window.fixture.verifyCache())
  assert.deepEqual(cache, {results: [{flags: {On: true}, active: true, variant: {name: 'blue', configurationValue: 7}}, {flags: {On: false}, active: false, variant: null}], second: false, returned: {On: true}, active: true, persisted: {On: true}, variant: {name: 'blue', configurationValue: 7}})
  assert.deepEqual(telemetry, [
    {k: 'cache-true', e: 'Test', i: 'token-a', f: {On: {blue: [2]}}},
    {k: 'cache-false', e: 'Test', i: 'token-a', f: {On: {disabled: [1]}}},
  ])
  assert.ok(cacheRequests.some(value => value.variants && value.conditional === 'variants-token-a'))
  assert.ok(cacheRequests.some(value => !value.variants && value.conditional === 'evaluated-token-a'))
  assert.ok(cacheRequests.some(value => value.token === 'token-b' && value.conditional === undefined))
  telemetry.length = 0
  const refreshOrder = await evaluate(() => window.fixture.verifyRefreshOrder())
  assert.equal(refreshOrder.length, 6)
  for (const result of refreshOrder) {
    const latest = result.kind === 'Feature' ? '' : 'false'
    assert.equal(result.beforeRelease, latest)
    assert.equal(result.afterRelease, latest)
  }
  assert.deepEqual(telemetry, refreshOrder.map(({kind, phase}) => ({k: `${kind}-${phase}`, e: 'Test', i: 'pending-hook', f: {On: {enabled: [1], disabled: [1]}}})))
  assert.ok([...refreshRequests.values()].every(count => count === 2), 'initial load plus actual refresh only')
  telemetry.length = 0
  const urlResults = await evaluate(() => window.fixture.verifyUrlContexts())
  assert.equal(urlResults.length, 12)
  for (const result of urlResults) {
    assert.equal(result.active, true)
    assert.equal(result.variant, result.enableVariants ? 'blue' : undefined)
    const packets = telemetry.filter(body => body.k === `url-${result.enableVariants}` && body.f?.[`URL${result.index}`])
    assert.equal(packets.length, 1)
    const token = [undefined, undefined, 'A', 'B', undefined, undefined][result.index]
    assert.equal(packets[0].i, token)
    assert.equal(packets[0].u, token ? undefined : 'bob')
    assert.deepEqual(packets[0].f[`URL${result.index}`], {enabled: [0, 1]})
    assert.deepEqual(packets[0].f.On, result.enableVariants ? {blue: [2]} : {enabled: [1]})
  }
  assert(urlRequests.length >= 12)
  for (const request of urlRequests) {
    const url = new URL(request)
    const variants = url.pathname.includes('evaluated-variants-signed')
    assert.equal(url.pathname, `/url-fixture/${variants ? 'evaluated-variants-signed' : 'evaluated-signed'}/url-${variants}/Test`)
    assert.deepEqual(url.searchParams.getAll('keep'), ['one', 'two'])
    const token = url.searchParams.get('i')
    assert(!['retired', 'older'].includes(token))
    if (token) {
      assert.deepEqual(url.searchParams.getAll('i'), [token])
      assert(['A', 'B'].includes(token))
      assert.deepEqual([...url.searchParams.keys()].filter(key => ['u', 'userId', 'g'].includes(key) || key.startsWith('claim.')), [])
    } else {
      assert.equal(url.searchParams.get(variants ? 'userId' : 'u'), 'bob')
      assert.deepEqual(url.searchParams.getAll('g'), ['inherited', 'team'])
      assert.equal(url.searchParams.get('claim.role'), 'reader')
    }
  }
  console.log('PASS actual packed initial/blank/rotation/clear URL contexts in both modes with exact checks and attribution')
  assert.deepEqual(errors, [])
  console.log('Browser passed: plugin/hooks/components, local/context/refresh, real CORS/gzip i/u/checks/metrics/plain keepalive i/pagehide/unmount/remount; response-mode and token ABA 304 cache/public results; pending-hook refresh DOM and exact checks')
})
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifyBrowser()
