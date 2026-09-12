import type { BrowserSession } from './client.js';
import { writable } from 'svelte/store';
import { evaluateResolvedKeys, resolveEvaluatedDefinition } from '@ops-ai/toggly-hooks-types';
import { applyLocalGate, buildFlagGateIndex } from '@ops-ai/toggly-local-gates';
import { selectDefinitions, type BrowserOptions, type GateOptions, type TogglySnapshot } from './types.js';
export type * from './types.js';

/** A layout-owned store: synchronous SSR/hydration, no module-level identity or store. */
export function createToggly(initial: TogglySnapshot, options: BrowserOptions = {}) {
  const acceptSnapshot = (value: TogglySnapshot): TogglySnapshot => {
    const copy = structuredClone(value);
    // Server-produced metadata comes from the host trust boundary, but current
    // browser pins still constrain whether its signed values may seed the UI.
    if (copy.source === 'signed' && options.allowedKeyIds?.length
      && !options.allowedKeyIds.includes(copy.signingKey?.kid ?? '')) {
      return { ...copy, definitions: {}, source: 'defaults', signedTimestamp: undefined, signingKey: undefined };
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
  // Keep signed timestamp floors across route-driven context changes in this layout.
  const session: BrowserSession = { timestamps: new Map(), keys: new Map() };
  const publish = (next: TogglySnapshot) => { snapshot = acceptSnapshot(next); store.set(snapshot); };
  const isEnabled = (key: string, gate: GateOptions = {}) => applyLocalGate(
    resolveEvaluatedDefinition(snapshot.definitions[key], gate.entity, gate.defaultValue), key, localGates, gateIndex,
  );
  const start = async (): Promise<void> => {
    if (disposed || typeof window === 'undefined') return;
    mounted = true;
    stop?.();
    const ownGeneration = ++generation;
    // Dynamic import keeps browser transports out of SSR execution and allows deterministic hydration.
    const { connectBrowser } = await import('./client.js');
    if (disposed || ownGeneration !== generation) return;
    stop = connectBrowser(snapshot, options, (definitions, verification) => {
      if (!disposed && ownGeneration === generation) publish({ ...snapshot, ...verification, source: 'signed', definitions: selectDefinitions(definitions, snapshot.expose) });
    }, session);
  };
  return {
    subscribe: store.subscribe,
    isEnabled,
    gate: (keys: string[], gate: GateOptions = {}) => evaluateResolvedKeys(keys, gate.requirement ?? 'all', gate.negate ?? false, key => isEnabled(key, gate)),
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
    dispose: () => { disposed = true; generation++; stop?.(); stop = undefined; },
  };
}
export type TogglyStore = ReturnType<typeof createToggly>;
