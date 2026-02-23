import type { Hook } from '@ops-ai/toggly-hooks-types';

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
  
  /** Default flag values when API is unavailable */
  flagDefaults?: Record<string, boolean>;
  
  /** Feature flags refresh interval in milliseconds (default: 180000 = 3 minutes) */
  featureFlagsRefreshInterval?: number;
  
  /** Enable all features during build (for hybrid approach with edge filtering) */
  allFeaturesEnabledDuringBuild?: boolean;
  
  /** User identity for targeting */
  identity?: string;
  
  /** Enable debug logging */
  isDebug?: boolean;
  
  /** Connection timeout in milliseconds */
  connectTimeout?: number;
  
  /** Hooks to extend SDK behavior at key lifecycle points */
  hooks?: Hook[];
}

/**
 * Feature flags object
 */
export interface Flags {
  [key: string]: boolean;
}

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
  
  /** Fallback content when feature is disabled */
  fallback?: React.ReactNode;
  
  /** Children to render when feature is enabled */
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
  
  /** Fallback content when gate is not met */
  fallback?: React.ReactNode;
  
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
