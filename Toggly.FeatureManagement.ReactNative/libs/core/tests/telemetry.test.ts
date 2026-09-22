import { TogglyService } from '../src/services/TogglyService';
import type { AppStateType, TogglyConfig } from '../src/models/types';
function client(options: TogglyConfig = {}) {
  return new TogglyService({ appKey: 'native-key', environment: 'Fixture', metricsBaseUrl: 'https://collector.test/base', featureDefaults: { on: true, off: false, skipped: true }, refreshInterval: 0, ...options } as TogglyConfig) as TogglyService & {
    recordUsage(key: string, variant?: string): void; recordView(key: string, variant?: string): void;
    incrementCounter(key: string, value?: number): void; setGauge(key: string, value: number): void; flushTelemetry(): Promise<void>;
  };
}
const packets: { body: any; options: RequestInit; url: string }[] = [];
beforeEach(() => {
  packets.length = 0;
  Object.defineProperty(globalThis, 'CompressionStream', { value: undefined, configurable: true });
  (fetch as jest.Mock).mockImplementation(async (url: string, options: RequestInit) => {
    if (url.includes('/api/frontend/telemetry')) {
      packets.push({ body: JSON.parse(options.body as string), options, url });
      return { status: 202, headers: { get: () => null } };
    }
    return { ok: false, status: 503 };
  });
});
it('records effective native leaves once, preserves short circuit and keeps projections silent', async () => {
  const t = client({ localGates: [{ id: 'device', flagKeys: ['on'], isEnabled: () => false }] });
  await t.init(); t.currentFeatures; t.notifyLocalGatesChanged(); await t.flushTelemetry();
  expect(packets).toHaveLength(0);
  expect(await t.evaluateFeatureGate(['on', 'skipped'], 'all', true)).toBe(true);
  expect(await t.isFeatureOff('off')).toBe(true);
  t.recordUsage('checkout', 'variant-a'); t.recordView('checkout', 'variant-a'); t.incrementCounter('orders', 2); t.setGauge('cart', 3.5);
  await t.flushTelemetry();
  expect(t.currentIdentity).toEqual(expect.any(String));
  expect(packets[0].body).toEqual({ k: 'native-key', e: 'Fixture', u: t.currentIdentity, f: { on: { disabled: [1] }, off: { disabled: [1] }, checkout: { 'variant-a': [0, 1, 1] } }, m: { orders: 2, cart: 3.5 } });
  expect(packets[0].url).toBe('https://collector.test/base/api/frontend/telemetry');
  expect(packets[0].options.credentials).toBe('omit');
  expect(packets[0].options.headers).toEqual({ 'Content-Type': 'application/json' }); t.dispose();
});
it.each(['keyless', 'optout'])('keeps %s collection and transport silent', async mode => {
  const t = client(mode === 'keyless' ? { appKey: undefined } : { enableTelemetry: false } as TogglyConfig);
  await t.init(); expect(await t.isFeatureOn('on')).toBe(true);
  t.recordUsage('on'); t.recordView('on'); t.incrementCounter('orders'); t.setGauge('cart', 2); await t.flushTelemetry(); t.dispose();
  expect(packets).toHaveLength(0);
});
it('flushes on background and disposes its reporter once without browser globals', async () => {
  let state!: (value: AppStateType) => void;
  const remove = jest.fn();
  const t = client({ appState: { getCurrentState: () => 'active', subscribe: listener => { state = listener; return remove; } } });
  await t.init(); t.recordUsage('background'); state('background'); await t.flushTelemetry();
  expect(packets).toHaveLength(1);
  t.recordView('final'); expect(t.dispose()).toBeUndefined(); t.dispose();
  await Promise.resolve(); await Promise.resolve();
  expect(packets).toHaveLength(2); expect(remove).toHaveBeenCalledTimes(1);
  t.recordUsage('after'); state('active'); await t.init(); await t.flushTelemetry(); expect(packets).toHaveLength(2);
});
it('never resumes initialization resources or writes after delayed storage returns to a disposed owner', async () => {
  let release!: (value: string | null) => void;
  const set = jest.fn().mockResolvedValue(undefined);
  const t = client({ storage: { get: jest.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(null), set, delete: jest.fn() }, enableLiveUpdates: true });
  const initialized = jest.fn(); t.on('initialized', initialized);
  const pending = t.init(); t.dispose(); release(null); await pending;
  expect(set).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(initialized).not.toHaveBeenCalled(); expect(t.initialized).toBe(false);
});
it('aborts refresh and ignores a late response after terminal disposal', async () => {
  let release!: (value: unknown) => void; let signal!: AbortSignal;
  (fetch as jest.Mock).mockImplementation((_url, options) => { signal = options.signal; return new Promise(resolve => { release = resolve; }); });
  const t = client({ identity: 'alice' });
  const changed = jest.fn(); t.on('refreshed', changed); const pending = t.init();
  for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
  expect(release).toBeDefined(); t.dispose(); expect(signal.aborted).toBe(true);
  release({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ on: false }) });
  await pending; expect(t.currentFeatures).toBeNull(); expect(changed).not.toHaveBeenCalled();
  await t.init(); expect(fetch).toHaveBeenCalledTimes(1);
});

