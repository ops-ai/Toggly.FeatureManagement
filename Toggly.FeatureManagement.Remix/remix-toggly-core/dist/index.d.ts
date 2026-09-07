import { LocalGate } from '@ops-ai/toggly-local-gates';
export { LocalGate } from '@ops-ai/toggly-local-gates';
import { EvaluatedDefinitions, TogglyEvaluationContext, TogglyEntityContext } from '@ops-ai/toggly-hooks-types';
export { EntityGate, EntityGateRule, EvaluatedDefinitions, TogglyEntityContext, clearRegisteredContexts, normalizeEntityContext, registerContext, resolveEvaluatedDefinition, toBooleanDefinitions } from '@ops-ai/toggly-hooks-types';
import { DefinitionsByKey, EvalContext } from '@ops-ai/toggly-eval';
export { DefinitionsByKey, EntityEvalContext, EvalContext, FeatureDefinitionModel, evaluateDefinitions, fromHttpRequest, indexDefinitions, parseDefinitionsPayload, snapshotEvaluatedBooleans } from '@ops-ai/toggly-eval';

/** Max distinct metric keys (metric+feature) retained per measures/counters map. */
declare const MAX_METRIC_KEYS_PER_BATCH = 500;
/** Max observation rows retained before flush. */
declare const MAX_OBSERVATIONS_PER_BATCH = 1000;
interface MetricsFeatureOptions {
    /** Optional feature key for experiment-style subcounts. */
    feature?: string;
    /** Variant name (default: enabled). */
    variant?: string;
}
interface MetricsBatcherOptions {
    appKey: string;
    environment: string;
    instanceName?: string;
    maxMetricKeys?: number;
    maxObservations?: number;
}
interface MetricStatPayload {
    appKey: string;
    environment: string;
    time: {
        seconds: number;
        nanos: number;
    };
    stats: Array<{
        metric: string;
        feature?: string;
        variantValues: Record<string, number>;
    }>;
    counters: Array<{
        metric: string;
        feature?: string;
        variantValues: Record<string, number>;
    }>;
    observations: Array<{
        time: {
            seconds: number;
            nanos: number;
        };
        metric: string;
        feature?: string;
        variantValues: Record<string, number>;
    }>;
    instanceName?: string;
}
/**
 * In-memory business metrics aggregator using variantValues maps (.NET parity).
 */
declare class MetricsBatcher {
    private readonly appKey;
    private readonly environment;
    private readonly instanceName?;
    private readonly maxMetricKeys;
    private readonly maxObservations;
    private measures;
    private counters;
    private observations;
    private droppedKeys;
    constructor(options: MetricsBatcherOptions);
    private key;
    private parseKey;
    private addToMap;
    measure(metric: string, value: number, options?: MetricsFeatureOptions): void;
    incrementCounter(metric: string, value?: number, options?: MetricsFeatureOptions): void;
    observe(metric: string, value: number, options?: MetricsFeatureOptions): void;
    isEmpty(): boolean;
    hitCap(): boolean;
    private drainMap;
    buildAndReset(): MetricStatPayload | null;
    restoreFromPayload(payload: MetricStatPayload): void;
}

/** Hard caps aligned with PHP/.NET unique-hash limits. */
declare const MAX_UNIQUE_USER_HASHES_PER_FEATURE = 10000;
declare const MAX_APPLICATION_UNIQUE_USER_HASHES = 10000;
/** Max distinct feature keys retained in one in-memory batch. */
declare const MAX_FEATURES_PER_BATCH = 500;
interface VariantStatsAgg {
    checkCount: number;
    requestCount: number;
    usedCount: number;
    viewedCount: number;
}
interface UsageBatcherOptions {
    appKey: string;
    environment: string;
    instanceName?: string;
    appVersion?: string;
    processStartTime?: Date;
    maxUniqueHashesPerFeature?: number;
    maxApplicationUniqueHashes?: number;
    maxFeatures?: number;
}
interface FeatureStatPayload {
    appKey: string;
    environment: string;
    time: {
        seconds: number;
        nanos: number;
    };
    stats: Array<{
        feature: string;
        uniqueContextIdentifierEnabledCount: number;
        uniqueContextIdentifierDisabledCount: number;
        uniqueUsersUsedCount: number;
        uniqueUserHashes: number[];
        uniqueViewedUserHashes: number[];
        variantStats: Record<string, VariantStatsAgg>;
    }>;
    totalUniqueUsers: number;
    uniqueUserHashes: number[];
    instanceName?: string;
    appVersion?: string;
    processStartTime?: {
        seconds: number;
        nanos: number;
    };
}
/**
 * Wire payload plus uniqueness hash-set snapshots for soft-fail HTTPS restore.
 */
interface UsageFlushBundle {
    payload: FeatureStatPayload;
    uniqueUsersEnabled: Record<string, number[]>;
    uniqueUsersDisabled: Record<string, number[]>;
    uniqueUsersUsed: Record<string, number[]>;
}
/**
 * In-memory feature usage aggregator. Prefer variantStats over legacy scalars
 * (matches .NET TogglyUsageStatsProvider send shape).
 */
