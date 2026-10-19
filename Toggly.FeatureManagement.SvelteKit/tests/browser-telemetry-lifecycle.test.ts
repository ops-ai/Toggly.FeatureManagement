import { afterEach, expect, it, vi } from 'vitest';
import { createToggly } from '../src/index.js';
import { attachPersistenceSafeBrowserLifecycle } from '../src/browser-telemetry-lifecycle.js';
import { createTelemetryReporter } from '@ops-ai/toggly-client-telemetry';

const snapshot = {
  definitions: { on: true },
  context: { identity: 'alice' },
  expose: ['on'],
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('defers pagehide keepalive flush when persistence storage is configured', async () => {
  vi.useFakeTimers();
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
  await vi.advanceTimersByTimeAsync(0);
  expect(requests).toHaveLength(1);
  expect((requests[0] as RequestInit).keepalive).toBe(true);
  t.dispose();
});

it('defers hidden visibility keepalive flush', async () => {
  vi.useFakeTimers();
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  const reporter = createTelemetryReporter({ appKey: 'app' });
  const flush = vi.spyOn(reporter, 'flush');
  attachPersistenceSafeBrowserLifecycle(reporter);
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  expect(flush).not.toHaveBeenCalled();
  vi.advanceTimersByTime(0);
  expect(flush).toHaveBeenCalledWith({ keepalive: true });
  reporter.dispose({ flush: false });
});

it('attaches persistence-safe lifecycle only once per reporter', () => {
  vi.useFakeTimers();
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
  expect(flush).not.toHaveBeenCalled();
  vi.advanceTimersByTime(0);
  expect(flush).toHaveBeenCalledTimes(1);
  expect(flush).toHaveBeenCalledWith({ keepalive: true });
  one();
  window.dispatchEvent(new Event('pagehide'));
  vi.advanceTimersByTime(0);
  expect(flush).toHaveBeenCalledTimes(1);
  reporter.dispose({ flush: false });
});
