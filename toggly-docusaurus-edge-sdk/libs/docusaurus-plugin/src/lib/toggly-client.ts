/**
 * @ops-ai/toggly-client-core - Framework-agnostic Toggly client
 *
 * Bundled directly into the Docusaurus plugin to avoid module resolution issues.
 * Original source: @ops-ai/toggly-client-core
 */

/**
 * Configuration options for creating a Toggly client
 * Matches the API structure used in other Toggly SDKs
 */
export interface TogglyConfig {
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
}

/**
 * Map of feature flag keys to their boolean values
 */
export type Flags = Record<string, boolean>;

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
    identity,
  } = config;

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

  const getApiUrl = (): string => {
    const baseUrl = baseURI.replace(/\/$/, ''); // Remove trailing slash
    
    // If no appKey is provided, return empty URL (will use flagDefaults)
    if (!appKey) {
      return '';
    }

    // Use the signed-flags endpoint exposed by definitions.toggly.io.
    // The response is `{ defs: { [flag]: bool }, signature, timestamp, kid }`;
    // fetchFlags() unwraps `defs` if present.
    let url = `${baseUrl}/evaluated-signed/${appKey}/${environment}`;
    
    // Add identity parameter if provided
    if (identity) {
      url += `?u=${identity}`;
    }
    
    return url;
  };

  const isCacheValid = (): boolean => {
    if (!cache) return false;
    const age = Date.now() - cache.timestamp;
    // When WebSocket is connected, use a longer fallback interval for polling
    const interval = _wsConnected ? FALLBACK_REFRESH_INTERVAL : featureFlagsRefreshInterval;
    return age < interval;
  };

  const fetchFlags = async (): Promise<Flags> => {
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
      const timeoutId = setTimeout(() => controller.abort(), connectTimeout);

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

      const payload = await response.json();
      const flags = (payload && typeof payload === 'object' && 'defs' in payload ? payload.defs : payload) as Flags;
      
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
    }
  };

  const refreshFlags = async (): Promise<void> => {
    if (isDebug) {
      console.log('Toggly.refresh');
    }
    
    const flags = await fetchFlags();
    cache = {
      flags,
      timestamp: Date.now(),
    };
  };

  const getFlags = async (): Promise<Flags> => {
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
    const value = flags[key];
    
    // If flag exists in flags, return it; otherwise use provided defaultValue or flagDefaults
    if (value !== undefined) {
      return value;
    }
    
    // Check flagDefaults first, then use provided defaultValue
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    
    // Fall back to flagDefaults if available
    return flagDefaults[key] ?? false;
  };

  const startWebSocket = (): void => {
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
      _ws.close();
      _ws = null;
    }

    _wsConnected = false;

    if (isDebug) {
      console.log('Toggly.ws - stopped');
    }
  };

  return {
    getFlags,
    getFlag,
    refreshFlags,
    startWebSocket,
    stopWebSocket,
  };
}
