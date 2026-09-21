import { createServer } from 'node:http'
import { gunzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Both tools resolve from the isolated consumer, never the SDK source tree.
const require = createRequire(join(process.cwd(), 'package.json'))
const { preview } = await import(join(dirname(require.resolve('vite/package.json')), 'dist/node/index.js'))
const { default: puppeteer } = await import(require.resolve('puppeteer-core'))
const server = await preview({ preview: { host: '127.0.0.1', port: 0 } })
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
await new Promise(resolve => collector.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await puppeteer.launch({executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox']})
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text())})
  let remoteEnabled = true
  const identities = []
  await page.setRequestInterception(true)
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/definitions-fixture/')) {
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
  await page.evaluate(() => window.fixture.service.flushTelemetry())
  assert.ok(telemetry.some(body => body.f?.release?.control?.[0] > 1))
  assert.ok(telemetry.some(body => body.f?.release?.disabled?.[0] > 0))
  assert.ok(telemetry.every(body => Object.values(body.f ?? {}).every(variants => Object.values(variants).every(counts => counts.length === 1))), 'rendering is not an implicit view or usage')
  assert.ok(telemetry.some(body => body.u === 'first-user'))
  assert.ok(telemetry.some(body => body.u === 'second-user'))
  await page.evaluate(async () => {await window.fixture.service.setContext({instanceId: 'fixture-mint', groups: ['ignored'], claims: {role: 'ignored'}}); await window.fixture.service.flushTelemetry()})
  await state('on')
  await page.evaluate(() => window.fixture.service.flushTelemetry())
  assert.ok(identities.some(query => query.i === 'fixture-mint' && !query.u && !query.userId && !query.g && !query['claim.role']))
  telemetry.length = 0
  await page.evaluate(async () => {window.fixture.recordTelemetry(); await window.fixture.service.flushTelemetry()})
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
  await page.evaluate(() => {window.fixture.recordTelemetry(); window.dispatchEvent(new Event('pagehide'))})
  await count(2); assert.deepEqual(telemetry[1], expected)
  assert.equal(headers.at(-1)['content-encoding'], undefined, 'pagehide is plain keepalive with i')
  await page.evaluate(() => {window.fixture.recordTelemetry(); window.fixture.unmount()})
  await count(3); assert.deepEqual(telemetry[2], expected)
  assert.equal(await page.evaluate(() => window.fixture.activeSubscriptions), 0)
  assert.equal(await page.$eval('#app', element => element.innerHTML), '')
  await page.evaluate(() => window.fixture.remount()); await state('on')
  assert.equal(await page.evaluate(() => window.fixture.service !== window.fixture.previousService), true)
  await page.evaluate(() => window.fixture.service.flushTelemetry())
  assert.ok(telemetry[3].f.release.control[0] > 0)
  assert.equal(telemetry[3].u, 'first-user'); assert.equal(telemetry[3].i, undefined)
  await page.evaluate(() => window.fixture.unmount())
  assert.equal(await page.evaluate(() => window.fixture.activeSubscriptions), 0)
  assert.deepEqual(errors, [])
  console.log('Browser passed: plugin/hooks/components, local/context/refresh, real CORS/gzip i/u/checks/metrics/plain keepalive i/pagehide/unmount/remount')
} finally {
  if (browser) await browser.close()
  await new Promise(resolve => server.httpServer.close(resolve))
  await new Promise(resolve => collector.close(resolve))
}
