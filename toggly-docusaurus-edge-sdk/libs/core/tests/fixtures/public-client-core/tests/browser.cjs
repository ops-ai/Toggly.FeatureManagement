const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const { gunzipSync } = require('node:zlib');

const root = require('node:path').resolve(__dirname, '..');
const port = 15382;
const origin = `http://127.0.0.1:${port}`;

async function openHost(browser, mode = 'enabled', plain = false, responses = []) {
  const page = await browser.newPage();
  await page.context().addCookies([{ name: 'existing-session', value: 'do-not-send', url: 'https://metrics.toggly.io', sameSite: 'None', secure: true }]);
  if (plain) await page.addInitScript(() => { window.CompressionStream = undefined; });
  const packets = [];
  const definitions = [];
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('https://definitions.toggly.io/**', async route => {
    definitions.push(new URL(route.request().url()));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      On: true, Off: false, Entity: { requirement: 'all', rules: [{ property: 'Vip', op: 'eq', value: 'true', type: 'boolean' }] },
    }) });
  });
  await page.route('https://metrics.toggly.io/**', async route => {
    const request = route.request();
    const headers = request.headers();
    const body = request.postDataBuffer();
    packets.push({
      method: request.method(), url: request.url(), headers,
      data: JSON.parse((headers['content-encoding'] === 'gzip' ? gunzipSync(body) : body).toString('utf8')),
    });
    const response = responses.shift() ?? 202;
    if (response === 'abort') await route.abort('failed');
    else await route.fulfill({ status: response, body: '' });
  });
  await page.goto(`${origin}/?mode=${mode}`);
  return { page, packets, definitions, errors };
}

