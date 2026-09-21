import { createTelemetryReporter } from '@ops-ai/toggly-client-telemetry';
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser';
import type { BrowserSession } from './client.js';
import { writable } from 'svelte/store';
import { evaluateResolvedKeys, resolveEvaluatedDefinition } from '@ops-ai/toggly-hooks-types';
import { applyLocalGate, buildFlagGateIndex } from '@ops-ai/toggly-local-gates';
import {
  selectDefinitions,
  type BrowserOptions,
  type GateOptions,
  type TogglySnapshot,
} from './types.js';
export type * from './types.js';

/** A layout-owned store: synchronous SSR/hydration, no module-level identity or store. */
export function createToggly(initial: TogglySnapshot, options: BrowserOptions = {}) {
  // Configuration identity belongs to the layout owner, not mutable caller options.
  options = { ...options };
  const telemetry =
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    options.appKey &&
    options.enableTelemetry !== false
      ? createTelemetryReporter({
          appKey: options.appKey,
          environment: options.environment,
          enableTelemetry: options.enableTelemetry,
          metricsBaseUrl: options.metricsBaseUrl,
          telemetryFlushIntervalMs: options.telemetryFlushIntervalMs,
          onDiagnostic: options.onTelemetryDiagnostic,
        })
      : undefined;
  const detachTelemetry = telemetry ? attachBrowserLifecycle(telemetry) : undefined;
  const acceptSnapshot = (value: TogglySnapshot): TogglySnapshot => {
    const copy = structuredClone(value);
    // Server-produced metadata comes from the host trust boundary, but current
    // browser pins still constrain whether its signed values may seed the UI.
    if (
      copy.source === 'signed' &&
      options.allowedKeyIds?.length &&
      !options.allowedKeyIds.includes(copy.signingKey?.kid ?? '')
    ) {
      return {
        ...copy,
        definitions: {},
        source: 'defaults',
        signedTimestamp: undefined,
        signingKey: undefined,
      };
    }
    return copy;
  };
  let snapshot = acceptSnapshot(initial);
  const store = writable(snapshot);
  const localGates = options.localGates ?? [];
  const gateIndex = buildFlagGateIndex(localGates);
  let stop: (() => void) | undefined;
  let generation = 0;
  let disposed = false;
  let mounted = false;
  // Keep trust and failed-retirement state across route-driven connections in this layout.
  const session: BrowserSession = {
    timestamps: new Map(),
    keys: new Map(),
    persistence: new Map(),
  };
  const publish = (next: TogglySnapshot) => {
    snapshot = acceptSnapshot(next);
    store.set(snapshot);
  };
  const isEnabled = (key: string, gate: GateOptions = {}) => {
    const enabled = applyLocalGate(
      resolveEvaluatedDefinition(snapshot.definitions[key], gate.entity, gate.defaultValue),
      key,
      localGates,
      gateIndex,
    );
    telemetry?.recordCheck(key, enabled ? 'enabled' : 'disabled');
    return enabled;
  };
  const start = async (): Promise<void> => {
    if (disposed || typeof window === 'undefined') return;
    mounted = true;
    stop?.();
    const ownGeneration = ++generation;
    // Dynamic import keeps browser transports out of SSR execution and allows deterministic hydration.
    const { connectBrowser } = await import('./client.js');
    if (disposed || ownGeneration !== generation) return;
    stop = connectBrowser(
      snapshot,
      options,
      (definitions, verification) => {
        if (!disposed && ownGeneration === generation)
          publish({
            ...snapshot,
            ...verification,
            source: 'signed',
            definitions: selectDefinitions(definitions, snapshot.expose),
          });
      },
      session,
    );
  };
  return {
    subscribe: store.subscribe,
    /** Explicit usage/view events do not evaluate a feature. */
    recordUsage: (featureKey: string, variant?: string) =>
      telemetry?.recordUsage(featureKey, variant),
    recordView: (featureKey: string, variant?: string) =>
      telemetry?.recordView(featureKey, variant),
    incrementCounter: (metricKey: string, value?: number) =>
      telemetry?.incrementCounter(metricKey, value),
    setGauge: (metricKey: string, value: number) => telemetry?.setGauge(metricKey, value),
    /** Await the existing best-effort drain; lifecycle sends use plain keepalive. */
    flushTelemetry: (options?: { keepalive?: boolean }) =>
      telemetry?.flush(options) ?? Promise.resolve(),
    isEnabled,
    gate: (keys: string[], gate: GateOptions = {}) =>
      evaluateResolvedKeys(keys, gate.requirement ?? 'all', gate.negate ?? false, (key) =>
        isEnabled(key, gate),
      ),
    /** Call when a layout receives new server data after navigation/login; never retain the previous user's values. */
    update: (next: TogglySnapshot) => {
      if (disposed) return;
      generation++;
      stop?.();
      stop = undefined;
      publish(next);
      if (mounted) void start();
    },
    start,
    notifyLocalGatesChanged: () => store.set(snapshot),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      detachTelemetry?.();
      telemetry?.dispose();
      generation++;
      stop?.();
      stop = undefined;
    },
  };
}
export type TogglyStore = ReturnType<typeof createToggly>;
