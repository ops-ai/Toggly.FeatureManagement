import type { Hook, EvaluatedDefinitions, TogglyEntityContext } from '@ops-ai/toggly-hooks-types';
import type { LocalGate } from '@ops-ai/toggly-local-gates';

export type { LocalGate };

/**
 * Toggly configuration options for Gatsby plugin
 */
export interface TogglyPluginOptions {
  /** Application key from Toggly dashboard */
  appKey: string;
  
  /** Environment name (e.g., 'Production', 'Staging') */
  environment?: string;
  
  /** Base URI for Toggly API */
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
  
  /** Default flag values when API is unavailable */
  flagDefaults?: Record<string, boolean>;
  
  /** Feature flags refresh interval in milliseconds (default: 180000 = 3 minutes) */
  featureFlagsRefreshInterval?: number;

  /**
   * Enable definitions WebSocket live updates in the browser (default: true).
   * When connected, HTTP polling becomes a rare fallback (~20 minutes).
   */
  enableLiveUpdates?: boolean;
  
  /** Enable all features during build (for hybrid approach with edge filtering) */
  allFeaturesEnabledDuringBuild?: boolean;
  
  /** User identity for targeting */
  identity?: string;

  /** User groups for targeting */
  groups?: string[];

  /** Custom claims for targeting */
  claims?: Record<string, string>;
  
  /** Enable debug logging */
  isDebug?: boolean;
  
  /** Connection timeout in milliseconds */
  connectTimeout?: number;
  
  /** Hooks to extend SDK behavior at key lifecycle points */
  hooks?: Hook[];

  /** Device-local gates applied as a read-time AND on worker-evaluated booleans */
  localGates?: LocalGate[];

  /** Optional SDK error callback for reporting fetch/cache/evaluation failures. */
  onError?: (message: string, error?: unknown) => void;
}

/**
 * Feature flags object
 */
export type { EvaluatedDefinitions, TogglyEntityContext } from '@ops-ai/toggly-hooks-types';

/** Feature flag definitions (boolean or entity gate per flag) */
export type Flags = EvaluatedDefinitions;

/**
 * Gate requirement type for multiple flags
 */
export type GateRequirement = 'all' | 'any';

/**
 * Server-side Toggly client interface
 */
export interface TogglyServerClient {
  /** Get all feature flags */
  getFlags(): Promise<Flags>;
  
  /** Get a single feature flag */
  getFlag(key: string, defaultValue?: boolean): Promise<boolean>;
  
  /** Evaluate a gate with multiple flags */
  evaluateGate(
    keys: string[],
    requirement: GateRequirement,
    negate?: boolean
  ): Promise<boolean>;
  
  /** Refresh flags from API */
  refreshFlags(): Promise<void>;
}

/**
 * Cached flags with timestamp
 */
export interface CachedFlags {
  flags: Flags;
  timestamp: number;
}

/**
 * Page to feature mapping for manifest
 */
export interface PageFeatureMap {
  [path: string]: string;
}

/**
 * Hook return type for feature flag
 */
export interface UseFeatureFlagResult {
  /** Whether the feature is enabled */
  isEnabled: boolean;
  
  /** Whether flags have been loaded */
  isReady: boolean;
  
  /** Error if flag loading failed */
  error: Error | null;
}

/**
 * Hook return type for feature gate
 */
export interface UseFeatureGateResult {
  /** Whether the gate condition is met */
  isEnabled: boolean;
  
  /** Whether flags have been loaded */
  isReady: boolean;
  
  /** Error if flag loading failed */
  error: Error | null;
}

/**
 * Hook return type for Toggly store access
 */
export interface UseTogglyResult {
  /** All feature flags */
  flags: Flags;
  
  /** Whether flags have been loaded */
  isReady: boolean;
  
  /** Error if flag loading failed */
  error: Error | null;
  
  /** Function to manually refresh flags */
  refreshFlags: () => Promise<void>;
}

/**
 * Component props for Feature component
 */
export interface FeatureProps {
  /** Feature flag key to check */
  flag: string;

  /** When true, render children when the feature is off */
  negate?: boolean;

  /** Entity instance or canonical entity context for entity-gated flags */
  context?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | Record<string, unknown> | null;

  /** Context kind for registerContext mapper lookup when `context` is a domain object */
  contextKind?: string;

  /** Content to render while flags are not ready (not an off-path branch) */
  loading?: React.ReactNode;

  /** Children to render when the gate passes */
  children: React.ReactNode;
}

/**
 * Component props for FeatureGate component
 */
export interface FeatureGateProps {
  /** Array of feature flag keys */
  flags: string[];

  /** Gate requirement: 'all' or 'any' */
  requirement?: GateRequirement;

  /** Negate the gate result */
  negate?: boolean;

  /** Entity instance or canonical entity context for entity-gated flags */
  context?: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | Record<string, unknown> | null;

  /** Context kind for registerContext mapper lookup when `context` is a domain object */
  contextKind?: string;

  /** Content to render while flags are not ready (not an off-path branch) */
  loading?: React.ReactNode;

  /** Children to render when gate is met */
  children: React.ReactNode;
}

/**
 * Component props for TogglyProvider
 */
export interface TogglyProviderProps {
  /** Toggly configuration */
  config: TogglyPluginOptions;
  
  /** Children to render */
  children: React.ReactNode;
}
