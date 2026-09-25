import {MemoryStorage, TogglyService} from '@ops-ai/react-native-toggly-core';

const packets: Array<{url: string; headers: Record<string, string>; credentials?: string; body: any}> = [];
const defs = {
  DirectOn: true, DirectOff: false, SkippedOn: true, LocalOn: true,
  OrderGate: {requirement: 'all', rules: [{property: 'Total', op: 'gt', value: '10', type: 'number'}]},
};
let originalFetch: typeof fetch;
let originalCompression: unknown;

beforeEach(() => {
  packets.length = 0;
  originalFetch = globalThis.fetch;
  originalCompression = (globalThis as any).CompressionStream;
  (globalThis as any).CompressionStream = undefined;
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/frontend/telemetry')) {
      packets.push({url, headers: init?.headers as Record<string, string>, credentials: init?.credentials,
        body: JSON.parse(String(init?.body))});
      return {status: 202, ok: true, headers: {get: () => null}} as unknown as Response;
    }
    return {status: 200, ok: true, headers: {get: () => null}, text: async () => JSON.stringify({defs})} as unknown as Response;
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as any).CompressionStream = originalCompression;
});

const client = (options: ConstructorParameters<typeof TogglyService>[0] = {}) => new TogglyService({
  appKey: 'sample-key-a', environment: 'Acceptance', baseURI: 'http://127.0.0.1:8765',
  metricsBaseUrl: 'http://127.0.0.1:8765', storage: new MemoryStorage(), refreshInterval: 0,
  enableLiveUpdates: false, ...options,
});

test('public Core captures actual leaves and explicit metrics in one compact packet', async () => {
  const service = client({instanceId: 'sample-instance-a',
    localGates: [{id: 'device', flagKeys: ['LocalOn'], isEnabled: () => false}]});
  await service.init();
  expect(await service.isFeatureOn('DirectOn')).toBe(true);
  expect(await service.evaluateFeatureGate(['DirectOn', 'DirectOff'], 'all', true)).toBe(true);
  expect(await service.evaluateFeatureGate(['DirectOff', 'SkippedOn'], 'all')).toBe(false);
  expect(await service.isFeatureOn('LocalOn')).toBe(false);
  expect(await service.isFeatureOn('OrderGate', {kind: 'Order', key: 'sample-order', attributes: {Total: 20}})).toBe(true);
  service.recordUsage('DirectOn', 'sample');
  service.recordView('DirectOn', 'sample');
  service.incrementCounter('orders', 2);
  service.setGauge('cart', 3.5);
  await service.flushTelemetry();
  expect(packets).toHaveLength(1);
  expect(packets[0]).toEqual({
    url: 'http://127.0.0.1:8765/api/frontend/telemetry',
    headers: {'Content-Type': 'application/json'}, credentials: 'omit',
    body: {k: 'sample-key-a', e: 'Acceptance', i: 'sample-instance-a',
      f: {DirectOn: {enabled: [2], sample: [0, 1, 1]}, DirectOff: {disabled: [2]},
        LocalOn: {disabled: [1]}, OrderGate: {enabled: [1]}},
      m: {orders: 2, cart: 3.5}},
  });
  expect(JSON.stringify(packets[0])).not.toContain('sample-order');
  service.dispose();
});

test.each(['optout', 'keyless'])('%s stays silent after evaluation, explicit events, and disposal', async mode => {
  const service = client(mode === 'keyless' ? {appKey: undefined, featureDefaults: defs as any} : {enableTelemetry: false});
  await service.init();
  await service.isFeatureOn('DirectOn');
  service.recordUsage('DirectOn'); service.recordView('DirectOn');
  service.incrementCounter('orders'); service.setGauge('cart', 1);
  await service.flushTelemetry(); service.dispose();
  await Promise.resolve();
  expect(packets).toHaveLength(0);
});

test('context rotation and AppState flush keep batches separate; disposal is terminal', async () => {
  let state!: (value: 'active' | 'background' | 'inactive') => void;
  const remove = jest.fn();
  const service = client({identity: 'sample-user-a', appState: {
    getCurrentState: () => 'active',
    subscribe: listener => {state = listener; return remove;},
  }});
  await service.init();
  await service.isFeatureOn('DirectOn');
  state('background');
  await service.flushTelemetry();
  expect(packets).toHaveLength(1);
  expect(packets[0].body.u).toBe('sample-user-a');
  expect(packets[0].body.i).toBeUndefined();
  state('active');
  await service.setContext({identity: 'sample-user-b', instanceId: 'sample-instance-b'});
  await service.isFeatureOn('DirectOff');
  state('inactive');
  await service.flushTelemetry();
  expect(packets).toHaveLength(2);
  expect(packets[1].body.i).toBe('sample-instance-b');
  expect(packets[1].body.u).toBeUndefined();
  service.dispose();
  expect(remove).toHaveBeenCalledTimes(1);
  service.recordUsage('after-disposal');
  state('active');
  await service.flushTelemetry();
  expect(packets).toHaveLength(2);
});
