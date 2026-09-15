import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const sdkDirectory = dirname(packageDirectory);
const currentGatsby = '5.16.1';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? sdkDirectory,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      ...options.env,
    },
  });
}

function runAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? sdkDirectory,
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        ...options.env,
      },
      stdio: options.stdio ?? 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}`));
    });
  });
}

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
  run('mkdir', ['-p', join(host, 'src')]);
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
const config: TogglyPluginOptions = { appKey: 'packed-type-consumer', verifySignatures: true };
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

  await sdk.initTogglyClient(config);
  assert.equal(sdk.$flags.get().runtimeOn, true);
  assert.equal(sdk.$flags.get().runtimeOff, false);
  assert.equal(sdk.$gate(['runtimeOn', 'runtimeOff'], 'all').get(), false);
  assert.equal(sdk.$gate(['runtimeOn', 'runtimeOff'], 'any').get(), true);
  sdk.stopRefreshInterval();

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
  console.log('PACKED_GATSBY_RUNTIME_PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`,
  );
}

function verifyTarball(tarball) {
  const files = run('tar', ['-tzf', tarball]);
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

const temporary = mkdtempSync(join(tmpdir(), 'toggly-gatsby-packed-host-'));
const host = join(temporary, 'host');
let definitions;
let productionHost;
let serverEnabled = true;

try {
  const serverDefinitions = [
    { featureKey: 'serverOn', filters: [{ name: 'AlwaysOn', parameters: {} }] },
    { featureKey: 'serverOff', filters: [{ name: 'AlwaysOff', parameters: {} }] },
  ];
  const requests = [];
  definitions = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    requests.push(url.pathname);
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
      response.end(envelope({ runtimeOn: true, runtimeOff: false }));
      return;
    }
    response.writeHead(404).end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => definitions.listen(0, '127.0.0.1', resolve));
  const baseURI = `http://127.0.0.1:${definitions.address().port}`;

  run('npm', ['run', 'build']);
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temporary]))[0];
  const tarball = join(temporary, packed.filename);
  verifyTarball(tarball);

  run('mkdir', ['-p', host]);
  writeHost(host, baseURI);
  run(
    'npm',
    [
      'install',
      '--no-package-lock',
      `gatsby@${currentGatsby}`,
      'react@18.3.1',
      'react-dom@18.3.1',
      'typescript@5.9.3',
      '@types/react@18.3.28',
      tarball,
    ],
    { cwd: host },
  );
  assert.equal(
    run(process.execPath, ['-p', "require('gatsby/package.json').version"], { cwd: host }).trim(),
    currentGatsby,
  );
  // Match the SDK's compiler contract: skip dependency declaration internals,
  // while strict checks and negative assertions validate the packed public API.
  run(join(host, 'node_modules', '.bin', 'tsc'), [
    '--noEmit', '--strict', '--skipLibCheck', '--module', 'ESNext', '--moduleResolution', 'Bundler',
    '--target', 'ES2022', 'consumer.mts',
  ], { cwd: host, stdio: 'inherit' });
  await runAsync(process.execPath, ['consumer.mjs'], { cwd: host });
  await runAsync(join(host, 'node_modules', '.bin', 'gatsby'), ['build'], {
    cwd: host, env: { CI: 'true', GATSBY_TELEMETRY_DISABLED: '1' },
  });

  const pageFeatures = JSON.parse(run('cat', [join(host, 'public', 'toggly-page-features.json')]));
  const config = JSON.parse(run('cat', [join(host, 'public', 'toggly-config.json')]));
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
  ], { cwd: host, env: { ...process.env, CI: 'true', GATSBY_TELEMETRY_DISABLED: '1' }, stdio: 'inherit' });
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
  console.log('PACKED_GATSBY_PRODUCTION_SSR_PASS');
  assert.ok(requests.includes('/definitions-signed/gatsby-current-host/Production'));
  assert.ok(requests.includes('/evaluated-signed/gatsby-current-host/Production'));
  assert.ok(requests.includes('/.well-known/jwks'));
  console.log(`PACKED_GATSBY_HOST_PASS ${JSON.stringify({ gatsby: currentGatsby, node: process.version })}`);
} finally {
  if (productionHost?.pid && productionHost.exitCode === null && productionHost.signalCode === null) {
    const stopped = new Promise((resolve) => productionHost.once('close', resolve));
    productionHost.kill('SIGTERM');
    const forceStop = setTimeout(() => productionHost.kill('SIGKILL'), 5_000);
    try { await stopped; } finally { clearTimeout(forceStop); }
  }
  if (definitions) await new Promise((resolve) => definitions.close(resolve));
  rmSync(temporary, { recursive: true, force: true });
}
