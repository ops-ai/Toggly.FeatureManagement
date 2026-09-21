import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readdirSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sdk = join(repository, 'toggly-docusaurus-edge-sdk/libs/docusaurus-plugin');
const currentDocusaurus = '3.10.2';
const currentReact = '19.3.0';
const temporary = mkdtempSync(join(tmpdir(), 'toggly-docusaurus-packed-host-'));
const host = join(temporary, 'host');
const servers = [];
let browser;
let sockets;
let runtimeEnabled = true;
let corruptSignature = false;
const requests = [];
const telemetry = [];
let preflights = 0;

function run(command, args, cwd = host) {
  return execFileSync(command, args, {
    cwd, encoding: 'utf8', env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  });
}
function runAsync(command, args, env = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: host, stdio: 'inherit', env: { ...process.env, CI: 'true', ...env },
    });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 180_000);
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited ${code}`));
    });
  });
}
function write(relative, contents) {
  const path = join(host, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}
async function listen(server) {
  servers.push(server);
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function serve(directory) {
  return listen(createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = resolve(directory, `.${pathname}`);
    if (!file.startsWith(`${directory}/`) && file !== directory) {
      response.writeHead(403).end();
      return;
    }
    if (!extname(file)) file = join(file, 'index.html');
    if (!existsSync(file)) { response.writeHead(404).end(); return; }
    const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
    response.setHeader('content-type', contentTypes[extname(file)] ?? 'application/octet-stream');
    response.end(readFileSync(file));
  }));
}

try {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = createHash('sha1').update(Buffer.from(jwk.x, 'base64url')).update(Buffer.from(jwk.y, 'base64url')).digest('hex').toUpperCase() + 'ES256';
  const jwks = { keys: [{ ...jwk, kid, alg: 'ES256', use: 'sig' }] };
  function signedFlags() {
    const defs = { flagOn: runtimeEnabled, flagOff: false };
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = createHash('sha256').update(`${JSON.stringify(defs)}|${timestamp}`).digest();
    const signature = sign('sha256', digest, { key: privateKey, dsaEncoding: 'ieee-p1363' });
    if (corruptSignature) signature[0] ^= 1;
    return JSON.stringify({ defs, kid, timestamp, signature: signature.toString('base64') });
  }
  const definitions = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', '*');
    response.setHeader('content-type', 'application/json');
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    requests.push(pathname);
    if (pathname === '/.well-known/jwks') response.end(JSON.stringify(jwks));
    else if (pathname === '/evaluated-signed/docusaurus-packed-host/Production') response.end(signedFlags());
    else if (request.method === 'POST') response.writeHead(204).end();
    else response.writeHead(404).end('{}');
  });
  const baseURI = await listen(definitions);
  const metricsBaseUrl = await listen(createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'content-type, content-encoding');
    if (request.method === 'OPTIONS') {preflights++; response.writeHead(204).end(); return;}
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    telemetry.push({url: request.url, headers: request.headers, body: JSON.parse((request.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString())});
    response.writeHead(202).end();
  }));
  const { WebSocketServer } = await import(pathToFileURL(join(sdk, 'node_modules/ws/wrapper.mjs')).href);
  sockets = new WebSocketServer({ server: definitions });

  run('npm', ['run', 'build'], sdk);
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temporary], sdk))[0];
  const tarball = join(temporary, packed.filename);
  for (const file of ['dist/index.js', 'dist/index.d.ts', 'dist/client/index.js', 'dist/client/index.d.ts']) {
    assert.ok(packed.files.some((entry) => entry.path === file), `tarball includes public ${file}`);
  }
  write('package.json', JSON.stringify({ name: 'toggly-docusaurus-packed-host', private: true }));
  run('npm', ['install', '--no-package-lock', '--no-audit', '--no-fund',
    `@docusaurus/core@${currentDocusaurus}`, `@docusaurus/preset-classic@${currentDocusaurus}`,
    `react@${currentReact}`, `react-dom@${currentReact}`, '@mdx-js/react@3.1.1',
    'typescript@5.9.3', '@types/react@19.3.0', '@types/react-dom@19.3.0', 'playwright@1.62.1', tarball, ...(process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL ? [process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL] : []),
  ]);
  assert.equal(JSON.parse(readFileSync(join(host, 'node_modules/@docusaurus/core/package.json'))).version, currentDocusaurus);
  assert.equal(JSON.parse(readFileSync(join(host, 'node_modules/react/package.json'))).version, currentReact);
  assert.equal(JSON.parse(readFileSync(join(host, 'node_modules/react-dom/package.json'))).version, currentReact);
  if (process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL) console.log('LOCAL_TELEMETRY_TARBALL: registry acceptance pending');
  const config = { metricsBaseUrl: metricsBaseUrl + '/base', appKey: 'docusaurus-packed-host', environment: 'Production', baseURI, verifySignatures: true, allowedKeyIds: [kid], featureFlagsRefreshInterval: 60_000, flagDefaults: { flagOn: false, flagOff: false } };
  write('docusaurus.config.js', `module.exports = {
    title: 'Packed Docusaurus', url: 'https://example.test', baseUrl: '/', favicon: undefined,
    onBrokenLinks: 'throw', trailingSlash: true,
    presets: [['classic', { docs: { routeBasePath: 'docs' }, blog: false }]],
    plugins: [['@ops-ai/toggly-docusaurus-plugin', { ...${JSON.stringify(config)}, staticGating: process.env.PACKED_STATIC === '1' }]],
    customFields: { toggly: ${JSON.stringify(config)} },
  };`);
  write('src/theme/Root.jsx', `import React, {useEffect, useState} from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { TogglyProvider, useToggly } from '@ops-ai/toggly-docusaurus-plugin/client';
