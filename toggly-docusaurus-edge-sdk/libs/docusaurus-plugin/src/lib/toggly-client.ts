import { captureRequestUrl } from './capture-request-url.js';
import { buildEvaluatedSignedUrl } from '@ops-ai/toggly-hooks-types';
import {
  createTelemetryReporter,
  type TelemetryOptions,
  type TelemetryReporter,
} from '@ops-ai/toggly-client-telemetry';
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser';

/**
 * @ops-ai/toggly-client-core - Framework-agnostic Toggly client
 *
 * Bundled directly into the Docusaurus plugin to avoid module resolution issues.
 * Original source: @ops-ai/toggly-client-core
 */

import {
  parseEvaluatedResponseBody,
  readResponseBody,
  unwrapDefsPayload,
} from './signed-response.js';

/**
 * Configuration options for creating a Toggly client
 * Matches the API structure used in other Toggly SDKs
 */
export interface TogglyConfig {
  enableTelemetry?: boolean;
  metricsBaseUrl?: string;
  telemetryFlushIntervalMs?: number;
  telemetryFetch?: TelemetryOptions['fetch'];
  onTelemetryDiagnostic?: TelemetryOptions['onDiagnostic'];
  /** Base URI for the Toggly API (default: 'https://definitions.toggly.io') */
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
}

/**
 * Map of feature flag keys to their boolean values
 */
export type Flags = Record<string, boolean>;

/**
 * Toggly client instance
 */
export interface TogglyClient {
  recordUsage(key: string, variant?: string): void;
  recordView(key: string, variant?: string): void;
  incrementCounter(key: string, value?: number): void;
  setGauge(key: string, value: number): void;
  flushTelemetry(): Promise<void>;
  dispose(): void;
  /** Activate a committed browser owner without evaluating flags. */
  startTelemetry(): void;
  /** Evaluate an already resolved snapshot through the same leaf path. */
  evaluateFlag(key: string, flags: Flags, defaultValue?: boolean): boolean;
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
  getFlag(key: string, defaultValue?: boolean): Promise<boolean>;

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
}

interface CachedFlags {
  flags: Flags;
  timestamp: number;
}

/**
 * Creates a new Toggly client instance
 *
 * @param config - Configuration options for the client
 * @returns A Toggly client instance
 */