(async () => {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root, stdio: 'pipe',
    env: { ...process.env, VITE_TOGGLY_APP_KEY: 'placeholder-core-key', VITE_TOGGLY_SECOND_APP_KEY: 'second-placeholder-key' },
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Vite did not start')), 20_000);
      server.stdout.on('data', chunk => { if (chunk.toString().includes('Local:')) { clearTimeout(deadline); resolve(); } });
      server.on('exit', code => reject(new Error(`Vite exited ${code}`)));
    });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
    const { page, packets, definitions } = await openHost(browser);
    await expect(page.locator('#status')).toHaveText('ready');
    await page.locator('#direct').click();
    await expect(page.locator('#result')).toHaveText('On=true');
    await page.locator('#gate').click();
    await expect(page.locator('#result')).toHaveText('gate=true');
    await page.locator('#gate-off').click();
    await expect(page.locator('#result')).toHaveText('gate-off=false');
    await page.locator('#negate').click();
    await expect(page.locator('#result')).toHaveText('negate=false');
    await page.locator('#entity').click();
    await expect(page.locator('#result')).toHaveText('entity=true/false');
    await page.locator('#events').click();
    await page.locator('#variant').click({ timeout: 2_000 });
    await page.locator('#flush').click();
    await expect.poll(() => packets.length).toBe(1);
    assert.equal(definitions.length, 1);
    assert.equal(packets[0].method, 'POST');
    assert.equal(packets[0].url, 'https://metrics.toggly.io/api/frontend/telemetry');
    assert.equal(packets[0].headers.cookie, undefined);
    assert.equal(packets[0].data.k, 'placeholder-core-key');
    assert.equal(packets[0].data.e, 'Production');
    assert.deepEqual(packets[0].data.f.On.enabled, [3, 1, 1]);
    assert.equal(packets[0].data.f.Off, undefined);
    assert.deepEqual(packets[0].data.f.Entity.enabled, [1]);
    assert.deepEqual(packets[0].data.f.Entity.disabled, [1]);
    assert.deepEqual(packets[0].data.f.On.treatment, [0, 1, 1]);
    assert.deepEqual(packets[0].data.m.orders, 2);
    assert.deepEqual(packets[0].data.m.cart, 9);
    assert.equal(packets[0].data.u, undefined);
    assert.equal(packets[0].headers['content-encoding'], 'gzip');
    await page.close();

    const context = await openHost(browser, 'context');
    await expect(context.page.locator('#status')).toHaveText('ready');
    await context.page.locator('#direct').click();
    await context.page.locator('#events').click();
    await context.page.locator('#switch').click();
    await expect(context.page.locator('#status')).toHaveText('bob');
    await context.page.locator('#direct').click();
    await context.page.locator('#events').click();
    await context.page.locator('#flush').click();
    await expect.poll(() => context.packets.length).toBe(2);
    assert.deepEqual(context.packets.map(packet => packet.data.u), ['alice', 'bob']);
    assert.equal(context.definitions[0].searchParams.get('u'), 'alice');
    assert.equal(context.definitions.at(-1).searchParams.get('u'), 'bob');
    await context.page.locator('#second').click();
    await expect.poll(() => context.packets.length).toBe(3);
    assert.equal(context.packets[2].data.k, 'second-placeholder-key');
    await context.page.close();

    const plain = await openHost(browser, 'enabled', true);
    await expect(plain.page.locator('#status')).toHaveText('ready');
    await plain.page.locator('#events').click();
    await plain.page.locator('#flush').click();
    await expect.poll(() => plain.packets.length).toBe(1);
    assert.equal(plain.packets[0].headers['content-encoding'], undefined);
    await plain.page.close();

    const lifecycle = await openHost(browser);
    await expect(lifecycle.page.locator('#status')).toHaveText('ready');
    await lifecycle.page.locator('#events').click();
    await lifecycle.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await lifecycle.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect.poll(() => lifecycle.packets.length).toBe(1);
    assert.equal(lifecycle.packets[0].headers['content-encoding'], undefined);
    await lifecycle.page.locator('#dispose').click();
    await lifecycle.page.locator('#events').click();
    await lifecycle.page.locator('#flush').click();
    assert.equal(lifecycle.packets.length, 1);
    await lifecycle.page.close();

    const hidden = await openHost(browser);
    await expect(hidden.page.locator('#status')).toHaveText('ready');
    await hidden.page.locator('#events').click();
    await hidden.page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => hidden.packets.length).toBe(1);
    assert.equal(hidden.packets[0].headers['content-encoding'], undefined);
    await hidden.page.close();

    const disposal = await openHost(browser);
    await expect(disposal.page.locator('#status')).toHaveText('ready');
    await disposal.page.locator('#events').click();
    await disposal.page.locator('#dispose').click();
    await expect.poll(() => disposal.packets.length).toBe(1);
    assert.equal(disposal.packets[0].headers['content-encoding'], undefined);
    await disposal.page.close();

    const retry = await openHost(browser, 'enabled', false, [503, 429, 202]);
    await expect(retry.page.locator('#status')).toHaveText('ready');
    await retry.page.clock.install();
    await retry.page.locator('#events').click();
    await retry.page.locator('#flush').click();
    await expect.poll(() => retry.packets.length).toBe(1);
    await retry.page.clock.runFor(30_000);
    await expect.poll(() => retry.packets.length).toBe(2);
    await retry.page.clock.runFor(60_000);
    await expect.poll(() => retry.packets.length).toBe(3);
    assert.deepEqual(retry.packets.map(packet => packet.data), [retry.packets[0].data, retry.packets[0].data, retry.packets[0].data]);
    assert.deepEqual(retry.errors, []);
    await retry.page.close();

    const ambiguous = await openHost(browser, 'enabled', false, ['abort']);
    await expect(ambiguous.page.locator('#status')).toHaveText('ready');
    await ambiguous.page.clock.install();
    await ambiguous.page.locator('#events').click();
    await ambiguous.page.locator('#flush').click();
    await expect.poll(() => ambiguous.packets.length).toBe(1);
    await ambiguous.page.clock.runFor(120_000);
    assert.equal(ambiguous.packets.length, 1);
    assert.deepEqual(ambiguous.errors, []);
    await ambiguous.page.close();

    const exhausted = await openHost(browser, 'enabled', false, [503, 503, 503]);
    await expect(exhausted.page.locator('#status')).toHaveText('ready');
    await exhausted.page.clock.install();
    await exhausted.page.locator('#events').click();
    await exhausted.page.locator('#flush').click();
    await expect.poll(() => exhausted.packets.length).toBe(1);
    await exhausted.page.clock.runFor(30_000);
    await expect.poll(() => exhausted.packets.length).toBe(2);
    await exhausted.page.clock.runFor(60_000);
    await expect.poll(() => exhausted.packets.length).toBe(3);
    await exhausted.page.clock.runFor(120_000);
    assert.equal(exhausted.packets.length, 3);
    assert.deepEqual(exhausted.errors, []);
    await exhausted.page.close();

    const rejected = await openHost(browser, 'enabled', false, [500]);
    await expect(rejected.page.locator('#status')).toHaveText('ready');
    await rejected.page.clock.install();
    await rejected.page.locator('#events').click();
    await rejected.page.locator('#flush').click();
    await expect.poll(() => rejected.packets.length).toBe(1);
    await rejected.page.clock.runFor(120_000);
    assert.equal(rejected.packets.length, 1);
    assert.deepEqual(rejected.errors, []);
    await rejected.page.close();

    for (const mode of ['optout', 'keyless']) {
      const silent = await openHost(browser, mode);
      await expect(silent.page.locator('#status')).toHaveText('ready');
      await silent.page.locator('#direct').click();
      await silent.page.locator('#events').click();
      await silent.page.locator('#flush').click();
      assert.equal(silent.packets.length, 0, mode);
      if (mode === 'keyless') assert.equal(silent.definitions.length, 0);
      await silent.page.close();
    }
    console.log('Chromium public client-core acceptance: direct, gates, entity, variants, context, two clients, lifecycle, gzip/plain, retry/drop, opt-out/keyless passed');
  } finally {
    await browser?.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
