const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { gunzipSync } = require('node:zlib');
const { once } = require('node:events');
const { TogglyService } = require('@ops-ai/react-native-toggly-core');

async function main() {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
  const packets = [];
  const definitions = [];
  const owners = [];
  const server = createServer(async (request, response) => {
    if (request.method === 'GET') {
      const url = new URL(request.url, 'http://loopback.invalid');
      definitions.push({url, headers: request.headers});
      response.writeHead(200, {'Content-Type':'application/json', ETag: url.searchParams.get('i') ?? 'legacy'});
      response.end(JSON.stringify({on: url.searchParams.get('i') !== 'B'}));
      return;
    }
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
    assert.deepEqual(packets[0].body, { k: 'packed-native', e: 'Local', u: 'private-user', f: { on: { enabled: [1, 1, 1] } }, m: { orders: 2, cart: 4 } });
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
      assert.equal(packet.body.u, 'private-user'); assert.equal(packet.body.i, undefined);
    }
    for (const options of [{ enableTelemetry: false }, { appKey: undefined }]) {
      const silent = new TogglyService({ appKey: 'silence', metricsBaseUrl: base, ...options });
      silent.recordUsage('silent'); await silent.flushTelemetry(); silent.dispose();
    }
    assert.equal(packets.length, 3);
    for (const useSignedDefinitions of [false, true]) {
      const owner = new TogglyService({appKey:'context', environment:'Local', identity:'bob', instanceId:' A ',
        baseURI: base+'/defs?i=retired&i=older&userId=private&u=old&g=old&claim.role=private&keep=one&keep=two',
        metricsBaseUrl:base, refreshInterval:0, enableLiveUpdates:false, useSignedDefinitions});
      owners.push(owner);
      for (const [index,token] of ['A','B','A',''].entries()) {
        const result=index===0 ? await owner.init() : await owner.setContext({instanceId:token});
        assert.equal(result.flags.on,token!=='B');
        assert.equal(await owner.isFeatureOn('on'),token!=='B');
        owner.recordUsage('explicit'); await owner.flushTelemetry();
        const packet=packets.at(-1).body;
        assert.deepEqual(packet,{k:'context',e:'Local',...(token?{i:token}:{u:'bob'}),f:{on:{[token==='B'?'disabled':'enabled']:[1]},explicit:{enabled:[0,1]}}});
        const {url}=definitions.at(-1);
        assert.equal(url.pathname,'/native/defs/evaluated-signed/context/Local');
        assert.deepEqual(url.searchParams.getAll('keep'),['one','two']);
        assert.deepEqual(url.searchParams.getAll('i'),token?[token]:[]);
        if(token)for(const key of ['u','userId','g','claim.role'])assert.equal(url.searchParams.has(key),false);
        else assert.equal(url.searchParams.get('u'),'bob');
      }
      owner.dispose();
    }
    assert.equal(definitions.length,8); assert.equal(packets.length,11);
    console.log('Packed native context: eight exact i/u envelopes, A/B/A/clear results and inherited-query controls passed.');
    console.log('Packed native CJS transport: gzip, plain background/final, payload/privacy, opt-out and terminal disposal passed (3 local packets).');
  } finally {
    const errors=[];
    for(const owner of [client,...owners]) { try { owner?.dispose({flush:false}); } catch(error){errors.push(error)} }
    globalThis.CompressionStream = originalCompression;
    try { server.closeAllConnections(); } catch(error){errors.push(error)}
    try { await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())); } catch(error){errors.push(error)}
    if(errors.length)throw new AggregateError(errors,'Native collector cleanup failed');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
