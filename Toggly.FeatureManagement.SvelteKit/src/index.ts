import { createTelemetryReporter } from '@ops-ai/toggly-client-telemetry';
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser';
import type { BrowserSession } from './client.js';
import { writable } from 'svelte/store';
import { evaluateResolvedKeys, resolveEvaluatedDefinition } from '@ops-ai/toggly-hooks-types';
import { applyLocalGate, buildFlagGateIndex } from '@ops-ai/toggly-local-gates';
import {
  selectDefinitions,
  selectVariantDefs,
  type BrowserOptions,
  type GateOptions,
  type TogglySnapshot,
  type VariantResult,
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
          instanceId: (initial.context.instanceId ?? options.instanceId)?.trim() || undefined,
          identity: initial.context.identity,
          enableTelemetry: options.enableTelemetry,
          metricsBaseUrl: options.metricsBaseUrl,
          telemetryFlushIntervalMs: options.telemetryFlushIntervalMs,
          onDiagnostic: options.onTelemetryDiagnostic,
        })
      : undefined;
  const detachTelemetry = telemetry ? attachBrowserLifecycle(telemetry) : undefined;
  const acceptSnapshot = (value: TogglySnapshot): TogglySnapshot => {
    const copy = structuredClone(value);
    copy.context.instanceId = copy.context.instanceId?.trim() || undefined;
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
        variants: undefined,
        source: 'defaults',
        signedTimestamp: undefined,
        signingKey: undefined,
      };
    }
    return copy;
  };
  let snapshot = acceptSnapshot({
    ...initial,
    context: { ...initial.context, instanceId: initial.context.instanceId ?? options.instanceId },
  });
  const store = writable(snapshot);
  const localGates = options.localGates ?? [];
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
    telemetry?.setContext({
      instanceId: snapshot.context.instanceId,
      identity: snapshot.context.identity,
    });
    store.set(snapshot);
  };
  const captureEvaluation = (gate: GateOptions) => {
    const record = telemetry?.captureCheck();
    const definitions = structuredClone(snapshot.definitions);
    const defaultValue = gate.defaultValue;
    const gates = localGates.map((local) => ({ ...local, flagKeys: [...local.flagKeys] }));
    const index = buildFlagGateIndex(gates);
    // Attribute values retain the evaluator's existing conversion semantics;
    // unlike signed definitions they may include non-cloneable application values.
    const entity = gate.entity
      ? { ...gate.entity, attributes: { ...gate.entity.attributes } }
      : undefined;
    return (key: string) => {
      const enabled = applyLocalGate(
        resolveEvaluatedDefinition(definitions[key], entity, defaultValue),
        key,
        gates,
        index,
      );
      record?.(key, enabled ? 'enabled' : 'disabled');
      return enabled;
    };
  };
  const isEnabled = (key: string, gate: GateOptions = {}) => captureEvaluation(gate)(key);
  /**
   * Current variant assignment for a feature (requires {@link BrowserOptions.enableVariants}).
   * Returns null when variants are disabled, the flag is off, or no variant name was assigned.
   */
  const getVariant = (featureKey: string): VariantResult | null => {
    if (!options.enableVariants) return null;
    const record = telemetry?.captureCheck();
    const entry = snapshot.variants?.[featureKey];
    const variantName = entry?.variant || 'enabled';
    const gates = localGates.map((local) => ({ ...local, flagKeys: [...local.flagKeys] }));
    const index = buildFlagGateIndex(gates);
    const enabled = applyLocalGate(entry?.enabled === true, featureKey, gates, index);
    record?.(featureKey, enabled ? variantName : 'disabled');
    if (!enabled || !entry?.variant) return null;
    return { name: entry.variant, configurationValue: entry.configurationValue };
  };
  /** Configuration payload for the assigned variant, if any. */
  const getVariantValue = (featureKey: string): unknown | null =>
    getVariant(featureKey)?.configurationValue ?? null;
  const start = async (): Promise<void> => {
    if (disposed || typeof window === 'undefined') return;
    mounted = true;
    stop?.();
    const ownGeneration = ++generation;
    // Dynamic import keeps browser transports out of SSR execution and allows deterministic hydration.
    const { connectBrowser } = await import('./client.js');
    if (disposed || ownGeneration !== generation) return;
    const disconnect = connectBrowser(
      snapshot,
      options,
      (definitions, verification, variants) => {
        if (!disposed && ownGeneration === generation)
          publish({
            ...snapshot,
            ...verification,
            source: 'signed',
            definitions: selectDefinitions(definitions, snapshot.expose),
            variants: variants ? selectVariantDefs(variants, snapshot.expose) : undefined,
          });
      },
      session,
    );
    // Fetch/socket observers can retire or replace this generation synchronously
    // before connection construction returns its resource handle.
    if (disposed || ownGeneration !== generation) disconnect();
    else stop = disconnect;
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
    getVariant,
    getVariantValue,
    gate: (keys: string[], gate: GateOptions = {}) =>
      evaluateResolvedKeys(
        [...keys],
        gate.requirement ?? 'all',
        gate.negate ?? false,
        captureEvaluation(gate),
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