it('counts missing evaluated leaves with an empty snapshot and keeps empty gates silent', async () => {
  const t = client({ featureDefaults: {} });
  await t.init();
  expect(await t.isFeatureOn('missing')).toBe(false);
  expect(await t.evaluateFeatureGate(['a', 'b'], 'any')).toBe(false);
  expect(await t.evaluateFeatureGate([])).toBe(true);
  await t.flushTelemetry();
  expect(packets[0].body.f).toEqual({ missing: { disabled: [1] }, a: { disabled: [1] }, b: { disabled: [1] } });
  t.dispose();
});

it('records the effective entity result and contains malformed optional telemetry values', async () => {
  const t = client({ featureDefaults: { order: { requirement: 'all', rules: [{ property: 'Total', op: 'gt', value: 10, type: 'number' }] } } as any });
  await t.init();
  const enabled = await t.isFeatureOn('order', { kind: 'Order', key: 'secret', attributes: { Total: 20 } });
  const disabled = await t.isFeatureOn('order');
  t.recordUsage('order', 'invalid\n'); t.recordView('order', {} as string); t.incrementCounter('bad', NaN);
  await t.flushTelemetry();
  expect(enabled).toBe(true); expect(disabled).toBe(false);
  expect(packets[0].body.f.order).toEqual({ enabled: [1], disabled: [1] });
  expect(JSON.stringify(packets[0].body)).not.toContain('secret');
  t.dispose();
});

it('does not revive identity state after a delayed device ID read on a retired owner', async () => {
  let release!: (value: string | null) => void;
  const get = jest.fn().mockResolvedValue(null); const set = jest.fn();
  const t = client({ identity: 'old', storage: { get, set, delete: jest.fn() } });
  await t.init(); get.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = t.setIdentity(null);
  for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
  t.dispose(); set.mockClear(); release('late'); await pending;
  expect(t.currentIdentity).toBe('old'); expect(set).not.toHaveBeenCalled();
});

it('does not start a JWKS request after disposal during its storage read', async () => {
  let release!: (value: string | null) => void;
  const get = jest.fn(async (key: string) => key.includes('jwks') ? new Promise<string | null>(resolve => { release = resolve; }) : null);
  const t = client({ identity: 'local', verifySignatures: true, storage: { get, set: jest.fn(), delete: jest.fn() } });
  (fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ defs: { on: true }, signature: 'signature', timestamp: 1, kid: 'key' }) });
  const pending = t.init();
  for (let i = 0; i < 40 && !release; i++) await Promise.resolve();
  expect(release).toBeDefined(); t.dispose(); release(null); await pending;
  expect(fetch).toHaveBeenCalledTimes(1); expect(t.initialized).toBe(false);
});

const contract = require('../../../../tests/frontend-telemetry/contract.json');
it.each(contract.endpointScenarios)('uses shared endpoint policy: $name', async ({ metricsBaseUrl, expectedUrl }) => {
  const t = client({ metricsBaseUrl });
  t.recordUsage('endpoint'); await t.flushTelemetry();
  expect(packets.map(packet => packet.url)).toEqual(expectedUrl ? [expectedUrl] : []);
  t.dispose();
});
it('forwards all shared explicit-event variant cases without coercion', async () => {
  const scenario = contract.scenarios.find((item: any) => item.name === 'invalid-variants-preserve-valid-queue');
  const t = client({ appKey: 'test-app', environment: 'Production' });
  for (const [method, key, variant] of scenario.events) {
    // The native evaluator exposes booleans, so assigned check variants are not an API here.
    if (method === 'recordUsage') t.recordUsage(key, variant);
    if (method === 'recordView') t.recordView(key, variant);
  }
  await t.flushTelemetry();
  const expected = JSON.parse(JSON.stringify(scenario.envelopes));
  for (const envelope of expected) for (const variants of Object.values(envelope.f) as any[]) {
    for (const counts of Object.values(variants) as number[][]) counts[0] = 0;
  }
  expect(packets.map(packet => packet.body)).toEqual(expected);
  t.dispose();
});

it('ignores retained WebSocket callbacks after retirement without recreating timers', async () => {
  jest.useFakeTimers();
  const previous = globalThis.WebSocket;
  const sockets: any[] = [];
  class Socket {
    onopen?: () => void; onmessage?: (event: any) => void; onclose?: () => void;
    close = jest.fn();
    constructor() { sockets.push(this); }
  }
  globalThis.WebSocket = Socket as any;
  const t = client({ identity: 'local', enableLiveUpdates: true });
  try {
    await t.init(); expect(sockets).toHaveLength(1);
    const { onopen, onmessage, onclose } = sockets[0];
    t.dispose(); expect(jest.getTimerCount()).toBe(0);
    onopen(); onmessage({ data: 'flags-updated' }); onclose();
    expect(jest.getTimerCount()).toBe(0);
    expect(t.initialized).toBe(false);
  } finally { t.dispose(); globalThis.WebSocket = previous; jest.useRealTimers(); }
});
