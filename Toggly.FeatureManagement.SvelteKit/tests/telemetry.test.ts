import { afterEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createToggly } from '../src/index.js';

const snapshot = {
  definitions: {
    on: true,
    skipped: true,
    Order: {
      requirement: 'all' as const,
      rules: [{ property: 'Vip', op: 'eq', value: 'true', type: 'boolean' }],
    },
  },
  context: { identity: 'private-user', groups: ['private-group'] },
  expose: ['on', 'skipped', 'Order'],
};
function browser() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('CompressionStream', undefined);
  vi.stubGlobal('WebSocket', undefined);
  const requests: { url: string; init: RequestInit; body: any }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/frontend/telemetry')) {
        requests.push({ url, init: init!, body: JSON.parse(init!.body as string) });
        return new Response(null, { status: 202 });
      }
      return new Response(null, { status: 503 });
    }),
  );
  return { window, document, requests };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('counts effective leaves once before negation and keeps projections and explicit events separate', async () => {
  const { requests } = browser();
  const t = createToggly(snapshot, {
    appKey: 'frontend',
    environment: 'Test',
    metricsBaseUrl: 'https://collector.test/base',
    localGates: [{ id: 'local', flagKeys: ['on'], isEnabled: () => false }],
  });
  get(t);
  t.update(snapshot);
  t.notifyLocalGatesChanged();
  await t.flushTelemetry();
  expect(requests).toHaveLength(0);
  expect(t.gate(['on', 'skipped'], { negate: true })).toBe(true);
  expect(
    t.isEnabled('Order', { entity: { kind: 'Order', key: 'secret', attributes: { Vip: true } } }),
  ).toBe(true);
  expect(t.isEnabled('Order')).toBe(false);
  t.recordUsage('used', 'variant-a');
  t.recordView('used', 'variant-a');
  t.incrementCounter('orders', 2);
  t.setGauge('cart', 3.5);
  await t.flushTelemetry();
  expect(requests).toHaveLength(1);
  expect(requests[0].body).toEqual({
    k: 'frontend',
    e: 'Test',
    f: {
      on: { disabled: [1] },
      Order: { enabled: [1], disabled: [1] },
      used: { 'variant-a': [0, 1, 1] },
    },
    m: { cart: 3.5, orders: 2 },
  });
  expect(requests[0].url).toBe('https://collector.test/base/api/frontend/telemetry');
  expect(requests[0].init.credentials).toBe('omit');
  t.dispose();
});

