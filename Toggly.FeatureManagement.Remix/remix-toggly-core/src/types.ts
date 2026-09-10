/**
 * Core types for Toggly Remix SDK
 */

import type { LocalGate } from '@ops-ai/toggly-local-gates'
import type { EvaluatedDefinitions } from '@ops-ai/toggly-hooks-types'

export type {
  EntityGate,
  EntityGateRule,
  EvaluatedDefinitions,
  TogglyEntityContext,
} from '@ops-ai/toggly-hooks-types'

export type { LocalGate }

/**
 * Feature requirement - whether all or any features must be enabled
 */
export type FeatureRequirement = 'all' | 'any';

/**
 * Where feature evaluation happens for definitions fetches.
 * - `remote` (default): fetch `evaluated-signed` with context query params
 * - `local`: fetch `definitions-signed` (rules only) and evaluate with `@ops-ai/toggly-eval`
 */
export type EvaluationMode = 'local' | 'remote';

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
  /**
   * Evaluation rail. Defaults to `remote` for backward compatibility.
   * Use `local` for definitions-signed + call-site evaluation (server multi-tenant).
   */
  evaluationMode?: EvaluationMode;
  /** Default feature values for offline/fallback mode */
  featureDefaults?: Record<string, boolean>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Enable debug logging */
  debug?: boolean;
  /**
   * When true, verify ES256 signed definition envelopes via JWKS before applying flags.
   */
  verifySignatures?: boolean;
  /**
   * Optional allow-list of JWKS `kid` values when verifySignatures is enabled.
   */
  allowedKeyIds?: string[];
  /**
   * Reject envelopes whose `timestamp` is older than this many seconds.
   * Unset or <= 0 disables freshness checks.
   */
  maxSignatureAgeSeconds?: number;
  /** Device-local gates applied as a read-time AND on worker-evaluated booleans */
  localGates?: LocalGate[];
  /** Optional SDK error callback for reporting fetch/evaluation failures. */
  onError?: (message: string, error?: unknown) => void;
  /** Initial browser identity; hydrated server identity takes precedence. */
  identity?: string;
  /** User groups for targeting */
  groups?: string[];
  /** Custom claims for targeting */
  claims?: Record<string, string>;
  /**
   * Base URL for usage/metrics transport (default: https://app.toggly.io/).
   * Separate from `baseUrl`, which is for definitions/JWKS.
   */
  metricsBaseUrl?: string;
  /**
   * Enable feature usage tracking (Usage.SendStats / api/usage/stats).
   * Defaults to false in core; remix-toggly-server enables when appKey is set.
   */
  enableUsageTracking?: boolean;
  /**
   * Enable business metrics (Metrics.SendMetrics / api/metrics).
   * Defaults to false in core; remix-toggly-server enables when appKey is set.
   */
  enableMetrics?: boolean;
  /** Usage flush interval in ms (default: 60000). 0 disables the timer. */
  usageFlushInterval?: number;
  /** Metrics flush interval in ms (default: 60000). 0 disables the timer. */
  metricsFlushInterval?: number;
  /** Hostname/instance name reported with usage/metrics payloads. */
  instanceName?: string;
  /** Application version reported with usage payloads. */
  appVersion?: string;
  /**
   * Telemetry transport when clients are not injected.
   * Server should use `grpc` with injected clients; edge adapters use `https`.
   */
  telemetryTransport?: 'grpc' | 'https';
  /**
   * Attach Node process signal handlers for best-effort flush (default: true for grpc).
   * Edge adapters must set false.
   */
  telemetryAttachProcessHandlers?: boolean;
  /**
   * Injected usage sender (gRPC stub or test double).
   * @internal
   */
  usageClient?: import('./telemetry/index').UsageSender | null;
  /**
   * Injected metrics sender (gRPC stub or test double).
   * @internal
   */
  metricsClient?: import('./telemetry/index').MetricsSender | null;
  /** Optional fetch override for HTTPS telemetry (edge/tests). */
  telemetryFetch?: typeof fetch;
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
  /** Custom claims for targeting */
  claims?: Record<string, string>;
  /** HTTP request segment fields (UA / Accept-Language / country) */
  request?: {
    userAgent?: string;
    acceptLanguage?: string;
    country?: string;
  };
}

/**
 * Feature flags state (boolean or entity gate per flag)
 */
export type FeatureFlags = EvaluatedDefinitions;

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
