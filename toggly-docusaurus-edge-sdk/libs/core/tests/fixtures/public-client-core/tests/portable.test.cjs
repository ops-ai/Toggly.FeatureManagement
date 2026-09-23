const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTogglyClient } = require('@ops-ai/toggly-client-core');

test('portable root import does not start frontend telemetry in Node', async () => {
  const packets = [];
  const client = createTogglyClient({
    appKey: 'placeholder-core-key',
    flagDefaults: { On: true },
    fetch: async () => new Response(JSON.stringify({ On: true })),
    telemetryFetch: async (...args) => { packets.push(args); return new Response('', { status: 202 }); },
  });
  assert.equal(await client.getFlag('On'), true);
  client.recordUsage('On');
  await client.flushTelemetry();
  client.dispose();
  assert.equal(packets.length, 0);
});
