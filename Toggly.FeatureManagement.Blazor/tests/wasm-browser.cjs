// Executes the packed WASM artifact against a cross-origin loopback collector only.
const { chromium } = (() => {
  try { return require('playwright'); }
  catch { return require('../../Toggly.FeatureManagement.NET/Toggly.FeatureManagement.Dashboard.BrowserTests/node_modules/playwright'); }
})();
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || 'Toggly.FeatureManagement.Blazor/tests/WasmHost/bin/Release/net8.0/publish/wwwroot');
const packets = [], preflights = [];
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const waitFor = async condition => { const deadline = Date.now() + 10000; while (!condition()) { if (Date.now() > deadline) throw Error('Timed out waiting for collector'); await new Promise(r => setTimeout(r, 20)); } };
(async () => {
  const collector = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, content-encoding');
    if (req.method === 'OPTIONS') { preflights.push(req.headers); res.writeHead(204).end(); return; }
    const chunks = []; req.on('data', x => chunks.push(x)); req.on('end', () => {
      const raw = Buffer.concat(chunks), plain = req.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(raw) : raw;
      packets.push({ headers: req.headers, body: JSON.parse(plain), bytes: plain.length, url: req.url });
      res.writeHead(202).end();
    });
  });
  const host = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    const types = { '.wasm': 'application/wasm', '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.dll': 'application/octet-stream' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); fs.createReadStream(file).pipe(res);
  });
  let browser;
  try {
    await listen(collector); await listen(host);
    browser = await chromium.launch({headless:true}); const page = await browser.newPage();
    page.on('pageerror', error => console.error(error));
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
    page.setDefaultTimeout(10000);
    await page.addInitScript(() => {
      window.telemetryFetchOptions = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, options) => {
        if (typeof input === 'string' && input.includes('/api/frontend/telemetry')) {
          window.telemetryFetchOptions.push({ keepalive: options.keepalive, encoding: options.headers['Content-Encoding'] ?? null });
        }
        return originalFetch(input, options);
      };
    });
    const collectorUrl = `http://127.0.0.1:${collector.address().port}/base/`;
    await page.goto(`http://127.0.0.1:${host.address().port}/?collector=${encodeURIComponent(collectorUrl)}`);
    await page.locator('#enabled').waitFor({timeout:60000});
    await page.locator('#flush').click(); await page.locator('#status').filter({hasText:'flushed'}).waitFor();
    const before = packets.length;
    await page.locator('#record').click(); await page.locator('#flush').click(); await waitFor(() => packets.length > before);
    const ordinary = packets.at(-1);
    assert.deepEqual(await page.evaluate(() => window.telemetryFetchOptions.at(-1)), {keepalive:false, encoding:'gzip'});
    assert.equal(ordinary.headers['content-encoding'], 'gzip'); assert.equal(ordinary.url, '/base/api/frontend/telemetry');
    assert.deepEqual(ordinary.body.f.checkout.enabled, [0,1,1]); assert.deepEqual(ordinary.body.m, { cart:3.5, orders:2 });
    assert.equal(ordinary.body.k, 'local-wasm-fixture'); assert.equal(ordinary.body.e, 'Fixture');
    assert.ok(preflights.length > 0); assert.equal(ordinary.headers.authorization, undefined); assert.equal(ordinary.headers.cookie, undefined);
    assert.deepEqual(Object.keys(ordinary.body).sort(), ['e','f','k','m']); assert.ok(ordinary.bytes <= 49152);
    await page.locator('#record').click(); const hiddenBefore = packets.length;
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', {value:'hidden', configurable:true}); document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => packets.length > hiddenBefore); assert.equal(packets.at(-1).headers['content-encoding'], undefined);
    assert.deepEqual(await page.evaluate(() => window.telemetryFetchOptions.at(-1)), {keepalive:true, encoding:null});
    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', {value:'visible', configurable:true}));
    await page.locator('#record').click(); const exitBefore = packets.length;
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide'))); await waitFor(() => packets.length > exitBefore);
    assert.equal(packets.at(-1).headers['content-encoding'], undefined);
    assert.deepEqual(await page.evaluate(() => window.telemetryFetchOptions.at(-1)), {keepalive:true, encoding:null});
    await page.locator('#record').click(); const disposeBefore = packets.length;
    await page.locator('#dispose').click(); await page.locator('#status').filter({hasText:'disposed'}).waitFor();
    assert.equal(packets.length, disposeBefore + 1); assert.equal(packets.at(-1).headers['content-encoding'], undefined);
    assert.deepEqual(await page.evaluate(() => window.telemetryFetchOptions.at(-1)), {keepalive:true, encoding:null});
    await page.locator('#record').click(); await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await new Promise(r => setTimeout(r, 100)); assert.equal(packets.length, disposeBefore + 1);
    for (const options of ['&enabled=false', '&key=']) {
      const silent = await browser.newPage(); const beforeSilent = packets.length;
      await silent.goto(`http://127.0.0.1:${host.address().port}/?collector=${encodeURIComponent(collectorUrl)}${options}`);
      await silent.locator('#enabled').waitFor({timeout:60000}); await silent.locator('#record').click(); await silent.locator('#flush').click();
      await silent.locator('#status').filter({hasText:'flushed'}).waitFor(); await silent.locator('#dispose').click();
      await silent.locator('#status').filter({hasText:'disposed'}).waitFor(); assert.equal(packets.length, beforeSilent); await silent.close();
    }
    const independent = await browser.newPage(); const isolatedBefore = packets.length;
    await independent.goto(`http://127.0.0.1:${host.address().port}/?collector=${encodeURIComponent(collectorUrl)}&key=second-owner&environment=Second`);
    await independent.locator('#enabled').waitFor({timeout:60000}); await independent.locator('#record').click(); await independent.locator('#flush').click();
    await independent.locator('#status').filter({hasText:'flushed'}).waitFor();
    assert.ok(packets.length > isolatedBefore); assert.equal(packets.at(-1).body.k, 'second-owner'); assert.equal(packets.at(-1).body.e, 'Second');
    await independent.locator('#dispose').click(); await independent.locator('#status').filter({hasText:'disposed'}).waitFor(); await independent.close();
    console.log(JSON.stringify({wasm:true, crossOrigin:true, packets:packets.length, preflights:preflights.length, lifecycle:'hidden, pagehide and disposal plain keepalive verified'}));
  } finally { if (browser) await browser.close(); host.close(); collector.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
