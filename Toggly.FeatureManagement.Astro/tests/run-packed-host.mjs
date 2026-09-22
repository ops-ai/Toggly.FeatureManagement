import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {gunzipSync} from 'node:zlib';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {withResources, bounded, closeServer, stopChild, ownBrowser, readHttp} from './host-resources.mjs';

await withResources(async defer => {
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
if (!process.env.HOST_WORKDIR) defer(() => rm(root, {recursive:true, force:true}));
await mkdir(root, { recursive: true });
await cp(new URL('./packed-host/', import.meta.url), root, { recursive: true });
console.log(JSON.stringify({ root, node: process.version, versions: selected }));
const npm = process.env.npm_execpath;
const environment = { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' };
// Runtime policy must stand on its own, independently of caller process state.
delete environment.TOGGLY_DISABLE_TELEMETRY;
async function run(args, cwd = root, extraEnv = {}) {
  await bounded(() => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env: { ...environment, ...extraEnv }, stdio: 'inherit', detached: true });
    defer(() => stopChild(child));
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited ${code}`)));
  }), 'Host command', 180000);
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
assert.equal(process.env.SIGNED_DEFS_ARTIFACT, undefined, 'Dependencies must come from the public registry');
assert.equal(process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL, undefined, 'Telemetry must come from the public registry');
await writeFile(path.join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await run([npm, 'install', '--no-audit', '--no-fund', '--engine-strict']);
await run([npm, 'ci', '--no-audit', '--no-fund', '--engine-strict']);
await run([npm, 'ls', '--depth=0']);
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json')));
const localPackages = new Set(registryVersion ? [] : ['node_modules/@ops-ai/astro-feature-flags-toggly']);
for (const [name, entry] of Object.entries(lock.packages)) {
  if (!name || localPackages.has(name)) continue;
  assert.equal(entry.link, undefined, `${name} must not use a linked dependency`);
  assert.ok(entry.resolved?.startsWith('https://registry.npmjs.org/'), `${name} must resolve from public npm`);
  assert.ok(entry.integrity, `${name} must have registry integrity`);
}
const evidence = {
  node: process.version, astro: selected.astro,
  mode: registryVersion ? 'registry-sdk-and-dependencies' : 'packed-sdk-with-registry-dependencies',
  artifactHash,
  packages: Object.fromEntries(Object.entries(lock.packages).filter(([name]) => name.includes('/@ops-ai/'))),
};
await writeFile(path.join(root, 'registry-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
assert.equal(lock.packages['node_modules/@ops-ai/toggly-client-telemetry'].version, '1.1.0');
await run(['--test', path.join(packageDir, 'tests/host-cleanup.test.mjs')], packageDir);
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
const unexpectedMetrics = [];
const telemetry = []; const telemetryHeaders = []; let telemetryPreflights = 0;
const metrics = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', request.headers.origin ?? '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Encoding');
  if (request.method === 'OPTIONS') {telemetryPreflights++; response.writeHead(204); response.end(); return;}
  if (request.method !== 'POST' || request.url !== '/base/api/frontend/telemetry') {unexpectedMetrics.push({method:request.method,url:request.url});response.writeHead(404); response.end(); return;}
  const chunks = []; request.on('data', chunk => chunks.push(chunk)); request.on('end', () => {
    const bytes = Buffer.concat(chunks); telemetryHeaders.push(request.headers);
    telemetry.push(JSON.parse((request.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes).toString()));
    response.writeHead(202); response.end();
  });
});
defer(() => closeServer(metrics));
await new Promise(resolve => metrics.listen(0, '127.0.0.1', resolve));
environment.METRICS_URL = `http://127.0.0.1:${metrics.address().port}/base`;
let remoteEnabled = true;
let tampered = false;
let fetchCount = 0;
const identityRequests = [];
let jwksPreflights = 0;
const definitions = createServer(async (request, response) => {
  fetchCount++;
  response.setHeader('Access-Control-Allow-Origin', '*');
  if (request.url !== '/.well-known/jwks') response.setHeader('Access-Control-Allow-Headers', '*');
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Access-Control-Expose-Headers', 'ETag');
  if (request.method === 'OPTIONS') {
    if (request.url === '/.well-known/jwks') { jwksPreflights++; response.statusCode = 403; }
    response.end(); return;
  }
  if (request.url === '/.well-known/jwks') { response.end(JSON.stringify({ keys: [publicKey] })); return; }
  const requestUrl = new URL(request.url, 'http://fixture');
  if (requestUrl.pathname.includes('/identity-host/')) {
    const mode = requestUrl.pathname.includes('variants') ? 'variants' : 'boolean';
    const token = requestUrl.searchParams.get('i') ?? requestUrl.searchParams.get('u') ?? requestUrl.searchParams.get('userId') ?? 'anonymous';
    const revision = `${mode}-${token}`;
    identityRequests.push({mode, token, url: requestUrl.href, query: Object.fromEntries(requestUrl.searchParams), validator: request.headers['if-none-match']});
    response.setHeader('ETag', revision);
    if (request.headers['if-none-match'] === revision) {response.writeHead(304);response.end();return;}
    const enabled = !['token-b', 'retired', 'older'].includes(token);
    response.end(JSON.stringify(await signed(mode === 'variants' ? {Visible:{enabled,variant:'blue'},Hidden:{enabled:false}} : {Visible:enabled,Hidden:false})));
    return;
  }
  const flags = { Visible: remoteEnabled, Hidden: false };
  const body = request.url.startsWith('/definitions-signed/')
    ? [...Object.entries(flags).map(([featureKey, enabled]) => ({ featureKey, filters: [{ name: enabled ? 'AlwaysOn' : 'AlwaysOff', parameters: {} }] })), { featureKey: 'Context', filters: [{ name: 'UserClaims', parameters: { Percentage: 100, Claim: 'role', Value: 'admin' } }] }]
    : flags;
  const envelope = await signed(body);
  if (tampered) envelope.signature = 'invalid-signature';
  response.end(JSON.stringify(envelope));
});
defer(() => closeServer(definitions));
await new Promise(resolve => definitions.listen(0, '127.0.0.1', resolve));
environment.DEFINITIONS_URL = `http://127.0.0.1:${definitions.address().port}`;
let host;
let browser;
async function stopHost() {await stopChild(host);}
async function waitForHost(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { return await readHttp(url, 1000); } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  throw new Error('Astro host did not start');
}
{
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
  const serializedConfig = JSON.parse(await readFile(path.join(root, 'dist/toggly-config.json')));
  assert.equal(serializedConfig.enableUsageTracking, false);
  assert.equal(serializedConfig.enableMetrics, false);
  assert.equal('browserEnableUsageTracking' in serializedConfig, false);
  assert.equal('browserEnableMetrics' in serializedConfig, false);
  assert.deepEqual(telemetry, [], 'SSG never posts frontend telemetry');
  assert.deepEqual(unexpectedMetrics, [], 'SSG trusted telemetry stays disabled');
  await run([astro, 'build'], root, { HOST_OUTPUT: 'server' });
  const port = Number(process.env.HOST_PORT ?? 43879);
  host = spawn(process.execPath, ['dist/server/entry.mjs'], { cwd: root, env: { ...environment, HOST: '127.0.0.1', PORT: String(port) }, stdio: 'inherit', detached: true });
  {const owned = host; defer(() => stopChild(owned));}
  const url = `http://127.0.0.1:${port}`;
  const response = await waitForHost(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-toggly-middleware'), 'applied');
  assert.match(response.body, /id="server-visible"/);
  assert.equal((await readHttp(`${url}/gated/`)).status, 200);
  const contexts = await Promise.all(['admin', 'user', 'admin', 'user'].map(async role => {
    const body = (await readHttp(`${url}/context/?identity=${role}&role=${role}`)).body;
    assert.equal(body.includes('id="context-allowed"'), role === 'admin');
    assert.equal(body.includes('id="context-denied"'), role !== 'admin');
  }));
  assert.equal(contexts.length, 4);
  assert.deepEqual(telemetry, [], 'SSR never posts frontend telemetry');
  assert.deepEqual(unexpectedMetrics, [], 'SSR trusted telemetry stays disabled');
  const require = createRequire(path.join(root, 'package.json'));
  const { chromium, expect } = require('@playwright/test');
  const browserServer = await chromium.launchServer({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  ownBrowser(defer, browserServer);
  browser = await chromium.connect(browserServer.wsEndpoint());
  defer(() => bounded(() => browser.close(), 'Browser connection cleanup'));
  let page = await browser.newPage();
  const evaluate = (...args) => bounded(() => page.evaluate(...args), 'Browser evaluation', 30000);
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
  assert.deepEqual(await evaluate(() => ({
    usage: window.__TOGGLY_CONFIG__.enableUsageTracking,
    metrics: window.__TOGGLY_CONFIG__.enableMetrics,
    leaked: 'browserEnableUsageTracking' in window.__TOGGLY_CONFIG__ || 'browserEnableMetrics' in window.__TOGGLY_CONFIG__,
  })), {usage:true, metrics:true, leaked:false});
  await evaluate(() => window.telemetry.flushTelemetry());
  assert.equal(telemetry.reduce((count, body) => count + (body.f?.Visible?.enabled?.[0] ?? 0), 0), 9, 'one effective check per initial island consumer including FeatureClient');
  assert.ok(telemetry.every(body => Object.values(body.f ?? {}).every(variants => Object.values(variants).every(counts => counts.length === 1))), 'hydration does not imply usage or views');
  telemetry.length = 0;
  // DOMContentLoaded plus Astro page-load must not attach another FeatureClient.
  await evaluate(() => document.dispatchEvent(new Event('astro:page-load')));
  await evaluate(() => window.telemetry.flushTelemetry());
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
  assert.equal((await readHttp(`${url}/gated/`)).status, 404);
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
  await evaluate(() => window.telemetry.flushTelemetry());
  assert.ok(telemetry.some(body => body.f?.Visible?.disabled?.[0] > 0));
  telemetry.length = 0;
  const record = () => evaluate(() => {window.telemetry.recordUsage('Visible'); window.telemetry.recordView('Visible', 'control'); window.telemetry.incrementCounter('orders', 2); window.telemetry.setGauge('cart', 3);});
  const expected = {k: 'packed-host', e: 'Test', f: {Visible: {enabled: [0,1], control: [0,0,1]}}, m: {orders: 2, cart: 3}};
  await record(); await evaluate(() => window.telemetry.flushTelemetry()); assert.deepEqual(telemetry, [expected]);
  assert.ok(telemetryPreflights > 0); assert.ok(telemetryHeaders.some(headers => headers['content-encoding'] === 'gzip'));
  assert.ok(telemetryHeaders.every(headers => !headers.cookie && !headers.authorization));
  const waitCount = async count => {const until = Date.now() + 5000; while (telemetry.length < count && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(telemetry.length, count);};
  await record(); await evaluate(() => window.dispatchEvent(new Event('pagehide'))); await waitCount(2); assert.deepEqual(telemetry[1], expected);
  assert.equal(telemetryHeaders[telemetryHeaders.length - 1]['content-encoding'], undefined);
  await evaluate(() => {window.telemetry.recordUsage('NavigationQueued'); window.beforeNavigationOwner = window.telemetry;});
  await page.locator('#navigate').click(); await page.waitForURL('**/navigation/'); await assertIslands(true);
  await evaluate(() => window.telemetry.flushTelemetry());
  assert.equal(await evaluate(() => window.telemetry === window.beforeNavigationOwner), true, 'navigation preserves the browser store module');
  assert.equal(telemetry[2].f.NavigationQueued.enabled[1], 1, 'navigation retains the existing reporter queue');
  assert.equal(telemetry[2].f.Visible.enabled[0], 9, 'new route consumers evaluate once');
  telemetry.length = 2;
  await record(); await evaluate(() => window.telemetry.destroyTogglyClient()); await waitCount(3); assert.deepEqual(telemetry[2], expected);
  await evaluate(() => {window.telemetry.recordUsage('Disposed');}); await evaluate(() => window.telemetry.flushTelemetry()); assert.equal(telemetry.length, 3);
  telemetry.length = 0;
  await evaluate(async () => {
    window.holdRefresh = false;
    await window.telemetry.initTogglyClient({...window.__TOGGLY_CONFIG__, hooks:[{
      getMetadata:()=>({name:'packed-pending-refresh'}),
      afterRefresh:()=>window.holdRefresh ? new Promise(resolve=>{window.releaseRefresh=resolve;}) : undefined,
    }]});
    await window.telemetry.flushTelemetry();
  });
  await assertIslands(true);
  telemetry.length=0;
  remoteEnabled=false;
  await evaluate(()=>{window.holdRefresh=true;window.pendingRefresh=window.telemetry.refreshFlags();});
  await page.waitForFunction(()=>typeof window.releaseRefresh==='function');
  await assertIslands(false);
  remoteEnabled=true;
  await evaluate(async()=>{window.holdRefresh=false;await window.telemetry.refreshFlags();});
  await assertIslands(true);
  await evaluate(async()=>{window.releaseRefresh();await window.pendingRefresh;await window.telemetry.flushTelemetry();});
  assert.equal(telemetry.reduce((n,body)=>n+(body.f?.Visible?.disabled?.[0]??0),0),9,'pending hook does not duplicate the first UI refresh');
  assert.equal(telemetry.reduce((n,body)=>n+(body.f?.Visible?.enabled?.[0]??0),0),9,'latest UI refresh evaluates each actual consumer once');
  telemetry.length=0;
  for (const enableVariants of [false, true]) {
    await evaluate(async enableVariants => {
      const sdk = window.telemetry;
      const base = {...window.__TOGGLY_CONFIG__, appKey:'identity-host', enableVariants};
      await sdk.initTogglyClient({...base,instanceId:'token-a',identity:'hidden',groups:['hidden'],claims:{role:'hidden'}});
      sdk.recordUsage('AcceptedA');
      await sdk.refreshFlags();
      if (sdk.$flags.get().Visible !== true || (enableVariants && sdk.getVariant('Visible')?.name !== 'blue')) throw Error('304 did not retain active body');
      await sdk.initTogglyClient({...base,instanceId:'token-b'});sdk.recordView('AcceptedB');
      if(sdk.$flags.get().Visible !== false) throw Error('B definitions not published');
      await sdk.initTogglyClient({...base,instanceId:'token-a'});
      if(sdk.$flags.get().Visible !== true) throw Error('A definitions not restored');
      await sdk.initTogglyClient({...base,identity:'client-alice'});sdk.incrementCounter('clientCounter');
      let changed=false;
      sdk.setLocalGates([{id:'reentrant',flagKeys:['Visible'],isEnabled:()=>{if(!changed){changed=true;sdk.setIdentity('client-bob');}return true;}}]);
      const value=enableVariants?sdk.getVariant('Visible')?.name:sdk.$flag('Visible').get();
      if(value!==(enableVariants?'blue':true))throw Error('Reentrant result changed');
      await sdk.flushTelemetry();
      sdk.setLocalGates([]);
      sdk.destroyTogglyClient();
    }, enableVariants);
    const recent = identityRequests.splice(0);
    assert.deepEqual(recent[0].query,{i:'token-a'});
    assert.equal(recent[0].validator,undefined);
    assert.equal(recent[1].validator,`${enableVariants?'variants':'boolean'}-token-a`);
    assert.ok(recent.slice(2).every(request=>!request.validator), 'retired context/mode validators never survive without body');
    assert.ok(telemetry.some(body=>body.i==='token-a'&&body.f?.AcceptedA?.enabled?.[1]===1));
    assert.ok(telemetry.some(body=>body.i==='token-b'&&body.f?.AcceptedB?.enabled?.[2]===1));
    assert.ok(telemetry.some(body=>body.u==='client-alice'&&body.m?.clientCounter===1));
    assert.ok(telemetry.some(body=>body.u==='client-alice'&&body.f?.Visible?.[enableVariants?'blue':'enabled']?.[0]>0));
    assert.ok(telemetry.every(body=>!(body.i&&body.u)));
    telemetry.length=0;
  }
  // Preserve the existing signed/ABA assertions above; independently exercise
  // explicit URL-token clearing through the actual packed public init API.
  for (const enableVariants of [false, true]) {
    identityRequests.length = 0;
    telemetry.length = 0;
    await evaluate(async enableVariants => {
      const sdk = window.telemetry;
      const inherited = new URL(window.__TOGGLY_CONFIG__.baseURI);
      inherited.search = 'i=retired&i=older&keep=one&keep=two';
      const base = {...window.__TOGGLY_CONFIG__, appKey:'identity-host', baseURI:inherited.href, enableVariants,
        verifySignatures:false, enableLiveUpdates:false, featureFlagsRefreshInterval:0, identity:'bob'};
      const tokens = [undefined, '', ' A ', 'B', '', undefined];
      for (let index=0;index<tokens.length;index++) {
        await sdk.initTogglyClient({...base, instanceId:tokens[index]});
        await sdk.refreshFlags();
        if (sdk.$flags.get().Visible !== true || (enableVariants && sdk.getVariant('Visible')?.name !== 'blue')) throw Error('Cleared token selected retired definitions');
        sdk.recordUsage('URL'+index);
        await sdk.flushTelemetry();
      }
      sdk.destroyTogglyClient();
    }, enableVariants);
    assert(identityRequests.length >= 6);
    for (const request of identityRequests) {
      const url = new URL(request.url);
      assert.deepEqual(url.searchParams.getAll('keep'), ['one','two']);
      assert(!['retired','older'].includes(url.searchParams.get('i')));
      assert(url.pathname.includes(enableVariants?'/evaluated-variants-signed/':'/evaluated-signed/'));
    }
    const expected = [undefined, undefined, 'A', 'B', undefined, undefined];
    for (let index=0;index<expected.length;index++) {
      const packets = telemetry.filter(body=>body.f?.['URL'+index]);
      assert.equal(packets.length,1);
      assert.deepEqual(packets[0].f['URL'+index], {enabled:[0,1]});
      assert.equal(packets[0].i,expected[index]);
      assert.equal(packets[0].u,expected[index]?undefined:'bob');
    }
    console.log('PASS inherited URL token initial/blank/rotation/clear', enableVariants?'variants':'boolean');
  }
  telemetry.length = 0;
  await evaluate(async () => {
    const sdk = window.telemetry;
    await sdk.initTogglyClient({...window.__TOGGLY_CONFIG__, enableTelemetry:false});
    if (!sdk.$flag('Visible').get()) throw Error('Opt-out changed evaluation');
    sdk.recordUsage('Visible'); sdk.recordView('Visible'); sdk.incrementCounter('orders'); sdk.setGauge('cart',3);
    await sdk.flushTelemetry();
    sdk.destroyTogglyClient();
  });
  assert.deepEqual(telemetry, [], 'master opt-out silences enabled browser categories');
  assert.deepEqual(unexpectedMetrics, [], 'server usage remains disabled throughout host');
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
    host = spawn(process.execPath, ['dev.mjs'], { cwd: root, env: { ...environment, PORT: String(port), ...(framework !== 'all' ? { HOST_ISLAND: framework } : {}) }, stdio: 'inherit', detached: true });
    {const owned = host; defer(() => stopChild(owned));}
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
  assert.deepEqual(unexpectedMetrics, [], 'dev server usage remains disabled');
  assert.equal(jwksPreflights, 0, 'public JWKS must not require CORS preflight');
  console.log(`PASS ${evidence.mode} Astro ${selected.astro}: packed exports/types, SSG, SSR, middleware, page manifest/gates, React/Vue/Svelte hydration, local gates, signed remote refresh/rejection, request context isolation, minted i/u queues, memory-only ABA/304/mode isolation, reentrant attribution, pending-hook nine-consumer refresh and dev hooks`);
}
});