function Observer(){const t=useToggly();useEffect(()=>{window.telemetry=t;},[t]);return null;}
export default function Root({children}) {
  const {siteConfig} = useDocusaurusContext();
  const [active,setActive]=useState(true);useEffect(()=>{window.unmountOwner=()=>setActive(false);},[]);
  return active ? <TogglyProvider config={siteConfig.customFields.toggly}><Observer/>{children}</TogglyProvider> : <main id="disposed">Disposed</main>;
}`);
  write('src/pages/index.jsx', `import React from 'react';
import Link from '@docusaurus/Link';
import { Feature, useFlag } from '@ops-ai/toggly-docusaurus-plugin/client';
export default function Page() {
  const {isReady} = useFlag('flagOn');
  return <main><Link id="navigate" to="/docs/enabled/">Navigate</Link><p id="ready">{isReady ? 'ready' : 'loading'}</p>
    <Feature flag="flagOn"><p id="flag-on">ENABLED_CONTENT</p></Feature>
    <Feature flag="flagOff"><p id="flag-off">DISABLED_CONTENT</p></Feature>
    <Feature flag="flagOff" negate><p id="off-fallback">OFF_FALLBACK</p></Feature>
  </main>;
}`);
  write('docs/enabled.md', '---\nslug: /enabled\nx-feature: flagOn\n---\n# Enabled page\n\nENABLED_DOC_CONTENT\n');
  write('docs/disabled.md', '---\nslug: /disabled\nx-feature: flagOff\n---\n# Disabled page\n\nDISABLED_DOC_CONTENT\n');
  write('static/favicon.ico', '');
  write('consumer.mts', `import togglyPlugin, { type TogglyPluginOptions } from '@ops-ai/toggly-docusaurus-plugin';
import { Feature, useFlag, type FeatureProps } from '@ops-ai/toggly-docusaurus-plugin/client';
const options: TogglyPluginOptions = { verifySignatures: true, staticGating: true, enableTelemetry: true, metricsBaseUrl: 'https://metrics.example/base', telemetryFlushIntervalMs: 45000 };
const props: FeatureProps = { flag: 'flagOn', negate: true, children: 'content' };
const state: ReturnType<typeof useFlag>['enabled'] = true;
// @ts-expect-error The installed public flag API requires a string key.
const invalid: FeatureProps = { flag: 123, children: 'content' };
void [togglyPlugin, Feature, options, props, state, invalid];
`);
  run(join(host, 'node_modules/.bin/tsc'), ['--noEmit', '--strict', '--skipLibCheck', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--target', 'ES2022', 'consumer.mts']);
  write('telemetry-consumer.mts', `import {type TogglyContextValue} from '@ops-ai/toggly-docusaurus-plugin/client';
