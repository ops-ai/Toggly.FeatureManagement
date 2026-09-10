/**
 * Toggly Astro SDK - Type Definitions
 */

import type { Hook, EvaluatedDefinitions, TogglyEntityContext } from '@ops-ai/toggly-hooks-types';
import type { LocalGate } from '@ops-ai/toggly-local-gates';

/**
 * Configuration options for Toggly integration
 */
export interface TogglyConfig {
  /** Base URI for the Toggly definitions API (default: 'https://definitions.toggly.io') */
  baseURI?: string;
  /** Whether signatures should be verified on signed responses */
  verifySignatures?: boolean;
  /**
   * Optional allow-list of JWKS `kid` values when verifySignatures is enabled.
   * Empty/undefined accepts any key present in JWKS.
   */
  allowedKeyIds?: string[];
  /**
   * Reject envelopes whose `timestamp` is older than this many seconds.
   * Unset or <= 0 disables freshness checks.
   */
  maxSignatureAgeSeconds?: number;
  /** Application key from Toggly */
  appKey?: string;
  /** Environment name (e.g., 'Production', 'Staging') (default: 'Production') */
  environment?: string;
  /** Default flag values to use when API is unavailable */
  flagDefaults?: Record<string, boolean>;
  /** Feature flags refresh interval in milliseconds (default: 180000 = 3 minutes) */
  featureFlagsRefreshInterval?: number;
  /**
   * When true (default), the browser client connects to the definitions WebSocket
   * for live flag updates. Set false to rely on polling only.
   */
  enableLiveUpdates?: boolean;
  /** Enable debug logging (default: false) */
  isDebug?: boolean;
  /** Connection timeout in milliseconds (default: 5000) */
  connectTimeout?: number;
  /** User identity for targeting (optional) */
  identity?: string;
  /** User groups for targeting (optional) */
  groups?: string[];
  /** Custom claims for targeting (optional) */
  claims?: Record<string, string>;
  /**
   * When true, all features are enabled during build time (SSG).
   * This is useful when you have an edge worker (like Cloudflare Worker) that
   * filters content based on feature flags at runtime.
   * During dev server, actual feature flags from the API are still used.
   * (default: false)
   */
  allFeaturesEnabledDuringBuild?: boolean;
  /**
   * When true, fetches from /evaluated-variants-signed and exposes variant APIs on the server client
   * and on the client store module.
   */
  enableVariants?: boolean;
  /** Hooks to extend SDK behavior at key lifecycle points */
  hooks?: Hook[];
  /** Device-local gates applied as a read-time AND on worker-evaluated booleans */
  localGates?: LocalGate[];
  /** Optional SDK error callback for reporting fetch/cache/evaluation failures. */
  onError?: (message: string, error?: unknown) => void;
  /**
   * When true, report usage stats (including definition cache hits/misses) via
   * HTTPS `POST api/usage/stats`. Defaults to true when `appKey` is set.
   * `TOGGLY_DISABLE_TELEMETRY=1` always wins over an explicit `true`.
   */
  enableUsageTracking?: boolean;
  /** Gateway base URL for usage flush (default: `https://app.toggly.io/`). */
  metricsBaseUrl?: string;
  /** Usage flush interval in ms (default: 60000). Set `0` to disable the timer. */
  usageFlushInterval?: number;
  /** Optional instance name included on usage payloads. */
  instanceName?: string;
  /**
   * Optional consuming-application version on usage payloads (heartbeat /
   * deployment identity). Omit when unset — do not confuse with SDK version
   * (sent via User-Agent / X-Toggly-Sdk-*).
   */
  appVersion?: string;
  /**
   * When true (default for long-lived `TogglyServer`), attach process signal
   * flush handlers. Middleware-created request-scoped clients default this to
   * false and close at end of request.
   */
  telemetryAttachProcessHandlers?: boolean;
  /** Optional fetch implementation for HTTPS usage flush (tests / edge). */
  telemetryFetch?: typeof fetch;
  /**
   * Injected usage sender for tests. When unset and usage is enabled, the
   * server client builds a soft-fail HTTPS client to `api/usage/stats`.
   */
  usageClient?: {
    sendStats(request: Record<string, unknown>): Promise<unknown>;
    close?(): void;
  } | null;
}

/**
 * Assigned variant for a feature (from evaluated-variants-signed).
 */
export interface VariantResult {
  name: string;
  configurationValue?: unknown;
}

/**
 * Raw evaluated entry from /evaluated-variants-signed `defs`.
 */
export interface EvaluatedVariantDef {
  enabled: boolean;
  variant?: string;
  configurationValue?: unknown;
}

/**
 * Map of feature flag keys to their boolean values
 */
export type { EvaluatedDefinitions, TogglyEntityContext } from '@ops-ai/toggly-hooks-types';

/** Feature flag definitions (boolean or entity gate per flag) */
export type Flags = EvaluatedDefinitions;

/**
 * Toggly client instance interface
 */
export interface TogglyClient {
  /**
   * Get all feature flags as a map of key-value pairs
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
   * Evaluate a feature gate with multiple flags
   * @param keys - Array of feature flag keys to evaluate
   * @param requirement - 'all' requires all flags to be true, 'any' requires at least one
   * @param negate - If true, negates the result
   * @returns Promise resolving to boolean evaluation result
   */
  evaluateGate(
    keys: string[],
    requirement?: 'all' | 'any',
    negate?: boolean
  ): Promise<boolean>;

  /**
   * Manually refresh the feature flags cache by fetching from the API
   * @returns Promise that resolves when flags have been refreshed
   */
  refreshFlags(): Promise<void>;

  /**
   * Current variant assignment for a feature (requires {@link TogglyConfig.enableVariants}).
   */
  getVariant(featureKey: string): Promise<VariantResult | null>;

  /**
   * Configuration payload for the assigned variant, if any.
   */
  getVariantValue(featureKey: string): Promise<unknown | null>;
}

/**
 * Page feature mapping for frontmatter extraction
 */
export interface PageFeatureMapping {
  [routePath: string]: string;
}

/**
 * Props for Feature component
 */
export interface FeatureProps {
  /** Single feature flag key to check */
  flag?: string;
  /** Multiple feature flag keys to check */
  flags?: string[];
  /** Requirement for multiple flags: 'all' or 'any' (default: 'all') */
  requirement?: 'all' | 'any';
  /** If true, negates the result (default: false) */
  negate?: boolean;
}

/**
 * Props for FeatureClient component
 */
export interface FeatureClientProps {
  /** Feature flag key to check */
  flag: string;
  /** Hydration strategy: 'load', 'idle', or 'visible' */
  client?: 'load' | 'idle' | 'visible';
}

/**
 * Augment Astro global types
 */
declare global {
  namespace App {
    interface Locals {
      toggly: TogglyClient;
    }
  }

  interface Window {
    __TOGGLY_CONFIG__?: TogglyConfig;
    __TOGGLY_PAGE_FEATURES__?: PageFeatureMapping;
  }
}

export {};


