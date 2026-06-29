/**
 * Core types for Toggly Remix SDK
 */

import type { LocalGate } from '@ops-ai/toggly-local-gates'

export type { LocalGate }

/**
 * Feature requirement - whether all or any features must be enabled
 */
export type FeatureRequirement = 'all' | 'any';

/**
 * Configuration options for Toggly
 */
export interface TogglyConfig {
  /** Toggly application key */
  appKey?: string;
  /** Environment name (e.g., 'Production', 'Staging') */
  environment?: string;
  /** Base URL for Toggly API */
  baseUrl?: string;
  /** Default feature values for offline/fallback mode */
  featureDefaults?: Record<string, boolean>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Device-local gates applied as a read-time AND on worker-evaluated booleans */
  localGates?: LocalGate[];
}

/**
 * User identity context for feature targeting
 */
export interface IdentityContext {
  /** Unique user identifier */
  identity?: string;
  /** User groups for targeting */
  groups?: string[];
  /** Custom traits for targeting */
  traits?: Record<string, string | number | boolean>;
}

/**
 * Feature flags state
 */
export interface FeatureFlags {
  [key: string]: boolean;
}

/**
 * Feature evaluation options
 */
export interface EvaluationOptions {
  /** Feature key or keys to evaluate */
  featureKey?: string;
  featureKeys?: string[];
  /** Requirement type for multiple features */
  requirement?: FeatureRequirement;
  /** Negate the result */
  negate?: boolean;
  /** Default value if feature is not found */
  defaultValue?: boolean;
}

/**
 * Feature evaluation result
 */
export interface EvaluationResult {
  /** Whether the feature(s) are enabled */
  enabled: boolean;
  /** The feature keys that were evaluated */
  featureKeys: string[];
  /** The requirement type used */
  requirement: FeatureRequirement;
  /** Whether the result was negated */
  negated: boolean;
}

/**
 * Server-side feature context passed to client
 */
export interface ServerFeatureContext {
  /** Pre-fetched feature flags */
  flags: FeatureFlags;
  /** User identity (if any) */
  identity?: string;
  /** App key (for client-side refresh) */
  appKey?: string;
  /** Environment */
  environment?: string;
  /** Timestamp when flags were fetched */
  fetchedAt: number;
}

/**
 * Loader data with feature flags
 */
export interface TogglyLoaderData {
  /** Feature context for hydration */
  __toggly: ServerFeatureContext;
}

/**
 * Hook metadata
 */
export interface HookMetadata {
  name: string;
  version?: string;
  description?: string;
}

/**
 * Evaluation series data passed between before/after hooks
 */
export interface EvaluationSeriesData {
  [key: string]: unknown;
}

/**
 * Identity series data passed between before/after hooks
 */
export interface IdentitySeriesData {
  [key: string]: unknown;
}

/**
 * Hook interface for extending SDK behavior
 */
export interface TogglyHook {
  /** Get hook metadata */
  getMetadata(): HookMetadata;

  /** Called before feature evaluation */
  beforeEvaluation?(
    flagKey: string,
    defaultValue?: boolean
  ): Promise<EvaluationSeriesData | void> | EvaluationSeriesData | void;

  /** Called after feature evaluation */
  afterEvaluation?(
    flagKey: string,
    data: EvaluationSeriesData | void,
    result: boolean
  ): Promise<void> | void;

  /** Called before user identification */
  beforeIdentify?(
    identity: string
  ): Promise<IdentitySeriesData | void> | IdentitySeriesData | void;

  /** Called after user identification */
  afterIdentify?(
    identity: string,
    data: IdentitySeriesData | void
  ): Promise<void> | void;

  /** Called after feature flags are refreshed */
  afterRefresh?(flags: FeatureFlags): Promise<void> | void;
}

/**
 * Cookie/session storage options
 */
export interface StorageOptions {
  /** Cookie name for identity */
  identityCookieName?: string;
  /** Cookie name for feature flags cache */
  flagsCookieName?: string;
  /** Cookie max age in seconds */
  maxAge?: number;
  /** Cookie path */
  path?: string;
  /** Cookie domain */
  domain?: string;
  /** Secure flag */
  secure?: boolean;
  /** SameSite attribute */
  sameSite?: 'strict' | 'lax' | 'none';
}

/**
 * Error types for Toggly SDK
 */
export class TogglyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'TogglyError';
  }
}

export class TogglyNetworkError extends TogglyError {
  constructor(message: string, cause?: unknown) {
    super(message, 'NETWORK_ERROR', cause);
    this.name = 'TogglyNetworkError';
  }
}

export class TogglyConfigError extends TogglyError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'TogglyConfigError';
  }
}

export class TogglyTimeoutError extends TogglyError {
  constructor(message: string) {
    super(message, 'TIMEOUT_ERROR');
    this.name = 'TogglyTimeoutError';
  }
}
