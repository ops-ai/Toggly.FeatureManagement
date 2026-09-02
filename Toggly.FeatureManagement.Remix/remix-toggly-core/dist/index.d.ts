import { LocalGate } from '@ops-ai/toggly-local-gates';
export { LocalGate } from '@ops-ai/toggly-local-gates';
import { EvaluatedDefinitions, TogglyEvaluationContext, TogglyEntityContext } from '@ops-ai/toggly-hooks-types';
export { EntityGate, EntityGateRule, EvaluatedDefinitions, TogglyEntityContext, clearRegisteredContexts, normalizeEntityContext, registerContext, resolveEvaluatedDefinition, toBooleanDefinitions } from '@ops-ai/toggly-hooks-types';
import { DefinitionsByKey, EvalContext } from '@ops-ai/toggly-eval';
export { DefinitionsByKey, EntityEvalContext, EvalContext, FeatureDefinitionModel, evaluateDefinitions, indexDefinitions, parseDefinitionsPayload, snapshotEvaluatedBooleans } from '@ops-ai/toggly-eval';

/**
 * Core types for Toggly Remix SDK
 */

/**
 * Feature requirement - whether all or any features must be enabled
 */
type FeatureRequirement = 'all' | 'any';
/**
 * Where feature evaluation happens for definitions fetches.
 * - `remote` (default): fetch `evaluated-signed` with context query params
 * - `local`: fetch `definitions-signed` (rules only) and evaluate with `@ops-ai/toggly-eval`
 */
type EvaluationMode = 'local' | 'remote';
/**
 * Configuration options for Toggly
 */
interface TogglyConfig {
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
    /** User groups for targeting */
    groups?: string[];
    /** Custom claims for targeting */
    claims?: Record<string, string>;
}
/**
 * User identity context for feature targeting
 */
interface IdentityContext {
    /** Unique user identifier */
    identity?: string;
    /** User groups for targeting */
    groups?: string[];
    /** Custom traits for targeting */
    traits?: Record<string, string | number | boolean>;
    /** Custom claims for targeting */
    claims?: Record<string, string>;
}
/**
 * Feature flags state (boolean or entity gate per flag)
 */
type FeatureFlags = EvaluatedDefinitions;
/**
 * Feature evaluation options
 */
