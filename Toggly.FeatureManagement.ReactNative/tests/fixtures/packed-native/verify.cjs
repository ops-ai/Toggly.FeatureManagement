const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { gunzipSync } = require('node:zlib');
const { once } = require('node:events');
const { TogglyService } = require('@ops-ai/react-native-toggly-core');

async function main() {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
  const packets = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const payload = request.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes;
    packets.push({ body: JSON.parse(payload), headers: request.headers, url: request.url });
    response.writeHead(202); response.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/native`;
  let listener;
  let client;
  const originalCompression = globalThis.CompressionStream;
  try {
    client = new TogglyService({ appKey: 'packed-native', environment: 'Local', identity: 'private-user',
      metricsBaseUrl: base, featureDefaults: { on: true }, refreshInterval: 0, enableLiveUpdates: false,
      networkInfo: { getState: async () => ({ isConnected: false }), subscribe: () => () => {} },
      appState: { getCurrentState: () => 'active', subscribe: callback => { listener = callback; return () => {}; } },
    });
    await client.init();
    assert.equal(await client.isFeatureOn('on'), true);
    client.recordUsage('on'); client.recordView('on'); client.incrementCounter('orders', 2); client.setGauge('cart', 4);
    await client.flushTelemetry();
    assert.equal(packets.length, 1);
    assert.equal(packets[0].headers['content-encoding'], 'gzip');
    assert.deepEqual(packets[0].body, { k: 'packed-native', e: 'Local', f: { on: { enabled: [1, 1, 1] } }, m: { orders: 2, cart: 4 } });
    globalThis.CompressionStream = undefined;
    client.recordUsage('background'); listener('background'); await client.flushTelemetry();
    assert.equal(packets.length, 2); assert.equal(packets[1].headers['content-encoding'], undefined);
    client.recordView('final'); client.dispose(); client.dispose();
    for (let i = 0; i < 100 && packets.length < 3; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(packets.length, 3);
    client.recordUsage('after'); listener('active'); await client.init(); await client.flushTelemetry();
    assert.equal(packets.length, 3);
    for (const packet of packets) {
      assert.equal(packet.url, '/native/api/frontend/telemetry');
      for (const key of ['origin', 'authorization', 'cookie', 'x-toggly-identity']) assert.equal(packet.headers[key], undefined);
      assert.ok(!JSON.stringify(packet.body).includes('private-user'));
    }
    for (const options of [{ enableTelemetry: false }, { appKey: undefined }]) {
      const silent = new TogglyService({ appKey: 'silence', metricsBaseUrl: base, ...options });
      silent.recordUsage('silent'); await silent.flushTelemetry(); silent.dispose();
    }
    assert.equal(packets.length, 3);
    console.log('Packed native CJS transport: gzip, plain background/final, payload/privacy, opt-out and terminal disposal passed (3 local packets).');
  } finally {
    client?.dispose(); globalThis.CompressionStream = originalCompression;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
