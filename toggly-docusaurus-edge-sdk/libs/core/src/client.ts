import { captureRequestUrl } from './capture-request-url.js';
/**
 * @ops-ai/toggly-client-core - Framework-agnostic Toggly client
 *
 * Provides core functionality for evaluating feature flags from Toggly.
 * This package is framework-agnostic and can be used in any JavaScript/TypeScript environment,
 * including browsers and Cloudflare Workers.
 */

import {
  buildEvaluatedSignedUrl,
  normalizeEntityContext,
  registerContext as registerEntityContext,
  resolveEvaluatedDefinition,
  type EvaluatedDefinitions,
  type TogglyEntityContext,
} from '@ops-ai/toggly-hooks-types';
import {
  parseEvaluatedResponseBody,
  readResponseBody,
  unwrapDefsPayload,
} from './signed-response';
import {
  createTelemetryReporter,
  type TelemetryDiagnostic,
  type TelemetryFetch,
  type TelemetryReporter,
} from '@ops-ai/toggly-client-telemetry';

/**
 * Configuration options for creating a Toggly client
 * Matches the API structure used in other Toggly SDKs
 */
export interface TogglyConfig {
  /** Base URI for the Toggly definitions API (default: 'https://definitions.toggly.io') */
  baseURI?: string;
  /** Application key from Toggly */
  appKey?: string;
  /** Environment name (e.g., 'Production', 'Staging') (default: 'Production') */
  environment?: string;
  /** Default flag values to use when API is unavailable or appKey is not provided */
  flagDefaults?: { [key: string]: boolean };
  /** Feature flags refresh interval in milliseconds (default: 180000 = 3 minutes) */
  featureFlagsRefreshInterval?: number;
  /** Enable debug logging (default: false) */
  isDebug?: boolean;
  /** Connection timeout in milliseconds (default: 5000) */
  connectTimeout?: number;
  /** Custom fetch implementation (useful for testing or Cloudflare Workers) */
  fetch?: typeof fetch;
  /** User identity for targeting (optional) */
  identity?: string;
  /** Minted opaque instance id; definitions `?i=` and telemetry `i` take precedence over identity. */
  instanceId?: string;
  /** Group memberships used by targeting rules; copied when the client is created. */
  groups?: string[];
  /** Rule attributes (up to 20 string claims); copied when the client is created. */
  claims?: Record<string, string>;
  /** When true, verify ES256 signed envelopes via JWKS before applying flags. */
  verifySignatures?: boolean;
  /** Optional allow-list of JWKS kid values when verifySignatures is enabled. */
  allowedKeyIds?: string[];
  /** Reject envelopes older than this many seconds; unset disables freshness. */
  maxSignatureAgeSeconds?: number;
  /** Enable compact browser telemetry when an application key is present (default: true). */
  enableTelemetry?: boolean;
  /** Enable automatic checks and explicit usage/view events (default: true). */
  enableUsageTracking?: boolean;
  /** Enable application counter/gauge metrics (default: true). */
  enableMetrics?: boolean;
  /** Independent base URL for frontend telemetry (default: https://metrics.toggly.io). */
  metricsBaseUrl?: string;
  /** Base telemetry flush interval in milliseconds (30,000 through 60,000). */
  telemetryFlushIntervalMs?: number;
  /** Independent frontend telemetry transport, primarily for tests and custom browser hosts. */
  telemetryFetch?: TelemetryFetch;
  /** Receives bounded, payload-free frontend telemetry diagnostics. */
  onTelemetryDiagnostic?: (diagnostic: TelemetryDiagnostic) => void;
}



/**
 * Map of feature flag keys to their boolean values
 */
export type Flags = EvaluatedDefinitions;

/**
 * Toggly client instance
 */
export interface TogglyClient {
  /**
   * Get all feature flags as a map of key-value pairs
   * @param context - Optional context for flag evaluation
   * @returns Promise resolving to a map of flag keys to boolean values
   */
  getFlags(): Promise<Flags>;

