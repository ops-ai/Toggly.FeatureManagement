/**
 * React context for Toggly feature flags
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  isFeatureEnabled as coreIsFeatureEnabled,
  buildDefinitionsUrl,
  fetchWithTimeout,
  createLogger,
  mergeConfig,
  normalizeEntityContext,
  registerContext as registerEntityContext,
} from '../core';
import type { TogglyEntityContext } from '../core';
import { createBrowserTelemetry, type FrontendTelemetry } from './telemetry';
import { appendSdkQueryParams } from './sdk-identity';
import {
  applyLocalGate,
  buildFlagGateIndex,
  type FlagGateIndex,
  type LocalGate,
} from '@ops-ai/toggly-local-gates';
import type {
  FeatureFlags,
  ServerFeatureContext,
  IdentityContext,
  TogglyConfig,
  TogglyHook,
} from '../core';

/**
 * Toggly context value
 */
export interface TogglyContextValue extends FrontendTelemetry {
  /** Current feature flags */
  flags: FeatureFlags;
  /** Whether the client is initialized */
  isReady: boolean;
  /** Current identity */
  identity?: string;
  /** Check if a feature is enabled */
  isEnabled: (
    featureKey: string,
    defaultValue?: boolean,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => boolean;
  /** Check if a feature is disabled */
  isDisabled: (
    featureKey: string,
    defaultValue?: boolean,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => boolean;
  /** Evaluate a feature gate */
  evaluateGate: (
    featureKeys: string[],
    requirement?: 'all' | 'any',
    negate?: boolean,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => boolean;
  /** Register a domain-object mapper for entity-context evaluation */
  registerContext: <T>(kind: string, mapper: (entity: T) => TogglyEntityContext) => void;
  /** Set user identity */
  identify: (identity: string, context?: IdentityContext) => Promise<void>;
  /** Clear user identity */
  reset: () => Promise<void>;
  /** Refresh feature flags */
  refresh: () => Promise<void>;
  /** Add a hook */
  addHook: (hook: TogglyHook) => void;
  /** Remove a hook by name */
  removeHook: (name: string) => boolean;
  /** Register device-local post-filter gates */
  setLocalGates: (gates: LocalGate[]) => void;
  /** Notify subscribers that local gate state changed (no network) */
  notifyLocalGatesChanged: () => void;
  /** Subscribe to local gate changes */
  subscribeLocalGatesChanged: (listener: () => void) => () => void;
}

/**
 * Toggly provider props
 */
export interface TogglyProviderProps {
  /** Child components */
  children: ReactNode;
  /** Server-side feature context for hydration */
  serverContext?: ServerFeatureContext;
  /** Toggly configuration */
  config?: TogglyConfig;
  /** Enable client-side refresh */
  enableRefresh?: boolean;
  /** Refresh interval in milliseconds */
  refreshInterval?: number;
  /** Callback when flags are updated */
  onFlagsChange?: (flags: FeatureFlags) => void;
}

// Create context with undefined default
const TogglyContext = createContext<TogglyContextValue | undefined>(undefined);

type BrowserTelemetry = ReturnType<typeof createBrowserTelemetry>;
type CommittedOwner = { telemetry: BrowserTelemetry; transport: string; fetch?: TogglyConfig['telemetryFetch'] };
const transportIds = new WeakMap<object, number>();
let nextTransportId = 0;
function transportId(value?: TogglyConfig['telemetryFetch']): number {
  if (!value) return 0;
  let id = transportIds.get(value);
  if (id === undefined) { id = ++nextTransportId; transportIds.set(value, id); }
  return id;
}

// Browser targeting changes must commit before descendant passive refreshes.
// Server imports and renders retain the inert passive-effect path.
const useCommittedContextEffect = typeof globalThis.window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Toggly Provider component
 */
export function TogglyProvider(props: Readonly<TogglyProviderProps>): ReactElement {
  const config = props.config ?? (props.serverContext ? {appKey: props.serverContext.appKey, environment: props.serverContext.environment} : undefined);
  const committedOwner = useRef<CommittedOwner>();
  const ownerKey = JSON.stringify([transportId(config?.telemetryFetch), config?.appKey ?? '', config?.environment ?? 'Production', config?.enableTelemetry, config?.enableUsageTracking, config?.enableMetrics, config?.metricsBaseUrl, config?.telemetryFlushIntervalMs]);
  const snapshot = props.serverContext;
  const matchesOwner = (!snapshot?.appKey || snapshot.appKey === config?.appKey) &&
    (!snapshot?.environment || snapshot.environment === (config?.environment ?? 'Production'));
  return <TogglyProviderOwner key={ownerKey} {...props} committedOwner={committedOwner} config={config} serverContext={matchesOwner ? snapshot : undefined} />;
}

function TogglyProviderOwner({
  committedOwner,
  children,
  serverContext,
  config,
  enableRefresh = false,
  refreshInterval = 60000,
  onFlagsChange,
}: Readonly<TogglyProviderProps & { committedOwner: { current?: CommittedOwner } }>): ReactElement {
  const mergedConfig = useMemo(
    () => (config ? mergeConfig(config) : undefined),
    [config]
  );
  const logger = useMemo(
    () => createLogger(mergedConfig?.debug ?? false),
    [mergedConfig?.debug]
  );

  const contextRef = useRef({
    identity: serverContext ? serverContext.identity : mergedConfig?.identity,
    instanceId: mergedConfig?.instanceId?.trim() || undefined,
    groups: [...(mergedConfig?.groups ?? [])],
    claims: { ...mergedConfig?.claims },
  });
  const committedTargetingProps = useRef({
    groups: [...(mergedConfig?.groups ?? [])],
    claims: { ...mergedConfig?.claims },
  });
  const flagsRef = useRef<FeatureFlags>(serverContext?.flags ?? mergedConfig?.featureDefaults ?? {});
  const generationRef = useRef(0);
  const updateRevisionRef = useRef(0);
  const [telemetry] = useState(() => createBrowserTelemetry({ ...config, ...contextRef.current }));
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    const transport = JSON.stringify([config?.metricsBaseUrl ?? 'https://metrics.toggly.io',
      config?.telemetryFlushIntervalMs ?? 45000, config?.enableTelemetry !== false,
      config?.enableUsageTracking !== false, config?.enableMetrics !== false]);
    const previous = committedOwner.current;
    if (previous && previous.telemetry !== telemetry) {
      previous.telemetry.dispose({ flush: previous.transport === transport && previous.fetch === config?.telemetryFetch });
    }
    committedOwner.current = { telemetry, transport, fetch: config?.telemetryFetch };
    telemetry.activate();
    return () => {
      mountedRef.current = false;
      generationRef.current++;
      queueMicrotask(() => {
        if (!mountedRef.current) {
          if (committedOwner.current?.telemetry === telemetry) committedOwner.current = undefined;
          telemetry.dispose();
        }
      });
    };
  }, [telemetry]);

  // Initialize state from server context
  const [flags, setFlags] = useState<FeatureFlags>(
    serverContext?.flags ?? mergedConfig?.featureDefaults ?? {}
  );
  const [identity, setIdentity] = useState<string | undefined>(
    serverContext ? serverContext.identity : mergedConfig?.identity
  );
  const [isReady, setIsReady] = useState(!!serverContext);
  const [hooks, setHooks] = useState<TogglyHook[]>([]);
  const [localGatesRevision, setLocalGatesRevision] = useState(0);

  const localGatesRef = useRef<LocalGate[]>(mergedConfig?.localGates ?? []);
  const localGateIndexRef = useRef<FlagGateIndex>(
    buildFlagGateIndex(localGatesRef.current)
  );
  const localGatesListenersRef = useRef(new Set<() => void>());

  const captureEvaluation = useCallback((featureKeys: readonly string[]) => {
    const selectedKeys = new Set(featureKeys);
    const selectedFlags = Object.fromEntries([...selectedKeys].map(key => [key, flagsRef.current[key]]));
    const capturedFlags = JSON.parse(JSON.stringify(selectedFlags)) as FeatureFlags;
    const applicableGates = localGatesRef.current.filter(gate => gate.flagKeys.some(key => selectedKeys.has(key)));
    const index = buildFlagGateIndex(applicableGates);
    // Preserve the shared helper's first-gate-by-id semantics, including when
    // several gate entries share an id. Only applicable callbacks are captured.
    const gates = [...new Set(index.values())].map(id => {
      const gate = localGatesRef.current.find(candidate => candidate.id === id)!;
      return { ...gate, flagKeys: [...gate.flagKeys] };
    });
    const record = telemetry.captureCheck();
    return (featureKey: string, defaultValue = false, entityContext?: TogglyEntityContext | null): boolean => {
      const remote = coreIsFeatureEnabled(capturedFlags, featureKey, defaultValue, entityContext);
      const result = applyLocalGate(remote, featureKey, gates, index);
      record(featureKey, result);
      return result;
    };
  }, [flags, localGatesRevision, telemetry]);

  const registerContext = useCallback(
    <T,>(kind: string, mapper: (entity: T) => TogglyEntityContext): void => {
      registerEntityContext(kind, mapper);
    },
    [],
  );

  const setLocalGates = useCallback((gates: LocalGate[]): void => {
    localGatesRef.current = [...gates];
    localGateIndexRef.current = buildFlagGateIndex(localGatesRef.current);
  }, []);

  const notifyLocalGatesChanged = useCallback((): void => {
    setLocalGatesRevision((revision) => revision + 1);
    localGatesListenersRef.current.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        logger.error('Local gate listener error:', error);
      }
    });
  }, [logger]);

  const subscribeLocalGatesChanged = useCallback(
    (listener: () => void): (() => void) => {
      localGatesListenersRef.current.add(listener);
      return () => {
        localGatesListenersRef.current.delete(listener);
      };
    },
    []
  );

  useEffect(() => {
    if (mergedConfig?.localGates) {
      setLocalGates(mergedConfig.localGates);
    }
  }, [mergedConfig?.localGates, setLocalGates]);

  const executeAfterRefresh = useCallback(
    async (newFlags: FeatureFlags, generation: number, revision: number): Promise<void> => {
      for (const hook of hooks) {
        if (!mountedRef.current || generation !== generationRef.current || revision !== updateRevisionRef.current) return;
        if (hook.afterRefresh) {
          try {
            await hook.afterRefresh(newFlags);
          } catch (error) {
            logger.error(
              `Error in hook "${hook.getMetadata().name}.afterRefresh":`,
              error
            );
          }
        }
      }
    },
    [hooks, logger]
  );

  // Fetch flags from API
  const fetchFlags = useCallback(
    async (target = contextRef.current): Promise<FeatureFlags> => {
      if (!mountedRef.current) return flagsRef.current;
      if (!mergedConfig?.appKey) {
        logger.debug('No appKey, using current flags.');
        return flagsRef.current;
      }

      try {
        const parsedUrl = new URL(buildDefinitionsUrl(mergedConfig, target));
        if (target.instanceId) {
          // Deleting live query entries can skip repeated targeting keys.
          const capturedKeys = [...parsedUrl.searchParams.keys()];
          for (const key of capturedKeys) {
            if (key === 'u' || key === 'userId' || key === 'g' || key.startsWith('claim.')) parsedUrl.searchParams.delete(key);
          }
          parsedUrl.searchParams.set('i', target.instanceId);
        }
        const url = parsedUrl.toString();
        logger.debug('Fetching feature flags');

        const response = await fetchWithTimeout(url, {}, mergedConfig.timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const payload = await response.json();
        const newFlags =
          payload && typeof payload === 'object'
            ? (payload as FeatureFlags)
            : {};
        logger.debug(`Fetched ${Object.keys(newFlags).length} flags.`);

        return newFlags;
      } catch (error) {
        logger.warn('Failed to fetch flags:', error);
        return flagsRef.current;
      }
    },
    [mergedConfig, logger]
  );

  // Update flags and trigger callbacks
  const updateFlags = useCallback(
    async (newFlags: FeatureFlags, generation: number, revision: number) => {
      if (!mountedRef.current || generation !== generationRef.current || revision !== updateRevisionRef.current) return;
      flagsRef.current = newFlags;
      setFlags(newFlags);
      await executeAfterRefresh(newFlags, generation, revision);
      if (mountedRef.current && generation === generationRef.current && revision === updateRevisionRef.current) onFlagsChange?.(newFlags);
    },
    [executeAfterRefresh, onFlagsChange]
  );

  // Check if feature is enabled (sync for performance)
  const isEnabled = useCallback(
    (
      featureKey: string,
      defaultValue = false,
      entity?: TogglyEntityContext | Record<string, unknown> | null,
      kind?: string,
    ): boolean => {
      const evaluate = captureEvaluation([featureKey]);
      return evaluate(
        featureKey,
        defaultValue,
        normalizeEntityContext(entity, kind),
      );
    },
    [captureEvaluation]
  );

  // Check if feature is disabled
  const isDisabled = useCallback(
    (
      featureKey: string,
      defaultValue = true,
      entity?: TogglyEntityContext | Record<string, unknown> | null,
      kind?: string,
    ): boolean => {
      return !isEnabled(featureKey, !defaultValue, entity, kind);
    },
    [isEnabled]
  );

  // Evaluate feature gate
  const evaluateGate = useCallback(
    (
      featureKeys: string[],
      requirement: 'all' | 'any' = 'all',
      negate = false,
      entity?: TogglyEntityContext | Record<string, unknown> | null,
      kind?: string,
    ): boolean => {
      if (featureKeys.length === 0) {
        return !negate;
      }

      const selectedKeys = [...featureKeys];
      const evaluate = captureEvaluation(selectedKeys);
      const entityContext = normalizeEntityContext(entity, kind);

      let result: boolean;
      if (requirement === 'any') {
        result = selectedKeys.some((key) =>
          evaluate(key, false, entityContext),
        );
      } else {
        result = selectedKeys.every((key) =>
          evaluate(key, false, entityContext),
        );
      }

      return negate ? !result : result;
    },
    [captureEvaluation]
  );

  const installContext = useCallback((target: typeof contextRef.current) => {
    contextRef.current = target;
    telemetry.setContext(target);
    flagsRef.current = mergedConfig?.featureDefaults ?? {};
    setFlags(flagsRef.current);
    setIdentity(target.identity);
  }, [mergedConfig?.featureDefaults, telemetry]);

  const isCurrentGeneration = useCallback((generation: number): boolean =>
    mountedRef.current && generation === generationRef.current, []);

  const completeIdentification = useCallback((generation: number): void => {
    if (isCurrentGeneration(generation)) setIsReady(true);
  }, [isCurrentGeneration]);

  // Check ownership before selecting each hook without adding Promise boundaries.
  const currentIdentifyHooks = useCallback(function* (generation: number, reverse = false): Generator<TogglyHook> {
    let index = reverse ? hooks.length - 1 : 0;
    while (reverse ? index >= 0 : index < hooks.length) {
      if (!isCurrentGeneration(generation)) return;
      yield hooks[index];
      index += reverse ? -1 : 1;
    }
  }, [hooks, isCurrentGeneration]);

  // Hook order remains unchanged; every asynchronous boundary checks ownership.
  const identify = useCallback(
    async (newIdentity: string, context?: IdentityContext): Promise<void> => {
      if (!mountedRef.current) return;
      const generation = ++generationRef.current;
      logger.debug('Identifying user');
      for (const hook of currentIdentifyHooks(generation)) {
        if (!hook.beforeIdentify) continue;
        try { await hook.beforeIdentify(newIdentity); }
        catch (error) { logger.error(`Error in hook "${hook.getMetadata().name}.beforeIdentify":`, error); }
      }
      if (!isCurrentGeneration(generation)) return;
      const target = {
        identity: newIdentity,
        instanceId: context?.instanceId?.trim() || undefined,
        groups: [...(context?.groups ?? contextRef.current.groups)],
        claims: { ...(context?.claims ?? contextRef.current.claims) },
      };
      installContext(target);
      const revision = ++updateRevisionRef.current;
      await updateFlags(await fetchFlags(target), generation, revision);
      for (const hook of currentIdentifyHooks(generation, true)) {
        if (!hook.afterIdentify) continue;
        try { await hook.afterIdentify(newIdentity, undefined); }
        catch (error) { logger.error(`Error in hook "${hook.getMetadata().name}.afterIdentify":`, error); }
      }
      completeIdentification(generation);
    },
    [hooks, fetchFlags, updateFlags, installContext, logger, isCurrentGeneration, completeIdentification, currentIdentifyHooks]
  );

  useCommittedContextEffect(() => {
    const previous = committedTargetingProps.current;
    const groups = [...(mergedConfig?.groups ?? [])];
    const claims = { ...mergedConfig?.claims };
    const groupsChanged = previous.groups.length !== groups.length || groups.some((group, index) => group !== previous.groups[index]);
    const claimKeys = Object.keys(claims);
    const claimsChanged = Object.keys(previous.claims).length !== claimKeys.length || claimKeys.some(key => claims[key] !== previous.claims[key]);
    if (!groupsChanged && !claimsChanged) return;
    committedTargetingProps.current = { groups, claims };
    generationRef.current++;
    updateRevisionRef.current++;
    installContext({
      ...contextRef.current,
      groups: groupsChanged ? groups : contextRef.current.groups,
      claims: claimsChanged ? claims : contextRef.current.claims,
    });
    setIsReady(false);
  }, [mergedConfig?.groups, mergedConfig?.claims, installContext]);

  const reset = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) return;
    const generation = ++generationRef.current;
    const target = { ...contextRef.current, identity: undefined, instanceId: undefined };
    installContext(target);
    const revision = ++updateRevisionRef.current;
    await updateFlags(await fetchFlags(target), generation, revision);
    if (mountedRef.current && generation === generationRef.current) setIsReady(true);
  }, [fetchFlags, updateFlags, installContext]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) return;
    const generation = generationRef.current;
    const revision = ++updateRevisionRef.current;
    await updateFlags(await fetchFlags(contextRef.current), generation, revision);
    if (mountedRef.current && generation === generationRef.current && revision === updateRevisionRef.current) setIsReady(true);
  }, [fetchFlags, updateFlags]);

  // Add hook
  const addHook = useCallback(
    (hook: TogglyHook): void => {
      setHooks((currentHooks) => {
        const metadata = hook.getMetadata();
        const exists = currentHooks.find(
          (h) => h.getMetadata().name === metadata.name
        );

        if (exists) {
          logger.warn(`Hook "${metadata.name}" already registered. Skipping.`);
          return currentHooks;
        }

        logger.debug(`Hook "${metadata.name}" registered.`);
        return [...currentHooks, hook];
      });
    },
    [logger]
  );

  // Remove hook
  const removeHook = useCallback(
    (name: string): boolean => {
      let removed = false;

      setHooks((currentHooks) => {
        const index = currentHooks.findIndex(
          (h) => h.getMetadata().name === name
        );

        if (index > -1) {
          logger.debug(`Hook "${name}" removed.`);
          removed = true;
          return [
            ...currentHooks.slice(0, index),
            ...currentHooks.slice(index + 1),
          ];
        }

        return currentHooks;
      });

      return removed;
    },
    [logger]
  );

  // WebSocket live updates
  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsConnectedRef = useRef(false);
  const lastFallbackRefreshRef = useRef(0);

  const FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000; // 20 minutes
  const WS_RECONNECT_DELAY = 5000; // 5 seconds

  // Stable ref for refresh so WebSocket handlers always call the latest version
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // Set up refresh interval with WebSocket throttling
  useEffect(() => {
    if (!enableRefresh || !mergedConfig?.appKey) {
      return;
    }

    logger.debug(`Setting up refresh interval: ${refreshInterval}ms`);

    const intervalId = setInterval(() => {
      // When WebSocket is connected, throttle HTTP polls to fallback interval
      if (wsConnectedRef.current) {
        const now = Date.now();
        if (now - lastFallbackRefreshRef.current < FALLBACK_REFRESH_INTERVAL) {
          return;
        }
        lastFallbackRefreshRef.current = now;
      }
      refresh();
    }, refreshInterval);

    return () => {
      clearInterval(intervalId);
    };
  }, [enableRefresh, refreshInterval, refresh, mergedConfig?.appKey, logger]);

  // Set up WebSocket connection for live updates (browser only —
  // Node 22+ exposes a global WebSocket that must not reconnect during SSR).
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!mergedConfig?.appKey || !mergedConfig?.baseUrl) {
      return;
    }

    // Only run in browser
    if (typeof WebSocket === 'undefined') {
      return;
    }

    let live = true;
    function buildWebSocketUrl(): string {
      const baseUrl = mergedConfig!.baseUrl!;
      const wsUrl = baseUrl
        .replace(/^https:\/\//, 'wss://')
        .replace(/^http:\/\//, 'ws://');
      const params = new URLSearchParams();
      appendSdkQueryParams(params);
      const query = params.toString();
      return `${wsUrl.replace(/\/$/, '')}/${mergedConfig!.appKey}/ws${query ? `?${query}` : ''}`;
    }

    function connect(): void {
      if (!live || !mountedRef.current || wsRef.current) {
        return;
      }

      const wsUrl = buildWebSocketUrl();
      logger.debug(`WebSocket connecting to: ${wsUrl}`);

      try {
        const socket = new WebSocket(wsUrl);
        wsRef.current = socket;

        socket.onopen = () => {
          if (!live || wsRef.current !== socket) return;
          wsConnectedRef.current = true;
          lastFallbackRefreshRef.current = Date.now();
          logger.debug('WebSocket connected');
        };

        socket.onmessage = (event: MessageEvent) => {
          if (!live || wsRef.current !== socket) return;
          const text = typeof event.data === 'string' ? event.data : '';
          try {
            const msg = JSON.parse(text);
            if (msg.type === 'ping') {
              return;
            }
            if (msg.type === 'flags-updated' || msg.type === 'update') {
              logger.debug('WebSocket: definitions updated, refreshing');
              refreshRef.current();
            }
          } catch {
            // Non-JSON message - check for plain text signals
            if (text === 'update' || text === 'flags-updated') {
              refreshRef.current();
            }
          }
        };

        socket.onclose = () => {
          if (!live || wsRef.current !== socket) return;
          wsConnectedRef.current = false;
          wsRef.current = null;
          logger.debug('WebSocket disconnected, reconnecting in 5s');
          scheduleReconnect();
        };

        socket.onerror = () => {
          if (!live || wsRef.current !== socket) return;
          logger.warn('WebSocket error');
          // close event will fire after error, triggering reconnect
        };
      } catch (error) {
        logger.warn('Failed to create WebSocket:', error);
        wsRef.current = null;
        scheduleReconnect();
      }
    }

    function scheduleReconnect(): void {
      if (wsReconnectTimerRef.current) {
        return;
      }
      wsReconnectTimerRef.current = setTimeout(() => {
        wsReconnectTimerRef.current = null;
        connect();
      }, WS_RECONNECT_DELAY);
    }

    connect();

    return () => {
      live = false;
      if (wsReconnectTimerRef.current) {
        clearTimeout(wsReconnectTimerRef.current);
        wsReconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.onopen = null;
        wsRef.current.close();
        wsRef.current = null;
        wsConnectedRef.current = false;
      }
    };
  }, [mergedConfig?.appKey, mergedConfig?.baseUrl, logger]);

  // Initialize on mount if no server context
  useEffect(() => {
    if (!serverContext && mergedConfig?.appKey) {
      logger.debug('No server context, initializing client-side');
      const generation = generationRef.current;
      const revision = ++updateRevisionRef.current;
      fetchFlags(contextRef.current).then((newFlags) => {
        if (!mountedRef.current || generation !== generationRef.current || revision !== updateRevisionRef.current) return;
        flagsRef.current = newFlags;
        setFlags(newFlags);
        setIsReady(true);
      });
    }
  }, []);

  const contextValue = useMemo<TogglyContextValue>(
    () => ({
      ...telemetry.api,
      flags,
      isReady,
      identity,
      isEnabled,
      isDisabled,
      evaluateGate,
      registerContext,
      identify,
      reset,
      refresh,
      addHook,
      removeHook,
      setLocalGates,
      notifyLocalGatesChanged,
      subscribeLocalGatesChanged,
    }),
    [
      telemetry,
      flags,
      isReady,
      identity,
      isEnabled,
      isDisabled,
      evaluateGate,
      registerContext,
      identify,
      reset,
      refresh,
      addHook,
      removeHook,
      setLocalGates,
      notifyLocalGatesChanged,
      subscribeLocalGatesChanged,
    ]
  );

  return (
    <TogglyContext.Provider value={contextValue}>
      {children}
    </TogglyContext.Provider>
  );
}

/**
 * Hook to access Toggly context
 */
export function useTogglyContext(): TogglyContextValue {
  const context = useContext(TogglyContext);

  if (!context) {
    throw new Error('useTogglyContext must be used within a TogglyProvider');
  }

  return context;
}

// Export context for advanced usage
export { TogglyContext };
