import type { TelemetryReporter } from './types.js';
import { lifecycleFor } from './lifecycle.js';
let attachments: WeakMap<TelemetryReporter, () => void> | undefined;
/** Attach optional browser lifecycle behavior; returns an idempotent detach. */
export function attachBrowserLifecycle(reporter: TelemetryReporter): () => void {
  const cleanups = lifecycleFor(reporter);
  if (!cleanups || typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const existing = attachments?.get(reporter);
  if (existing) return existing;
  const targetWindow = window; const targetDocument = document;
  const flush = (): void => { void reporter.flush({ keepalive: true }); };
  const hidden = (): void => { if (targetDocument.visibilityState === 'hidden') flush(); };
  targetWindow.addEventListener('pagehide', flush);
  targetDocument.addEventListener('visibilitychange', hidden);
  let detached = false;
  const detach = (): void => {
    if (detached) return;
    detached = true;
    targetWindow.removeEventListener('pagehide', flush);
    targetDocument.removeEventListener('visibilitychange', hidden);
    cleanups.delete(detach); attachments?.delete(reporter);
  };
  attachments ??= new WeakMap(); attachments.set(reporter, detach); cleanups.add(detach);
  return detach;
}