interface EvaluationOptions {
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
interface EvaluationResult {
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
interface ServerFeatureContext {
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
interface TogglyLoaderData {
    /** Feature context for hydration */
    __toggly: ServerFeatureContext;
}
/**
 * Hook metadata
 */
interface HookMetadata {
    name: string;
    version?: string;
    description?: string;
}
/**
 * Evaluation series data passed between before/after hooks
 */
interface EvaluationSeriesData {
    [key: string]: unknown;
}
/**
 * Identity series data passed between before/after hooks
 */
interface IdentitySeriesData {
    [key: string]: unknown;
}
/**
 * Hook interface for extending SDK behavior
 */
interface TogglyHook {
    /** Get hook metadata */
    getMetadata(): HookMetadata;
    /** Called before feature evaluation */
    beforeEvaluation?(flagKey: string, defaultValue?: boolean): Promise<EvaluationSeriesData | void> | EvaluationSeriesData | void;
    /** Called after feature evaluation */
    afterEvaluation?(flagKey: string, data: EvaluationSeriesData | void, result: boolean): Promise<void> | void;
    /** Called before user identification */
    beforeIdentify?(identity: string): Promise<IdentitySeriesData | void> | IdentitySeriesData | void;
    /** Called after user identification */
    afterIdentify?(identity: string, data: IdentitySeriesData | void): Promise<void> | void;
    /** Called after feature flags are refreshed */
    afterRefresh?(flags: FeatureFlags): Promise<void> | void;
}
/**
 * Cookie/session storage options
 */
interface StorageOptions {
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
declare class TogglyError extends Error {
    readonly code: string;
    readonly cause?: unknown | undefined;
    constructor(message: string, code: string, cause?: unknown | undefined);
}
declare class TogglyNetworkError extends TogglyError {
    constructor(message: string, cause?: unknown);
}
declare class TogglyConfigError extends TogglyError {
    constructor(message: string);
}
declare class TogglyTimeoutError extends TogglyError {
    constructor(message: string);
}

/**
 * Utility functions for Toggly Remix SDK
 */

/**
 * Default Toggly configuration
 */
declare const DEFAULT_CONFIG: Required<Pick<TogglyConfig, 'baseUrl' | 'environment' | 'timeout' | 'debug' | 'evaluationMode'>>;
/**
 * Merge user config with defaults
 */
declare function mergeConfig(config: TogglyConfig): TogglyConfig;
/**
 * Build the feature definitions URL.
 *
 * - `evaluationMode: 'remote'` (default): `/evaluated-signed/...` + context query params
 * - `evaluationMode: 'local'`: `/definitions-signed/...` with no evaluation context params
 */
declare function buildDefinitionsUrl(config: TogglyConfig, context?: string | TogglyEvaluationContext): string;
/**
 * Evaluate a single feature
 */
declare function isFeatureEnabled(flags: FeatureFlags, featureKey: string, defaultValue?: boolean, entityContext?: TogglyEntityContext | null): boolean;

/**
 * Locally evaluate a single feature against definitions-signed rules.
 */
declare function isFeatureEnabledLocal(defsByKey: DefinitionsByKey | null | undefined, featureKey: string, evalCtx?: EvalContext, defaultValue?: boolean): boolean;
/**
 * Locally evaluate multiple features with requirement against definitions-signed rules.
 */
declare function evaluateFeatureGateLocal(defsByKey: DefinitionsByKey | null | undefined, featureKeys: string[], requirement?: FeatureRequirement, negate?: boolean, defaultValue?: boolean, evalCtx?: EvalContext): EvaluationResult;
/**
 * Evaluate multiple features with requirement
 */
declare function evaluateFeatureGate(flags: FeatureFlags, featureKeys: string[], requirement?: FeatureRequirement, negate?: boolean, defaultValue?: boolean, entityContext?: TogglyEntityContext | null): EvaluationResult;
/**
 * Normalize feature keys from options
 */
declare function normalizeFeatureKeys(featureKey?: string, featureKeys?: string[]): string[];
/**
 * Create a debug logger
 */
declare function createLogger(debug: boolean): {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
};
/**
 * Parse identity from various sources (cookie value, header, etc.)
 */
declare function parseIdentity(value: string | null | undefined): string | undefined;
/**
 * Serialize feature flags for transport
 */
declare function serializeFlags(flags: FeatureFlags): string;
/**
 * Deserialize feature flags from transport
 */
declare function deserializeFlags(value: string | null | undefined): FeatureFlags;
/**
 * Check if we're running on the server
 */
declare function isServer(): boolean;
/**
 * Check if we're running on the client
 */
declare function isClient(): boolean;
/**
 * Create a timeout promise
 */
declare function createTimeout(ms: number): Promise<never>;
/**
 * Fetch with timeout
 */
declare function fetchWithTimeout(url: string, options?: RequestInit, timeout?: number): Promise<Response>;

/**
 * Constants for Toggly Remix SDK
 */
/** Default base URL for Toggly API */
declare const DEFAULT_BASE_URL = "https://definitions.toggly.io";
/** Default environment name */
declare const DEFAULT_ENVIRONMENT = "Production";
/** Default request timeout in milliseconds */
declare const DEFAULT_TIMEOUT = 10000;
/** Cookie/storage key names */
declare const STORAGE_KEYS: {
    /** Identity cookie/storage key */
    readonly IDENTITY: "toggly_identity";
    /** Feature flags cache key */
    readonly FLAGS: "toggly_flags";
    /** Config cache key */
    readonly CONFIG: "toggly_config";
    /** Last fetch timestamp key */
    readonly LAST_FETCH: "toggly_last_fetch";
};
/** HTTP header names */
declare const HEADERS: {
    /** Identity header */
    readonly IDENTITY: "x-toggly-identity";
    /** Feature flags header */
    readonly FLAGS: "x-toggly-flags";
    /** Cache control */
    readonly CACHE_CONTROL: "cache-control";
};
/** Feature requirement types */
declare const REQUIREMENT: {
    ALL: "all";
    ANY: "any";
};
/** Error codes */
declare const ERROR_CODES: {
    readonly NETWORK_ERROR: "NETWORK_ERROR";
    readonly CONFIG_ERROR: "CONFIG_ERROR";
    readonly TIMEOUT_ERROR: "TIMEOUT_ERROR";
    readonly PARSE_ERROR: "PARSE_ERROR";
    readonly UNKNOWN_ERROR: "UNKNOWN_ERROR";
};
/** Meta key for loader data */
declare const TOGGLY_LOADER_KEY: "__toggly";

export { DEFAULT_BASE_URL, DEFAULT_CONFIG, DEFAULT_ENVIRONMENT, DEFAULT_TIMEOUT, ERROR_CODES, HEADERS, REQUIREMENT, STORAGE_KEYS, TOGGLY_LOADER_KEY, TogglyConfigError, TogglyError, TogglyNetworkError, TogglyTimeoutError, buildDefinitionsUrl, createLogger, createTimeout, deserializeFlags, evaluateFeatureGate, evaluateFeatureGateLocal, fetchWithTimeout, isClient, isFeatureEnabled, isFeatureEnabledLocal, isServer, mergeConfig, normalizeFeatureKeys, parseIdentity, serializeFlags };
export type { EvaluationMode, EvaluationOptions, EvaluationResult, EvaluationSeriesData, FeatureFlags, FeatureRequirement, HookMetadata, IdentityContext, IdentitySeriesData, ServerFeatureContext, StorageOptions, TogglyConfig, TogglyHook, TogglyLoaderData };
