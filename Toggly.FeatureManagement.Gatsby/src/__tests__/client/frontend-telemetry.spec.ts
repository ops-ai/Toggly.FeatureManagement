import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type StoreModule = typeof import('../../client/store.js');

type TelemetryEnvelope = {
  k: string;
  e: string;
  f?: Record<string, Record<string, number[]>>;
  m?: Record<string, number>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function definitions(flags: Record<string, unknown>): Response {
  return new Response(JSON.stringify(flags), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function readEnvelope(init?: RequestInit): Promise<TelemetryEnvelope> {
  const body = init?.body;
  let bytes: Uint8Array;
  if (typeof body === 'string') {
    return JSON.parse(body) as TelemetryEnvelope;
  }
  if (body instanceof ArrayBuffer) {
    bytes = new Uint8Array(body);
  } else if (ArrayBuffer.isView(body)) {
    bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  } else {
    throw new Error(`Unsupported request body: ${String(body)}`);
  }
  return JSON.parse(gunzipSync(bytes).toString('utf8')) as TelemetryEnvelope;
}

describe('frontend telemetry store facade', () => {
  let store: StoreModule;
  let envelopes: TelemetryEnvelope[];

  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {
      // Suppress expected bounded diagnostics in transport mocks.
    });
    envelopes = [];
    store = await import('../../client/store.js');
  });

  afterEach(() => {
    store.disposeTogglyClient();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function installFetch(flags: Record<string, unknown>) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/frontend/telemetry')) {
        envelopes.push(await readEnvelope(init));
        expect(init?.credentials).toBe('omit');
        return new Response(null, { status: 202 });
      }
      return definitions(flags);
    });
  }

  async function initialize(
    flags: Record<string, unknown>,
    overrides: Partial<Parameters<StoreModule['initTogglyClient']>[0]> = {},
  ) {
    installFetch(flags);
    await store.initTogglyClient({
      appKey: 'app-key',
      environment: 'Staging',
      featureFlagsRefreshInterval: 0,
      enableLiveUpdates: false,
      metricsBaseUrl: 'https://collector.example/base',
      ...overrides,
    });
  }

  it('exposes explicit compact telemetry and disposal APIs', () => {
    expect(typeof store.recordUsage).toBe('function');
    expect(typeof store.recordView).toBe('function');
    expect(typeof store.incrementCounter).toBe('function');
    expect(typeof store.setGauge).toBe('function');
    expect(typeof store.flushTelemetry).toBe('function');
    expect(typeof store.disposeTogglyClient).toBe('function');
  });

  it('starts no work on import and does not share browser state across SSR module copies', async () => {
    store.disposeTogglyClient();
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.resetModules();
    const firstServerCopy = await import('../../client/store.js');
    firstServerCopy.$flags.set({ RequestOne: true });
    vi.resetModules();
    const secondServerCopy = await import('../../client/store.js');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(secondServerCopy.$flags.get()).toEqual({});
    store = secondServerCopy;
  });

  it('records effective evaluated leaves once and keeps explicit APIs evaluation-free', async () => {
    await initialize({ F1: true, F2: false });

    expect(store.$flag('F1').get()).toBe(true);
    expect(store.$gate(['F1', 'F2'], 'any').get()).toBe(true);
    store.recordUsage('F1', 'blue');
    store.recordView('F2', 'green');
    store.incrementCounter('checkout', 2);
    store.setGauge('cartValue', 19.5);
    await store.flushTelemetry();

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toEqual({
      k: 'app-key',
      e: 'Staging',
      f: {
        F1: { enabled: [2], blue: [0, 1] },
        F2: { green: [0, 0, 1] },
      },
      m: { checkout: 2, cartValue: 19.5 },
    });
    expect(JSON.stringify(envelopes[0])).not.toMatch(/identity|claims|groups|timestamp/i);
  });

  it('counts a cold subscribed evaluation once without counting hydration itself', async () => {
    const pending = deferred<Response>();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/frontend/telemetry')) {
        envelopes.push(await readEnvelope(init));
        return new Response(null, { status: 202 });
      }
      return pending.promise;
    });

    const flag = store.$flag('F1');
    const values: boolean[] = [];
    const unbind = flag.subscribe((value) => values.push(value));
    const init = store.initTogglyClient({
      appKey: 'cold-app',
      featureFlagsRefreshInterval: 0,
      enableLiveUpdates: false,
      metricsBaseUrl: 'https://collector.example',
    });

    expect(values).toEqual([false]);
    pending.resolve(definitions({ F1: true }));
    await init;
    await store.flushTelemetry();

    expect(values).toEqual([false, true]);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0].f).toEqual({ F1: { enabled: [1] } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    unbind();
  });

  it('records entity and local-gate effective outcomes before gate negation', async () => {
    const entityDefinition = {
      requirement: 'all',
      rules: [
        {
          property: 'BirthDate',
          op: 'gt',
          value: '2026-01-01',
          type: 'datetime',
        },
      ],
    };
    await initialize(
      { Remote: true, Entity: entityDefinition },
      {
        localGates: [{ id: 'blocked', flagKeys: ['Remote'], isEnabled: () => false }],
      },
    );

    expect(store.$flag('Remote').get()).toBe(false);
    expect(
      store.$gate(
        ['Entity'],
        'all',
        true,
        { kind: 'Account', key: '1', attributes: { BirthDate: '2026-06-15T00:00:00Z' } },
      ).get(),
    ).toBe(false);
    await store.flushTelemetry();

    expect(envelopes[0].f).toEqual({
      Remote: { disabled: [1] },
      Entity: { enabled: [1] },
    });
  });

  it('stays silent for keyless, opted-out, and SSR owners', async () => {
    const fetchSpy = installFetch({ F1: true });
    await store.initTogglyClient({ appKey: '', flagDefaults: { F1: true } });
    expect(store.$flag('F1').get()).toBe(true);
    store.recordUsage('F1');
    await store.flushTelemetry();
    expect(envelopes).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    store.disposeTogglyClient();
    await store.initTogglyClient({
      appKey: 'opt-out',
      enableTelemetry: false,
      featureFlagsRefreshInterval: 0,
      enableLiveUpdates: false,
    });
    expect(store.$flag('F1').get()).toBe(true);
    await store.flushTelemetry();
    expect(envelopes).toHaveLength(0);

    store.disposeTogglyClient();
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    await store.initTogglyClient({
      appKey: 'server-owner',
      flagDefaults: { F1: true },
      featureFlagsRefreshInterval: 0,
      enableLiveUpdates: false,
    });
    expect(store.$flag('F1').get()).toBe(true);
    await store.flushTelemetry();
    expect(envelopes).toHaveLength(0);
  });

  it('applies usage and metrics category opt-outs independently', async () => {
    await initialize(
      { F1: true },
      { enableUsageTracking: false, enableMetrics: true },
    );
    expect(store.$flag('F1').get()).toBe(true);
    store.recordUsage('F1');
    store.incrementCounter('orders');
    await store.flushTelemetry();
    expect(envelopes[0]).toMatchObject({ m: { orders: 1 } });
    expect(envelopes[0].f).toBeUndefined();

    store.disposeTogglyClient();
    envelopes.length = 0;
    await store.initTogglyClient({
      appKey: 'usage-only',
      enableUsageTracking: true,
      enableMetrics: false,
      featureFlagsRefreshInterval: 0,
      enableLiveUpdates: false,
      metricsBaseUrl: 'https://collector.example',
    });
    store.recordView('F2');
    store.setGauge('ignored', 3);
    await store.flushTelemetry();
    expect(envelopes[0].f).toEqual({ F2: { enabled: [0, 0, 1] } });
    expect(envelopes[0].m).toBeUndefined();
  });

  it('uses keepalive for pagehide and disposes with at most one final envelope', async () => {
    const requests: RequestInit[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/api/frontend/telemetry')) {
        requests.push(init ?? {});
        envelopes.push(await readEnvelope(init));
        return new Response(null, { status: 202 });
      }
      return definitions({ F1: true });
    });
    await store.initTogglyClient({
      appKey: 'lifecycle-app',
      featureFlagsRefreshInterval: 0,
      enableLiveUpdates: false,
      metricsBaseUrl: 'https://collector.example',
    });

    store.recordUsage('PageFeature');
    window.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(envelopes).toHaveLength(1));
    expect(requests[0].keepalive).toBe(true);

    store.recordView('DisposeFeature');
    store.disposeTogglyClient();
    store.disposeTogglyClient();
    await vi.waitFor(() => expect(envelopes).toHaveLength(2));
    expect(requests[1].keepalive).toBe(true);
    expect(envelopes[1].f).toEqual({ DisposeFeature: { enabled: [0, 0, 1] } });
  });

  it('isolates replacement owners and ignores delayed completion from the disposed owner', async () => {
    const oldFetch = deferred<Response>();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/frontend/telemetry')) {
        envelopes.push(await readEnvelope(init));
        return new Response(null, { status: 202 });
      }
      if (url.includes('/old-app/')) return oldFetch.promise;
      return definitions({ New: true });
    });

    const oldInit = store.initTogglyClient({
      appKey: 'old-app',
      environment: 'Old',
      featureFlagsRefreshInterval: 0,
      enableLiveUpdates: false,
      metricsBaseUrl: 'https://collector.example',
    });
    store.recordUsage('OldFeature');
    const newInit = store.initTogglyClient({
      appKey: 'new-app',
      environment: 'New',
      featureFlagsRefreshInterval: 0,
      enableLiveUpdates: false,
      metricsBaseUrl: 'https://collector.example',
    });
    await newInit;
    expect(store.$flags.get()).toEqual({ New: true });
    store.recordView('NewFeature');
    await store.flushTelemetry();

    oldFetch.resolve(definitions({ Old: true }));
    await oldInit;
    expect(store.$flags.get()).toEqual({ New: true });

    await vi.waitFor(() => expect(envelopes).toHaveLength(1));
    expect(envelopes.map(({ k, e, f }) => ({ k, e, f }))).toEqual([
      { k: 'new-app', e: 'New', f: { NewFeature: { enabled: [0, 0, 1] } } },
    ]);
  });

  it('does not count the replacement default snapshot as a subscribed evaluation', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/frontend/telemetry')) {
        envelopes.push(await readEnvelope(init));
        return new Response(null, { status: 202 });
      }
      return definitions({ F1: url.includes('/first-app/') });
    });
    await store.initTogglyClient({
      appKey: 'first-app',
      featureFlagsRefreshInterval: 0,
      enableLiveUpdates: false,
      metricsBaseUrl: 'https://collector.example',
    });
    const unbind = store.$flag('F1').subscribe(() => {
      // Keep the computed atom mounted across owner replacement.
    });
    await store.flushTelemetry();
    envelopes.length = 0;

    await store.initTogglyClient({
      appKey: 'second-app',
      featureFlagsRefreshInterval: 0,
      enableLiveUpdates: false,
      metricsBaseUrl: 'https://collector.example',
    });
    await store.flushTelemetry();

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      k: 'second-app',
      f: { F1: { disabled: [1] } },
    });
    unbind();
  });
});
