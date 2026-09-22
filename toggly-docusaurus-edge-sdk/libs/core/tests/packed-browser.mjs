import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { gunzipSync } from 'node:zlib';

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const sdkDirectory = dirname(dirname(dirname(packageDirectory)));
const reporterDirectory = join(sdkDirectory, 'toggly-client-telemetry');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? packageDirectory,
    encoding: 'utf8',
    timeout: 180_000,
    stdio: options.stdio ?? 'pipe',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      ...options.env,
    },
  });
}

function pack(directory, destination) {
  const result = JSON.parse(run('npm', [
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    destination,
  ], { cwd: directory }));
  assert.equal(result.length, 1);
  return join(destination, result[0].filename);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function close(server) {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function waitFor(predicate, message, timeoutMs = 7000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(25);
  }
  throw new Error(message);
}

async function evaluate(page, callback, argument) {
  let timer;
  try {
    return await Promise.race([
      page.evaluate(callback, argument),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Packed client evaluation exceeded 10 seconds')), 10_000); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  return request.headers['content-encoding'] === 'gzip' ? gunzipSync(body) : body;
}

const temporary = mkdtempSync(join(tmpdir(), 'toggly-client-core-packed-'));
const host = join(temporary, 'host');
mkdirSync(host, { recursive: true });
let collector;
let staticServer;
let browser;

try {
  run('npm', ['run', 'build']);
  const packageTarball = pack(packageDirectory, temporary);
  let reporterTarball = process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL;
  if (!reporterTarball && process.env.TOGGLY_USE_LOCAL_TELEMETRY === '1') {
    run('npm', ['run', 'build'], { cwd: reporterDirectory });
    reporterTarball = pack(reporterDirectory, temporary);
  }

  writeFileSync(join(host, 'package.json'), JSON.stringify({
    name: 'toggly-client-core-packed-host',
    private: true,
    type: 'module',
  }, null, 2));

  const install = [
    'install',
    '--ignore-scripts',
    '--no-package-lock',
    packageTarball,
    ...(reporterTarball ? [reporterTarball] : []),
    'esbuild@0.25.10',
    'playwright@1.58.2',
    'typescript@5.3.3',
  ];
  run('npm', install, { cwd: host, stdio: 'inherit' });
  const installedVersion = name => JSON.parse(readFileSync(join(host, 'node_modules', name, 'package.json'), 'utf8')).version;

  const packedFiles = run('tar', ['-tzf', packageTarball]);
  for (const expected of [
    'package/dist/index.js',
    'package/dist/index.d.ts',
    'package/dist/browser.js',
    'package/dist/browser.d.ts',
    'package/dist/client.js',
    'package/dist/client.d.ts',
  ]) {
    assert.ok(packedFiles.includes(expected), `packed client core contains ${expected}`);
  }

  writeFileSync(join(host, 'consumer.cjs'), `
const assert = require('node:assert/strict');
global.window = { addEventListener() { throw new Error('portable CJS attached browser lifecycle'); } };
global.document = { addEventListener() { throw new Error('portable CJS attached browser lifecycle'); } };
const { createTogglyClient } = require('@ops-ai/toggly-client-core');
const client = createTogglyClient({ appKey: 'server-cjs', fetch: async () => ({ ok: true, text: async () => '{"On":true}' }) });
client.getFlag('On').then((value) => {
  assert.equal(value, true);
  client.dispose();
  console.log('PACKED_CLIENT_CORE_CJS_PASS');
}).catch((error) => { console.error(error); process.exitCode = 1; });
`);
  writeFileSync(join(host, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import { createTogglyClient } from '@ops-ai/toggly-client-core';
const client = createTogglyClient({ flagDefaults: { ESM: true } });
assert.equal(await client.getFlag('ESM'), true);
client.dispose();
console.log('PACKED_CLIENT_CORE_ESM_PASS');
`);
  writeFileSync(join(host, 'consumer.mts'), `
import { createTogglyClient, type TogglyClient, type TogglyConfig } from '@ops-ai/toggly-client-core';
const config: TogglyConfig = {
  appKey: 'typed', enableTelemetry: true, enableUsageTracking: true, enableMetrics: true,
  metricsBaseUrl: 'https://metrics.example/base', telemetryFlushIntervalMs: 45_000,
};
const client: TogglyClient = createTogglyClient(config);
client.recordUsage('feature', 'blue');
client.recordView('feature');
client.incrementCounter('orders', 2);
client.setGauge('cartValue', 19.5);
const switched: Promise<void> = client.setContext({ instanceId: 'mint-token', identity: 'alice' });
const flushed: Promise<void> = client.flushTelemetry();
client.dispose({ flush: false });
void switched;
void flushed;
// @ts-expect-error Gauge values are required.
client.setGauge('missing');
`);
  writeFileSync(join(host, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'Node16',
      moduleResolution: 'Node16',
      strict: true,
      skipLibCheck: false,
      noEmit: true,
    },
    include: ['consumer.mts'],
  }, null, 2));

  const cjsOutput = run(process.execPath, ['consumer.cjs'], { cwd: host });
  assert.match(cjsOutput, /PACKED_CLIENT_CORE_CJS_PASS/);
  const esmOutput = run(process.execPath, ['consumer.mjs'], { cwd: host });
  assert.match(esmOutput, /PACKED_CLIENT_CORE_ESM_PASS/);
  run(join(host, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], { cwd: host });
  console.log('PACKED_CLIENT_CORE_CJS_ESM_TYPES_PASS');

  const telemetryRequests = [];
  const definitionUrls = [];
  const preflights = [];
  collector = createServer(async (request, response) => {
    const origin = request.headers.origin ?? '*';
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type, content-encoding');
    if (request.method === 'OPTIONS') {
      preflights.push(request.url);
      response.writeHead(204).end();
      return;
    }
    if (request.url?.startsWith('/evaluated-signed/')) {
      definitionUrls.push(request.url);
      response.setHeader('content-type', 'application/json');
      const query = new URL(request.url, 'http://localhost').searchParams;
      const changed = request.url.includes('/snapshot-') && (query.get('u') === 'bob' || query.get('i') === 'token-b');
      response.end(JSON.stringify({
        On: !changed,
        Off: false,
        Gated: {
          requirement: 'all',
          rules: [{ property: 'Plan', op: 'eq', value: 'pro', type: 'string' }],
        },
      }));
      return;
    }
    if (request.url === '/api/frontend/telemetry' && request.method === 'POST') {
      telemetryRequests.push({
        encoding: request.headers['content-encoding'] ?? 'identity',
        origin: request.headers.origin,
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
        body: JSON.parse((await requestBody(request)).toString('utf8')),
      });
      response.writeHead(202).end();
      return;
    }
    response.writeHead(404).end();
  });
  const collectorOrigin = await listen(collector);

  writeFileSync(join(host, 'browser-entry.js'), `
import { createTogglyClient } from '@ops-ai/toggly-client-core';

globalThis.runClientCoreAcceptance = async (origin) => {
  const diagnostics = [];
  const client = createTogglyClient({
    appKey: 'browser-app', environment: 'Production', baseURI: origin,
    identity: 'alice', instanceId: 'mint-token', groups: ['beta'], claims: { plan: 'pro' },
    metricsBaseUrl: origin, featureFlagsRefreshInterval: 60_000,
    telemetryFlushIntervalMs: 30_000,
    onTelemetryDiagnostic: code => diagnostics.push(code),
  });
  await client.getFlags();
  const values = [
    await client.getFlag('On'),
    await client.getFlag('On'),
    await client.getFlag('Off'),
    await client.getFlag('Gated', false, { kind: 'Account', key: 'a-1', attributes: { Plan: 'free' } }),
  ];
  client.recordUsage('On', 'blue');
  client.recordView('Off');
  client.incrementCounter('orders', 2);
  client.setGauge('cartValue', 19.5);
  await client.flushTelemetry();
  client.recordUsage('exitFeature');
  window.dispatchEvent(new PageTransitionEvent('pagehide'));
  globalThis.clientCoreMain = client;
  globalThis.clientCoreValues = values;
  globalThis.clientCoreDiagnostics = diagnostics;
};

globalThis.runSecondClient = async (origin) => {
  const client = createTogglyClient({
    appKey: 'second-app', environment: 'Preview', baseURI: origin, metricsBaseUrl: origin,
    telemetryFlushIntervalMs: 30_000,
  });
  client.recordView('secondOnly');
  await client.flushTelemetry();
  client.dispose();
};

globalThis.runInvalidTelemetryClient = async (origin) => {
  const diagnostics = [];
  const client = createTogglyClient({
    appKey: 'invalid-telemetry-app', baseURI: origin, metricsBaseUrl: 'https://',
    onTelemetryDiagnostic: code => diagnostics.push(code),
  });
  const enabled = await client.getFlag('On');
  client.recordUsage('must-not-send');
  await client.flushTelemetry();
  client.dispose();
  return { enabled, diagnostics };
};

globalThis.runAttributionClients = async (origin) => {
  const options = {baseURI: origin, metricsBaseUrl: origin, identity: 'alice', featureFlagsRefreshInterval: 60_000};
  const results = [];
  for (const field of ['identity', 'instanceId']) {
    const client = createTogglyClient({...options, appKey: 'snapshot-' + field, ...(field === 'instanceId' ? {instanceId: 'token-a'} : {})});
    try {
      await client.getFlags();
      let switched;
      client.registerContext('snapshot-' + field, () => {
        switched = client.setContext({[field]: field === 'identity' ? 'bob' : 'token-b'});
        return {kind: 'Account', key: 'a-1', attributes: {Plan: 'pro'}};
      });
      const oldValue = await client.getFlag('On', false, {}, 'snapshot-' + field);
      await switched;
      const newValue = await client.getFlag('On');
      await client.flushTelemetry(); results.push([oldValue, newValue]);
    } finally { client.dispose({flush: false}); }
  }
  const cached = createTogglyClient({...options, appKey: 'snapshot-cached'});
  try {
    await cached.getFlags();
    const oldValue = cached.getFlag('On');
    const switched = cached.setContext({identity: 'bob'});
    const resolved = await oldValue; await switched;
    const current = await cached.getFlag('On');
    await cached.flushTelemetry();results.push([resolved, current]);
  } finally { cached.dispose({flush: false}); }
  let finishOld;
  let first = true;
  const inflight = createTogglyClient({...options, appKey: 'snapshot-inflight', fetch: (url, init) => {
    if (first) {first = false;return new Promise(resolve => {finishOld = resolve})}
    return fetch(url, init);
  }});
  try {
    const pending = inflight.getFlag('On');
    await inflight.setContext({identity: 'bob'});
    finishOld(new Response(JSON.stringify({On: true})));
    results.push([await pending]);await inflight.flushTelemetry();
  } finally { inflight.dispose({flush: false}); }
  const disposed = createTogglyClient({...options, appKey: 'snapshot-disposed'});
  try {
    await disposed.getFlags();
    disposed.registerContext('snapshot-disposed', () => {disposed.dispose({flush: false});return {kind: 'Account',key: 'a-1'}});
    results.push([await disposed.getFlag('On', false, {}, 'snapshot-disposed')]);
  } finally { disposed.dispose({flush: false}); }
  return results;
};

globalThis.disposeClientCore = async () => {
  const client = globalThis.clientCoreMain;
  client.dispose();
  client.recordUsage('afterDispose');
  window.dispatchEvent(new PageTransitionEvent('pagehide'));
  await client.flushTelemetry();
};
`);

  run(join(host, 'node_modules', '.bin', 'esbuild'), [
    'browser-entry.js',
    '--bundle',
    '--platform=browser',
    '--format=iife',
    '--conditions=browser',
    '--outfile=browser-bundle.js',
  ], { cwd: host });
  const browserBundle = readFileSync(join(host, 'browser-bundle.js'), 'utf8');
  assert.match(browserBundle, /visibilitychange/);

  staticServer = createServer((request, response) => {
    if (request.url === '/browser-bundle.js') {
      response.setHeader('content-type', 'text/javascript');
      response.end(browserBundle);
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><script src="/browser-bundle.js"></script><p id="ready">ready</p>');
  });
  const hostOrigin = await listen(staticServer);

  const { chromium } = await import(pathToFileURL(join(host, 'node_modules', 'playwright', 'index.mjs')).href);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'collector-secret', value: 'must-not-send', url: collectorOrigin }]);
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    if (!request.url().startsWith(collectorOrigin)) browserErrors.push(`request failed: ${request.url()}`);
  });
  await page.goto(hostOrigin, { waitUntil: 'networkidle' });
  await evaluate(page, (origin) => globalThis.runClientCoreAcceptance(origin), collectorOrigin);
  await waitFor(() => telemetryRequests.length >= 2, 'browser telemetry and pagehide envelopes were not received');

  assert.deepEqual(await evaluate(page, () => globalThis.clientCoreValues), [true, true, false, false]);
  assert.deepEqual(await evaluate(page, () => globalThis.clientCoreDiagnostics), []);
  const mainRequests = telemetryRequests.filter((request) => request.body.k === 'browser-app');
  assert.equal(mainRequests.length, 2);
  const ordinary = mainRequests.find((request) => request.encoding === 'gzip');
  const exit = mainRequests.find((request) => request.encoding === 'identity');
  assert.ok(ordinary, 'ordinary flush uses gzip');
  assert.ok(exit, 'pagehide flush uses plain keepalive JSON');
  assert.deepEqual(ordinary.body, {
    k: 'browser-app',
    e: 'Production',
    i: 'mint-token',
    f: {
      On: { enabled: [2], blue: [0, 1] },
      Off: { disabled: [1], enabled: [0, 0, 1] },
      Gated: { disabled: [1] },
    },
    m: { orders: 2, cartValue: 19.5 },
  });
  assert.deepEqual(exit.body, {
    k: 'browser-app',
    e: 'Production',
    i: 'mint-token',
    f: { exitFeature: { enabled: [0, 1] } },
  });
  assert.ok(
    definitionUrls.some((url) => url.includes('i=mint-token') && !url.includes('u=') && !url.includes('g=')),
    'definitions request uses minted ?i= without client u/g',
  );
  assert.equal(ordinary.body.u, undefined);
  for (const request of mainRequests) {
    assert.equal(request.origin, hostOrigin);
    assert.equal(request.authorization, undefined);
    assert.equal(request.cookie, undefined);
  }
  assert.ok(preflights.includes('/api/frontend/telemetry'), 'collector observed telemetry CORS preflight');

  await evaluate(page, (origin) => globalThis.runSecondClient(origin), collectorOrigin);
  await waitFor(() => telemetryRequests.some((request) => request.body.k === 'second-app'), 'second client envelope was not received');
  const second = telemetryRequests.find((request) => request.body.k === 'second-app');
  assert.deepEqual(second.body, {
    k: 'second-app',
    e: 'Preview',
    f: { secondOnly: { enabled: [0, 0, 1] } },
  });

  const invalidResult = await evaluate(page,
    (origin) => globalThis.runInvalidTelemetryClient(origin),
    collectorOrigin,
  );
  assert.equal(invalidResult.enabled, true);
  assert.deepEqual(invalidResult.diagnostics, ['invalid-option']);
  assert.equal(
    telemetryRequests.some((request) => request.body.k === 'invalid-telemetry-app'),
    false,
  );

  const attributionResults = await evaluate(page, (origin) => globalThis.runAttributionClients(origin), collectorOrigin);
  assert.deepEqual(attributionResults, [[true, false], [true, false], [true, false], [false], [true]]);
  const attributed = telemetryRequests.filter(request => request.body.k.startsWith('snapshot-'));
  assert.equal(attributed.length, 7);
  const check = (app, attribution, enabled) => ({k: app, e: 'Production', ...attribution, f: {On: {[enabled ? 'enabled' : 'disabled']: [1]}}});
  assert.deepEqual(attributed.map(request => request.body), [
    check('snapshot-identity', {u: 'alice'}, true), check('snapshot-identity', {u: 'bob'}, false),
    check('snapshot-instanceId', {i: 'token-a'}, true), check('snapshot-instanceId', {i: 'token-b'}, false),
    check('snapshot-cached', {u: 'alice'}, true), check('snapshot-cached', {u: 'bob'}, false),
    check('snapshot-inflight', {u: 'bob'}, false),
  ]);
  assert.ok(attributed.every(request => request.encoding === 'gzip' && request.origin === hostOrigin && request.authorization === undefined && request.cookie === undefined));

  const beforeDispose = telemetryRequests.length;
  await evaluate(page, () => globalThis.disposeClientCore());
  await delay(250);
  assert.equal(telemetryRequests.length, beforeDispose, 'disposed owner emitted no later telemetry');
  assert.deepEqual(browserErrors, []);
  console.log('PACKED_CLIENT_CORE_BROWSER_TELEMETRY_PASS');
  console.log(`PACKED_CLIENT_CORE_HOST_PASS ${JSON.stringify({sdk: installedVersion('@ops-ai/toggly-client-core'), reporter: installedVersion('@ops-ai/toggly-client-telemetry'), reporterSource: reporterTarball ? 'local-tarball' : 'registry', node: process.version, typescript: installedVersion('typescript'), playwright: installedVersion('playwright'), chromium: browser.version(), envelopes: telemetryRequests.length})}`);
} finally {
  await browser?.close().catch(() => undefined);
  await close(staticServer);
  await close(collector);
  rmSync(temporary, { recursive: true, force: true });
}
