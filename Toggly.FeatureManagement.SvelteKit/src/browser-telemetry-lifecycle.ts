import type { TelemetryReporter } from '@ops-ai/toggly-client-telemetry';

let attachments: WeakMap<TelemetryReporter, () => void> | undefined;

/**
 * Persistence hosts defer exit flushes so synchronous `localStorage` writes are not
 * starved by an immediate keepalive fetch during `pagehide` (live-acceptance cold signed).
 */
export function attachPersistenceSafeBrowserLifecycle(reporter: TelemetryReporter): () => void {
  const targetWindow = globalThis.window;
  const targetDocument = globalThis.document;
  if (!targetWindow || !targetDocument) return () => {};
  const existing = attachments?.get(reporter);
  if (existing) return existing;
  const scheduleExitFlush = (): void => {
    setTimeout(() => {
      void reporter.flush({ keepalive: true });
    }, 0);
  };
  const hidden = (): void => {
    if (targetDocument.visibilityState === 'hidden') scheduleExitFlush();
  };
  targetWindow.addEventListener('pagehide', scheduleExitFlush);
  targetDocument.addEventListener('visibilitychange', hidden);
  let detached = false;
  const detach = (): void => {
    if (detached) return;
    detached = true;
    targetWindow.removeEventListener('pagehide', scheduleExitFlush);
    targetDocument.removeEventListener('visibilitychange', hidden);
    attachments?.delete(reporter);
  };
  attachments ??= new WeakMap();
  attachments.set(reporter, detach);
  return detach;
}