export function exercise(t: TogglyContextValue): Promise<void> {
 t.recordUsage('feature','control'); t.recordView('feature'); t.incrementCounter('orders',2); t.setGauge('cart',3); return t.flushTelemetry();
}`);
  run(join(host, 'node_modules/.bin/tsc'), ['--noEmit', '--strict', '--skipLibCheck', 'false', '--types', 'react,react-dom', '--lib', 'ES2022,DOM,DOM.Iterable', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--target', 'ES2022', 'telemetry-consumer.mts']);
  write('consumer.mjs', `import assert from 'node:assert/strict';
import plugin from '@ops-ai/toggly-docusaurus-plugin';
import { Feature, TogglyProvider, useFlag } from '@ops-ai/toggly-docusaurus-plugin/client';
for (const entry of [plugin, Feature, TogglyProvider, useFlag]) assert.equal(typeof entry, 'function');
console.log('PACKED_DOCUSAURUS_PUBLIC_CONSUMERS_PASS');
`);
  await runAsync(process.execPath, ['consumer.mjs']);
  const cli = join(host, 'node_modules/.bin/docusaurus');
  await runAsync(cli, ['build', '--out-dir', 'build-runtime'], { PACKED_STATIC: '0' });
  const runtimeOutput = join(host, 'build-runtime');
  for (const file of readdirSync(join(runtimeOutput, 'assets/js'))) {
    if (file.endsWith('.js')) assert.doesNotMatch(readFileSync(join(runtimeOutput, 'assets/js', file), 'utf8'), /api\/usage\/stats|toggly-node-core|node:fs|grpc-js/);
  }
  const runtimeHtml = readFileSync(join(runtimeOutput, 'index.html'), 'utf8');
  assert.match(runtimeHtml, /id="flag-on"/);
  assert.match(runtimeHtml, /id="flag-off"/);
  assert.match(runtimeHtml, /data-feature="flagOff"/);
  const mapping = JSON.parse(readFileSync(join(runtimeOutput, 'toggly-page-features.json')));
  assert.equal(mapping['/docs/enabled'], 'flagOn');
  assert.equal(mapping['/docs/disabled'], 'flagOff');
  assert.match(readFileSync(join(runtimeOutput, 'docs/disabled/index.html'), 'utf8'), /DISABLED_DOC_CONTENT/);

  assert.equal(telemetry.length, 0, 'SSR/runtime build is frontend-telemetry silent');
  const { chromium } = await import(pathToFileURL(join(host, 'node_modules/playwright/index.mjs')).href);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' }) });
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const runtimeUrl = await serve(runtimeOutput);
  await page.goto(runtimeUrl);
  await page.locator('#ready').filter({ hasText: 'ready' }).waitFor();
  await page.locator('#flag-on').waitFor();
  await page.locator('#flag-off').waitFor({ state: 'detached' });
  await page.locator('#off-fallback').waitFor();
  await page.waitForFunction(() => window.telemetry?.isReady);
  await page.evaluate(() => window.telemetry.flushTelemetry());
  assert.deepEqual(telemetry.at(-1).body.f, {flagOn:{enabled:[2]},flagOff:{disabled:[2]}});
  assert.equal(telemetry.at(-1).headers['content-encoding'], 'gzip');
  assert.equal(telemetry.at(-1).headers.cookie, undefined);
  assert.equal(telemetry.at(-1).url, '/base/api/frontend/telemetry');
  assert(preflights > 0);
  await page.evaluate(async () => {window.telemetry.recordUsage('Checkout','control');window.telemetry.recordView('Checkout','control');window.telemetry.incrementCounter('orders',2);window.telemetry.setGauge('cart',3);await window.telemetry.flushTelemetry();});
  assert.deepEqual(telemetry.at(-1).body, {k:'docusaurus-packed-host',e:'Production',f:{Checkout:{control:[0,1,1]}},m:{orders:2,cart:3}});
  await page.evaluate(() => {window.telemetry.recordView('Hidden');window.dispatchEvent(new Event('pagehide'));});
  for(let i=0;telemetry.at(-1).body.f?.Hidden===undefined&&i<50;i++) await page.waitForTimeout(20);
  assert.deepEqual(telemetry.at(-1).body.f,{Hidden:{enabled:[0,0,1]}});assert.equal(telemetry.at(-1).headers['content-encoding'],undefined);
  await page.evaluate(() => {window.telemetry.recordUsage('Navigation');window.beforeNavigation=window.telemetry;});
  await page.locator('#navigate').click();await page.waitForURL('**/docs/enabled/');
  await page.evaluate(() => window.telemetry.flushTelemetry());
  assert.equal(await page.evaluate(() => window.beforeNavigation===window.telemetry),true);
  assert(telemetry.some(packet=>packet.body.f?.Navigation?.enabled[1]===1));
  await page.goto(runtimeUrl);
  runtimeEnabled = false;
  await page.reload();
  await page.locator('#ready').filter({ hasText: 'ready' }).waitFor();
  await page.locator('#flag-on').waitFor({ state: 'detached' });
  runtimeEnabled = true;
  corruptSignature = true;
  await page.reload();
  await page.locator('#ready').filter({ hasText: 'ready' }).waitFor();
  await page.locator('#flag-on').waitFor({ state: 'detached' });
  assert.ok(requests.includes('/evaluated-signed/docusaurus-packed-host/Production'));
  assert.ok(requests.includes('/.well-known/jwks'));
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await page.evaluate(() => window.telemetry.flushTelemetry());
  const beforeDispose=telemetry.length;
  await page.evaluate(() => {window.telemetry.recordUsage('Final');window.unmountOwner();});
  await page.locator('#disposed').waitFor();
  for(let i=0;telemetry.length===beforeDispose&&i<50;i++) await page.waitForTimeout(20);
  assert.equal(telemetry.length,beforeDispose+1);assert.deepEqual(telemetry.at(-1).body.f,{Final:{enabled:[0,1]}});
  assert.equal(telemetry.at(-1).headers['content-encoding'],undefined);
  await page.evaluate(async()=>{window.telemetry.recordView('Late');await window.telemetry.flushTelemetry();});assert.equal(telemetry.length,beforeDispose+1);
  for(const packet of telemetry) assert(Object.keys(packet.body).every(key=>['k','e','f','m'].includes(key)));
  await page.close();
  console.log('PACKED_DOCUSAURUS_BROWSER_GATES_TELEMETRY_PASS');

  runtimeEnabled = true;
  corruptSignature = false;
  const beforeStaticBuild = requests.length;
  const telemetryBeforeStaticBuild = telemetry.length;
  await runAsync(cli, ['build', '--out-dir', 'build-static'], { PACKED_STATIC: '1' });
  assert.ok(requests.slice(beforeStaticBuild).includes('/evaluated-signed/docusaurus-packed-host/Production'));
  assert.ok(requests.slice(beforeStaticBuild).includes('/.well-known/jwks'));
  assert.equal(telemetry.length,telemetryBeforeStaticBuild,'static build telemetry silent');
  const staticOutput = join(host, 'build-static');
  const staticHtml = readFileSync(join(staticOutput, 'index.html'), 'utf8');
  assert.match(staticHtml, /id="flag-on"/);
  assert.doesNotMatch(staticHtml, /id="flag-off"/);
  assert.match(staticHtml, /id="off-fallback"/);
  assert.match(readFileSync(join(staticOutput, 'docs/enabled/index.html'), 'utf8'), /ENABLED_DOC_CONTENT/);
  assert.equal(readFileSync(join(staticOutput, 'docs/disabled/index.html'), 'utf8'), readFileSync(join(staticOutput, '404.html'), 'utf8'));
  const beforeStaticBrowser = requests.length;
  const staticPage = await browser.newPage();
  staticPage.on('pageerror', (error) => pageErrors.push(error.message));
  staticPage.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await staticPage.goto(await serve(staticOutput));
  await staticPage.locator('#ready').filter({ hasText: 'ready' }).waitFor();
  await staticPage.waitForLoadState('networkidle');
  assert.equal(await staticPage.locator('#flag-off').count(), 0);
  assert.equal(await staticPage.locator('#flag-on').count(), 1);
  assert.equal(requests.length, beforeStaticBrowser, 'static gating does not fetch runtime flags');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await staticPage.evaluate(() => window.telemetry.flushTelemetry());
  assert.deepEqual(telemetry.at(-1).body.f,{flagOn:{enabled:[2]},flagOff:{disabled:[2]}});
  await staticPage.close();
  console.log(`PACKED_DOCUSAURUS_HOST_PASS ${JSON.stringify({ docusaurus: currentDocusaurus, react: currentReact, node: process.version })}`);
} finally {
  if (browser) await browser.close();
  if (sockets) {
    for (const client of sockets.clients) client.terminate();
    await new Promise((resolveClose) => sockets.close(resolveClose));
  }
  for (const server of servers.reverse()) {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  rmSync(temporary, { recursive: true, force: true });
}
