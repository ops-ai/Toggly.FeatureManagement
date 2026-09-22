import assert from 'node:assert/strict';
import { verifyBrowserRetirement } from './browser-retirement.mjs';
import {
  bounded,
  closeServer,
  launchBrowser,
  runOwnedCommand,
  withResources,
} from './owned-resources.mjs';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  readdirSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sdk = join(
  repository,
  'toggly-docusaurus-edge-sdk/libs/docusaurus-plugin'
);
const currentDocusaurus = '3.10.2';
const currentReact = '19.3.0';
let temporary, host, own;
let browser;
let sockets;
let runtimeEnabled = true;
let corruptSignature = false;
const requests = [];
const requestUrls = [];
const telemetry = [];
let preflights = 0;

function run(command, args, cwd = host) {
  return runOwnedCommand(
    command,
    args,
    {
      cwd,
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
      },
    },
    300000
  );
}
async function runAsync(command, args, env = {}) {
  const output = await runOwnedCommand(
    command,
    args,
    {
      cwd: host,
      env: { ...process.env, CI: 'true', ...env },
    },
    180000
  );
  console.log(output);
}
function write(relative, contents) {
  const path = join(host, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}
async function listen(server) {
  own(() => closeServer(server));
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function serve(directory) {
  return listen(
    createServer((request, response) => {
      const pathname = decodeURIComponent(
        new URL(request.url, 'http://localhost').pathname
      );
      let file = resolve(directory, `.${pathname}`);
      if (!file.startsWith(`${directory}/`) && file !== directory) {
        response.writeHead(403).end();
        return;
      }
      if (!extname(file)) file = join(file, 'index.html');
      if (!existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      const contentTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
      };
      response.setHeader(
        'content-type',
        contentTypes[extname(file)] ?? 'application/octet-stream'
      );
      response.end(readFileSync(file));
    })
  );
}

// The supervisor owns both the temporary root and every actual BrowserServer.
// Its worker may block or be forcibly retired without losing those handles.
if (!process.env.TOGGLY_DOCUSAURUS_WORKER) {
  await withResources(async (defer) => {
    const root = mkdtempSync(join(tmpdir(), 'toggly-docusaurus-packed-host-'));
    defer(() => rmSync(root, { recursive: true, force: true }));
    await runOwnedCommand(process.execPath, [fileURLToPath(import.meta.url)], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, TOGGLY_DOCUSAURUS_WORKER: root },
    }, 900000);
  });
} else await withResources(async (defer) => {
  own = defer;
  temporary = process.env.TOGGLY_DOCUSAURUS_WORKER;
  own(() => rmSync(temporary, { recursive: true, force: true }));
  host = join(temporary, 'host');
  console.log('OWNED_DOCUSAURUS_HOST', temporary);
  assert.equal(
    process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL,
    undefined,
    'Shared reporter must resolve from public npm'
  );
  await run(
    process.execPath,
    [
      '--test',
      join(repository, 'tests/docusaurus-consumer-fixtures/cleanup.test.mjs'),
    ],
    repository
  ).then(console.log);
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid =
    createHash('sha1')
      .update(Buffer.from(jwk.x, 'base64url'))
      .update(Buffer.from(jwk.y, 'base64url'))
      .digest('hex')
      .toUpperCase() + 'ES256';
  const jwks = { keys: [{ ...jwk, kid, alg: 'ES256', use: 'sig' }] };
  function signedFlags(token) {
    const defs = {
      flagOn: runtimeEnabled && token !== 'token-b',
      flagOff: false,
    };
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = createHash('sha256')
      .update(`${JSON.stringify(defs)}|${timestamp}`)
      .digest();
    const signature = sign('sha256', digest, {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    if (corruptSignature) signature[0] ^= 1;
    return JSON.stringify({
      defs,
      kid,
      timestamp,
      signature: signature.toString('base64'),
    });
  }
  const definitions = createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    const pathname = requestUrl.pathname;
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', '*');
    response.setHeader('content-type', 'application/json');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    requests.push(pathname);
    requestUrls.push(requestUrl);
    if (pathname === '/.well-known/jwks') response.end(JSON.stringify(jwks));
    else if (pathname === '/evaluated-signed/docusaurus-packed-host/Production')
      response.end(signedFlags(requestUrl.searchParams.get('i')));
    else if (request.method === 'POST') response.writeHead(204).end();
    else response.writeHead(404).end('{}');
  });
  const baseURI = await listen(definitions);
  const metricsBaseUrl = await listen(
    createServer(async (request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      response.setHeader(
        'Access-Control-Allow-Headers',
        'content-type, content-encoding'
      );
      if (request.method === 'OPTIONS') {
        preflights++;
        response.writeHead(204).end();
        return;
      }
      try {
        const raw = await bounded(async () => {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          return Buffer.concat(chunks);
        }, 'Collector body');
        telemetry.push({
          url: request.url,
          headers: request.headers,
          body: JSON.parse(
            (request.headers['content-encoding'] === 'gzip'
              ? gunzipSync(raw)
              : raw
            ).toString()
          ),
        });
        response.writeHead(202).end();
      } catch (error) {
        request.destroy();
        console.error('Collector request failed', error);
      }
    })
  );
  const { WebSocketServer } = await import(
    pathToFileURL(join(sdk, 'node_modules/ws/wrapper.mjs')).href
  );
  sockets = new WebSocketServer({ server: definitions });
  own(async () => {
    const failures = [];
    for (const client of sockets.clients) {
      try {
        client.terminate();
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await bounded(
        () => new Promise((resolveClose) => sockets.close(resolveClose)),
        'WebSocket close'
      );
    } catch (error) {
      failures.push(error);
    }
    if (failures.length)
      throw new AggregateError(failures, 'WebSocket cleanup failed');
  });

  await run('npm', ['run', 'build'], sdk);
  const packed = JSON.parse(
    await run('npm', ['pack', '--json', '--pack-destination', temporary], sdk)
  )[0];
  const tarball = join(temporary, packed.filename);
  for (const file of [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/client/index.js',
    'dist/client/index.d.ts',
  ]) {
    assert.ok(
      packed.files.some((entry) => entry.path === file),
      `tarball includes public ${file}`
    );
  }
  write(
    'package.json',
    JSON.stringify({ name: 'toggly-docusaurus-packed-host', private: true })
  );
  await run('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    '--engine-strict',
    `@docusaurus/core@${currentDocusaurus}`,
    `@docusaurus/preset-classic@${currentDocusaurus}`,
    `react@${currentReact}`,
    `react-dom@${currentReact}`,
    '@mdx-js/react@3.1.1',
    'typescript@5.9.3',
    '@types/react@19.3.0',
    '@types/react-dom@19.3.0',
    'playwright@1.62.1',
    tarball,
  ]);
  assert.equal(
    JSON.parse(
      readFileSync(join(host, 'node_modules/@docusaurus/core/package.json'))
    ).version,
    currentDocusaurus
  );
  assert.equal(
    JSON.parse(readFileSync(join(host, 'node_modules/react/package.json')))
      .version,
    currentReact
  );
  assert.equal(
    JSON.parse(readFileSync(join(host, 'node_modules/react-dom/package.json')))
      .version,
    currentReact
  );
  await run('npm', ['ci', '--no-audit', '--no-fund', '--engine-strict']);
  const lock = JSON.parse(readFileSync(join(host, 'package-lock.json')));
  const candidateBytes = readFileSync(tarball);
  for (const [key, value] of Object.entries(lock.packages)) {
    if (!key) continue;
    if (key === 'node_modules/@ops-ai/toggly-docusaurus-plugin') {
      assert.equal(
        value.integrity,
        'sha512-' + createHash('sha512').update(candidateBytes).digest('base64')
      );
    } else {
      assert(
        value.resolved?.startsWith('https://registry.npmjs.org/'),
        key + ' uses public npm'
      );
      assert(value.integrity, key + ' has maintained registry integrity');
    }
  }
  assert.equal(
    lock.packages['node_modules/@ops-ai/toggly-client-telemetry'].version,
    '1.1.0'
  );
  console.log(
    'PACKED_DOCUSAURUS_REGISTRY',
    JSON.stringify({
      archive: packed.shasum,
      integrity: packed.integrity,
      reporter: '1.1.0',
    })
  );
  const config = {
    metricsBaseUrl: metricsBaseUrl + '/base',
    appKey: 'docusaurus-packed-host',
    environment: 'Production',
    baseURI,
    verifySignatures: true,
    allowedKeyIds: [kid],
    featureFlagsRefreshInterval: 60_000,
    flagDefaults: { flagOn: false, flagOff: false },
  };
  write(
    'docusaurus.config.js',
    `module.exports = {
    title: 'Packed Docusaurus', url: 'https://example.test', baseUrl: '/', favicon: undefined,
    onBrokenLinks: 'throw', trailingSlash: true,
    presets: [['classic', { docs: { routeBasePath: 'docs' }, blog: false }]],
    plugins: [['@ops-ai/toggly-docusaurus-plugin', { ...${JSON.stringify(config)}, staticGating: process.env.PACKED_STATIC === '1' }]],
    customFields: { toggly: ${JSON.stringify(config)} },
  };`
  );
  write(
    'src/theme/Root.jsx',
    `import React, {useEffect, useState, useMemo} from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { TogglyProvider, useToggly } from '@ops-ai/toggly-docusaurus-plugin/client';
function Observer(){const t=useToggly();useEffect(()=>{window.telemetry=t;},[t]);return null;}
export default function Root({children}) {
  const {siteConfig} = useDocusaurusContext();
  const [active,setActive]=useState(true);
  const [overrides,setOverrides]=useState({});
  const config=useMemo(()=>({...siteConfig.customFields.toggly,...overrides}),[siteConfig.customFields.toggly,overrides]);
  useEffect(()=>{window.unmountOwner=()=>setActive(false);window.updateTarget=(next)=>setOverrides(previous=>({...previous,...next}));},[]);
  return active ? <TogglyProvider config={config}><Observer/>{children}</TogglyProvider> : <main id="disposed">Disposed</main>;
}`
  );
  write(
    'src/pages/index.jsx',
    `import React from 'react';
import Link from '@docusaurus/Link';
import { Feature, useFlag } from '@ops-ai/toggly-docusaurus-plugin/client';
export default function Page() {
  const {isReady} = useFlag('flagOn');
  return <main><Link id="navigate" to="/docs/enabled/">Navigate</Link><p id="ready">{isReady ? 'ready' : 'loading'}</p>
    <Feature flag="flagOn"><p id="flag-on">ENABLED_CONTENT</p></Feature>
    <Feature flag="flagOff"><p id="flag-off">DISABLED_CONTENT</p></Feature>
    <Feature flag="flagOff" negate><p id="off-fallback">OFF_FALLBACK</p></Feature>
  </main>;
}`
  );
  write(
    "src/pages/fallback.jsx",
    `import React, {useEffect} from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { TogglyProvider, useToggly, useFlag, Feature } from '@ops-ai/toggly-docusaurus-plugin/client';
const cases = [{key:'configured',expected:true},{key:'explicitOff',fallback:false,expected:false},{key:'explicitOn',fallback:true,expected:true},{key:'flagOff',fallback:true,expected:false},{key:'missing',expected:false}];
function Reader({item}) { const t=useToggly(); const result=useFlag(item.key,item.fallback); useEffect(()=>{window.fallbackTelemetry=t;},[t]); return <span id={'fallback-'+item.key}>{result.isReady ? String(result.enabled) : 'pending'}</span>; }
export default function FallbackPage() { const {siteConfig}=useDocusaurusContext(); const config={...siteConfig.customFields.toggly,instanceId:'fallback-token',flagDefaults:{configured:true,explicitOff:true,explicitOn:false,flagOff:true}}; return <TogglyProvider config={config}>{cases.map(item=><React.Fragment key={item.key}><Reader item={item}/><Feature flag={item.key} defaultValue={item.fallback} negate={!item.expected}><span id={'feature-'+item.key}>visible</span></Feature></React.Fragment>)}</TogglyProvider>; }
`,
  );
  write(
    'docs/enabled.md',
    '---\nslug: /enabled\nx-feature: flagOn\n---\n# Enabled page\n\nENABLED_DOC_CONTENT\n'
  );
  write(
    'docs/disabled.md',
    '---\nslug: /disabled\nx-feature: flagOff\n---\n# Disabled page\n\nDISABLED_DOC_CONTENT\n'
  );
  write('static/favicon.ico', '');
  write(
    'consumer.mts',
    `import togglyPlugin, { type TogglyPluginOptions } from '@ops-ai/toggly-docusaurus-plugin';
import { Feature, useFlag, type FeatureProps } from '@ops-ai/toggly-docusaurus-plugin/client';
const options: TogglyPluginOptions = { instanceId: 'host-token', verifySignatures: true, staticGating: true, enableTelemetry: true, metricsBaseUrl: 'https://metrics.example/base', telemetryFlushIntervalMs: 45000 };
const props: FeatureProps = { flag: 'flagOn', negate: true, children: 'content' };
const state: ReturnType<typeof useFlag>['enabled'] = true;
// @ts-expect-error The installed public flag API requires a string key.
const invalid: FeatureProps = { flag: 123, children: 'content' };
void [togglyPlugin, Feature, options, props, state, invalid];
`
  );
  await run(join(host, 'node_modules/.bin/tsc'), [
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--module',
    'ESNext',
    '--moduleResolution',
    'Bundler',
    '--target',
    'ES2022',
    'consumer.mts',
  ]);
  write(
    'telemetry-consumer.mts',
    `import {type TogglyContextValue} from '@ops-ai/toggly-docusaurus-plugin/client';
export function exercise(t: TogglyContextValue): Promise<void> {
 t.recordUsage('feature','control'); t.recordView('feature'); t.incrementCounter('orders',2); t.setGauge('cart',3); return t.flushTelemetry();
}`
  );
  await run(join(host, 'node_modules/.bin/tsc'), [
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    'false',
    '--types',
    'react,react-dom',
    '--lib',
    'ES2022,DOM,DOM.Iterable',
    '--module',
    'ESNext',
    '--moduleResolution',
    'Bundler',
    '--target',
    'ES2022',
    'telemetry-consumer.mts',
  ]);
  write(
    'consumer.mjs',
    `import assert from 'node:assert/strict';
import plugin from '@ops-ai/toggly-docusaurus-plugin';
import { Feature, TogglyProvider, useFlag } from '@ops-ai/toggly-docusaurus-plugin/client';
for (const entry of [plugin, Feature, TogglyProvider, useFlag]) assert.equal(typeof entry, 'function');
console.log('PACKED_DOCUSAURUS_PUBLIC_CONSUMERS_PASS');
`
  );
  await runAsync(process.execPath, ['consumer.mjs']);
  const cli = join(host, 'node_modules/.bin/docusaurus');
  await runAsync(cli, ['build', '--out-dir', 'build-runtime'], {
    PACKED_STATIC: '0',
  });
  const runtimeOutput = join(host, 'build-runtime');
  for (const file of readdirSync(join(runtimeOutput, 'assets/js'))) {
    if (file.endsWith('.js'))
      assert.doesNotMatch(
        readFileSync(join(runtimeOutput, 'assets/js', file), 'utf8'),
        /api\/usage\/stats|toggly-node-core|node:fs|grpc-js/
      );
  }
  const runtimeHtml = readFileSync(join(runtimeOutput, 'index.html'), 'utf8');
  assert.match(runtimeHtml, /id="flag-on"/);
  assert.match(runtimeHtml, /id="flag-off"/);
  assert.match(runtimeHtml, /data-feature="flagOff"/);
  const mapping = JSON.parse(
    readFileSync(join(runtimeOutput, 'toggly-page-features.json'))
  );
  assert.equal(mapping['/docs/enabled'], 'flagOn');
  assert.equal(mapping['/docs/disabled'], 'flagOff');
  assert.match(
    readFileSync(join(runtimeOutput, 'docs/disabled/index.html'), 'utf8'),
    /DISABLED_DOC_CONTENT/
  );

  assert.equal(
    telemetry.length,
    0,
    'SSR/runtime build is frontend-telemetry silent'
  );
  const { chromium } = await import(
    pathToFileURL(join(host, 'node_modules/playwright/index.mjs')).href
  );
  const browserOptions = {
    moduleUrl: pathToFileURL(join(host, 'node_modules/playwright/index.mjs')).href,
    ...(process.env.CHROME_BIN
      ? { executablePath: process.env.CHROME_BIN }
      : { channel: 'chrome' }),
  };
  await verifyBrowserRetirement(browserOptions.moduleUrl, browserOptions);
  let probePid;
  await assert.rejects(
    withResources(async (defer) => {
      const held = await launchBrowser(
        chromium,
        defer,
        browserOptions,
        (child) => {
          probePid = child.pid;
        }
      );
      const heldPage = await bounded(
        () => held.newPage(),
        'Probe page creation',
        15000
      );
      await bounded(
        () => heldPage.evaluate(() => new Promise(() => {})),
        'Injected actual browser evaluation',
        100
      );
    }),
    (error) => /Injected actual browser evaluation/.test(String(error.cause))
  );
  assert.throws(() => process.kill(probePid, 0), { code: 'ESRCH' });
  console.log('PACKED_DOCUSAURUS_ACTUAL_BROWSER_CLEANUP_PASS', probePid);
  browser = await launchBrowser(chromium, own, browserOptions);
  const page = await bounded(
    () => browser.newPage(),
    'Browser page creation',
    15000
  );
  const evaluate = (...args) =>
    bounded(() => page.evaluate(...args), 'Browser evaluation', 30000);
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
  await evaluate(() => window.telemetry.flushTelemetry());
  assert.deepEqual(telemetry.at(-1).body.f, {
    flagOn: { enabled: [2] },
    flagOff: { disabled: [2] },
  });
  assert.equal(telemetry.at(-1).headers['content-encoding'], 'gzip');
  assert.equal(telemetry.at(-1).headers.cookie, undefined);
  assert.equal(telemetry.at(-1).url, '/base/api/frontend/telemetry');
  assert(preflights > 0);
  await evaluate(async () => {
    window.telemetry.recordUsage('Checkout', 'control');
    window.telemetry.recordView('Checkout', 'control');
    window.telemetry.incrementCounter('orders', 2);
    window.telemetry.setGauge('cart', 3);
    await window.telemetry.flushTelemetry();
  });
  assert.deepEqual(telemetry.at(-1).body, {
    k: 'docusaurus-packed-host',
    e: 'Production',
    f: { Checkout: { control: [0, 1, 1] } },
    m: { orders: 2, cart: 3 },
  });
  await evaluate(() => {
    window.telemetry.recordView('Hidden');
    window.dispatchEvent(new Event('pagehide'));
  });
  for (let i = 0; telemetry.at(-1).body.f?.Hidden === undefined && i < 50; i++)
    await page.waitForTimeout(20);
  assert.deepEqual(telemetry.at(-1).body.f, { Hidden: { enabled: [0, 0, 1] } });
  assert.equal(telemetry.at(-1).headers['content-encoding'], undefined);
  await evaluate(() => {
    window.telemetry.recordUsage('Navigation');
    window.beforeNavigation = window.telemetry;
  });
  await page.locator('#navigate').click();
  await page.waitForURL('**/docs/enabled/');
  await evaluate(() => window.telemetry.flushTelemetry());
  assert.equal(
    await evaluate(() => window.beforeNavigation === window.telemetry),
    true
  );
  assert(
    telemetry.some((packet) => packet.body.f?.Navigation?.enabled[1] === 1)
  );
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
  assert.ok(
    requests.includes('/evaluated-signed/docusaurus-packed-host/Production')
  );
  assert.ok(requests.includes('/.well-known/jwks'));
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await evaluate(() => window.telemetry.flushTelemetry());
  const beforeDispose = telemetry.length;
  await evaluate(() => {
    window.telemetry.recordUsage('Final');
    window.unmountOwner();
  });
  await page.locator('#disposed').waitFor();
  for (let i = 0; telemetry.length === beforeDispose && i < 50; i++)
    await page.waitForTimeout(20);
  assert.equal(telemetry.length, beforeDispose + 1);
  assert.deepEqual(telemetry.at(-1).body.f, { Final: { enabled: [0, 1] } });
  assert.equal(telemetry.at(-1).headers['content-encoding'], undefined);
  await evaluate(async () => {
    window.telemetry.recordView('Late');
    await window.telemetry.flushTelemetry();
  });
  assert.equal(telemetry.length, beforeDispose + 1);
  for (const packet of telemetry)
    assert(
      Object.keys(packet.body).every((key) =>
        ['k', 'e', 'f', 'm'].includes(key)
      )
    );
  // A new actual provider owner exercises configured query defaults, then its
  // targeting remounts retain one queue through A/B/A and token clearing.
  runtimeEnabled = true;
  corruptSignature = false;
  await page.goto(runtimeUrl);
  await page.waitForFunction(() => window.telemetry?.isReady);
  await evaluate(() => window.telemetry.flushTelemetry());
  const identityStart = telemetry.length;
  const requestStart = requestUrls.length;
  const target = async (next) => {
    await evaluate((next) => {
      window.previousTarget = window.telemetry;
      window.updateTarget(next);
    }, next);
    await page.waitForFunction(
      () =>
        window.telemetry !== window.previousTarget && window.telemetry?.isReady
    );
    console.log(
      'PACKED_TARGET_STATE',
      JSON.stringify({
        requested: next.instanceId,
        public: await evaluate(() => ({
          flags: window.telemetry.flags,
          error: window.telemetry.error?.message,
          ready: window.telemetry.isReady,
          markup: document.querySelector('main')?.textContent,
        })),
        definitions: requestUrls.slice(requestStart).map((url) => url.href),
        pageErrors,
        consoleErrors,
      })
    );
  };
  await target({
    instanceId: 'token-a',
    identity: 'private',
    groups: ['private'],
    claims: { role: 'private' },
    baseURI:
      baseURI +
      '?i=retired&u=private&userId=private&g=one&g=two&claim.role=private&keep=one&keep=two',
  });
  await page.locator('#flag-on').waitFor();
  await evaluate(() => window.telemetry.recordUsage('BeforeTarget'));
  await target({ instanceId: 'token-b' });
  await page.locator('#flag-on').waitFor({ state: 'detached' });
  await evaluate(() => window.telemetry.recordView('DuringTarget'));
  await target({ instanceId: 'token-a' });
  await page.locator('#flag-on').waitFor();
  assert.equal(
    telemetry.length,
    identityStart,
    'target transitions retain queued packets until explicit flush'
  );
  await evaluate(() => window.telemetry.flushTelemetry());
  assert.deepEqual(
    telemetry.slice(identityStart).map((packet) => packet.body),
    [
      {
        k: 'docusaurus-packed-host',
        e: 'Production',
        i: 'token-a',
        f: {
          flagOn: { enabled: [2] },
          flagOff: { disabled: [2] },
          BeforeTarget: { enabled: [0, 1] },
        },
      },
      {
        k: 'docusaurus-packed-host',
        e: 'Production',
        i: 'token-b',
        f: {
          flagOn: { disabled: [2] },
          flagOff: { disabled: [2] },
          DuringTarget: { enabled: [0, 0, 1] },
        },
      },
      {
        k: 'docusaurus-packed-host',
        e: 'Production',
        i: 'token-a',
        f: { flagOn: { enabled: [2] }, flagOff: { disabled: [2] } },
      },
    ]
  );
  await target({
    instanceId: undefined,
    identity: 'bob',
    groups: ['team'],
    claims: { role: 'reader' },
  });
  await evaluate(() => window.telemetry.flushTelemetry());
  assert.deepEqual(telemetry.at(-1).body, {
    k: 'docusaurus-packed-host',
    e: 'Production',
    u: 'bob',
    f: { flagOn: { enabled: [2] }, flagOff: { disabled: [2] } },
  });
  const transitionRequests = requestUrls
    .slice(requestStart)
    .filter((url) => url.pathname.includes('/evaluated-signed/'));
  // Each remounted page invokes the existing navbar client with the original
  // injected config, separately from the provider's explicitly targeted client.
  const navbarRequests = transitionRequests.filter((url) => url.search === '');
  const identityRequests = transitionRequests.filter(
    (url) => url.search !== ''
  );
  assert.equal(transitionRequests.length, 8);
  assert.equal(navbarRequests.length, 4);
  for (const url of navbarRequests)
    assert.equal(
      url.pathname,
      '/evaluated-signed/docusaurus-packed-host/Production'
    );
  assert.deepEqual(
    identityRequests.map((url) => url.searchParams.get('i')),
    ['token-a', 'token-b', 'token-a', null]
  );
  for (const url of identityRequests) {
    assert.equal(
      url.pathname,
      '/evaluated-signed/docusaurus-packed-host/Production'
    );
    assert.deepEqual(url.searchParams.getAll('keep'), ['one', 'two']);
    if (url.searchParams.has('i'))
      assert(
        [...url.searchParams.keys()].every((key) => ['keep', 'i'].includes(key))
      );
  }
  assert.equal(identityRequests.at(-1).searchParams.get('u'), 'bob');
  // App/transport replacement discards pending prior-owner events.
  const replacementStart = telemetry.length;
  await evaluate(() => window.telemetry.recordUsage('DiscardOnReplacement'));
  await target({ metricsBaseUrl: metricsBaseUrl + '/replacement' });
  await evaluate(() => {
    window.telemetry.recordUsage('CurrentOwner');
    return window.telemetry.flushTelemetry();
  });
  assert.equal(telemetry.length, replacementStart + 1);
  assert.equal(telemetry.at(-1).url, '/replacement/api/frontend/telemetry');
  assert.equal(telemetry.at(-1).body.f.DiscardOnReplacement, undefined);
  assert.deepEqual(telemetry.at(-1).body.f.CurrentOwner, { enabled: [0, 1] });
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await bounded(() => page.close(), 'Page close');
  console.log('PACKED_DOCUSAURUS_BROWSER_GATES_TELEMETRY_PASS');

  runtimeEnabled = true;
  corruptSignature = false;
  const beforeStaticBuild = requests.length;
  const telemetryBeforeStaticBuild = telemetry.length;
  await runAsync(cli, ['build', '--out-dir', 'build-static'], {
    PACKED_STATIC: '1',
  });
  assert.ok(
    requests
      .slice(beforeStaticBuild)
      .includes('/evaluated-signed/docusaurus-packed-host/Production')
  );
  assert.ok(requests.slice(beforeStaticBuild).includes('/.well-known/jwks'));
  assert.equal(
    telemetry.length,
    telemetryBeforeStaticBuild,
    'static build telemetry silent'
  );
  const staticOutput = join(host, 'build-static');
  const staticHtml = readFileSync(join(staticOutput, 'index.html'), 'utf8');
  assert.match(staticHtml, /id="flag-on"/);
  assert.doesNotMatch(staticHtml, /id="flag-off"/);
  assert.match(staticHtml, /id="off-fallback"/);
  assert.match(
    readFileSync(join(staticOutput, 'docs/enabled/index.html'), 'utf8'),
    /ENABLED_DOC_CONTENT/
  );
  assert.equal(
    readFileSync(join(staticOutput, 'docs/disabled/index.html'), 'utf8'),
    readFileSync(join(staticOutput, '404.html'), 'utf8')
  );
  const beforeStaticBrowser = requests.length;
  const staticPage = await bounded(
    () => browser.newPage(),
    'Browser page creation',
    15000
  );
  const evaluateStatic = (...args) =>
    bounded(
      () => staticPage.evaluate(...args),
      'Static browser evaluation',
      30000
    );
  staticPage.on('pageerror', (error) => pageErrors.push(error.message));
  staticPage.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const staticUrl = await serve(staticOutput);
  await staticPage.goto(staticUrl);
  await staticPage.locator('#ready').filter({ hasText: 'ready' }).waitFor();
  await staticPage.waitForLoadState('networkidle');
  assert.equal(await staticPage.locator('#flag-off').count(), 0);
  assert.equal(await staticPage.locator('#flag-on').count(), 1);
  assert.equal(
    requests.length,
    beforeStaticBrowser,
    'static gating does not fetch runtime flags'
  );
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await evaluateStatic(() => window.telemetry.flushTelemetry());
  assert.deepEqual(telemetry.at(-1).body.f, {
    flagOn: { enabled: [2] },
    flagOff: { disabled: [2] },
  });
  const staticFetches = requests.length;
  const staticTarget = async (instanceId) => {
    await evaluateStatic((instanceId) => {
      window.previousTarget = window.telemetry;
      window.updateTarget({ instanceId });
    }, instanceId);
    await staticPage.waitForFunction(
      () =>
        window.telemetry !== window.previousTarget && window.telemetry?.isReady
    );
  };
  await staticTarget('token-b');
  assert.equal(await staticPage.locator('#flag-on').count(), 0);
  await evaluateStatic(() => window.telemetry.flushTelemetry());
  assert.deepEqual(telemetry.at(-1).body, {
    k: 'docusaurus-packed-host',
    e: 'Production',
    i: 'token-b',
    f: { flagOn: { disabled: [2] }, flagOff: { disabled: [2] } },
  });
  await staticTarget(undefined);
  assert.equal(
    await staticPage.locator('#flag-on').count(),
    0,
    'original anonymous page snapshot cannot revive after target retirement'
  );
  await evaluateStatic(() => window.telemetry.flushTelemetry());
  assert.deepEqual(telemetry.at(-1).body, {
    k: 'docusaurus-packed-host',
    e: 'Production',
    f: { flagOn: { disabled: [2] }, flagOff: { disabled: [2] } },
  });
  assert.equal(
    requests.length,
    staticFetches,
    'static target transitions create no definitions or key fetch'
  );
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await bounded(() => staticPage.close(), 'Static page close');
  for (const [mode, url] of [
    ["runtime", runtimeUrl],
    ["static", staticUrl],
  ]) {
    const fallbackPage = await bounded(
      () => browser.newPage(),
      "Fallback page creation",
      15000,
    );
    const before = telemetry.length;
    const beforeRequests = requests.length;
    const errors = [];
    fallbackPage.on("pageerror", (error) => errors.push(error.message));
    fallbackPage.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await fallbackPage.goto(url + "/fallback/");
    await fallbackPage
      .locator("#fallback-configured")
      .filter({ hasText: "true" })
      .waitFor();
    const cases = [
      ["configured", undefined, true],
      ["explicitOff", false, false],
      ["explicitOn", true, true],
      ["flagOff", true, false],
      ["missing", undefined, false],
    ];
    for (const [key, , expected] of cases) {
      assert.equal(
        await fallbackPage.locator("#fallback-" + key).textContent(),
        String(expected),
        mode + " hook " + key,
      );
      assert.equal(
        await fallbackPage.locator("#feature-" + key).count(),
        1,
        mode + " Feature " + key,
      );
    }
    const direct = await bounded(
      () =>
        fallbackPage.evaluate(async (cases) => {
          const t = window.fallbackTelemetry;
          const results = cases.map(([key, fallback]) =>
            t.evaluateFlag(key, fallback),
          );
          await t.flushTelemetry();
          return results;
        }, cases),
      "Fallback evaluation",
      30000,
    );
    assert.deepEqual(
      direct,
      cases.map(([, , expected]) => expected),
    );
    assert.deepEqual(
      telemetry
        .slice(before)
        .filter((packet) => packet.body.i === "fallback-token")
        .map((packet) => packet.body),
      [
        {
          k: "docusaurus-packed-host",
          e: "Production",
          i: "fallback-token",
          f: {
            configured: { enabled: [3] },
            explicitOff: { disabled: [3] },
            explicitOn: { enabled: [3] },
            flagOff: { disabled: [3] },
            missing: { disabled: [3] },
          },
        },
      ],
    );
    if (mode === "static")
      assert.equal(
        requests.length,
        beforeRequests,
        "static fallback consumers do not fetch",
      );
    assert.deepEqual(errors, []);
    await bounded(() => fallbackPage.close(), "Fallback page close");
    console.log(
      "PACKED_DEFAULT_FALLBACK_PASS",
      mode,
      "five hook/Feature/direct results, 15 exact checks",
    );
  }
  console.log(
    `PACKED_DOCUSAURUS_HOST_PASS ${JSON.stringify({ docusaurus: currentDocusaurus, react: currentReact, node: process.version })}`
  );
});