declare class UsageBatcher {
    private readonly appKey;
    private readonly environment;
    private readonly instanceName?;
    private readonly appVersion?;
    private readonly processStartTime;
    private readonly maxUniqueHashesPerFeature;
    private readonly maxApplicationUniqueHashes;
    private readonly maxFeatures;
    private perFeature;
    private appUnique;
    private droppedFeatures;
    constructor(options: UsageBatcherOptions);
    private get;
    private getVariant;
    private addHashCapped;
    private trackAppUnique;
    /**
     * Record a feature evaluation.
     *
     * `checkCount` increments on every call. `requestCount` maps to .NET
     * UniqueRequestEnabled/Disabled when `uniqueRequest` is true.
     */
    recordCheck(feature: string, enabled: boolean, identity?: string, variant?: string, uniqueRequest?: boolean): void;
    recordUsage(feature: string, identity?: string, variant?: string): void;
    recordView(feature: string, identity?: string, variant?: string): void;
    isEmpty(): boolean;
    hitFeatureCap(): boolean;
    featureCount(): number;
    buildAndReset(): UsageFlushBundle | null;
    restoreFromBundle(bundle: UsageFlushBundle): void;
    private mergeUniqueHashMap;
}

interface UsageSender {
    sendStats(request: Record<string, unknown>): Promise<unknown>;
    close?(): void;
}
interface MetricsSender {
    sendMetrics(request: Record<string, unknown>): Promise<unknown>;
    close?(): void;
}
type TelemetryTransport = 'grpc' | 'https';
interface TelemetryConfig {
    appKey: string;
    environment: string;
    metricsBaseUrl?: string;
    enableUsageTracking?: boolean;
    enableMetrics?: boolean;
    usageFlushInterval?: number;
    metricsFlushInterval?: number;
    instanceName?: string;
    appVersion?: string;
    debug?: boolean;
    /**
     * Transport used when clients are not injected.
     * - `grpc`: expect injected usage/metrics clients (server creates them)
     * - `https`: build soft-fail fetch clients to api/usage/stats + api/metrics
     */
    transport?: TelemetryTransport;
    /**
     * When true (default for Node/server), attach beforeExit/SIGTERM/SIGINT flush.
     * Edge runtimes must set false — signal handlers are not available / unsafe.
     */
    attachProcessHandlers?: boolean;
    /** When true, restore batches if HTTPS/send returns soft-fail (default for https). */
    restoreOnSendFailure?: boolean;
    fetchImpl?: typeof fetch;
    /** Injected clients for tests or gRPC transport. */
    usageClient?: UsageSender | null;
    metricsClient?: MetricsSender | null;
}
interface TelemetryLogger {
    debug: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}
/**
 * Owns usage + metrics batchers, flush timers, and optional process signal handlers.
 */
declare class TelemetryRuntime {
    private usageBatcher;
    private metricsBatcher;
    private usageClient;
    private metricsClient;
    private httpsClient;
    private usageTimer;
    private metricsTimer;
    /** Single-flight drain promise (CF Worker TelemetryRuntime pattern). */
    private flushInFlight;
    /** Set when flush/close is requested during an in-flight drain. */
    private pendingDrain;
    private closed;
    private readonly processStartTime;
    private readonly signalHandlers;
    private readonly logger;
    private readonly restoreOnSendFailure;
    private readonly attachProcessHandlers;
    private readonly transport;
    private readonly config;
    constructor(config: TelemetryConfig, logger?: TelemetryLogger);
    get usageEnabled(): boolean;
    get metricsEnabled(): boolean;
    start(): void;
    /** Best-effort flush budget before re-emitting the signal so Node can exit. */
    static readonly SIGNAL_FLUSH_TIMEOUT_MS = 2000;
    private attachHandlers;
    private handleProcessSignal;
    private reemitSignalAndExit;
    private detachProcessHandlers;
    recordCheck(feature: string, enabled: boolean, identity?: string, variant?: string, uniqueRequest?: boolean): void;
    recordUsage(feature: string, identity?: string, variant?: string): void;
    recordView(feature: string, identity?: string, variant?: string): void;
    measure(metric: string, value: number, options?: MetricsFeatureOptions): void;
    incrementCounter(metric: string, value?: number, options?: MetricsFeatureOptions): void;
    observe(metric: string, value: number, options?: MetricsFeatureOptions): void;
    shouldFlushForCaps(): boolean;
    /**
     * Single-flight flush with pending-drain follow-up (CF Worker parity).
     * Concurrent flush/close during an active send coalesces onto one drain and
     * runs another pass so batches recorded mid-send are not stranded.
     */
    flush(): Promise<void>;
    flushAll(): Promise<void>;
    /** @deprecated Prefer {@link flush}; kept for callers that split usage/metrics. */
    flushUsage(): Promise<void>;
    /** @deprecated Prefer {@link flush}; kept for callers that split usage/metrics. */
    flushMetrics(): Promise<void>;
    private drainUntilIdle;
    private flushInternal;
    private sendUsageOnce;
    private sendMetricsOnce;
    close(): Promise<void>;
}

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
    usageClient?: UsageSender | null;
    /**
     * Injected metrics sender (gRPC stub or test double).
     * @internal
     */
    metricsClient?: MetricsSender | null;
    /** Optional fetch override for HTTPS telemetry (edge/tests). */
    telemetryFetch?: typeof fetch;
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

