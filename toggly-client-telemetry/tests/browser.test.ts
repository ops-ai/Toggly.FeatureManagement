import { attachBrowserLifecycle } from '../src/browser';
import { createTelemetryReporter } from '../src/index';
function browser() {
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = new EventTarget();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  return { document, window };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); delete (globalThis as any).document; delete (globalThis as any).window; jest.restoreAllMocks(); });
test('hidden and pagehide flush uncompressed, then dispose automatically detaches', async () => {
  const { window, document } = browser();
  const reporter = createTelemetryReporter({ appKey: 'app', fetch: async () => ({ status: 202 }) });
  const flush = jest.spyOn(reporter, 'flush'); const detach = attachBrowserLifecycle(reporter);
  document.dispatchEvent(new Event('visibilitychange')); expect(flush).not.toHaveBeenCalled();
  document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide'));
  expect(flush).toHaveBeenCalledTimes(2); expect(flush).toHaveBeenCalledWith({ keepalive: true });
  reporter.dispose(); const count = flush.mock.calls.length;
  document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); expect(flush).toHaveBeenCalledTimes(count);
  detach(); detach(); await reporter.flush();
});
test('manual detach removes listeners and attaching twice does not count twice', () => {
  const { window } = browser(); const reporter = createTelemetryReporter({ appKey: 'app' }); const flush = jest.spyOn(reporter, 'flush');
  const one = attachBrowserLifecycle(reporter); const two = attachBrowserLifecycle(reporter);
  window.dispatchEvent(new Event('pagehide')); expect(flush).toHaveBeenCalledTimes(1);
  one(); two(); window.dispatchEvent(new Event('pagehide')); expect(flush).toHaveBeenCalledTimes(1); reporter.dispose();
});
test('no-key, opted-out, disposed and server owners never attach listeners', () => {
  const { window, document } = browser(); const windowAdd = jest.spyOn(window, 'addEventListener'); const documentAdd = jest.spyOn(document, 'addEventListener');
  for (const options of [{}, { appKey: 'app', enableTelemetry: false }]) { const r = createTelemetryReporter(options); attachBrowserLifecycle(r)(); r.dispose(); }
  const disposed = createTelemetryReporter({ appKey: 'app' }); disposed.dispose(); attachBrowserLifecycle(disposed)();
  expect(windowAdd).not.toHaveBeenCalled(); expect(documentAdd).not.toHaveBeenCalled();
  delete (globalThis as any).window; delete (globalThis as any).document;
  const r = createTelemetryReporter({ appKey: 'app' }); expect(() => attachBrowserLifecycle(r)()).not.toThrow(); r.dispose();
});
test('a stale detach cannot unregister a later attachment from disposal cleanup', () => {
  const { window } = browser(); const reporter = createTelemetryReporter({ appKey: 'app' }); const flush = jest.spyOn(reporter, 'flush');
  const old = attachBrowserLifecycle(reporter); old(); const current = attachBrowserLifecycle(reporter); old();
  // Reattachment must still reuse the active listener after an old detach.
  expect(attachBrowserLifecycle(reporter)).toBe(current);
  window.dispatchEvent(new Event('pagehide')); expect(flush).toHaveBeenCalledTimes(1); reporter.dispose();
});
