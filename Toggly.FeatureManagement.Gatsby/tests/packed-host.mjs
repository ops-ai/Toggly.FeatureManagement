import assert from 'node:assert/strict';
import { bounded, diagnoseFailure, cleanupOwned, closeBrowser, closeServer, runOwnedCommand, stopChild } from './owned-resources.mjs';
import { spawn } from 'node:child_process';
import { runBrowserCleanupControls } from './browser-cleanup.mjs';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { gunzipSync } from 'node:zlib';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const sdkDirectory = dirname(packageDirectory);
const reporterOverride = process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL;
const reporterTarball = reporterOverride ? resolve(reporterOverride) : undefined;
if (reporterTarball) {
  assert.ok(statSync(reporterTarball).isFile(), 'local reporter override must be an existing tarball');
  console.log('LOCAL_TELEMETRY_TARBALL: registry acceptance pending');
}
const currentGatsby = '5.16.1';

function run(command, args, options = {}) {
  console.log('GATSBY_HOST_COMMAND', command, args.join(' '));
  return runOwnedCommand(command, args, {
    cwd: options.cwd ?? sdkDirectory,
    stdio: options.stdio ?? 'pipe',
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', ...options.env },
  }, 180_000);
}
const runAsync = (command, args, options = {}) => run(command, args, { stdio: 'inherit', ...options });

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const rawJwk = publicKey.export({ format: 'jwk' });
const kid = createHash('sha1')
  .update(Buffer.from(rawJwk.x, 'base64url'))
  .update(Buffer.from(rawJwk.y, 'base64url'))
  .digest('hex')
  .toUpperCase() + 'ES256';
const jwks = { keys: [{ ...rawJwk, kid, alg: 'ES256', use: 'sig' }] };