/**
 * FNV-1a 32-bit as signed int32 (matches Go `hash/fnv` New32a on `[]byte(s)`).
 * Hashes UTF-8 bytes — not UTF-16 code units from `String.charCodeAt`.
 */
declare function hashIdentity(identity: string): number;
declare function toProtobufTimestamp(date?: Date): {
    seconds: number;
    nanos: number;
};

declare const DEFAULT_METRICS_BASE_URL = "https://app.toggly.io/";
declare const DEFAULT_TELEMETRY_FLUSH_MS = 60000;
interface HttpsTelemetryClientOptions {
    metricsBaseUrl?: string;
    userAgent?: string;
    fetchImpl?: typeof fetch;
}
/** Convert protobuf-timestamp usage payload to gateway HTTPS JSON (PHP parity). */
declare function usagePayloadToHttpJson(payload: FeatureStatPayload): Record<string, unknown>;
/** Convert protobuf-timestamp metrics payload to gateway HTTPS JSON (PHP parity). */
declare function metricsPayloadToHttpJson(payload: MetricStatPayload): Record<string, unknown>;
/**
 * Soft-fail HTTPS JSON client for gateway-accepted usage/metrics paths.
 * Network and non-2xx errors never throw to callers.
 */
declare class HttpsTelemetryClient {
    private readonly baseUrl;
    private readonly userAgent;
    private readonly fetchImpl;
    constructor(options?: HttpsTelemetryClientOptions);
    getUserAgent(): string;
    getBaseUrl(): string;
    /**
     * POST JSON. Returns true on 2xx, false on soft-fail (network / non-2xx).
     */
    post(path: string, body: unknown): Promise<boolean>;
    sendUsageStats(payload: FeatureStatPayload): Promise<boolean>;
    sendMetrics(payload: MetricStatPayload): Promise<boolean>;
}
declare function resolveMetricsBaseUrl(raw?: string): string;
declare function isTelemetryEnvDisabled(): boolean;
/**
 * Resolve an enable flag. `TOGGLY_DISABLE_TELEMETRY=1` is authoritative and
 * wins over any explicit `true` in config.
 */
declare function resolveTelemetryEnableFlag(explicit: boolean | undefined, defaultWhenUnset: boolean): boolean;

declare const SDK_ID = "remix";
declare const SDK_VERSION = "1.7.0";
declare function sdkUserAgent(): string;
declare function sdkCustomHeaders(): Record<string, string>;
declare function buildDefinitionFetchHeaders(existing?: Record<string, string>): Record<string, string>;

export { DEFAULT_BASE_URL, DEFAULT_CONFIG, DEFAULT_ENVIRONMENT, DEFAULT_METRICS_BASE_URL, DEFAULT_TELEMETRY_FLUSH_MS, DEFAULT_TIMEOUT, ERROR_CODES, HEADERS, HttpsTelemetryClient, MAX_APPLICATION_UNIQUE_USER_HASHES, MAX_FEATURES_PER_BATCH, MAX_METRIC_KEYS_PER_BATCH, MAX_OBSERVATIONS_PER_BATCH, MAX_UNIQUE_USER_HASHES_PER_FEATURE, MetricsBatcher, REQUIREMENT, SDK_ID, SDK_VERSION, STORAGE_KEYS, TOGGLY_LOADER_KEY, TelemetryRuntime, TogglyConfigError, TogglyError, TogglyNetworkError, TogglyTimeoutError, UsageBatcher, buildDefinitionFetchHeaders, buildDefinitionsUrl, createLogger, createTimeout, deserializeFlags, evaluateFeatureGate, evaluateFeatureGateLocal, fetchWithTimeout, hashIdentity, isClient, isFeatureEnabled, isFeatureEnabledLocal, isServer, isTelemetryEnvDisabled, mergeConfig, metricsPayloadToHttpJson, normalizeFeatureKeys, parseIdentity, resolveMetricsBaseUrl, resolveTelemetryEnableFlag, sdkCustomHeaders, sdkUserAgent, serializeFlags, toProtobufTimestamp, usagePayloadToHttpJson };
export type { EvaluationMode, EvaluationOptions, EvaluationResult, EvaluationSeriesData, FeatureFlags, FeatureRequirement, FeatureStatPayload, HookMetadata, IdentityContext, IdentitySeriesData, MetricStatPayload, MetricsFeatureOptions, MetricsSender, ServerFeatureContext, StorageOptions, TelemetryConfig, TelemetryLogger, TelemetryTransport, TogglyConfig, TogglyHook, TogglyLoaderData, UsageFlushBundle, UsageSender, VariantStatsAgg };