  /**
   * Get a single feature flag value
   * @param key - The feature flag key
   * @param defaultValue - Optional default value if flag is not found (default: false)
   * @returns Promise resolving to the flag's boolean value
   */
  getFlag(
    key: string,
    defaultValue?: boolean,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): Promise<boolean>;

  registerContext<T>(kind: string, mapper: (entity: T) => TogglyEntityContext): void;

  /**
   * Manually refresh the feature flags cache by fetching from the API
   * @returns Promise that resolves when flags have been refreshed
   */
  refreshFlags(): Promise<void>;

  /**
   * Start a WebSocket connection for live flag updates.
   * Only works in browser environments (requires window and WebSocket).
   * Automatically reconnects on close with a 5-second delay.
   */
  startWebSocket(): void;

  /**
   * Stop the WebSocket connection and clean up reconnect timers.
   */
  stopWebSocket(): void;

  /** Record an explicit feature usage event without evaluating the feature. */
  recordUsage(featureKey: string, variant?: string): void;

  /** Record an explicit feature view event without evaluating the feature. */
  recordView(featureKey: string, variant?: string): void;

  /** Increment an application-level counter. */
  incrementCounter(metricKey: string, value?: number): void;

  /** Set an application-level gauge. */
  setGauge(metricKey: string, value: number): void;

  /** Flush pending frontend telemetry. */
  flushTelemetry(): Promise<void>;

  /**
   * Replace targeting and telemetry attribution. Omitted fields keep their
   * current values; blank `instanceId` or `identity` clears that field.
   * Admitted telemetry events keep their previous `i`/`u`.
   */
  setContext(context: {
    identity?: string;
    instanceId?: string;
    groups?: string[];
    claims?: Record<string, string>;
  }): Promise<void>;

  /** Stop owned browser resources; flush at most one final envelope unless flush is false. */
  dispose(options?: { flush?: boolean }): void;
}

export type TelemetryLifecycle = (reporter: TelemetryReporter) => () => void;

interface CachedFlags {
  flags: Flags;
  timestamp: number;
}

/**
 * Creates a new Toggly client instance
 *
 * @param config - Configuration options for the client
 * @returns A Toggly client instance
 *
 * @example
 * ```typescript
 * const client = createTogglyClient({
 *   baseURI: 'https://definitions.toggly.io',
 *   environment: 'Production',
 *   appKey: 'my-app-key',
 *   featureFlagsRefreshInterval: 180000,
 *   flagDefaults: { 'my-feature': false }
 * });
 *
 * const flags = await client.getFlags();
 * const isEnabled = await client.getFlag('my-feature', false);
 * ```
 */