export function createTogglyClient(config: TogglyConfig = {}): TogglyClient {
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

  // Serialize once so caller mutations cannot change this client's targeting or refreshes.
  const getApiUrl = captureRequestUrl(() =>
    appKey ? buildEvaluatedSignedUrl(baseURI, appKey, environment, config, false) : ''
  );

  // Resolve fetch implementation: use provided, then globalThis.fetch, then throw
  let resolvedFetch: typeof fetch;
  if (fetchImpl) {
    resolvedFetch = fetchImpl;
  } else if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
    resolvedFetch = globalThis.fetch.bind(globalThis);
  } else {
    throw new Error(
      'fetch is not available. Please provide a fetch implementation via config.fetch'
    );
  }

  // WebSocket live-update support
  const FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000; // 20 minutes
  const WS_RECONNECT_DELAY = 5000; // 5 seconds

  let _ws: WebSocket | null = null;
  let _wsConnected = false;
  let _wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let _lastFallbackRefresh = 0;

  let cache: CachedFlags | null = null;
  let disposed = false;
  let generation = 0;
  const requests = new Map<AbortController, ReturnType<typeof setTimeout>>();
  let reporter: TelemetryReporter | undefined;
  let detachTelemetry: (() => void) | undefined;
  // React may discard an owner during render. Construction itself schedules nothing.
  const startTelemetry = () => {
    if (
      disposed ||
      reporter ||
      config.enableTelemetry === false ||
      !appKey?.trim() ||
      typeof window === 'undefined' ||
      typeof document === 'undefined'
    )
      return;
    reporter = createTelemetryReporter({
      appKey,
      environment,
      metricsBaseUrl: config.metricsBaseUrl,
      telemetryFlushIntervalMs: config.telemetryFlushIntervalMs,
      fetch: config.telemetryFetch,
      onDiagnostic: config.onTelemetryDiagnostic,
    });
    detachTelemetry = attachBrowserLifecycle(reporter);
  };
  const evaluateFlag = (key: string, flags: Flags, defaultValue?: boolean): boolean => {
    const enabled = flags[key] ?? defaultValue ?? flagDefaults[key] ?? false;
    startTelemetry();
    reporter?.recordCheck(key, enabled ? 'enabled' : 'disabled');
    return enabled;
  };

  const isCacheValid = (): boolean => {
    if (!cache) return false;
    const age = Date.now() - cache.timestamp;
    // When WebSocket is connected, use a longer fallback interval for polling
    const interval = _wsConnected ? FALLBACK_REFRESH_INTERVAL : featureFlagsRefreshInterval;
    return age < interval;
  };

  const fetchFlags = async (): Promise<Flags> => {
    if (disposed) return { ...(cache?.flags ?? flagDefaults) };
    const url = getApiUrl();

    // If no appKey, return flagDefaults
    if (!url || !appKey) {
      if (isDebug) {
        console.log(`Toggly.usedFlagDefaults - ${JSON.stringify(flagDefaults)}`);
      }
      return { ...flagDefaults };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), connectTimeout);
    requests.set(controller, timeoutId);
    try {
      const response = await resolvedFetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch flags from Toggly API: ${response.status} ${response.statusText}`
        );
      }

      const bodyText = await readResponseBody(response);
      if (disposed) return { ...flagDefaults };
      const parsed = await parseEvaluatedResponseBody(bodyText, {
        verifySignatures,
        baseURI,
        allowedKeyIds,
        maxSignatureAgeSeconds,
        headers: { Accept: 'application/json' },
        fetchImpl: (input, init) => resolvedFetch(input, { ...init, signal: controller.signal }),
      });
      const flags = (verifySignatures ? (parsed as Flags) : unwrapDefsPayload(parsed)) as Flags;

      if (isDebug) {
        console.log(`Toggly.fetchFeatureFlags - ${JSON.stringify(flags)}`);
      }

      return flags;
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
    } finally {
      clearTimeout(timeoutId);
      requests.delete(controller);
    }
  };

  const refreshFlags = async (): Promise<void> => {
    if (disposed) return;
    const expected = ++generation;
    if (isDebug) {
      console.log('Toggly.refresh');
    }

    const flags = await fetchFlags();
    if (disposed || generation !== expected) return;
    cache = {
      flags,
      timestamp: Date.now(),
    };
  };

  const getFlags = async (): Promise<Flags> => {
    if (disposed) return { ...(cache?.flags ?? flagDefaults) };
    // If no appKey, return flagDefaults immediately
    if (!appKey) {
      return { ...flagDefaults };
    }

    if (isCacheValid() && cache) {
      return { ...cache.flags };
    }

    await refreshFlags();
    return cache ? { ...cache.flags } : { ...flagDefaults };
  };

  const getFlag = async (key: string, defaultValue?: boolean): Promise<boolean> => {
    const flags = await getFlags();
    return evaluateFlag(key, flags, defaultValue);
  };

  const startWebSocket = (): void => {
    if (disposed || _ws) return;
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
    const wsUrl =
      baseURI
        .replace(/^https:\/\//, 'wss://')
        .replace(/^http:\/\//, 'ws://')
        .replace(/\/$/, '') + `/${appKey}/ws`;

    if (isDebug) {
      console.log(`Toggly.ws - connecting to ${wsUrl}`);
    }

    try {
      _ws = new WebSocket(wsUrl);

      _ws.onopen = () => {
        _wsConnected = true;
        _lastFallbackRefresh = Date.now();
        if (isDebug) {
          console.log('Toggly.ws - connected');
        }
      };

      _ws.onmessage = (event: MessageEvent) => {
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
      _ws.onmessage = null;
      _ws.onopen = null;
      _ws.onerror = null;
      _ws.close();
      _ws = null;
    }

    _wsConnected = false;

    if (isDebug) {
      console.log('Toggly.ws - stopped');
    }
  };

  return {
    startTelemetry,
    evaluateFlag,
    recordUsage(key, variant = 'enabled') {
      startTelemetry();
      reporter?.recordUsage(key, variant);
    },
    recordView(key, variant = 'enabled') {
      startTelemetry();
      reporter?.recordView(key, variant);
    },
    incrementCounter(key, value = 1) {
      startTelemetry();
      reporter?.incrementCounter(key, value);
    },
    setGauge(key, value) {
      startTelemetry();
      reporter?.setGauge(key, value);
    },
    async flushTelemetry() {
      await reporter?.flush();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      stopWebSocket();
      for (const [controller, timer] of requests) {
        clearTimeout(timer);
        controller.abort();
      }
      requests.clear();
      detachTelemetry?.();
      reporter?.dispose();
    },
    getFlags,
    getFlag,
    refreshFlags,
    startWebSocket,
    stopWebSocket,
  };
}
