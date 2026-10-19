import { afterEach, expect, it, vi } from 'vitest';
import { createToggly } from '../src/index.js';
import { attachPersistenceSafeBrowserLifecycle } from '../src/browser-telemetry-lifecycle.js';
import { createTelemetryReporter } from '@ops-ai/toggly-client-telemetry';
import { envelope, jwk } from './signing.js';

const snapshot = {
  definitions: { on: true },
  context: { identity: 'alice' },
  expose: ['on'],
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('flushes pagehide telemetry when storage is configured before start()', async () => {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('CompressionStream', undefined);
  const requests: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(init);
      return new Response(null, { status: 202 });
    }),
  );
  const t = createToggly(snapshot, {
    appKey: 'layout',
    metricsBaseUrl: 'https://collector.test',
    storage: { getItem: () => null, setItem: () => {} },
  });
  t.recordUsage('new-dashboard', 'enabled');
  window.dispatchEvent(new Event('pagehide'));
  await Promise.resolve();
  expect(requests).toHaveLength(1);
  t.dispose();
});

it('starts pagehide keepalive flush synchronously when persistence storage is configured', async () => {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('CompressionStream', undefined);
  const requests: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(init);
      return new Response(null, { status: 202 });
    }),
  );
  const storage = {
    getItem: () => null,
    setItem: () => {},
  };
  const t = createToggly(snapshot, {
    appKey: 'layout',
    metricsBaseUrl: 'https://collector.test',
    storage,
  });
  t.recordUsage('new-dashboard', 'enabled');
  window.dispatchEvent(new Event('pagehide'));
  expect(requests).toHaveLength(0);
  await Promise.resolve();
  expect(requests).toHaveLength(1);
  expect((requests[0] as RequestInit).keepalive).toBe(true);
  t.dispose();
});

it('commits persistence before keepalive fetch when storage is configured', async () => {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('CompressionStream', undefined);
  vi.stubGlobal('WebSocket', undefined);
  const order: string[] = [];
  const records = new Map<string, string>();
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value);
      order.push('storage');
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/frontend/telemetry')) {
        order.push('fetch');
        return new Response(null, { status: 202 });
      }
      if (String(url).endsWith('/.well-known/jwks')) {
        return new Response(JSON.stringify({ keys: [jwk] }));
      }
      return new Response(envelope({ on: true }), { status: 200, headers: { ETag: 'r1' } });
    }),
  );
  const t = createToggly(snapshot, {
    appKey: 'layout',
    baseURI: 'https://definitions.toggly.io',
    metricsBaseUrl: 'https://collector.test',
    storage,
    refreshInterval: 0,
    enableLiveUpdates: false,
  });
  await t.start();
  await vi.waitFor(() =>
    expect(order.filter((step) => step === 'storage').length).toBeGreaterThan(0),
  );
  order.length = 0;
  t.recordUsage('new-dashboard', 'enabled');
  window.dispatchEvent(new Event('pagehide'));
  await Promise.resolve();
  expect(order.filter((step) => step === 'storage').length).toBeGreaterThan(0);
  expect(order.indexOf('fetch')).toBeGreaterThan(order.indexOf('storage'));
  t.dispose();
});

it('flushes hidden visibility keepalive synchronously', async () => {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  const reporter = createTelemetryReporter({ appKey: 'app' });
  const flush = vi.spyOn(reporter, 'flush');
  attachPersistenceSafeBrowserLifecycle(reporter);
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  expect(flush).toHaveBeenCalledWith({ keepalive: true });
  reporter.dispose({ flush: false });
});

it('runs beforeExitFlush synchronously before keepalive flush', () => {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  const reporter = createTelemetryReporter({ appKey: 'app' });
  const flush = vi.spyOn(reporter, 'flush');
  const order: string[] = [];
  attachPersistenceSafeBrowserLifecycle(reporter, {
    beforeExitFlush: () => order.push('persist'),
  });
  window.dispatchEvent(new Event('pagehide'));
  expect(order).toEqual(['persist']);
  expect(flush).toHaveBeenCalledWith({ keepalive: true });
  reporter.dispose({ flush: false });
});

it('does not defer exit flush with timers', () => {
  vi.useFakeTimers();
  const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  const reporter = createTelemetryReporter({ appKey: 'app' });
  const flush = vi.spyOn(reporter, 'flush');
  attachPersistenceSafeBrowserLifecycle(reporter);
  window.dispatchEvent(new Event('pagehide'));
  expect(flush).toHaveBeenCalledWith({ keepalive: true });
  expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 0)).toBe(false);
  reporter.dispose({ flush: false });
});

it('attaches persistence-safe lifecycle only once per reporter', () => {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  const reporter = createTelemetryReporter({ appKey: 'app' });
  const flush = vi.spyOn(reporter, 'flush');
  const one = attachPersistenceSafeBrowserLifecycle(reporter);
  const two = attachPersistenceSafeBrowserLifecycle(reporter);
  expect(one).toBe(two);
  window.dispatchEvent(new Event('pagehide'));
  expect(flush).toHaveBeenCalledTimes(1);
  expect(flush).toHaveBeenCalledWith({ keepalive: true });
  one();
  window.dispatchEvent(new Event('pagehide'));
  expect(flush).toHaveBeenCalledTimes(1);
  reporter.dispose({ flush: false });
});
