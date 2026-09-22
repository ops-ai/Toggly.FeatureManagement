import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'localStorage']) globalThis[key] = key === 'window' ? dom.window : dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const cjs = require('../dist/index.js');
const esm = await import('../dist/index.mjs');
const packets = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/api/frontend/telemetry')) {
    const bytes = Buffer.from(await new Response(init.body).arrayBuffer());
    packets.push(JSON.parse((new Headers(init.headers).get('content-encoding') === 'gzip' ? gunzipSync(bytes) : bytes).toString()));
    return new Response(null, { status: 202 });
  }
  return new Response(JSON.stringify({ On: true }));
};
const config = { appKey: 'compiled-provider', identity: 'alice', baseURI: 'https://definitions.invalid', metricsBaseUrl: 'https://collector.invalid', enableLiveUpdates: false, featureFlagsRefreshInterval: 0 };
const root = createRoot(document.body.appendChild(document.createElement('div')));
try {
  await React.act(async () => root.render(React.createElement(cjs.TogglyProvider, { config }, 'first')));
  cjs.incrementCounter('before-remount');
  await React.act(async () => root.render(React.createElement(esm.TogglyProvider, { config }, 'second')));
  assert.deepEqual(packets, [], 'old compiled Provider cleanup must not flush the successor owner');
  esm.incrementCounter('after-remount');
  await esm.flushTelemetry();
  assert.deepEqual(packets.map(packet => packet.m), [{ 'before-remount': 1, 'after-remount': 1 }]);
  esm.incrementCounter('final');
  await React.act(async () => root.unmount());
  assert.deepEqual(packets.map(packet => packet.m), [{ 'before-remount': 1, 'after-remount': 1 }, { final: 1 }]);
  assert.equal('retainProviderOwner' in cjs, false);
  assert.equal('retainProviderOwner' in require('../dist/client/store.js'), false);
  console.log('GATSBY_COMPILED_PROVIDER_OWNERSHIP_PASS CJS/ESM remount retains one owner; final teardown flushes');
} finally {
  await React.act(async () => root.unmount());
  cjs.disposeTogglyClient();
  dom.window.close();
}