it('retains queued metrics and one lifecycle attachment across route-driven transport reconnects', async () => {
  const { window, document, requests } = browser();
  const windowAdd = vi.spyOn(window, 'addEventListener');
  const documentAdd = vi.spyOn(document, 'addEventListener');
  const t = createToggly(snapshot, {
    appKey: 'layout',
    metricsBaseUrl: 'https://collector.test',
    refreshInterval: 0,
  });
  t.incrementCounter('pending');
  await t.start();
  await t.start();
  t.update({
    ...snapshot,
    context: { identity: 'bob' },
    definitions: { ...snapshot.definitions, on: false },
  });
  await t.start();
  t.incrementCounter('pending', 2);
  expect(t.isEnabled('on')).toBe(false);
  expect(requests).toHaveLength(0);
  expect(windowAdd).toHaveBeenCalledTimes(1);
  expect(documentAdd).toHaveBeenCalledTimes(1);
  await t.flushTelemetry();
  expect(requests[0].body.m.pending).toBe(3);
  expect(requests[0].body.f.on).toEqual({ disabled: [1] });
  t.dispose();
  t.recordUsage('after');
  t.update(snapshot);
  await t.start();
  await t.flushTelemetry();
  window.dispatchEvent(new Event('pagehide'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(requests).toHaveLength(1);
});

it('uses plain keepalive for hidden, pagehide and one synchronous final disposal', async () => {
  const { window, document, requests } = browser();
  const t = createToggly(snapshot, { appKey: 'browser', metricsBaseUrl: 'https://collector.test' });
  t.recordUsage('hidden');
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  await t.flushTelemetry();
  t.recordView('exit');
  window.dispatchEvent(new Event('pagehide'));
  await t.flushTelemetry();
  t.recordUsage('final');
  expect(t.dispose()).toBeUndefined();
  t.dispose();
  await vi.waitFor(() => expect(requests).toHaveLength(3));
  expect(
    requests.every(
      (r) =>
        r.init.keepalive === true &&
        !(r.init.headers as Record<string, string>)['Content-Encoding'],
    ),
  ).toBe(true);
  t.recordUsage('after');
  window.dispatchEvent(new Event('pagehide'));
  await t.flushTelemetry();
  expect(requests).toHaveLength(3);
});

it.each(['ssr', 'keyless', 'optout'])(
  'keeps %s evaluations, lifecycle and explicit telemetry silent',
  async (mode) => {
    vi.useFakeTimers();
    const { requests, window, document } = browser();
    const addWindow = vi.spyOn(window, 'addEventListener');
    const addDocument = vi.spyOn(document, 'addEventListener');
    if (mode === 'ssr') {
      vi.stubGlobal('window', undefined);
      vi.stubGlobal('document', undefined);
    }
    const t = createToggly(snapshot, {
      appKey: mode === 'keyless' ? undefined : 'test',
      enableTelemetry: mode !== 'optout',
    });
    expect(t.isEnabled('on')).toBe(true);
    t.recordUsage('on');
    t.recordView('on');
    t.incrementCounter('orders');
    t.setGauge('cart', 1);
    await t.flushTelemetry();
    t.dispose();
    await vi.runAllTimersAsync();
    expect(requests).toHaveLength(0);
    expect(addWindow).not.toHaveBeenCalled();
    expect(addDocument).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('snapshots owner configuration and never attributes an old value to a replacement app', async () => {
  const { requests } = browser();
  const options = { appKey: 'old', environment: 'Old', metricsBaseUrl: 'https://collector.test' };
  const old = createToggly(snapshot, options);
  options.appKey = 'new';
  options.environment = 'New';
  const next = createToggly({ ...snapshot, definitions: { on: false } }, options);
  expect(old.isEnabled('on')).toBe(true);
  expect(next.isEnabled('on')).toBe(false);
  await next.flushTelemetry();
  await old.flushTelemetry();
  expect(requests.map((r) => [r.body.k, r.body.e, r.body.f.on])).toEqual([
    ['new', 'New', { disabled: [1] }],
    ['old', 'Old', { enabled: [1] }],
  ]);
  old.dispose();
  next.dispose();
});

it('retires the reporter and refresh resources while a browser refresh is suspended', async () => {
  vi.useFakeTimers();
  const { requests, window, document } = browser();
  const removedWindow = vi.spyOn(window, 'removeEventListener');
  const removedDocument = vi.spyOn(document, 'removeEventListener');
  let release!: (value: Response) => void;
  let signal: AbortSignal | undefined;
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((input, init) => {
    if (String(input).includes('/api/frontend/telemetry')) return originalFetch(input, init);
    signal = init?.signal ?? undefined;
    return new Promise<Response>((resolve) => (release = resolve));
  });
  const closed = vi.fn();
  const connected = vi.fn();
  vi.stubGlobal(
    'WebSocket',
    class {
      close = closed;
      constructor() {
        connected();
      }
    },
  );
  const t = createToggly(
    { ...snapshot, source: 'defaults' },
    {
      appKey: 'retired',
      baseURI: 'https://definitions.test',
      metricsBaseUrl: 'https://collector.test',
      refreshInterval: 100,
    },
  );
  const publishes = vi.fn();
  const unsubscribe = t.subscribe(publishes);
  await t.start();
  await vi.advanceTimersByTimeAsync(1);
  expect(release).toBeTypeOf('function');
  t.recordUsage('final');
  t.dispose();
  expect(signal?.aborted).toBe(true);
  release(new Response(null, { status: 503 }));
  await vi.advanceTimersByTimeAsync(6000);
  expect(requests).toHaveLength(1);
  expect(requests[0].init.keepalive).toBe(true);
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  expect(connected).toHaveBeenCalledTimes(1);
  expect(closed).toHaveBeenCalledTimes(1);
  expect(publishes).toHaveBeenCalledTimes(1);
  expect(removedWindow).toHaveBeenCalledTimes(1);
  expect(removedDocument).toHaveBeenCalledTimes(1);
  await t.start();
  t.update(snapshot);
  t.isEnabled('on');
  window.dispatchEvent(new Event('pagehide'));
  await t.flushTelemetry();
  expect(requests).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
  unsubscribe();
});
