import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sdk = join(repository, 'toggly-docusaurus-edge-sdk/libs/docusaurus-plugin');
const currentDocusaurus = '3.10.2';
const temporary = mkdtempSync(join(tmpdir(), 'toggly-docusaurus-packed-host-'));
const host = join(temporary, 'host');
const servers = [];
let browser;
let sockets;
let runtimeEnabled = true;
let corruptSignature = false;
const requests = [];

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
    'react@18.3.1', 'react-dom@18.3.1', '@mdx-js/react@3.1.1',
    'typescript@5.9.3', '@types/react@18.3.28', '@types/react-dom@18.3.7', 'playwright@1.62.1', tarball,
  ]);
  assert.equal(JSON.parse(readFileSync(join(host, 'node_modules/@docusaurus/core/package.json'))).version, currentDocusaurus);
  const config = { appKey: 'docusaurus-packed-host', environment: 'Production', baseURI, verifySignatures: true, allowedKeyIds: [kid], featureFlagsRefreshInterval: 60_000, flagDefaults: { flagOn: false, flagOff: false } };
  write('docusaurus.config.js', `module.exports = {
    title: 'Packed Docusaurus', url: 'https://example.test', baseUrl: '/', favicon: undefined,
    onBrokenLinks: 'throw', trailingSlash: true,
    presets: [['classic', { docs: { routeBasePath: 'docs' }, blog: false }]],
    plugins: [['@ops-ai/toggly-docusaurus-plugin', { ...${JSON.stringify(config)}, staticGating: process.env.PACKED_STATIC === '1' }]],
    customFields: { toggly: ${JSON.stringify(config)} },
  };`);
  write('src/theme/Root.jsx', `import React from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { TogglyProvider } from '@ops-ai/toggly-docusaurus-plugin/client';
export default function Root({children}) {
  const {siteConfig} = useDocusaurusContext();
  return <TogglyProvider config={siteConfig.customFields.toggly}>{children}</TogglyProvider>;
}`);
  write('src/pages/index.jsx', `import React from 'react';
import { Feature, useFlag } from '@ops-ai/toggly-docusaurus-plugin/client';
export default function Page() {
  const {isReady} = useFlag('flagOn');
  return <main><p id="ready">{isReady ? 'ready' : 'loading'}</p>
    <Feature flag="flagOn"><p id="flag-on">ENABLED_CONTENT</p></Feature>
    <Feature flag="flagOff"><p id="flag-off">DISABLED_CONTENT</p></Feature>
    <Feature flag="flagOff" negate><p id="off-fallback">OFF_FALLBACK</p></Feature>
  </main>;
}`);
  write('docs/enabled.md', '---\nslug: /enabled\nx-feature: flagOn\n---\n# Enabled page\n\nENABLED_DOC_CONTENT\n');
  write('docs/disabled.md', '---\nslug: /disabled\nx-feature: flagOff\n---\n# Disabled page\n\nDISABLED_DOC_CONTENT\n');
  write('consumer.mts', `import togglyPlugin, { type TogglyPluginOptions } from '@ops-ai/toggly-docusaurus-plugin';
import { Feature, useFlag, type FeatureProps } from '@ops-ai/toggly-docusaurus-plugin/client';
const options: TogglyPluginOptions = { verifySignatures: true, staticGating: true };
const props: FeatureProps = { flag: 'flagOn', negate: true, children: 'content' };
const state: ReturnType<typeof useFlag>['enabled'] = true;
// @ts-expect-error The installed public flag API requires a string key.
const invalid: FeatureProps = { flag: 123, children: 'content' };
void [togglyPlugin, Feature, options, props, state, invalid];
`);
  run(join(host, 'node_modules/.bin/tsc'), ['--noEmit', '--strict', '--skipLibCheck', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--target', 'ES2022', 'consumer.mts']);
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
  const runtimeHtml = readFileSync(join(runtimeOutput, 'index.html'), 'utf8');
  assert.match(runtimeHtml, /id="flag-on"/);
  assert.match(runtimeHtml, /id="flag-off"/);
  assert.match(runtimeHtml, /data-feature="flagOff"/);
  const mapping = JSON.parse(readFileSync(join(runtimeOutput, 'toggly-page-features.json')));
  assert.equal(mapping['/docs/enabled'], 'flagOn');
  assert.equal(mapping['/docs/disabled'], 'flagOff');
  assert.match(readFileSync(join(runtimeOutput, 'docs/disabled/index.html'), 'utf8'), /DISABLED_DOC_CONTENT/);

  const { chromium } = await import(pathToFileURL(join(host, 'node_modules/playwright/index.mjs')).href);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' }) });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const runtimeUrl = await serve(runtimeOutput);
  await page.goto(runtimeUrl);
  await page.locator('#ready').filter({ hasText: 'ready' }).waitFor();
  await page.locator('#flag-on').waitFor();
  await page.locator('#flag-off').waitFor({ state: 'detached' });
  await page.locator('#off-fallback').waitFor();
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
  await page.close();
  console.log('PACKED_DOCUSAURUS_BROWSER_GATES_PASS');

  runtimeEnabled = true;
  corruptSignature = false;
  const beforeStaticBuild = requests.length;
  await runAsync(cli, ['build', '--out-dir', 'build-static'], { PACKED_STATIC: '1' });
  assert.ok(requests.slice(beforeStaticBuild).includes('/evaluated-signed/docusaurus-packed-host/Production'));
  assert.ok(requests.slice(beforeStaticBuild).includes('/.well-known/jwks'));
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
  await staticPage.goto(await serve(staticOutput));
  await staticPage.locator('#ready').filter({ hasText: 'ready' }).waitFor();
  await staticPage.waitForLoadState('networkidle');
  assert.equal(await staticPage.locator('#flag-off').count(), 0);
  assert.equal(await staticPage.locator('#flag-on').count(), 1);
  assert.equal(requests.length, beforeStaticBrowser, 'static gating does not fetch runtime flags');
  assert.deepEqual(pageErrors, []);
  await staticPage.close();
  console.log(`PACKED_DOCUSAURUS_HOST_PASS ${JSON.stringify({ docusaurus: currentDocusaurus, node: process.version })}`);
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
