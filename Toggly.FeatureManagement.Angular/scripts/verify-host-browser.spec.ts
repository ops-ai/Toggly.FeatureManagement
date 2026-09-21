import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

export async function verifyBrowser(cwd, entry) {
  const dist = fs.existsSync(path.join(cwd, 'dist/browser')) ? path.join(cwd, 'dist/browser') : path.join(cwd, 'dist');
  let enabled = true;
  const requests = [];
  const telemetry = [];
  const telemetryHeaders = [];
  let preflights = 0;
  const collector = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Encoding');
    if (req.method === 'OPTIONS') { preflights++; res.statusCode = 204; res.end(); return; }
    if (req.method !== 'POST' || req.url !== '/api/frontend/telemetry') { res.statusCode = 404; res.end(); return; }
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const bytes = Buffer.concat(chunks);
      telemetryHeaders.push(req.headers);
      telemetry.push(JSON.parse((req.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes).toString()));
      res.statusCode = 202; res.end();
    });
  });
  const server = createServer((req, res) => {
    if (req.url.startsWith('/evaluated-variants-signed/')) {
      requests.push(req.url);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ Checkout: { enabled, variant: 'control', configurationValue: null }, Disabled: { enabled: false, variant: 'control', configurationValue: null } }));
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    let file = path.join(dist, url.pathname);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    const contentTypes = { '.js': 'text/javascript', '.css': 'text/css' };
    res.setHeader('content-type', contentTypes[path.extname(file)] ?? 'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => collector.listen(0, '127.0.0.1', resolve));
  const collectorUrl = `http://127.0.0.1:${collector.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let socket;
    let activeSocketClosed = false;
    await page.routeWebSocket('**/fixture/ws**', ws => { socket = ws; activeSocketClosed = false; ws.onClose(() => { if (socket === ws) activeSocketClosed = true; }); });
    await page.goto(`http://127.0.0.1:${server.address().port}/?metrics=${encodeURIComponent(collectorUrl)}`);
    const rendered = async value => {
      await page.waitForFunction(value => ['component', 'flag', 'variant'].every(id => Boolean(document.getElementById(id)) === value)
        && document.getElementById('builder')?.textContent?.trim() === String(value), value);
    };
    const navigate = async (route, expected) => {
      await page.evaluate(route => window.navigate(route), route);
      await page.waitForURL(`**${expected}`);
      assert.equal(await page.locator(expected === '/denied' ? '#denied' : '#protected').count(), 1);
      await page.evaluate(() => window.navigate('/'));
    };
    await rendered(true);
    assert.equal(await page.evaluate(() => window.Zone === undefined), entry.mode === 'zoneless OnPush', 'host uses its declared change detection mode');
    assert.ok(requests.length > 0, 'initialization fetched definitions');
    for (const route of ['/function', '/class']) await navigate(route, route);
    await page.click('#input');
    await rendered(false);
    await page.click('#input');
    await rendered(true);
    await page.evaluate(() => window.setLocal(false));
    await rendered(false);
    for (const route of ['/function', '/class']) await navigate(route, '/denied');
    await page.evaluate(() => window.setLocal(true));
    await rendered(true);
    for (const route of ['/function', '/class']) await navigate(route, route);
    enabled = false;
    assert.ok(socket, 'SDK connected its real WebSocket');
    socket.send('update');
    await rendered(false);
    for (const route of ['/function', '/class']) await navigate(route, '/denied');
    enabled = true;
    socket.send('update');
    await rendered(true);
    for (const route of ['/function', '/class']) await navigate(route, route);
    await page.evaluate(() => window.setContext('second-user'));
    await rendered(true);
    assert.ok(requests.some(url => new URL(url, 'http://localhost').searchParams.get('userId') === 'second-user'), 'identity change reaches definitions URL');
    assert.ok(requests.some(url => new URL(url, 'http://localhost').searchParams.get('g') === 'fixture' && new URL(url, 'http://localhost').searchParams.get('claim.role') === 'test'), 'groups and claims reach definitions URL');
    await page.evaluate(() => window.flushTelemetry());
    assert.ok(telemetry.some(body => body.f?.Checkout?.control?.[0] > 1), 'effective variant checks reach the local collector');
    assert.ok(telemetry.some(body => body.f?.Checkout?.disabled?.[0] > 0), 'effective denials reach the local collector');
    telemetry.length = 0;
    await page.evaluate(async () => { window.recordTelemetry(); await window.flushTelemetry(); });
    assert.deepEqual(telemetry, [{ k: 'fixture', e: 'Test', u: 'second-user', f: { Checkout: { control: [0, 1], enabled: [0, 0, 1] } }, m: { orders: 2, cart: 3 } }], 'explicit telemetry uses the compact client-attributed wire contract');
    assert.ok(preflights > 0, 'browser performs real cross-origin preflight');
    assert.ok(telemetryHeaders.some(headers => headers['content-encoding'] === 'gzip'), 'native browser gzip reaches the collector');
    assert.ok(telemetryHeaders.every(headers => !headers.authorization && !headers.cookie && headers.origin === `http://127.0.0.1:${server.address().port}`), 'collector receives browser Origin without credentials');
    const waitForTelemetry = async count => {
      const deadline = Date.now() + 5000;
      while (telemetry.length < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(telemetry.length, count, 'lifecycle event flushes pending telemetry');
    };
    await page.evaluate(async () => { await window.setInstance('fixture-minted'); await window.flushTelemetry(); });
    const mintedRequest = new URL(requests[requests.length - 1], 'http://localhost');
    assert.equal(mintedRequest.searchParams.get('i'), 'fixture-minted');
    for (const key of ['u', 'userId', 'g', 'claim.role']) assert.equal(mintedRequest.searchParams.has(key), false);
    telemetry.length = 0;
    await page.evaluate(async () => { window.recordTelemetry(); await window.flushTelemetry(); });
    assert.equal(telemetry[0].i, 'fixture-minted'); assert.equal(telemetry[0].u, undefined);
    assert.equal(telemetryHeaders[telemetryHeaders.length - 1]['content-encoding'], 'gzip', 'minted attribution uses native gzip');
    await page.evaluate(() => { Object.defineProperty(globalThis, 'CompressionStream', { configurable: true, value: undefined }); });
    await page.evaluate(() => { window.recordTelemetry(); window.dispatchEvent(new Event('pagehide')); });
    await waitForTelemetry(2);
    assert.deepEqual(telemetry[1], telemetry[0], 'pagehide flush preserves aggregate content');
    assert.equal(telemetryHeaders[telemetryHeaders.length - 1]['content-encoding'], undefined, 'plain keepalive carries minted attribution');
    await page.evaluate(() => { window.recordTelemetry(); window.destroyHost(); });
    await waitForTelemetry(3);
    assert.deepEqual(telemetry[2], telemetry[0], 'synchronous service teardown flushes pending events');
    await page.waitForFunction(() => !document.getElementById('input'));
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.ok(activeSocketClosed, 'destroy closes the active WebSocket');
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    console.log(`BROWSER ${entry.fixture}: input binding; component/flag/builder/variant local deny+restore and remote refresh; both guards allow+redirect; identity/groups/claims and minted-only definitions; destroy/socket close; cross-origin telemetry POST/preflight/native gzip i/u and plain keepalive i; aggregate checks/metrics; pagehide/destruction flush`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => collector.close(resolve));
  }
}
