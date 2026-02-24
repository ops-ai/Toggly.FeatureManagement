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
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  isFeatureEnabled as coreIsFeatureEnabled,
  evaluateFeatureGate,
  buildDefinitionsUrl,
  fetchWithTimeout,
  createLogger,
  mergeConfig,
} from '@ops-ai/remix-toggly-core';
import type {
  FeatureFlags,
  ServerFeatureContext,
  IdentityContext,
  TogglyConfig,
  TogglyHook,
} from '@ops-ai/remix-toggly-core';

/**
 * Toggly context value
 */
export interface TogglyContextValue {
  /** Current feature flags */
  flags: FeatureFlags;
  /** Whether the client is initialized */
  isReady: boolean;
  /** Current identity */
  identity?: string;
  /** Check if a feature is enabled */
  isEnabled: (featureKey: string, defaultValue?: boolean) => boolean;
  /** Check if a feature is disabled */
  isDisabled: (featureKey: string, defaultValue?: boolean) => boolean;
  /** Evaluate a feature gate */
  evaluateGate: (
    featureKeys: string[],
    requirement?: 'all' | 'any',
    negate?: boolean
  ) => boolean;
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

/**
 * Toggly Provider component
 */
export function TogglyProvider({
  children,
  serverContext,
  config,
  enableRefresh = false,
  refreshInterval = 60000,
  onFlagsChange,
}: TogglyProviderProps): ReactElement {
  const mergedConfig = useMemo(
    () => (config ? mergeConfig(config) : undefined),
    [config]
  );
  const logger = useMemo(
    () => createLogger(mergedConfig?.debug ?? false),
    [mergedConfig?.debug]
  );

  // Initialize state from server context
  const [flags, setFlags] = useState<FeatureFlags>(
    serverContext?.flags ?? mergedConfig?.featureDefaults ?? {}
  );
  const [identity, setIdentity] = useState<string | undefined>(
    serverContext?.identity
  );
  const [isReady, setIsReady] = useState(!!serverContext);
  const [hooks, setHooks] = useState<TogglyHook[]>([]);

  const executeAfterRefresh = useCallback(
    async (newFlags: FeatureFlags): Promise<void> => {
      for (const hook of hooks) {
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
    async (userIdentity?: string): Promise<FeatureFlags> => {
      if (!mergedConfig?.appKey) {
        logger.debug('No appKey, using current flags.');
        return flags;
      }

      try {
        const url = buildDefinitionsUrl(mergedConfig, userIdentity);
        logger.debug(`Fetching flags from: ${url}`);

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
        return flags;
      }
    },
    [mergedConfig, flags, logger]
  );

  // Update flags and trigger callbacks
  const updateFlags = useCallback(
    async (newFlags: FeatureFlags) => {
      setFlags(newFlags);
      await executeAfterRefresh(newFlags);
      onFlagsChange?.(newFlags);
    },
    [executeAfterRefresh, onFlagsChange]
  );

  // Check if feature is enabled (sync for performance)
  const isEnabled = useCallback(
    (featureKey: string, defaultValue = false): boolean => {
      // Note: Hooks are async but we need sync API for React
      // Consider using useEffect for hook execution if needed
      return coreIsFeatureEnabled(flags, featureKey, defaultValue);
    },
    [flags]
  );

  // Check if feature is disabled
  const isDisabled = useCallback(
    (featureKey: string, defaultValue = true): boolean => {
      return !isEnabled(featureKey, !defaultValue);
    },
    [isEnabled]
  );

  // Evaluate feature gate
  const evaluateGate = useCallback(
    (
      featureKeys: string[],
      requirement: 'all' | 'any' = 'all',
      negate = false
    ): boolean => {
      const result = evaluateFeatureGate(
        flags,
        featureKeys,
        requirement,
        negate,
        false
      );
      return result.enabled;
    },
    [flags]
  );

  // Identify user
  const identify = useCallback(
    async (newIdentity: string, context?: IdentityContext): Promise<void> => {
      logger.debug(`Identifying user: ${newIdentity}`);

      // Execute beforeIdentify hooks
      for (const hook of hooks) {
        if (hook.beforeIdentify) {
          try {
            await hook.beforeIdentify(newIdentity);
          } catch (error) {
            logger.error(
              `Error in hook "${hook.getMetadata().name}.beforeIdentify":`,
              error
            );
          }
        }
      }

      setIdentity(newIdentity);

      // Fetch new flags with identity
      const newFlags = await fetchFlags(newIdentity);
      await updateFlags(newFlags);

      // Execute afterIdentify hooks
      for (let i = hooks.length - 1; i >= 0; i--) {
        const hook = hooks[i];
        if (hook.afterIdentify) {
          try {
            await hook.afterIdentify(newIdentity, undefined);
          } catch (error) {
            logger.error(
              `Error in hook "${hook.getMetadata().name}.afterIdentify":`,
              error
            );
          }
        }
      }

      setIsReady(true);
    },
    [hooks, fetchFlags, updateFlags, logger]
  );

  // Reset identity
  const reset = useCallback(async (): Promise<void> => {
    logger.debug('Resetting identity');
    setIdentity(undefined);

    // Fetch flags without identity
    const newFlags = await fetchFlags();
    await updateFlags(newFlags);
  }, [fetchFlags, updateFlags, logger]);

  // Refresh flags
  const refresh = useCallback(async (): Promise<void> => {
    logger.debug('Refreshing flags');
    const newFlags = await fetchFlags(identity);
    await updateFlags(newFlags);
  }, [identity, fetchFlags, updateFlags, logger]);

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

  // Set up WebSocket connection for live updates
  useEffect(() => {
    if (!mergedConfig?.appKey || !mergedConfig?.baseUrl) {
      return;
    }

    // Only run in browser
    if (typeof WebSocket === 'undefined') {
      return;
    }

    function buildWebSocketUrl(): string {
      const baseUrl = mergedConfig!.baseUrl!;
      const wsUrl = baseUrl
        .replace(/^https:\/\//, 'wss://')
        .replace(/^http:\/\//, 'ws://');
      return `${wsUrl.replace(/\/$/, '')}/${mergedConfig!.appKey}/ws`;
    }

    function connect(): void {
      if (wsRef.current) {
        return;
      }

      const wsUrl = buildWebSocketUrl();
      logger.debug(`WebSocket connecting to: ${wsUrl}`);

      try {
        const socket = new WebSocket(wsUrl);
        wsRef.current = socket;

        socket.onopen = () => {
          wsConnectedRef.current = true;
          lastFallbackRefreshRef.current = Date.now();
          logger.debug('WebSocket connected');
        };

        socket.onmessage = (event: MessageEvent) => {
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
          wsConnectedRef.current = false;
          wsRef.current = null;
          logger.debug('WebSocket disconnected, reconnecting in 5s');
          scheduleReconnect();
        };

        socket.onerror = () => {
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
      fetchFlags(identity).then((newFlags) => {
        setFlags(newFlags);
        setIsReady(true);
      });
    }
  }, []);

  const contextValue = useMemo<TogglyContextValue>(
    () => ({
      flags,
      isReady,
      identity,
      isEnabled,
      isDisabled,
      evaluateGate,
      identify,
      reset,
      refresh,
      addHook,
      removeHook,
    }),
    [
      flags,
      isReady,
      identity,
      isEnabled,
      isDisabled,
      evaluateGate,
      identify,
      reset,
      refresh,
      addHook,
      removeHook,
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
