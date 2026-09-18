import type { TelemetryReporter } from './types.js';
// Allocated on first owner registration, never at module import time.
let owners: WeakMap<TelemetryReporter, Set<() => void>> | undefined;
export function registerOwner(reporter: TelemetryReporter): Set<() => void> {
  owners ??= new WeakMap();
  const cleanup = new Set<() => void>(); owners.set(reporter, cleanup); return cleanup;
}
export function lifecycleFor(reporter: TelemetryReporter): Set<() => void> | undefined { return owners?.get(reporter); }
export function removeOwner(reporter: TelemetryReporter): void { owners?.delete(reporter); }
