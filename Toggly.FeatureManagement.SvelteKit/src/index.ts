import { writable } from 'svelte/store';
import { evaluateResolvedKeys, resolveEvaluatedDefinition } from '@ops-ai/toggly-hooks-types';
import { applyLocalGate, buildFlagGateIndex } from '@ops-ai/toggly-local-gates';
import { selectDefinitions, type BrowserOptions, type GateOptions, type TogglySnapshot } from './types.js';
export type * from './types.js';

/** A layout-owned store: synchronous SSR/hydration, no module-level identity or store. */
export function createToggly(initial: TogglySnapshot, options: BrowserOptions = {}) {
  let snapshot = structuredClone(initial);
  const store = writable(snapshot);
  const localGates = options.localGates ?? [];
  const gateIndex = buildFlagGateIndex(localGates);
  let stop: (() => void) | undefined;
  let generation = 0;
  let disposed = false;
  let mounted = false;
  const publish = (next: TogglySnapshot) => { snapshot = structuredClone(next); store.set(snapshot); };
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
    stop = connectBrowser(snapshot, options, definitions => {
      if (!disposed && ownGeneration === generation) publish({ ...snapshot, definitions: selectDefinitions(definitions, snapshot.expose) });
    });
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