export function createTogglyClientCore(
  config: TogglyConfig = {},
  attachTelemetryLifecycle?: TelemetryLifecycle,
): TogglyClient {
  const {
    baseURI = 'https://definitions.toggly.io',
    appKey,
    environment = 'Production',
    flagDefaults = {},
    featureFlagsRefreshInterval = 3 * 60 * 1000, // 3 minutes
    isDebug = false,
    connectTimeout = 5 * 1000, // 5 seconds
    fetch: fetchImpl,
    verifySignatures = false,
    allowedKeyIds,
    maxSignatureAgeSeconds,
  } = config;

  let identity = typeof config.identity === 'string' ? config.identity : undefined;
  let instanceId = typeof config.instanceId === 'string' ? config.instanceId.trim() : '';
  let groups = config.groups ? [...config.groups] : undefined;
  let claims = config.claims ? { ...config.claims } : undefined;

  const buildDefinitionsUrl = (): string => {
    if (!appKey) return '';
    if (instanceId) {
      const url = new URL(`${baseURI.replace(/\/$/, '')}/evaluated-signed/${appKey}/${environment}`);
      url.searchParams.set('i', instanceId);
      return url.toString();
    }
    return buildEvaluatedSignedUrl(baseURI, appKey, environment, { identity, groups, claims }, false);
  };

  const getApiUrl = captureRequestUrl(buildDefinitionsUrl);

  // Resolve fetch implementation: use provided, then globalThis.fetch, then throw
  let resolvedFetch: typeof fetch;
  if (fetchImpl) {
    resolvedFetch = fetchImpl;
  } else if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
    resolvedFetch = globalThis.fetch.bind(globalThis);
  } else {
    throw new Error('fetch is not available. Please provide a fetch implementation via config.fetch');
  }

  // WebSocket live-update support
  const FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000; // 20 minutes
  const WS_RECONNECT_DELAY = 5000; // 5 seconds

  let _ws: WebSocket | null = null;
  let _wsConnected = false;
  let _wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let _lastFallbackRefresh = 0;

  let cache: CachedFlags | null = null;
  let definitionsGeneration = 0;
  let disposed = false;
  const activeDefinitionRequests = new Set<AbortController>();
  let telemetryReporter: TelemetryReporter | undefined;
  let detachTelemetry: (() => void) | undefined;

  const usageEnabled = config.enableUsageTracking !== false;
  const metricsEnabled = config.enableMetrics !== false;
  const telemetryEnabled =
    config.enableTelemetry !== false &&
    Boolean(appKey) &&
    (usageEnabled || metricsEnabled) &&
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    Boolean(attachTelemetryLifecycle);

  if (telemetryEnabled) {
    try {
      telemetryReporter = createTelemetryReporter({
        appKey,
        environment,
        instanceId: instanceId || undefined,
        identity,
        enableTelemetry: true,
        metricsBaseUrl: config.metricsBaseUrl,
        telemetryFlushIntervalMs: config.telemetryFlushIntervalMs,
        fetch: config.telemetryFetch,
        onDiagnostic: config.onTelemetryDiagnostic,
      });
      detachTelemetry = attachTelemetryLifecycle?.(telemetryReporter);
    } catch {
      try {
        telemetryReporter?.dispose();
      } catch {
        // A partially initialized reporter must not escape this client.
      }
      try {
        config.onTelemetryDiagnostic?.('invalid-option');
      } catch {
        // Diagnostics never affect feature evaluation.
      }
      telemetryReporter = undefined;
      detachTelemetry = undefined;
    }
  }

  const recordTelemetry = (operation: (reporter: TelemetryReporter) => void): void => {
    if (!telemetryReporter || disposed) return;
    try {
      operation(telemetryReporter);
    } catch {
      // Frontend telemetry is best effort and never changes evaluation results.
    }
  };


  const isCacheValid = (): boolean => {
    if (!cache) return false;
    const age = Date.now() - cache.timestamp;
    // When WebSocket is connected, use a longer fallback interval for polling
    const interval = _wsConnected ? FALLBACK_REFRESH_INTERVAL : featureFlagsRefreshInterval;
    return age < interval;
  };

  const fetchFlags = async (): Promise<Flags> => {
    if (disposed) return cache ? { ...cache.flags } : { ...flagDefaults };
    const generation = definitionsGeneration;
    const url = getApiUrl();

    // If no appKey, return flagDefaults
    if (!url || !appKey) {
      if (isDebug) {
        console.log(`Toggly.usedFlagDefaults - ${JSON.stringify(flagDefaults)}`);
      }
      return { ...flagDefaults };
    }

    try {
      const controller = new AbortController();
      activeDefinitionRequests.add(controller);
      const timeoutId = setTimeout(() => controller.abort(), connectTimeout);
      try {
        const response = await resolvedFetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `Failed to fetch flags from Toggly API: ${response.status} ${response.statusText}`
          );
        }

        const bodyText = await readResponseBody(response);
        const parsed = await parseEvaluatedResponseBody(bodyText, {
          verifySignatures,
          baseURI,
          allowedKeyIds,
          maxSignatureAgeSeconds,
          headers: { Accept: 'application/json' },
          fetchImpl: resolvedFetch,
        });
        const flags = (
          verifySignatures ? (parsed as Flags) : unwrapDefsPayload(parsed)
        ) as Flags;

        if (isDebug) {
          console.log(`Toggly.fetchFeatureFlags - ${JSON.stringify(flags)}`);
        }

        if (generation !== definitionsGeneration) {
          return cache ? { ...cache.flags } : { ...flagDefaults };
        }
        return flags;
      } finally {
        clearTimeout(timeoutId);
        activeDefinitionRequests.delete(controller);
      }
    } catch (error) {
      // On error, try to use cached flags, otherwise use flagDefaults
      if (cache) {
        if (isDebug) {
          console.log(`Toggly.loadedFromCache - ${JSON.stringify(cache.flags)}`);
        }
        return { ...cache.flags };
      }

      if (isDebug) {
        console.log(`Toggly.loadedFromDefaults - ${JSON.stringify(flagDefaults)}`);
      }

      return { ...flagDefaults };
    }
  };

  const refreshFlags = async (): Promise<void> => {
    if (disposed) return;
    const generation = definitionsGeneration;
    if (isDebug) {
      console.log('Toggly.refresh');
    }

    const flags = await fetchFlags();
    if (disposed || generation !== definitionsGeneration) return;
    cache = {
      flags,
      timestamp: Date.now(),
    };
  };

  // Select flags and attribution together, before returning across an await boundary.
  // A superseded request may return the current cache/defaults, not its original context.
  const getFlagsSnapshot = async (captureCheck = false): Promise<{
    flags: Flags;
    recordCheck?: ReturnType<TelemetryReporter['captureCheck']>;
  }> => {
    const snapshot = (flags: Flags) => {
      let recordCheck: ReturnType<TelemetryReporter['captureCheck']> | undefined;
      if (captureCheck && usageEnabled) {
        recordTelemetry((reporter) => { recordCheck = reporter.captureCheck(); });
      }
      return { flags: { ...flags }, recordCheck };
    };
    if (disposed) return snapshot(cache?.flags ?? flagDefaults);

    // If no appKey, return flagDefaults immediately.
    if (!appKey) return snapshot(flagDefaults);
    if (isCacheValid() && cache) return snapshot(cache.flags);

    await refreshFlags();
    return snapshot(cache?.flags ?? flagDefaults);
  };

  const getFlags = async (): Promise<Flags> => (await getFlagsSnapshot()).flags;

  const getFlag = async (
    key: string,
    defaultValue?: boolean,
    entity?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ): Promise<boolean> => {
    const { flags, recordCheck } = await getFlagsSnapshot(true);
    const value = flags[key];
    const entityContext = normalizeEntityContext(entity, kind);

    let result: boolean;
    if (value !== undefined) {
      result = resolveEvaluatedDefinition(value, entityContext);
    } else if (defaultValue !== undefined) {
      result = defaultValue;
    } else {
      result = flagDefaults[key] ?? false;
    }

    try {
      recordCheck?.(key, result ? 'enabled' : 'disabled');
    } catch {
      // Captured telemetry remains best effort and never changes evaluation results.
    }
    return result;
  };

  const registerContext = <T>(
    kind: string,
    mapper: (entity: T) => TogglyEntityContext,
  ): void => {
    registerEntityContext(kind, mapper);
  };

  const startWebSocket = (): void => {
    if (disposed) return;
    // Only run in browser environments
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
      if (isDebug) {
        console.log('Toggly.ws - skipped (not a browser environment)');
      }
      return;
    }

    if (!appKey) {
      if (isDebug) {
        console.log('Toggly.ws - skipped (no appKey)');
      }
      return;
    }

    // Build WebSocket URL from baseURI: https:// -> wss://, http:// -> ws://
    const wsUrl = baseURI
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://')
      .replace(/\/$/, '') + `/${appKey}/ws`;

    if (isDebug) {
      console.log(`Toggly.ws - connecting to ${wsUrl}`);
    }

    try {
      _ws = new WebSocket(wsUrl);

      _ws.onopen = () => {
        if (disposed) return;
        _wsConnected = true;
        _lastFallbackRefresh = Date.now();
        if (isDebug) {
          console.log('Toggly.ws - connected');
        }
      };

      _ws.onmessage = (event: MessageEvent) => {
        if (disposed) return;
        try {
          const data = JSON.parse(event.data);
          if (isDebug) {
            console.log(`Toggly.ws - message: ${JSON.stringify(data)}`);
          }

          // Skip ping messages
          if (data.type === 'ping') {
            return;
          }

          // On flags-updated or update messages, refresh flags from the API
          if (data.type === 'flags-updated' || data.type === 'update') {
            if (isDebug) {
              console.log('Toggly.ws - flags updated, refreshing');
            }
            void refreshFlags();
          }
        } catch {
          // Ignore malformed messages
          if (isDebug) {
            console.log('Toggly.ws - failed to parse message');
          }
        }
      };

      _ws.onerror = (event: Event) => {
        if (isDebug) {
          console.log('Toggly.ws - error', event);
        }
      };

      _ws.onclose = () => {
        if (disposed) return;
        _wsConnected = false;
        _ws = null;
        if (isDebug) {
          console.log(`Toggly.ws - closed, reconnecting in ${WS_RECONNECT_DELAY}ms`);
        }

        // Reconnect after delay
        _wsReconnectTimer = setTimeout(() => {
          _wsReconnectTimer = null;
          startWebSocket();
        }, WS_RECONNECT_DELAY);
      };
    } catch (error) {
      if (isDebug) {
        console.log('Toggly.ws - failed to connect', error);
      }
    }
  };

  const stopWebSocket = (): void => {
    if (_wsReconnectTimer !== null) {
      clearTimeout(_wsReconnectTimer);
      _wsReconnectTimer = null;
    }

    if (_ws) {
      // Remove onclose handler to prevent auto-reconnect
      _ws.onclose = null;
      _ws.close();
      _ws = null;
    }

    _wsConnected = false;

    if (isDebug) {
      console.log('Toggly.ws - stopped');
    }
  };

  const recordUsage = (featureKey: string, variant?: string): void => {
    if (usageEnabled) recordTelemetry((reporter) => reporter.recordUsage(featureKey, variant));
  };

  const recordView = (featureKey: string, variant?: string): void => {
    if (usageEnabled) recordTelemetry((reporter) => reporter.recordView(featureKey, variant));
  };

  const incrementCounter = (metricKey: string, value?: number): void => {
    if (metricsEnabled) recordTelemetry((reporter) => reporter.incrementCounter(metricKey, value));
  };

  const setGauge = (metricKey: string, value: number): void => {
    if (metricsEnabled) recordTelemetry((reporter) => reporter.setGauge(metricKey, value));
  };

  const flushTelemetry = (): Promise<void> => {
    if (!telemetryReporter || disposed) return Promise.resolve();
    try {
      return telemetryReporter.flush();
    } catch {
      return Promise.resolve();
    }
  };

  const setContext = async (context: {
    identity?: string;
    instanceId?: string;
    groups?: string[];
    claims?: Record<string, string>;
  }): Promise<void> => {
    if (disposed) return;
    if (context.instanceId !== undefined) {
      instanceId = typeof context.instanceId === 'string' ? context.instanceId.trim() : '';
    }
    if (context.identity !== undefined) {
      identity = typeof context.identity === 'string' && context.identity ? context.identity : undefined;
    }
    if (context.groups !== undefined) {
      groups = [...context.groups];
    }
    if (context.claims !== undefined) {
      claims = { ...context.claims };
    }
    definitionsGeneration += 1;
    cache = null;
    for (const controller of activeDefinitionRequests) controller.abort();
    recordTelemetry((reporter) => reporter.setContext({
      instanceId: instanceId || '',
      identity: identity || '',
    }));
    await refreshFlags();
  };

  const dispose = (options?: { flush?: boolean }): void => {
    if (disposed) return;
    disposed = true;
    stopWebSocket();
    for (const controller of activeDefinitionRequests) controller.abort();
    activeDefinitionRequests.clear();
    try {
      detachTelemetry?.();
    } catch {
      // Cleanup is best effort.
    }
    detachTelemetry = undefined;
    try {
      telemetryReporter?.dispose(options);
    } catch {
      // Cleanup is best effort.
    }
    telemetryReporter = undefined;
  };

  return {
    getFlags,
    getFlag,
    registerContext,
    refreshFlags,
    startWebSocket,
    stopWebSocket,
    recordUsage,
    recordView,
    incrementCounter,
    setGauge,
    flushTelemetry,
    setContext,
    dispose,
  };
}
