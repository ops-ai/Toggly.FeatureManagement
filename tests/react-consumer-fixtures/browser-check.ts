import { createServer } from 'node:http'
import { gunzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Resolve both tools from the isolated host, never the repository's dependency tree.
const require = createRequire(join(process.cwd(), 'package.json'))
const { preview } = await import(join(dirname(require.resolve('vite/package.json')), 'dist/node/index.js'))
const { default: puppeteer } = await import(require.resolve('puppeteer-core'))
const server = await preview({ preview: { host: '127.0.0.1', port: 0 } })
const telemetry = []
const telemetryHeaders = []
let preflights = 0
const collector = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', request.headers.origin ?? '*')
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Encoding')
  if (request.method === 'OPTIONS') { preflights++; response.statusCode = 204; response.end(); return }
  if (request.method !== 'POST' || request.url !== '/api/frontend/telemetry') { response.statusCode = 404; response.end(); return }
  const chunks = []
  request.on('data', chunk => chunks.push(chunk))
  request.on('end', () => {
    const bytes = Buffer.concat(chunks)
    telemetryHeaders.push(request.headers)
    telemetry.push(JSON.parse((request.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes).toString()))
    response.statusCode = 202; response.end()
  })
})
await new Promise<void>(resolve => collector.listen(0, '127.0.0.1', resolve))
const metricsUrl = `http://127.0.0.1:${(collector.address() as import('node:net').AddressInfo).port}`
let browser
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox'],
  })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  let remoteEnabled = true
  const identities = []
  const definitionsQueries: URLSearchParams[] = []
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/definitions-fixture/')) {
      const query = new URL(request.url()).searchParams
      definitionsQueries.push(query)
      identities.push(query.get('userId'))
      void request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ defs: { release: {enabled: remoteEnabled, variant: 'control'}, second: {enabled: true, variant: 'control'} } }) })
    } else void request.continue()
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?metrics=${encodeURIComponent(metricsUrl)}`)
  const state = async expected => {
    await page.waitForFunction(value =>
      ['flag', 'gate', 'render'].every(id => document.querySelector(`[data-testid="${id}"]`)?.textContent === value)
      && !!document.querySelector('[data-testid="visible"]') === (value === 'on')
      && !!document.querySelector('[data-testid="negated"]') === (value === 'off')
      && document.querySelector('[data-testid="variant-name"]')?.textContent === (value === 'on' ? 'control' : 'none')
      && !!document.querySelector('[data-testid="variant-visible"]') === (value === 'on'),
    { timeout: 5000 }, expected)
    assert.equal(await page.$eval('[data-testid="gate"]', el => el.textContent), expected)
    assert.equal(await page.$eval('[data-testid="render"]', el => el.textContent), expected)
    assert.equal(await page.$('[data-testid="visible"]') !== null, expected === 'on')
    assert.equal(await page.$('[data-testid="negated"]') !== null, expected === 'off')
  }
  await state('on')
  assert.equal(await page.$eval('[data-testid="provider"]', el => el.textContent), 'connected')
  await page.click('#local-off')
  await state('off')
  await page.click('#local-on')
  await state('on')
  remoteEnabled = false
  await page.click('#context')
  await state('off')
  assert.ok(identities.includes('second-user'), `Context identity missing from requests: ${identities}`)
  remoteEnabled = true
  await page.click('#refresh')
  await state('on')
  // Count real service listener registrations/unsubscriptions at its public boundary.
  assert.ok(await page.evaluate(() => (window as unknown as Window & { fixture: { activeSubscriptions: number } }).fixture.activeSubscriptions > 0))
  await page.evaluate(() => (window as any).fixture.service.flushTelemetry())
  assert.ok(telemetry.some(body => body.f?.release?.control?.[0] > 1), 'aggregated effective checks delivered')
  assert.ok(telemetry.some(body => body.f?.release?.disabled?.[0] > 0), 'effective denials delivered')
  assert.ok(telemetry.every(body => Object.values(body.f ?? {}).every(variants => Object.values(variants).every(counts => (counts as number[]).length === 1))), 'rendering never records a view or usage')
  telemetry.length = 0
  await page.evaluate(async () => { (window as any).fixture.recordTelemetry(); await (window as any).fixture.service.flushTelemetry() })
  const clientExpected = {k: 'fixture', e: 'Test', u: 'second-user', f: {release: {enabled: [0, 1], control: [0, 0, 1]}}, m: {orders: 2, cart: 3}}
  assert.deepEqual(telemetry, [clientExpected], 'explicit events carry current client attribution')
  assert.ok(preflights > 0, 'real cross-origin preflight')
  assert.ok(telemetryHeaders.some(headers => headers['content-encoding'] === 'gzip'), 'native browser gzip')
  assert.ok(telemetryHeaders.every(headers => !headers.cookie && !headers.authorization), 'no telemetry credentials')
  await page.evaluate(async () => { await (window as any).fixture.service.setContext({instanceId:'fixture-minted'}); await (window as any).fixture.service.flushTelemetry() })
  await state('on')
  const minted = definitionsQueries[definitionsQueries.length - 1]
  assert.equal(minted.get('i'), 'fixture-minted')
  for (const key of ['u', 'userId', 'g', 'claim.role']) assert.equal(minted.has(key), false)
  telemetry.length = 0
  await page.evaluate(async () => { (window as any).fixture.recordTelemetry(); await (window as any).fixture.service.flushTelemetry() })
  const {u: _identity, ...anonymous} = clientExpected
  const expected = {...anonymous, i: 'fixture-minted'}
  assert.deepEqual(telemetry, [expected], 'minted attribution replaces client identity')
  assert.equal(telemetryHeaders[telemetryHeaders.length - 1]['content-encoding'], 'gzip')
  await page.evaluate(() => Object.defineProperty(globalThis, 'CompressionStream', {configurable:true, value:undefined}))
  const waitForCount = async count => {
    const deadline = Date.now() + 5000
    while (telemetry.length < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(telemetry.length, count)
  }
  await page.evaluate(() => { (window as any).fixture.recordTelemetry(); window.dispatchEvent(new Event('pagehide')) })
  await waitForCount(2); assert.deepEqual(telemetry[1], expected)
  assert.equal(telemetryHeaders[telemetryHeaders.length - 1]['content-encoding'], undefined, 'plain keepalive preserves minted attribution')
  await page.evaluate(() => (window as any).fixture.recordTelemetry())
  await page.click('#unmount')
  await waitForCount(3); assert.deepEqual(telemetry[2], expected, 'final provider unmount flushes pending events')
  await page.waitForFunction(() => (window as unknown as Window & { fixture: { activeSubscriptions: number } }).fixture.activeSubscriptions === 0)
  assert.equal(await page.$eval('#root', el => el.innerHTML), '')
  await page.evaluate(() => (window as any).fixture.remount())
  await state('on')
  assert.equal(await page.evaluate(() => (window as any).fixture.service !== (window as any).fixture.previousService), true, 'remount creates a fresh service from the same provider factory')
  await page.evaluate(() => (window as any).fixture.service.flushTelemetry())
  assert.ok(telemetry[3].f.release.control[0] > 0, 'remounted owner records its own evaluations')
  assert.equal(telemetry[3].u, 'first-user'); assert.equal(telemetry[3].i, undefined, 'remount does not inherit the retired token')
  await page.click('#unmount')
  await page.waitForFunction(() => (window as any).fixture.activeSubscriptions === 0)
  assert.deepEqual(errors, [])
  console.log('Browser: provider, hooks, all/negated/render gates, local gates, context, refresh, StrictMode/unmount cleanup; real CORS/native gzip i/u/plain keepalive i/checks/metrics/pagehide/unmount telemetry passed')
} finally {
  if (browser) await browser.close()
  await new Promise(resolve => server.httpServer.close(resolve))
  await new Promise<void>(resolve => collector.close(() => resolve()))
}