function envelope(defs) {
  const timestamp = Math.floor(Date.now() / 1000);
  const raw = JSON.stringify(defs);
  const digest = createHash('sha256').update(`${raw}|${timestamp}`).digest();
  return JSON.stringify({
    defs,
    timestamp,
    kid,
    signature: sign('sha256', digest, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString(
      'base64',
    ),
  });
}

function writeHost(host, baseURI) {
  writeFileSync(
    join(host, 'package.json'),
    JSON.stringify({ name: 'toggly-gatsby-packed-host', private: true }, null, 2),
  );
  writeFileSync(
    join(host, 'gatsby-config.js'),
    `module.exports = {
  plugins: [{
    resolve: '@ops-ai/gatsby-feature-flags-toggly',
    options: {
      appKey: 'gatsby-current-host',
      environment: 'Production',
      baseURI: ${JSON.stringify(baseURI)},
      metricsBaseUrl: ${JSON.stringify(baseURI)},
      verifySignatures: true,
      enableLiveUpdates: false,
      flagDefaults: { serverOff: false }
    }
  }]
};
`,
  );
  writeFileSync(
    join(host, 'gatsby-node.js'),
    `exports.createPages = async ({ actions }) => {
  actions.createPage({
    path: '/gated/',
    component: require.resolve('./src/gated.js'),
    context: { frontmatter: { 'x-feature': 'build-gate' } }
  });
  actions.createPage({ path: '/ssr/', component: require.resolve('./src/ssr.js') });
};
`,
  );
  mkdirSync(join(host, 'src'), { recursive: true });
  mkdirSync(join(host, 'src', 'pages'), { recursive: true });
  writeFileSync(join(host, 'src', 'pages', 'index.js'), `
import React, { useEffect } from 'react';
import { hydrateRoot } from 'react-dom/client';
import {
  Feature,
  FeatureGate,
  flushTelemetry,
  incrementCounter,
  initTogglyClient,
  recordUsage,
  recordView,
  setGauge,
  useFeatureFlag,
} from '@ops-ai/gatsby-feature-flags-toggly';

function WarmConsumer() {
  const { isEnabled } = useFeatureFlag('warmOn');
  useEffect(() => { document.body.dataset.warm = 'committed'; }, []);
  return <span>{isEnabled ? 'warm-on' : 'warm-off'}</span>;
}
export default function IndexPage() {
  useEffect(() => { document.body.dataset.hydrated = 'true'; }, []);
  const hook = useFeatureFlag('hookOn');
  return <main>
    <p id="mounted">{hook.isReady ? 'ready' : 'loading'}</p>
    <p id="hook">{hook.isEnabled ? 'on' : 'off'}</p>
    <Feature flag="featureOn" loading={<p id="feature">loading</p>}>
      <p id="feature">on</p>
    </Feature>
    <FeatureGate flags={['gateOn', 'gateSkipped']} requirement="any">
      <p id="gate">on</p>
    </FeatureGate>
    <button id="warm" onClick={() => {
      const container = document.createElement('div');
      container.id = 'warm-root';
      container.innerHTML = window.__TOGGLY_COLD_HTML__;
      document.body.appendChild(container);
      hydrateRoot(container, <WarmConsumer />);
    }}>warm replay</button>
    <button id="warm-flush" onClick={async () => { await flushTelemetry(); document.body.dataset.warmFlushed = 'true'; }}>warm flush</button>
    <button id="explicit" onClick={async () => {
      recordUsage('featureOn', 'blue');
      recordView('featureOff', 'green');
      incrementCounter('orders', 2);
      setGauge('cartValue', 19.5);
      await flushTelemetry();
      document.body.dataset.explicit = 'done';
    }}>explicit</button>
    <button id="exit" onClick={() => {
      recordUsage('exitFeature');
      document.body.dataset.exit = 'queued';
    }}>exit</button>
    <button id="replacement" onClick={async () => {
      recordUsage('oldOnly');
      await initTogglyClient({
        appKey: 'gatsby-replacement-host', environment: 'Preview', identity: 'first-user',
        baseURI: ${JSON.stringify(baseURI)}, metricsBaseUrl: ${JSON.stringify(baseURI)},
        enableLiveUpdates: false, featureFlagsRefreshInterval: 0,
      });
      recordView('newOnly');
      await flushTelemetry();
      document.body.dataset.replacement = 'done';
    }}>replacement</button>
    <button id="minted" onClick={async () => {
      recordUsage('queuedBeforeToken');
      await initTogglyClient({
        appKey: 'gatsby-replacement-host', environment: 'Preview', identity: 'ignored-user',
        instanceId: 'host-token', groups: ['private-group'], claims: { role: 'private-claim' },
        baseURI: ${JSON.stringify(baseURI)}, metricsBaseUrl: ${JSON.stringify(baseURI)},
        enableLiveUpdates: false, featureFlagsRefreshInterval: 0,
      });
      recordView('mintedView');
      await flushTelemetry();
      document.body.dataset.minted = 'done';
    }}>minted</button>
    <button id="identified" onClick={async () => {
      recordUsage('queuedBeforeIdentity');
      await initTogglyClient({
        appKey: 'gatsby-replacement-host', environment: 'Preview', identity: 'second-user',
        groups: ['staff'], claims: { role: 'admin' },
        baseURI: ${JSON.stringify(baseURI)}, metricsBaseUrl: ${JSON.stringify(baseURI)},
        enableLiveUpdates: false, featureFlagsRefreshInterval: 0,
      });
      recordView('identifiedView');
      await flushTelemetry();
      document.body.dataset.identified = 'done';
    }}>identified</button>
  </main>;
}
`);
  writeFileSync(join(host, 'warm-ssr.cjs'), `
const React = require('react');
const { renderToString } = require('react-dom/server');
const { useFeatureFlag } = require('@ops-ai/gatsby-feature-flags-toggly');
function WarmConsumer() {
  const { isEnabled } = useFeatureFlag('warmOn');
  return React.createElement('span', null, isEnabled ? 'warm-on' : 'warm-off');
}
console.log(renderToString(React.createElement(WarmConsumer)));
`);
  writeFileSync(join(host, 'src', 'gated.js'), "import React from 'react'; export default () => <main>Gatsby packed SSG gate</main>;\n");
  writeFileSync(join(host, 'src', 'ssr.js'), `
import React from 'react';

export async function getServerData() {
  const { createTogglyServerClient } = await import('@ops-ai/gatsby-feature-flags-toggly');
  const server = createTogglyServerClient({
    appKey: 'gatsby-current-host', environment: 'Production',
    baseURI: ${JSON.stringify(baseURI)}, verifySignatures: true,
    enableLiveUpdates: false, featureFlagsRefreshInterval: 0,
  });
  return {
    status: 200,
    headers: { 'cache-control': 'no-store' },
    props: {
      enabled: await server.evaluateGate(['serverOn']),
      disabled: await server.evaluateGate(['serverOff']),
    },
  };
}

export default function SsrPage({ serverData }) {
  return <main>
    {serverData.enabled ? <p>SSR_ENABLED_GATE</p> : <p>SSR_OFF_FALLBACK</p>}
    {serverData.disabled ? <p>SSR_DISABLED_LEAK</p> : <p>SSR_DISABLED_FALLBACK</p>}
  </main>;
}
`);
  writeFileSync(join(host, 'consumer.mts'), `
import { createTogglyServerClient, type TogglyPluginOptions } from '@ops-ai/gatsby-feature-flags-toggly';
import { useFeatureFlag } from '@ops-ai/gatsby-feature-flags-toggly/hooks';
import { Feature, FeatureGate } from '@ops-ai/gatsby-feature-flags-toggly/components';
import { $gate } from '@ops-ai/gatsby-feature-flags-toggly/client';
const config: TogglyPluginOptions = { appKey: 'packed-type-consumer', verifySignatures: true, instanceId: 'host-token' };
const result: Promise<boolean> = createTogglyServerClient(config).evaluateGate(['one'], 'any');
const hookResult: ReturnType<typeof useFeatureFlag>['isEnabled'] = true;
const gateResult: boolean = $gate(['one'], 'all').get();
// @ts-expect-error The packed gate requirement must retain its public union type.
createTogglyServerClient(config).evaluateGate(['one'], 'unsupported');
// @ts-expect-error Packed client gates expose booleans rather than untyped values.
const invalidGate: string = $gate(['one']).get();
void [result, hookResult, gateResult, Feature, FeatureGate, invalidGate];
`);
  writeFileSync(join(host, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import { createTogglyServerClient, initTogglyClient, Feature, FeatureGate } from '@ops-ai/gatsby-feature-flags-toggly';
import { useFeatureFlag } from '@ops-ai/gatsby-feature-flags-toggly/hooks';
import { TogglyProvider } from '@ops-ai/gatsby-feature-flags-toggly/components';
import { $gate } from '@ops-ai/gatsby-feature-flags-toggly/client';
for (const value of [createTogglyServerClient, initTogglyClient, Feature, FeatureGate, useFeatureFlag, TogglyProvider, $gate]) {
  assert.equal(typeof value, 'function');
}
const server = createTogglyServerClient({
  appKey: 'gatsby-current-host', environment: 'Production',
  baseURI: ${JSON.stringify(baseURI)}, verifySignatures: true,
  enableLiveUpdates: false, featureFlagsRefreshInterval: 0,
});
assert.equal(await server.evaluateGate(['serverOn', 'serverOff'], 'any'), true);
assert.equal(await server.evaluateGate(['serverOn', 'serverOff'], 'all'), false);
console.log('PACKED_GATSBY_TYPES_AND_ESM_PASS');
`);
  writeFileSync(join(host, 'src', 'runtime.cjs'), `
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const sdk = require('@ops-ai/gatsby-feature-flags-toggly');
const ssr = require('@ops-ai/gatsby-feature-flags-toggly/gatsby-ssr');

(async () => {
  const config = {
    appKey: 'gatsby-current-host',
    environment: 'Production',
    baseURI: ${JSON.stringify(baseURI)},
    verifySignatures: true,
    enableLiveUpdates: false,
    featureFlagsRefreshInterval: 0,
    flagDefaults: { serverOff: false, runtimeOff: false }
  };
  const server = sdk.createTogglyServerClient(config);
  assert.equal(await server.getFlag('serverOn'), true);
  assert.equal(await server.getFlag('serverOff'), false);
  assert.equal(await server.evaluateGate(['serverOn', 'serverOff'], 'all'), false);
  assert.equal(await server.evaluateGate(['serverOn', 'serverOff'], 'any'), true);

  sdk.$flags.set({ runtimeOn: true, runtimeOff: false });
  sdk.$isReady.set(true);
  assert.equal(sdk.$gate(['runtimeOn', 'runtimeOff'], 'all').get(), false);
  assert.equal(sdk.$gate(['runtimeOn', 'runtimeOff'], 'any').get(), true);

  const html = renderToStaticMarkup(
    ssr.wrapRootElement({ element: React.createElement('main', null,
      React.createElement(sdk.Feature, { flag: 'runtimeOn' }, 'RUNTIME_ENABLED_GATE'),
      React.createElement(sdk.Feature, { flag: 'runtimeOff' }, 'RUNTIME_DISABLED_LEAK'),
      React.createElement(sdk.Feature, { flag: 'runtimeOff', negate: true }, 'RUNTIME_OFF_FALLBACK'),
      React.createElement(sdk.FeatureGate, { flags: ['runtimeOn', 'runtimeOff'], requirement: 'any' }, 'RUNTIME_ANY_GATE'),
      React.createElement(sdk.FeatureGate, { flags: ['runtimeOn', 'runtimeOff'], requirement: 'all' }, 'RUNTIME_ALL_LEAK'),
    ) }, config),
  );
  assert.match(html, /RUNTIME_ENABLED_GATE/);
  assert.match(html, /RUNTIME_OFF_FALLBACK/);
  assert.match(html, /RUNTIME_ANY_GATE/);
  assert.doesNotMatch(html, /RUNTIME_DISABLED_LEAK|RUNTIME_ALL_LEAK/);
  sdk.$isReady.set(false);
  console.log('PACKED_GATSBY_RUNTIME_PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`,
  );
}

async function verifyTarball(tarball) {
  const files = await run('tar', ['-tzf', tarball]);
  for (const expected of [
    'package/dist/index.js',
    'package/dist/index.mjs',
    'package/dist/index.d.ts',
    'package/dist/hooks/index.d.ts',
    'package/dist/components/index.d.ts',
    'package/dist/client/store.d.ts',
    'package/dist/plugin/gatsby-node.js',
    'package/dist/plugin/gatsby-ssr.js',
    'package/dist/plugin/gatsby-browser.js',
    'package/gatsby-node.js',
    'package/gatsby-ssr.js',
    'package/gatsby-browser.js',
  ]) {
    assert.ok(files.includes(expected), `packed Gatsby SDK contains ${expected}`);
  }
}

console.log(await run(process.execPath, ['--test', 'tests/cleanup.test.mjs']));

const temporary = mkdtempSync(join(tmpdir(), 'toggly-gatsby-packed-host-'));
const host = join(temporary, 'host');
let definitions;
let productionHost;
let browser;
let browserServer;
let failure;
let serverEnabled = true;
const telemetryRequests = [];

async function waitForTelemetry(count, phase) {
  const deadline = Date.now() + 10_000;
  while (telemetryRequests.length < count) {
    assert.ok(Date.now() < deadline,
      `Gatsby ${phase}: collector received ${telemetryRequests.length}/${count} envelopes within 10 seconds`);
    await delay(20);
  }
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  return request.headers['content-encoding'] === 'gzip' ? gunzipSync(body) : body;
}

try {
  const serverDefinitions = [
    { featureKey: 'serverOn', filters: [{ name: 'AlwaysOn', parameters: {} }] },
    { featureKey: 'serverOff', filters: [{ name: 'AlwaysOff', parameters: {} }] },
  ];
  const requests = [];
  const evaluatedRequests = [];
  let releaseInitialDefinitions;
  const initialDefinitions = new Promise(resolve => { releaseInitialDefinitions = resolve; });
  definitions = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    requests.push(url.pathname);
    if (request.method === 'GET' && url.pathname.includes('/evaluated-signed/')) evaluatedRequests.push(url);
    response.setHeader('access-control-allow-origin', request.headers.origin ?? '*');
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type, content-encoding, x-toggly-sdk, x-toggly-sdk-version');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === '/cors-probe' && request.method === 'POST') {
      response.writeHead(202).end();
      return;
    }
    if (url.pathname === '/api/frontend/telemetry' && request.method === 'POST') {
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
    response.setHeader('content-type', 'application/json');
    if (url.pathname === '/.well-known/jwks') {
      response.end(JSON.stringify(jwks));
      return;
    }
    if (url.pathname === '/definitions-signed/gatsby-current-host/Production') {
      response.end(envelope(serverDefinitions.map((definition) =>
        definition.featureKey === 'serverOn' && !serverEnabled
          ? { ...definition, filters: [{ name: 'AlwaysOff', parameters: {} }] }
          : definition,
      )));
      return;
    }
    if (url.pathname === '/evaluated-signed/gatsby-current-host/Production') {
      try { await bounded(() => initialDefinitions, 'Cold hydration response release', 8000); } catch (error) { response.destroy(error); return; }
      response.end(envelope({
        runtimeOn: true,
        runtimeOff: false,
        hookOn: true,
        featureOn: true,
        featureOff: false,
        gateOn: true,
        gateSkipped: false,
      }));
      return;
    }
    if (url.pathname === '/evaluated-signed/gatsby-replacement-host/Preview') {
      response.end(JSON.stringify({
        warmOn: true,
        hookOn: url.searchParams.has('i'),
        featureOn: url.searchParams.has('i'),
        featureOff: true,
        gateOn: url.searchParams.has('i'),
        gateSkipped: true,
      }));
      return;
    }
    response.writeHead(404).end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => definitions.listen(0, '127.0.0.1', resolve));
  const baseURI = `http://127.0.0.1:${definitions.address().port}`;

  await run('npm', ['run', 'build']);
  await runAsync(process.execPath, [join(packageDirectory, 'provider-ownership.mjs')]);
  const packed = JSON.parse(await run('npm', ['pack', '--json', '--pack-destination', temporary]))[0];
  const tarball = join(temporary, packed.filename);
  console.log('PACKED_GATSBY_ARTIFACT', JSON.stringify({ version: packed.version, integrity: packed.integrity, shasum: packed.shasum }));
  await verifyTarball(tarball);

  mkdirSync(host, { recursive: true });
  writeHost(host, baseURI);
  await run(
    'npm',
    [
      'install',
      '--no-package-lock',
      `gatsby@${currentGatsby}`,
      'react@18.3.1',
      'react-dom@18.3.1',
      'typescript@5.3.3',
      '@types/react@18.3.28',
      'playwright@1.58.2',
      ...(reporterTarball ? [reporterTarball] : []),
      tarball,
    ],
    { cwd: host },
  );
  assert.equal(
    (await run(process.execPath, ['-p', "require('gatsby/package.json').version"], { cwd: host })).trim(),
    currentGatsby,
  );
  assert.equal(
    JSON.parse(
      readFileSync(
        join(host, 'node_modules', '@ops-ai', 'toggly-client-telemetry', 'package.json'),
        'utf8',
      ),
    ).version,
    '1.1.0',
  );
  console.log('PACKED_GATSBY_REGISTRY_GRAPH', await run('npm', ['ls', '@ops-ai/toggly-client-telemetry', '@ops-ai/toggly-hooks-types', '@ops-ai/toggly-signed-defs', '--json'], { cwd: host }));
  await run(join(host, 'node_modules', '.bin', 'playwright'), ['install', 'chromium'], {
    cwd: host,
    stdio: 'inherit',
  });
  await run(join(host, 'node_modules', '.bin', 'tsc'), [
    '--noEmit', '--strict', '--module', 'ESNext', '--moduleResolution', 'Bundler',
    '--target', 'ES2022', '--types', 'react', 'consumer.mts',
  ], { cwd: host, stdio: 'inherit' });
  await runAsync(process.execPath, ['consumer.mjs'], { cwd: host });
  await runAsync(join(host, 'node_modules', '.bin', 'gatsby'), ['build'], {
    cwd: host, env: { CI: 'true', GATSBY_TELEMETRY_DISABLED: '1', TOGGLY_GATSBY_BUILD_DIAGNOSTICS: '1', NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require=${JSON.stringify(join(packageDirectory, 'build-diagnostics.cjs'))}` },
  });

  const pageFeatures = JSON.parse(readFileSync(join(host, 'public', 'toggly-page-features.json'), 'utf8'));
  const config = JSON.parse(readFileSync(join(host, 'public', 'toggly-config.json'), 'utf8'));
  assert.equal(pageFeatures['/gated'], 'build-gate');
  assert.match(readFileSync(join(host, 'public', 'gated', 'index.html'), 'utf8'), /Gatsby packed SSG gate/);
  assert.deepEqual(config, {
    appKey: 'gatsby-current-host',
    environment: 'Production',
    baseURI,
  });
  await runAsync(process.execPath, [join(host, 'src', 'runtime.cjs')], { cwd: host });
  const portProbe = createServer();
  await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  productionHost = spawn(join(host, 'node_modules', '.bin', 'gatsby'), [
    'serve', '--host', '127.0.0.1', '--port', String(port),
  ], { cwd: host, detached: process.platform !== 'win32', env: { ...process.env, CI: 'true', GATSBY_TELEMETRY_DISABLED: '1' }, stdio: 'inherit' });
  let startupError;
  productionHost.on('error', (error) => { startupError = error; });
  const deadline = Date.now() + 30_000;
  while (true) {
    if (startupError) throw startupError;
    assert.equal(productionHost.exitCode, null, 'Gatsby production server stays alive');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/gated/`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) break;
    } catch {}
    assert.ok(Date.now() < deadline, 'Gatsby production server starts within 30 seconds');
    await delay(100);
  }

  const javascriptFiles = [];
  const collectJavaScript = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) collectJavaScript(path);
      else if (path.endsWith('.js')) javascriptFiles.push(path);
    }
  };
  collectJavaScript(join(host, 'public'));
  const browserBundle = javascriptFiles.map((path) => readFileSync(path, 'utf8')).join('\n');
  for (const serverOnly of [
    '/definitions-signed/',
    '@grpc/grpc-js',
    '@grpc/proto-loader',
    'toggly-usage-stats',
  ]) {
    assert.doesNotMatch(browserBundle, new RegExp(serverOnly.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const { chromium } = await import(
    pathToFileURL(join(host, 'node_modules', 'playwright', 'index.mjs')).href
  );
  await runBrowserCleanupControls(chromium);
  browserServer = await chromium.launchServer({ headless: true });
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('requestfailed', (request) => {
    // Synthetic pagehide marks already delivered keepalive resources aborted
    // in Chromium. Collector receipt and the explicit CORS status probe below
    // are the authoritative transport assertions.
    if (!request.url().startsWith(baseURI)) {
      browserErrors.push(`request failed: ${request.url()} ${request.failure()?.errorText ?? ''}`);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error' || message.text().includes('Telemetry diagnostic')) {
      browserErrors.push(message.text());
    }
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  // Pin the original cold-hydration scenario; warm replay is exercised separately below.
  await page.waitForFunction(() => document.body.dataset.hydrated === 'true', undefined, { timeout: 5000 });
  releaseInitialDefinitions();
  try {
    await page.waitForFunction(
      () => document.querySelector('#mounted')?.textContent === 'ready',
      undefined,
      { timeout: 10_000 },
    );
  } catch (error) {
    throw await diagnoseFailure(error, async () => console.error('Gatsby browser diagnostics', {
      mounted: await page.locator('#mounted').textContent().catch(() => null),
      body: await page.locator('body').textContent().catch(() => null),
      browserErrors,
      definitionRequests: requests,
      resources: await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name)),
    }));
  }
  assert.equal(await page.locator('#hook').textContent(), 'on');
  assert.equal(await page.locator('#feature').textContent(), 'on');
  assert.equal(await page.locator('#gate').textContent(), 'on');

  await page.locator('#explicit').click();
  await page.waitForFunction(() => document.body.dataset.explicit === 'done', undefined, { timeout: 10_000 });
  await waitForTelemetry(1, 'explicit flush');
  const explicit = telemetryRequests[0];
  console.log('GATSBY_INITIAL_BROWSER_EVIDENCE', JSON.stringify({ errors: browserErrors, requests: evaluatedRequests.map(url => url.toString()), body: explicit.body }));
  assert.equal(explicit.encoding, 'gzip');
  assert.equal(explicit.origin, `http://127.0.0.1:${port}`);
  assert.equal(explicit.authorization, undefined);
  assert.equal(explicit.cookie, undefined);
  assert.deepEqual(Object.keys(explicit.body).sort(), ['e', 'f', 'k', 'm']);
  assert.deepEqual(explicit.body, {
    k: 'gatsby-current-host',
    e: 'Production',
    f: {
      hookOn: { enabled: [1] },
      featureOn: { enabled: [1], blue: [0, 1] },
      gateOn: { enabled: [1] },
      featureOff: { green: [0, 0, 1] },
    },
    m: { orders: 2, cartValue: 19.5 },
  });
  assert.equal(
    await bounded(() => page.evaluate(async (collector) => {
      const response = await fetch(`${collector}/cors-probe`, {
        signal: AbortSignal.timeout(5000),
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      return response.status;
    }, baseURI), 'Browser CORS evaluation', 10000),
    202,
  );

  await page.locator('#exit').click();
  await bounded(() => page.evaluate(() => window.dispatchEvent(new Event('pagehide'))), 'Browser pagehide evaluation', 10000);
  await waitForTelemetry(2, 'pagehide flush');
  assert.equal(telemetryRequests[1].encoding, 'identity');
  assert.deepEqual(telemetryRequests[1].body.f, {
    exitFeature: { enabled: [0, 1] },
  });

  await page.locator('#replacement').click();
  await page.waitForFunction(() => document.body.dataset.replacement === 'done', undefined, { timeout: 10_000 });
  await waitForTelemetry(3, 'owner replacement flush');
  const oldFinal = telemetryRequests.find((request) => request.body.k === 'gatsby-current-host' && request.body.f?.oldOnly);
  const replacement = telemetryRequests.find((request) => request.body.k === 'gatsby-replacement-host');
  assert.equal(oldFinal, undefined, 'transport replacement discards the retired queue');
  assert.deepEqual(replacement?.body, {
    k: 'gatsby-replacement-host',
    e: 'Preview',
    u: 'first-user',
    f: {
      hookOn: { disabled: [1] },
      featureOn: { disabled: [1] },
      gateOn: { disabled: [1] },
      gateSkipped: { enabled: [1] },
      newOnly: { enabled: [0, 0, 1] },
    },
  });
  assert.equal(replacement?.encoding, 'gzip');

  await page.locator('#minted').click();
  await page.waitForFunction(() => document.body.dataset.minted === 'done', undefined, { timeout: 10_000 });
  await waitForTelemetry(5, 'minted context flush');
  assert.equal(await page.locator('#hook').textContent(), 'on');
  assert.equal(await page.locator('#feature').textContent(), 'on');
  assert.deepEqual(telemetryRequests[3].body, {
    k: 'gatsby-replacement-host', e: 'Preview', u: 'first-user',
    f: { queuedBeforeToken: { enabled: [0, 1] } },
  });
  assert.deepEqual(telemetryRequests[4].body, {
    k: 'gatsby-replacement-host', e: 'Preview', i: 'host-token',
    f: { hookOn: { enabled: [1] }, featureOn: { enabled: [1] }, gateOn: { enabled: [1] }, mintedView: { enabled: [0, 0, 1] } },
  });
  const mintedRequest = evaluatedRequests.find(url => url.searchParams.get('i') === 'host-token');
  assert.ok(mintedRequest);
  assert.equal(mintedRequest.searchParams.has('u'), false);
  assert.equal(mintedRequest.searchParams.has('g'), false);
  assert.equal(mintedRequest.searchParams.has('claim.role'), false);
  await page.locator('#identified').click();
  await page.waitForFunction(() => document.body.dataset.identified === 'done', undefined, { timeout: 10_000 });
  await waitForTelemetry(7, 'identified context flush');
  assert.equal(await page.locator('#hook').textContent(), 'off');
  assert.deepEqual(telemetryRequests[5].body, {
    k: 'gatsby-replacement-host', e: 'Preview', i: 'host-token',
    f: { queuedBeforeIdentity: { enabled: [0, 1] } },
  });
  assert.deepEqual(telemetryRequests[6].body, {
    k: 'gatsby-replacement-host', e: 'Preview', u: 'second-user',
    f: { hookOn: { disabled: [1] }, featureOn: { disabled: [1] }, gateOn: { disabled: [1] }, gateSkipped: { enabled: [1] }, identifiedView: { enabled: [0, 0, 1] } },
  });
  const identifiedRequest = evaluatedRequests.find(url => url.searchParams.get('u') === 'second-user');
  assert.ok(identifiedRequest);
  assert.equal(identifiedRequest.searchParams.has('i'), false);
  assert.equal(identifiedRequest.searchParams.get('g'), 'staff');
  assert.equal(identifiedRequest.searchParams.get('claim.role'), 'admin');
  assert.deepEqual(browserErrors, []);
  console.log('PACKED_GATSBY_BROWSER_TELEMETRY_PASS');

  // Render the cold HTML through the same installed package, then hydrate it in
  // actual Chromium after the active owner is already ready. Only React's known
  // discarded-hydration warnings belong to this deliberately mismatched probe.
  const coldHtml = (await run(process.execPath, ['warm-ssr.cjs'], { cwd: host })).trim();
  assert.equal(coldHtml, '<span>warm-off</span>');
  await bounded(() => page.evaluate(html => { window.__TOGGLY_COLD_HTML__ = html; }, coldHtml), 'Warm hydration setup');
  await page.locator('#warm').click();
  await page.waitForFunction(() => document.body.dataset.warm === 'committed' && document.querySelector('#warm-root')?.textContent === 'warm-on', undefined, { timeout: 5000 });
  await page.locator('#warm-flush').click();
  await page.waitForFunction(() => document.body.dataset.warmFlushed === 'true', undefined, { timeout: 5000 });
  await waitForTelemetry(8, 'committed warm hydration replay');
  assert.deepEqual(telemetryRequests[7].body, { k: 'gatsby-replacement-host', e: 'Preview', u: 'second-user', f: { warmOn: { enabled: [1] } } });
  assert.ok(browserErrors.length > 0, 'the warm probe actually exercised a discarded hydration render');
  assert.deepEqual(browserErrors.map(message => message.match(/^Minified React error #(\d+);/)?.[1]), ['425', '423'], 'only the reproduced text-mismatch and hydration-recovery warnings are expected');
  console.log('PACKED_GATSBY_WARM_HYDRATION_PASS', JSON.stringify({ committedChecks: 1, warnings: browserErrors }));

  async function renderSsr() {
    const response = await fetch(`http://127.0.0.1:${port}/ssr/`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, 'production Gatsby SSR request succeeds');
    return response.text();
  }
  const enabledHtml = await renderSsr();
  assert.match(enabledHtml, /<p>SSR_ENABLED_GATE<\/p>/);
  assert.match(enabledHtml, /<p>SSR_DISABLED_FALLBACK<\/p>/);
  assert.doesNotMatch(enabledHtml, /<p>SSR_DISABLED_LEAK<\/p>|<p>SSR_OFF_FALLBACK<\/p>/);
  const beforeSecondRequest = requests.length;
  serverEnabled = false;
  const disabledHtml = await renderSsr();
  assert.match(disabledHtml, /<p>SSR_OFF_FALLBACK<\/p>/);
  assert.doesNotMatch(disabledHtml, /<p>SSR_ENABLED_GATE<\/p>|<p>SSR_DISABLED_LEAK<\/p>/);
  assert.ok(requests.slice(beforeSecondRequest).includes('/definitions-signed/gatsby-current-host/Production'));
  assert.equal(telemetryRequests.length, 8, 'native server requests remain telemetry-silent');
  console.log('PACKED_GATSBY_PRODUCTION_SSR_PASS');
  assert.ok(requests.includes('/definitions-signed/gatsby-current-host/Production'));
  assert.ok(requests.includes('/evaluated-signed/gatsby-current-host/Production'));
  assert.ok(requests.includes('/.well-known/jwks'));
  console.log(`PACKED_GATSBY_HOST_PASS ${JSON.stringify({ gatsby: currentGatsby, react: '18.3.1', reporter: '1.1.0', typescript: '5.3.3', playwright: '1.58.2', chromium: browser.version(), node: process.version, actualEnvelopes: telemetryRequests.length })}`);
} catch (error) { failure = error; }
await cleanupOwned([
  () => browser && bounded(() => browser.close(), 'Browser connection close'),
  () => browserServer && closeBrowser(browserServer),
  async () => {
    if (productionHost?.pid && process.platform !== 'win32') {
      try { process.kill(-productionHost.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await stopChild(productionHost);
  },
  () => definitions && closeServer(definitions),
  () => rmSync(temporary, { recursive: true, force: true }),
], failure);
