// Executed inside each isolated, installed storage consumer, with its real Core dependency.
module.exports = function verifyTelemetry(createStorage) {
  test('inherits one portable Core reporter without persisting telemetry', async () => {
    const { TogglyService } = require('@ops-ai/react-native-toggly-core');
    const packets = [];
    const priorFetch = globalThis.fetch;
    const priorCompression = globalThis.CompressionStream;
    globalThis.CompressionStream = undefined;
    globalThis.fetch = jest.fn(async (url, options) => {
      if (url.endsWith('/api/frontend/telemetry')) {
        packets.push({ url, options, body: JSON.parse(options.body) });
        return { status: 202, headers: { get: () => null } };
      }
      return { ok: false, status: 503 };
    });
    const storage = createStorage();
    const save = jest.spyOn(storage, 'set');
    const client = new TogglyService({
      appKey: 'packed-native', environment: 'Test', identity: 'not-in-telemetry',
      metricsBaseUrl: 'https://collector.invalid', featureDefaults: { on: true },
      storage, refreshInterval: 0, enableLiveUpdates: false,
    });
    try {
      await client.init(); save.mockClear();
      expect(await client.isFeatureOn('on')).toBe(true);
      client.recordUsage('on'); client.recordView('on'); client.incrementCounter('orders');
      await client.flushTelemetry();
      expect(packets).toHaveLength(1);
      expect(packets[0].body).toEqual({ k: 'packed-native', e: 'Test', f: { on: { enabled: [1, 1, 1] } }, m: { orders: 1 } });
      expect(packets[0].options.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(packets[0].options.credentials).toBe('omit');
      expect(save).not.toHaveBeenCalled();
      client.dispose(); client.recordUsage('after'); await client.flushTelemetry();
      expect(packets).toHaveLength(1);
    } finally {
      client.dispose(); globalThis.fetch = priorFetch; globalThis.CompressionStream = priorCompression;
    }
  });
};
