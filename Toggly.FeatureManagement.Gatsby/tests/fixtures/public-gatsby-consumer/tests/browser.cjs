const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('@playwright/test');
const { createCollector } = require('./collector.cjs');
const { bounded, withOwnedResources } = require('./owned-resources.cjs');

const port = 8837;

async function waitForTelemetryCount(collector, count) {
  for (let i = 0; i < 600; i++) {
    const rows = collector.requests.filter(row => row.url.includes('/metrics'));
    if (rows.length >= count) return rows;
    await delay(100);
  }
  throw new Error(`Timed out waiting for telemetry request ${count}`);
}

async function main() {
  const resources = { collector: null, serve: null, browserServer: null, browser: null };
  return withOwnedResources(resources, async () => {
    const collector = resources.collector = createCollector({ port: 8838 });
    await bounded(() => collector.listen(), 5000, 'collector listen');
    const serve = resources.serve = spawn(process.execPath, ['node_modules/gatsby/cli.js', 'serve', '-H', '127.0.0.1', '-p', String(port)], {
      cwd: process.cwd(), stdio: 'inherit', env: process.env,
    });
    await waitForServer(serve);
    const startupFailure = process.argv.includes('--inject-browser-startup-failure');
    if (startupFailure) {
      console.log(`OWNED_RESOURCES ${JSON.stringify({ gatsbyPort: port, collectorPort: 8838 })}`);
    }
    resources.browserServer = await chromium.launchServer({
      headless: true,
      timeout: 20000,
      ...(startupFailure ? { executablePath: '/no-such-playwright-browser' } : {}),
    });
    const browserPid = resources.browserServer.process().pid;
    if (process.argv.includes('--inject-browser-connect-failure')) {
      console.log(`OWNED_RESOURCES ${JSON.stringify({ browserPid, gatsbyPort: port, collectorPort: 8838 })}`);
      throw new Error('injected browser connection failure');
    }
    const browser = resources.browser = await chromium.connect(resources.browserServer.wsEndpoint(), { timeout: 20000 });
    if (process.argv.includes('--inject-browser-cleanup-failure') || process.argv.includes('--inject-browser-cleanup-stall')) {
      console.log(`OWNED_RESOURCES ${JSON.stringify({ browserPid, gatsbyPort: port, collectorPort: 8838 })}`);
      browser.close = process.argv.includes('--inject-browser-cleanup-failure')
        ? async () => { throw new Error('injected pre-shutdown browser.close rejection'); }
        : () => new Promise(() => {});
      throw new Error('injected primary browser test failure');
    }
    const page = await bounded(() => browser.newPage(), 20000, 'browser page creation');
    const outgoing = [];
    const pageErrors = [];
    page.on('request', request => outgoing.push(new URL(request.url()).origin));
    page.on('pageerror', error => pageErrors.push(error.message));
    const serverHtml = await (await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(5000) })).text();
    assert.match(serverHtml, /Gatsby public package telemetry probe/);
    assert.equal(collector.requests.length, 0, 'SSR request must not call the definitions or telemetry collector');

    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.locator('#ready').getByText('true').waitFor({ timeout: 15000 });
    for (const id of ['direct', 'hook-flag', 'hook-any', 'hook-negated']) {
      await page.locator(`#${id}`).getByText('true').waitFor();
    }
    for (const id of ['computed-gate', 'hook-all']) {
      await page.locator(`#${id}`).getByText('false').waitFor();
    }
    for (const id of ['feature', 'feature-negated', 'gate-any', 'gate-negated', 'entity']) {
      await page.locator(`#${id}`).waitFor();
    }
    await page.locator('#gate-all').waitFor({ state: 'detached' });

    const metricsBeforeExplicit = collector.requests.filter(row => row.url.includes('/metrics')).length;
    assert.equal(metricsBeforeExplicit, 0, 'rendering evaluations should queue checks without sending before flush');
    const definitionCount = collector.requests.filter(row => row.url.includes('/evaluated-signed/')).length;
    assert.ok(definitionCount >= 1, 'browser must fetch definitions from the local collector');
    assert.equal(collector.requests.filter(row => row.url.includes('/metrics')).length, metricsBeforeExplicit,
      'hydration should queue automatic checks without an implicit network send');

    await page.locator('#explicit').click();
    let packets = await waitForTelemetryCount(collector, 1);
    await page.waitForFunction(() => document.body.dataset.flushed === 'true');
    const first = packets[0];
    const packet = first.body;
    console.log('Observed telemetry packet:', JSON.stringify(packet));
    assert.deepEqual(Object.keys(packet).filter(key => ['k', 'e', 'f', 'm'].includes(key)).sort(), ['e', 'f', 'k', 'm']);
    assert.equal(packet.k, 'sample-browser-key');
    assert.equal(packet.e, 'Production');
    assert.deepEqual(packet.f['manual-variant']['treatment-b'], [0, 1]);
    assert.deepEqual(packet.f['manual-default'].enabled, [0, 0, 1]);
    assert.equal(packet.m.orders, 5, 'counters should sum');
    assert.equal(packet.m['cart-value'], 19, 'gauges should retain the latest value');
    assert.deepEqual(packet.f['context-variant']['control-a'], [0, 1]);
    assert.deepEqual(packet.f['context-default'].enabled, [0, 0, 1]);
    assert.equal(packet.m['context-orders'], 4);
    assert.equal(packet.m['context-gauge'], 7);
    assert.equal(packet.f.Skipped, undefined, 'any gate should short circuit before the second leaf');
    assert.ok(packet.f.Local.disabled, 'local gate should record the effective disabled result');
    assert.equal(packet.f.Local.enabled, undefined);
    assert.deepEqual(packet.f.Entity.enabled, [1], 'one entity evaluation should record one check');

    // Observe i/u without deciding the pending packet policy.
    const identityObservation = Object.fromEntries(['i', 'u'].filter(key => key in packet).map(key => [key, packet[key]]));
    console.log('Observed identity fields:', JSON.stringify(identityObservation));
    console.log('Observed compression:', first.headers['content-encoding'] || 'none');

    collector.setTelemetryStatus(503);
    await page.clock.install();
    await page.evaluate(() => {
      window.__gatsbyProbe.recordUsage('retry-503');
      void window.__gatsbyProbe.flushTelemetry();
    });
    await waitForTelemetryCount(collector, 2);
    collector.setTelemetryStatus(202);
    await page.clock.fastForward(30000);
    packets = await waitForTelemetryCount(collector, 3);
    assert.ok(packets[2].body.f['retry-503'].enabled, '503 retry should retain the event');

    await page.locator('#hidden').click();
    packets = await waitForTelemetryCount(collector, 4);
    assert.ok(packets[3].body.f['hidden-lifecycle'].enabled, 'hidden visibility should flush queued events');

    await page.evaluate(async () => {
      window.__gatsbyProbe.recordUsage('retired-owner-only');
      await window.__gatsbyProbe.initTogglyClient({
        appKey: 'replacement-app', environment: 'Staging', identity: 'replacement-user',
        baseURI: 'http://127.0.0.1:8838/definitions', metricsBaseUrl: 'http://127.0.0.1:8838/metrics',
        enableLiveUpdates: false, featureFlagsRefreshInterval: 0,
      });
      window.__gatsbyProbe.recordUsage('replacement-only');
      await window.__gatsbyProbe.flushTelemetry();
    });
    packets = await waitForTelemetryCount(collector, 5);
    assert.equal(packets[4].body.k, 'replacement-app');
    assert.equal(packets[4].body.e, 'Staging');
    assert.ok(packets[4].body.f['replacement-only']);
    assert.equal(packets[4].body.f['retry-503'], undefined, 'replacement should discard the retired owner queue');
    assert.equal(packets[4].body.f['retired-owner-only'], undefined, 'replacement should discard the prior owner queue');

    const beforeOptOut = packets.length;
    await page.locator('#opt-out').click();
    await delay(100);
    assert.equal(collector.requests.filter(row => row.url.includes('/metrics')).length, beforeOptOut,
      'opt-out owner must not post telemetry');
    const definitionsBeforeKeyless = collector.requests.filter(row => row.url.includes('/evaluated-signed/')).length;
    await page.locator('#keyless').click();
    await delay(100);
    assert.equal(collector.requests.filter(row => row.url.includes('/metrics')).length, beforeOptOut,
      'keyless owner must not post telemetry');
    assert.equal(collector.requests.filter(row => row.url.includes('/evaluated-signed/')).length, definitionsBeforeKeyless,
      'keyless owner must not fetch definitions');

    const external = [...new Set(outgoing)].filter(origin => !['http://127.0.0.1:8837', 'http://127.0.0.1:8838'].includes(origin));
    assert.deepEqual(external, [], 'all browser network requests must remain on local hosts');
    assert.deepEqual(pageErrors, [], 'the public Gatsby consumer should hydrate without browser errors');
  });
}

async function waitForServer(child) {
  let spawnError;
  const deadline = Date.now() + 30000;
  const onError = error => { spawnError = error; };
  child.once('error', onError);
  try {
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Gatsby serve exited before becoming ready (code ${child.exitCode}, signal ${child.signalCode})`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) return;
      } catch { /* Gatsby is still starting. */ }
      await delay(Math.min(100, Math.max(0, deadline - Date.now())));
    }
    throw new Error('Gatsby serve did not become ready within 30 seconds');
  } finally {
    child.removeListener('error', onError);
  }
}

main().catch(error => {
  console.error(error);
  for (const cleanupError of error.cause?.errors || []) {
    console.error('Cleanup error:', cleanupError);
  }
  process.exitCode = 1;
});
