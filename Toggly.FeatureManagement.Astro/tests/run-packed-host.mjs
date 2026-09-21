import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {gunzipSync} from 'node:zlib';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const matrix = {
  '5-min': { astro: '5.0.0', '@astrojs/node': '9.0.0', '@astrojs/react': '4.4.2', '@astrojs/vue': '5.1.4', '@astrojs/svelte': '7.2.5', '@nanostores/react': '1.1.0' },
  '5-locked': { astro: '5.16.6', '@astrojs/node': '9.4.6', '@astrojs/react': '4.4.2', '@astrojs/vue': '5.1.4', '@astrojs/svelte': '7.2.5', '@nanostores/react': '1.1.0' },
  5: { astro: '5.18.2', '@astrojs/node': '9.5.5', '@astrojs/react': '4.4.2', '@astrojs/vue': '5.1.4', '@astrojs/svelte': '7.2.5', '@nanostores/react': '1.1.0' },
  6: { astro: '6.4.8', '@astrojs/node': '10.1.4', '@astrojs/react': '5.0.7', '@astrojs/vue': '6.0.1', '@astrojs/svelte': '8.1.2', '@nanostores/react': '2.0.1' },
  7: { astro: '7.3.2', '@astrojs/node': '11.1.5', '@astrojs/react': '6.0.5', '@astrojs/vue': '7.0.2', '@astrojs/svelte': '9.0.1', '@nanostores/react': '2.0.1' },
};
const selected = matrix[process.env.ASTRO_MAJOR ?? '7'];
assert.ok(selected, 'ASTRO_MAJOR must be 5, 6 or 7');
assert.ok(process.env.npm_execpath, 'Run with npm run test:host');
const root = process.env.HOST_WORKDIR ?? await mkdtemp(path.join(tmpdir(), 'toggly-astro-host-'));
await mkdir(root, { recursive: true });
await cp(new URL('./packed-host/', import.meta.url), root, { recursive: true });
console.log(JSON.stringify({ root, node: process.version, versions: selected }));
const npm = process.env.npm_execpath;
const environment = { ...process.env, TOGGLY_DISABLE_TELEMETRY: '1', ASTRO_TELEMETRY_DISABLED: '1' };
async function run(args, cwd = root, extraEnv = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env: { ...environment, ...extraEnv }, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited ${code}`)));
  });
}
const registryVersion = process.env.SDK_REGISTRY_VERSION;
let sdkDependency;
let artifactHash;
if (registryVersion) {
  assert.match(registryVersion, /^\d+\.\d+\.\d+$/, 'SDK_REGISTRY_VERSION must be an exact stable version');
  assert.equal(process.env.SIGNED_DEFS_ARTIFACT, undefined, 'Registry verification must not override a shared dependency');
  assert.equal(process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL, undefined, 'Registry verification must not override telemetry');
  sdkDependency = registryVersion;
  console.log(`Installing Astro SDK ${registryVersion} entirely from the public registry`);
} else {
  await run([npm, 'pack', '--pack-destination', root], packageDir);
  const sourceManifest = JSON.parse(await readFile(path.join(packageDir, 'package.json')));
  const tarball = await readFile(path.join(root, `ops-ai-astro-feature-flags-toggly-${sourceManifest.version}.tgz`));
  artifactHash = createHash('sha256').update(tarball).digest('hex');
  const artifact = `toggly-${artifactHash}.tgz`;
  await writeFile(path.join(root, artifact), tarball);
  sdkDependency = `file:./${artifact}`;
  console.log(`Packed artifact SHA256 ${artifactHash}`);
}
const dependencies = {
  ...selected, '@ops-ai/astro-feature-flags-toggly': sdkDependency,
  react: process.env.ASTRO_MAJOR === '5-min' ? '18.3.1' : '19.2.4',
  'react-dom': process.env.ASTRO_MAJOR === '5-min' ? '18.3.1' : '19.2.4',
  '@types/react': process.env.ASTRO_MAJOR === '5-min' ? '18.3.27' : '19.2.14',
  '@types/react-dom': process.env.ASTRO_MAJOR === '5-min' ? '18.3.7' : '19.2.3',
  vue: '3.5.30', svelte: '5.53.12', nanostores: '1.5.3', '@nanostores/vue': '1.1.0',
  '@astrojs/check': '0.9.9', '@types/node': '22.19.15', typescript: '5.9.3', '@playwright/test': '1.61.1',
};
const manifest = { name: 'toggly-astro-packed-host', private: true, type: 'module', dependencies };
if (process.env.SIGNED_DEFS_ARTIFACT) {
  dependencies['@ops-ai/toggly-signed-defs'] = `file:${path.resolve(process.env.SIGNED_DEFS_ARTIFACT)}`;
  manifest.overrides = { '@ops-ai/toggly-signed-defs': '$@ops-ai/toggly-signed-defs' };
  console.log('Using explicit local signed-defs artifact; this is not public-registry evidence.');
}
if (process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL) {
  dependencies['@ops-ai/toggly-client-telemetry'] = process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL;
  console.log('LOCAL TELEMETRY ARTIFACT: registry acceptance pending');
}
await writeFile(path.join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await run([npm, 'install', '--no-audit', '--no-fund', '--engine-strict']);
await run([npm, 'ci', '--no-audit', '--no-fund', '--engine-strict']);
await run([npm, 'ls', '--depth=0']);
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json')));
const localPackages = new Set(registryVersion ? [] : ['node_modules/@ops-ai/astro-feature-flags-toggly']);
if (process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL) localPackages.add('node_modules/@ops-ai/toggly-client-telemetry');
if (process.env.SIGNED_DEFS_ARTIFACT) localPackages.add('node_modules/@ops-ai/toggly-signed-defs');
for (const [name, entry] of Object.entries(lock.packages)) {
  if (!name || localPackages.has(name)) continue;
  assert.equal(entry.link, undefined, `${name} must not use a linked dependency`);
  assert.ok(entry.resolved?.startsWith('https://registry.npmjs.org/'), `${name} must resolve from public npm`);
  assert.ok(entry.integrity, `${name} must have registry integrity`);
}
const evidence = {
  node: process.version, astro: selected.astro,
  mode: process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL ? 'packed-sdk-with-local-telemetry-artifact' : registryVersion ? 'registry-sdk-and-dependencies' : process.env.SIGNED_DEFS_ARTIFACT ? 'packed-sdk-with-local-dependency-override' : 'packed-sdk-with-registry-dependencies',
  artifactHash,
  packages: Object.fromEntries(Object.entries(lock.packages).filter(([name]) => name.includes('/@ops-ai/'))),
};
await writeFile(path.join(root, 'registry-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
// Independent Worker-compatible signer: SHA256 payload, then ECDSA SHA256.
// Keys exist only in this test process; no Toggly account or production key is used.
const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await webcrypto.subtle.exportKey('jwk', keys.publicKey);
const kid = Buffer.concat([Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
const publicKey = { ...jwk, kid: `${createHash('sha1').update(kid).digest('hex').toUpperCase()}ES256`, alg: 'ES256', use: 'sig' };
async function signed(defs) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(`${JSON.stringify(defs)}|${timestamp}`));
  const signature = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, digest)).toString('base64');
  return { defs, signature, timestamp, kid: publicKey.kid };
}
const telemetry = []; const telemetryHeaders = []; let telemetryPreflights = 0;
const metrics = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', request.headers.origin ?? '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Encoding');
  if (request.method === 'OPTIONS') {telemetryPreflights++; response.writeHead(204); response.end(); return;}
  if (request.method !== 'POST' || request.url !== '/base/api/frontend/telemetry') {response.writeHead(404); response.end(); return;}
  const chunks = []; request.on('data', chunk => chunks.push(chunk)); request.on('end', () => {
    const bytes = Buffer.concat(chunks); telemetryHeaders.push(request.headers);
    telemetry.push(JSON.parse((request.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes).toString()));
    response.writeHead(202); response.end();
  });
});
await new Promise(resolve => metrics.listen(0, '127.0.0.1', resolve));
environment.METRICS_URL = `http://127.0.0.1:${metrics.address().port}/base`;
let remoteEnabled = true;
let tampered = false;
let fetchCount = 0;
let jwksPreflights = 0;
const definitions = createServer(async (request, response) => {
  fetchCount++;
  response.setHeader('Access-Control-Allow-Origin', '*');
  if (request.url !== '/.well-known/jwks') response.setHeader('Access-Control-Allow-Headers', '*');
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'OPTIONS') {
    if (request.url === '/.well-known/jwks') { jwksPreflights++; response.statusCode = 403; }
    response.end(); return;
  }
  if (request.url === '/.well-known/jwks') { response.end(JSON.stringify({ keys: [publicKey] })); return; }
  const flags = { Visible: remoteEnabled, Hidden: false };
  const body = request.url.startsWith('/definitions-signed/')
    ? [...Object.entries(flags).map(([featureKey, enabled]) => ({ featureKey, filters: [{ name: enabled ? 'AlwaysOn' : 'AlwaysOff', parameters: {} }] })), { featureKey: 'Context', filters: [{ name: 'UserClaims', parameters: { Percentage: 100, Claim: 'role', Value: 'admin' } }] }]
    : flags;
  const envelope = await signed(body);
  if (tampered) envelope.signature = 'invalid-signature';
  response.end(JSON.stringify(envelope));
});
await new Promise(resolve => definitions.listen(0, '127.0.0.1', resolve));
environment.DEFINITIONS_URL = `http://127.0.0.1:${definitions.address().port}`;
let host;
let browser;
async function stopHost() {
  if (!host || host.exitCode !== null) return;
  const stopped = new Promise(resolve => host.once('exit', resolve));
  host.kill('SIGTERM');
  await stopped;
}
async function waitForHost(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { return await fetch(url); } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  throw new Error('Astro host did not start');
}
try {
  const astroManifest = JSON.parse(await readFile(path.join(root, 'node_modules/astro/package.json')));
  const astro = path.join(root, 'node_modules/astro', astroManifest.bin.astro);
  await run([astro, 'check']);
  await run([path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit']);
  await run([astro, 'build'], root, { HOST_OUTPUT: 'static' });
  async function browserFiles(directory) {
    const result = [];
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) result.push(...await browserFiles(file)); else if (file.endsWith('.js')) result.push(file);
    }
    return result;
  }
  for (const file of await browserFiles(path.join(root, 'dist/_astro'))) {
    assert.doesNotMatch(await readFile(file, 'utf8'), /api\/usage\/stats|api\/metrics|UsageTelemetryRuntime|UsageBatcher|MetricsBatcher|grpc-js|protobufjs|node:fs/, `Trusted code in browser asset ${file}`);
  }
  const html = await readFile(path.join(root, 'dist/index.html'), 'utf8');
  assert.match(html, /id="server-visible"/);
  assert.doesNotMatch(html, /id="server-hidden"/);
  assert.match(html, /id="server-negate"/);
  const mapping = JSON.parse(await readFile(path.join(root, 'dist/toggly-page-features.json')));
  assert.equal(mapping['/gated'], 'Visible');
  await run([astro, 'build'], root, { HOST_OUTPUT: 'server' });
  const port = Number(process.env.HOST_PORT ?? 43879);
  host = spawn(process.execPath, ['dist/server/entry.mjs'], { cwd: root, env: { ...environment, HOST: '127.0.0.1', PORT: String(port) }, stdio: 'inherit' });
  const url = `http://127.0.0.1:${port}`;
  const response = await waitForHost(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-toggly-middleware'), 'applied');
  assert.match(await response.text(), /id="server-visible"/);
  assert.equal((await fetch(`${url}/gated/`)).status, 200);
  const contexts = await Promise.all(['admin', 'user', 'admin', 'user'].map(async role => {
    const body = await (await fetch(`${url}/context/?identity=${role}&role=${role}`)).text();
    assert.equal(body.includes('id="context-allowed"'), role === 'admin');
    assert.equal(body.includes('id="context-denied"'), role !== 'admin');
  }));
  assert.equal(contexts.length, 4);
  const require = createRequire(path.join(root, 'package.json'));
  const { chromium, expect } = require('@playwright/test');
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  let page = await browser.newPage();
  const errors = [];
  function watchBrowser(page) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (['warning', 'error'].includes(message.type()) && /hydrat/i.test(message.text())) errors.push(message.text());
    });
  }
  watchBrowser(page);
  await page.goto(url);
  async function assertIslands(enabled, frameworks = ['react', 'vue', 'svelte']) {
    for (const framework of frameworks) {
      await expect(page.locator(`#${framework}-state`)).toHaveText(String(enabled));
      await expect(page.locator(`#${framework}-content`)).toHaveCount(enabled ? 1 : 0);
      if (framework !== 'react') await expect(page.locator(`#${framework}-builder`)).toHaveText(String(enabled));
    }
  }
  await assertIslands(true);
  await page.evaluate(() => window.telemetry.flushTelemetry());
  assert.equal(telemetry.reduce((count, body) => count + (body.f?.Visible?.enabled?.[0] ?? 0), 0), 9, 'one effective check per initial island consumer including FeatureClient');
  assert.ok(telemetry.every(body => Object.values(body.f ?? {}).every(variants => Object.values(variants).every(counts => counts.length === 1))), 'hydration does not imply usage or views');
  telemetry.length = 0;
  // DOMContentLoaded plus Astro page-load must not attach another FeatureClient.
  await page.evaluate(() => document.dispatchEvent(new Event('astro:page-load')));
  await page.evaluate(() => window.telemetry.flushTelemetry());
  assert.deepEqual(telemetry, [], 'repeated hydration is silent');
  const beforeLocal = fetchCount;
  await page.locator('#local').click();
  await assertIslands(false);
  assert.equal(fetchCount, beforeLocal, 'local gate updates perform no fetch');
  await page.locator('#local').click();
  await assertIslands(true);
  remoteEnabled = false;
  await page.locator('#refresh').click();
  await assertIslands(false);
  assert.ok(fetchCount > beforeLocal, 'explicit remote refresh fetches definitions');
  assert.equal((await fetch(`${url}/gated/`)).status, 404);
  remoteEnabled = true;
  tampered = true;
  const invalidResponse = page.waitForResponse(response => response.url().includes('/evaluated-signed/'));
  await page.locator('#refresh').click();
  await invalidResponse;
  await expect(page.locator('#refresh-error')).toHaveText('rejected');
  await assertIslands(false);
  tampered = false;
  await page.locator('#refresh').click();
  await assertIslands(true);
  assert.deepEqual(errors, [], 'island hydration and refresh have no browser exceptions');
  await page.evaluate(() => window.telemetry.flushTelemetry());
  assert.ok(telemetry.some(body => body.f?.Visible?.disabled?.[0] > 0));
  telemetry.length = 0;
  const record = () => page.evaluate(() => {window.telemetry.recordUsage('Visible'); window.telemetry.recordView('Visible', 'control'); window.telemetry.incrementCounter('orders', 2); window.telemetry.setGauge('cart', 3);});
  const expected = {k: 'packed-host', e: 'Test', f: {Visible: {enabled: [0,1], control: [0,0,1]}}, m: {orders: 2, cart: 3}};
  await record(); await page.evaluate(() => window.telemetry.flushTelemetry()); assert.deepEqual(telemetry, [expected]);
  assert.ok(telemetryPreflights > 0); assert.ok(telemetryHeaders.some(headers => headers['content-encoding'] === 'gzip'));
  assert.ok(telemetryHeaders.every(headers => !headers.cookie && !headers.authorization));
  const waitCount = async count => {const until = Date.now() + 5000; while (telemetry.length < count && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(telemetry.length, count);};
  await record(); await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await waitCount(2); assert.deepEqual(telemetry[1], expected);
  assert.equal(telemetryHeaders[telemetryHeaders.length - 1]['content-encoding'], undefined);
  await page.evaluate(() => {window.telemetry.recordUsage('NavigationQueued'); window.beforeNavigationOwner = window.telemetry;});
  await page.locator('#navigate').click(); await page.waitForURL('**/navigation/'); await assertIslands(true);
  await page.evaluate(() => window.telemetry.flushTelemetry());
  assert.equal(await page.evaluate(() => window.telemetry === window.beforeNavigationOwner), true, 'navigation preserves the browser store module');
  assert.equal(telemetry[2].f.NavigationQueued.enabled[1], 1, 'navigation retains the existing reporter queue');
  assert.equal(telemetry[2].f.Visible.enabled[0], 9, 'new route consumers evaluate once');
  telemetry.length = 2;
  await record(); await page.evaluate(() => window.telemetry.destroyTogglyClient()); await waitCount(3); assert.deepEqual(telemetry[2], expected);
  await page.evaluate(() => {window.telemetry.recordUsage('Disposed');}); await page.evaluate(() => window.telemetry.flushTelemetry()); assert.equal(telemetry.length, 3);
  await page.close();
  await stopHost();
  // Astro 7's current React/Vue Vite plugins have an upstream mixed-dev bug:
  // https://github.com/vitejs/vite-plugin-vue/issues/798
  // Keep mixed production coverage above; verify each real dev host separately.
  const devFrameworks = selected.astro.startsWith('7.') ? ['react', 'vue', 'svelte'] : ['all'];
  const pageSource = await readFile(new URL('./packed-host/src/pages/index.astro', import.meta.url), 'utf8');
  for (const framework of devFrameworks) {
    // ClientRouter navigation is covered against the built mixed-framework host.
    // Keep the existing dev smoke free of transition dependency re-optimization.
    let devPage = pageSource.replace(/^import \{ClientRouter\}.*$/m, '').replace('<ClientRouter />', '');
    if (framework !== 'all') {
      for (const other of ['react', 'vue', 'svelte'].filter(name => name !== framework)) {
        const component = `${other[0].toUpperCase()}${other.slice(1)}Island`;
        devPage = devPage.replace(new RegExp(`^import ${component}.*$`, 'm'), '').replace(`<${component} client:load />`, '');
      }
    }
    await writeFile(path.join(root, 'src/pages/index.astro'), devPage);
    host = spawn(process.execPath, ['dev.mjs'], { cwd: root, env: { ...environment, PORT: String(port), ...(framework !== 'all' ? { HOST_ISLAND: framework } : {}) }, stdio: 'inherit' });
    assert.equal((await waitForHost(url)).status, 200);
    page = await browser.newPage();
    watchBrowser(page);
    await page.goto(url);
    const active = framework === 'all' ? undefined : [framework];
    await assertIslands(true, active);
    await page.locator('#local').click();
    await assertIslands(false, active);
    assert.deepEqual(errors, [], 'dev integration hooks and hydration have no browser exceptions');
    await page.close();
    await stopHost();
  }
  assert.equal(jwksPreflights, 0, 'public JWKS must not require CORS preflight');
  console.log(`PASS ${evidence.mode} Astro ${selected.astro}: packed exports/types, SSG, SSR, middleware, page manifest/gates, React/Vue/Svelte hydration, local gates, signed remote refresh/rejection, request context isolation and dev hooks`);
} finally {
  await browser?.close();
  await stopHost();
  await new Promise(resolve => definitions.close(resolve));
  await new Promise(resolve => metrics.close(resolve));
}
