import type { TelemetryReporter } from '@ops-ai/toggly-client-telemetry';

let attachments: WeakMap<TelemetryReporter, () => void> | undefined;

export type PersistenceSafeLifecycleOptions = {
  /** Runs synchronously before keepalive flush so origin storage can commit first. */
  beforeExitFlush?: () => void;
};

/**
 * Persistence hosts flush exit telemetry synchronously in the pagehide/hidden handler.
 * Callers should persist signed envelopes in `beforeExitFlush` so keepalive fetch work
 * cannot starve synchronous `localStorage` writes (live-acceptance cold signed).
 */
export function attachPersistenceSafeBrowserLifecycle(
  reporter: TelemetryReporter,
  options: PersistenceSafeLifecycleOptions = {},
): () => void {
  const targetWindow = globalThis.window;
  const targetDocument = globalThis.document;
  if (!targetWindow || !targetDocument) return () => {};
  const existing = attachments?.get(reporter);
  if (existing) return existing;
  const exitFlush = (): void => {
    options.beforeExitFlush?.();
    void reporter.flush({ keepalive: true });
  };
  const hidden = (): void => {
    if (targetDocument.visibilityState === 'hidden') exitFlush();
  };
  targetWindow.addEventListener('pagehide', exitFlush);
  targetDocument.addEventListener('visibilitychange', hidden);
  let detached = false;
  const detach = (): void => {
    if (detached) return;
    detached = true;
    targetWindow.removeEventListener('pagehide', exitFlush);
    targetDocument.removeEventListener('visibilitychange', hidden);
    attachments?.delete(reporter);
  };
  attachments ??= new WeakMap();
  attachments.set(reporter, detach);
  return detach;
}
