import { appendEvaluationContext, evaluateEvaluatedGate, resolveEvaluatedDefinition } from '@ops-ai/toggly-hooks-types';
export { clearRegisteredContexts, normalizeEntityContext, registerContext, resolveEvaluatedDefinition, toBooleanDefinitions } from '@ops-ai/toggly-hooks-types';
import { evaluateFeatureGate as evaluateFeatureGate$1, evaluateDefinitions } from '@ops-ai/toggly-eval';
export { evaluateDefinitions, fromHttpRequest, indexDefinitions, parseDefinitionsPayload, snapshotEvaluatedBooleans } from '@ops-ai/toggly-eval';

/**
 * Core types for Toggly Remix SDK
 */
/**
 * Error types for Toggly SDK
 */
class TogglyError extends Error {
    constructor(message, code, cause) {
        super(message);
        this.code = code;
        this.cause = cause;
        this.name = 'TogglyError';
    }
}
class TogglyNetworkError extends TogglyError {
    constructor(message, cause) {
        super(message, 'NETWORK_ERROR', cause);
        this.name = 'TogglyNetworkError';
    }
}
class TogglyConfigError extends TogglyError {
    constructor(message) {
        super(message, 'CONFIG_ERROR');
        this.name = 'TogglyConfigError';
    }
}
class TogglyTimeoutError extends TogglyError {
    constructor(message) {
        super(message, 'TIMEOUT_ERROR');
        this.name = 'TogglyTimeoutError';
    }
}

/**
 * Utility functions for Toggly Remix SDK
 */
/**
 * Default Toggly configuration
 */
const DEFAULT_CONFIG = {
    baseUrl: 'https://definitions.toggly.io',
    environment: 'Production',
    timeout: 10000,
    debug: false,
    evaluationMode: 'remote',
};
/**
 * Merge user config with defaults
 */
function mergeConfig(config) {
    return {
        ...DEFAULT_CONFIG,
        ...config,
    };
}
/**
 * Build the feature definitions URL.
 *
 * - `evaluationMode: 'remote'` (default): `/evaluated-signed/...` + context query params
 * - `evaluationMode: 'local'`: `/definitions-signed/...` with no evaluation context params
 */
function buildDefinitionsUrl(config, context) {
    const { baseUrl, appKey, environment, groups, claims, evaluationMode } = mergeConfig(config);
    if (!appKey) {
        throw new Error('appKey is required');
    }
    const mode = evaluationMode ?? 'remote';
    const pathSegment = mode === 'local' ? 'definitions-signed' : 'evaluated-signed';
    const url = new URL(`${baseUrl}/${pathSegment}/${appKey}/${environment}`);
    if (mode === 'local') {
        return url.toString();
    }
    const fromParam = typeof context === 'string' ? { identity: context } : context;
    appendEvaluationContext(url, {
        identity: fromParam?.identity,
        groups: fromParam?.groups ?? groups,
        claims: fromParam?.claims ?? claims,
    }, 'evaluated');
    return url.toString();
}
/**
 * Evaluate a single feature
 */
function isFeatureEnabled(flags, featureKey, defaultValue = false, entityContext) {
    if (!flags || Object.keys(flags).length === 0) {
        return defaultValue;
    }
    const value = flags[featureKey];
    if (value === undefined) {
        return defaultValue;
    }
    return resolveEvaluatedDefinition(value, entityContext);
}
/**
 * Locally evaluate a single feature against definitions-signed rules.
 */
function isFeatureEnabledLocal(defsByKey, featureKey, evalCtx = {}, defaultValue = false) {
    if (!defsByKey || defsByKey.size === 0) {
        return defaultValue;
    }
    if (!defsByKey.has(featureKey)) {
        return defaultValue;
    }
    return evaluateDefinitions(defsByKey, featureKey, evalCtx);
}
/**
 * Locally evaluate multiple features with requirement against definitions-signed rules.
 */
function evaluateFeatureGateLocal(defsByKey, featureKeys, requirement = 'all', negate = false, defaultValue = false, evalCtx = {}) {
    if (!defsByKey || defsByKey.size === 0) {
        return {
            enabled: negate ? !defaultValue : defaultValue,
            featureKeys,
            requirement,
            negated: negate,
        };
    }
    if (featureKeys.length === 0) {
        return {
            enabled: negate ? false : true,
            featureKeys,
            requirement,
            negated: negate,
        };
    }
    const enabled = evaluateFeatureGate$1(defsByKey, featureKeys, requirement, negate, evalCtx);
    return {
        enabled,
        featureKeys,
        requirement,
        negated: negate,
    };
}
/**
 * Evaluate multiple features with requirement
 */
function evaluateFeatureGate(flags, featureKeys, requirement = 'all', negate = false, defaultValue = false, entityContext) {
    if (!flags || Object.keys(flags).length === 0) {
        return {
            enabled: negate ? !defaultValue : defaultValue,
            featureKeys,
            requirement,
            negated: negate,
        };
    }
    if (featureKeys.length === 0) {
        return {
            enabled: negate ? false : true,
            featureKeys,
            requirement,
            negated: negate,
        };
    }
    const enabled = evaluateEvaluatedGate(flags, featureKeys, requirement, negate, entityContext);
    return {
        enabled,
        featureKeys,
        requirement,
        negated: negate,
    };
}
/**
 * Normalize feature keys from options
 */
function normalizeFeatureKeys(featureKey, featureKeys) {
    const keys = [];
    if (featureKey) {
        keys.push(featureKey);
    }
    if (featureKeys && Array.isArray(featureKeys)) {
        keys.push(...featureKeys);
    }
    return [...new Set(keys)]; // Remove duplicates
}
/**
 * Create a debug logger
 */
function createLogger(debug) {
    return {
        debug: (...args) => {
            if (debug) {
                console.debug('[Toggly]', ...args);
            }
        },
        info: (...args) => {
            if (debug) {
                console.info('[Toggly]', ...args);
            }
        },
        warn: (...args) => {
            console.warn('[Toggly]', ...args);
        },
        error: (...args) => {
            console.error('[Toggly]', ...args);
        },
    };
}
/**
 * Parse identity from various sources (cookie value, header, etc.)
 */
function parseIdentity(value) {
    if (!value) {
        return undefined;
    }
    // Try to parse as JSON (in case it's a stringified object)
    try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'string') {
            return parsed;
        }
        if (typeof parsed === 'object' && parsed !== null) {
            // Look for common identity fields
            return parsed.identity || parsed.id || parsed.userId || parsed.sub;
        }
    }
    catch {
        // Not JSON, use as-is
    }
    return value;
}
/**
 * Serialize feature flags for transport
 */
function serializeFlags(flags) {
    return JSON.stringify(flags);
}
/**
 * Deserialize feature flags from transport
 */
function deserializeFlags(value) {
    if (!value) {
        return {};
    }
    try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed;
        }
    }
    catch {
        // Invalid JSON
    }
    return {};
}
/**
 * Check if we're running on the server
 */
function isServer() {
    return !isClient();
}
/**
 * Check if we're running on the client
 */
function isClient() {
    return (typeof globalThis !== 'undefined' &&
        typeof globalThis.window !== 'undefined');
}
/**
 * Create a timeout promise
 */
function createTimeout(ms) {
    return new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(`Request timed out after ${ms}ms`));
        }, ms);
    });
}
/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        return response;
    }
    finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Constants for Toggly Remix SDK
 */
/** Default base URL for Toggly API */
const DEFAULT_BASE_URL = 'https://definitions.toggly.io';
/** Default environment name */
const DEFAULT_ENVIRONMENT = 'Production';
/** Default request timeout in milliseconds */
const DEFAULT_TIMEOUT = 10000;
/** Cookie/storage key names */
const STORAGE_KEYS = {
    /** Identity cookie/storage key */
    IDENTITY: 'toggly_identity',
    /** Feature flags cache key */
    FLAGS: 'toggly_flags',
    /** Config cache key */
    CONFIG: 'toggly_config',
    /** Last fetch timestamp key */
    LAST_FETCH: 'toggly_last_fetch',
};
/** HTTP header names */
const HEADERS = {
    /** Identity header */
    IDENTITY: 'x-toggly-identity',
    /** Feature flags header */
    FLAGS: 'x-toggly-flags',
    /** Cache control */
    CACHE_CONTROL: 'cache-control',
};
/** Feature requirement types */
const REQUIREMENT = {
    ALL: 'all',
    ANY: 'any',
};
/** Error codes */
const ERROR_CODES = {
    NETWORK_ERROR: 'NETWORK_ERROR',
    CONFIG_ERROR: 'CONFIG_ERROR',
    TIMEOUT_ERROR: 'TIMEOUT_ERROR',
    PARSE_ERROR: 'PARSE_ERROR',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
};
/** Meta key for loader data */
const TOGGLY_LOADER_KEY = '__toggly';

const utf8Encoder = new TextEncoder();
/**
 * FNV-1a 32-bit as signed int32 (matches Go `hash/fnv` New32a on `[]byte(s)`).
 * Hashes UTF-8 bytes — not UTF-16 code units from `String.charCodeAt`.
 */
function hashIdentity(identity) {
    let hash = 2166136261; // FNV offset basis
    const bytes = utf8Encoder.encode(identity);
    for (let i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        hash = Math.imul(hash, 16777619); // FNV prime
    }
    const unsigned = hash >>> 0;
    return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
}
function toProtobufTimestamp(date = new Date()) {
    const ms = date.getTime();
    const seconds = Math.floor(ms / 1000);
    const nanos = (ms % 1000) * 1000000;
    return { seconds, nanos };
}
function protobufTimestampToIso(ts) {
    return new Date(ts.seconds * 1000 + Math.floor(ts.nanos / 1000000)).toISOString();
}

/** Hard caps aligned with PHP/.NET unique-hash limits. */
const MAX_UNIQUE_USER_HASHES_PER_FEATURE = 10000;
const MAX_APPLICATION_UNIQUE_USER_HASHES = 10000;
/** Max distinct feature keys retained in one in-memory batch. */
const MAX_FEATURES_PER_BATCH = 500;
function emptyVariant() {
    return { checkCount: 0, requestCount: 0, usedCount: 0, viewedCount: 0 };
}
function emptyFeature() {
    return {
        variantStats: new Map(),
        uniqueUsersEnabled: new Set(),
        uniqueUsersDisabled: new Set(),
        uniqueUsersUsed: new Set(),
        uniqueUsersViewed: new Set(),
        uniqueUserHashes: new Set(),
        uniqueViewedUserHashes: new Set(),
    };
}
/**
 * In-memory feature usage aggregator. Prefer variantStats over legacy scalars
 * (matches .NET TogglyUsageStatsProvider send shape).
 */
class UsageBatcher {
    constructor(options) {
        this.perFeature = new Map();
        this.appUnique = new Set();
        this.droppedFeatures = false;
        this.appKey = options.appKey;
        this.environment = options.environment;
        this.instanceName = options.instanceName;
        this.appVersion = options.appVersion;
        this.processStartTime = options.processStartTime ?? new Date();
        this.maxUniqueHashesPerFeature =
            options.maxUniqueHashesPerFeature ?? MAX_UNIQUE_USER_HASHES_PER_FEATURE;
        this.maxApplicationUniqueHashes =
            options.maxApplicationUniqueHashes ?? MAX_APPLICATION_UNIQUE_USER_HASHES;
        this.maxFeatures = options.maxFeatures ?? MAX_FEATURES_PER_BATCH;
    }
    get(feature) {
        let agg = this.perFeature.get(feature);
        if (!agg) {
            if (this.perFeature.size >= this.maxFeatures) {
                this.droppedFeatures = true;
                return null;
            }
            agg = emptyFeature();
            this.perFeature.set(feature, agg);
        }
        return agg;
    }
    getVariant(agg, variant) {
        let stats = agg.variantStats.get(variant);
        if (!stats) {
            stats = emptyVariant();
            agg.variantStats.set(variant, stats);
        }
        return stats;
    }
    addHashCapped(set, hash, max) {
        if (set.has(hash) || set.size < max) {
            set.add(hash);
        }
    }
    trackAppUnique(hash) {
        this.addHashCapped(this.appUnique, hash, this.maxApplicationUniqueHashes);
    }
    /**
     * Record a feature evaluation.
     *
     * `checkCount` increments on every call. `requestCount` maps to .NET
     * UniqueRequestEnabled/Disabled when `uniqueRequest` is true.
     */
    recordCheck(feature, enabled, identity, variant, uniqueRequest = false) {
        const agg = this.get(feature);
        if (!agg)
            return;
        const name = variant ?? (enabled ? 'enabled' : 'disabled');
        const stats = this.getVariant(agg, name);
        stats.checkCount += 1;
        if (uniqueRequest) {
            stats.requestCount += 1;
        }
        if (identity) {
            const hash = hashIdentity(identity);
            this.trackAppUnique(hash);
            if (enabled) {
                this.addHashCapped(agg.uniqueUsersEnabled, hash, this.maxUniqueHashesPerFeature);
            }
            else {
                this.addHashCapped(agg.uniqueUsersDisabled, hash, this.maxUniqueHashesPerFeature);
            }
        }
    }
    recordUsage(feature, identity, variant = 'enabled') {
        const agg = this.get(feature);
        if (!agg)
            return;
        this.getVariant(agg, variant).usedCount += 1;
        if (identity) {
            const hash = hashIdentity(identity);
            this.trackAppUnique(hash);
            this.addHashCapped(agg.uniqueUsersUsed, hash, this.maxUniqueHashesPerFeature);
            this.addHashCapped(agg.uniqueUserHashes, hash, this.maxUniqueHashesPerFeature);
        }
    }
    recordView(feature, identity, variant = 'enabled') {
        const agg = this.get(feature);
        if (!agg)
            return;
        this.getVariant(agg, variant).viewedCount += 1;
        if (identity) {
            const hash = hashIdentity(identity);
            this.trackAppUnique(hash);
            this.addHashCapped(agg.uniqueUsersViewed, hash, this.maxUniqueHashesPerFeature);
            this.addHashCapped(agg.uniqueViewedUserHashes, hash, this.maxUniqueHashesPerFeature);
        }
    }
    isEmpty() {
        return this.perFeature.size === 0 && this.appUnique.size === 0;
    }
    hitFeatureCap() {
        return this.droppedFeatures;
    }
    featureCount() {
        return this.perFeature.size;
    }
    buildAndReset() {
        if (this.isEmpty()) {
            return null;
        }
        const payload = {
            appKey: this.appKey,
            environment: this.environment,
            time: toProtobufTimestamp(),
            stats: [],
            totalUniqueUsers: this.appUnique.size,
            uniqueUserHashes: [...this.appUnique],
            processStartTime: toProtobufTimestamp(this.processStartTime),
        };
        if (this.instanceName) {
            payload.instanceName = this.instanceName;
        }
        if (this.appVersion) {
            payload.appVersion = this.appVersion;
        }
        const uniqueUsersEnabled = {};
        const uniqueUsersDisabled = {};
        const uniqueUsersUsed = {};
        for (const [feature, agg] of this.perFeature) {
            const variantStats = {};
            for (const [name, stats] of agg.variantStats) {
                if (stats.checkCount > 0 ||
                    stats.requestCount > 0 ||
                    stats.usedCount > 0 ||
                    stats.viewedCount > 0) {
                    variantStats[name] = { ...stats };
                }
            }
            if (agg.uniqueUsersEnabled.size > 0) {
                uniqueUsersEnabled[feature] = [...agg.uniqueUsersEnabled];
            }
            if (agg.uniqueUsersDisabled.size > 0) {
                uniqueUsersDisabled[feature] = [...agg.uniqueUsersDisabled];
            }
            if (agg.uniqueUsersUsed.size > 0) {
                uniqueUsersUsed[feature] = [...agg.uniqueUsersUsed];
            }
            payload.stats.push({
                feature,
                uniqueContextIdentifierEnabledCount: agg.uniqueUsersEnabled.size,
                uniqueContextIdentifierDisabledCount: agg.uniqueUsersDisabled.size,
                uniqueUsersUsedCount: agg.uniqueUsersUsed.size,
                uniqueUserHashes: [...agg.uniqueUserHashes],
                uniqueViewedUserHashes: [...agg.uniqueViewedUserHashes],
                variantStats,
            });
        }
        this.perFeature = new Map();
        this.appUnique = new Set();
        this.droppedFeatures = false;
        return {
            payload,
            uniqueUsersEnabled,
            uniqueUsersDisabled,
            uniqueUsersUsed,
        };
    }
    restoreFromBundle(bundle) {
        const { payload } = bundle;
        for (const hash of payload.uniqueUserHashes ?? []) {
            this.trackAppUnique(hash);
        }
        for (const stat of payload.stats ?? []) {
            const feature = stat.feature;
            if (!feature)
                continue;
            const agg = this.get(feature);
            if (!agg)
                continue;
            for (const [name, vs] of Object.entries(stat.variantStats ?? {})) {
                const target = this.getVariant(agg, name);
                target.checkCount += vs.checkCount ?? 0;
                target.requestCount += vs.requestCount ?? 0;
                target.usedCount += vs.usedCount ?? 0;
                target.viewedCount += vs.viewedCount ?? 0;
            }
            for (const hash of stat.uniqueUserHashes ?? []) {
                this.addHashCapped(agg.uniqueUserHashes, hash, this.maxUniqueHashesPerFeature);
            }
            for (const hash of stat.uniqueViewedUserHashes ?? []) {
                this.addHashCapped(agg.uniqueViewedUserHashes, hash, this.maxUniqueHashesPerFeature);
                this.addHashCapped(agg.uniqueUsersViewed, hash, this.maxUniqueHashesPerFeature);
            }
        }
        this.mergeUniqueHashMap(bundle.uniqueUsersEnabled, 'uniqueUsersEnabled');
        this.mergeUniqueHashMap(bundle.uniqueUsersDisabled, 'uniqueUsersDisabled');
        this.mergeUniqueHashMap(bundle.uniqueUsersUsed, 'uniqueUsersUsed');
    }
    mergeUniqueHashMap(snapshot, field) {
        for (const [feature, hashes] of Object.entries(snapshot ?? {})) {
            const agg = this.get(feature);
            if (!agg)
                continue;
            for (const hash of hashes) {
                this.addHashCapped(agg[field], hash, this.maxUniqueHashesPerFeature);
                this.trackAppUnique(hash);
            }
        }
    }
}

/** Max distinct metric keys (metric+feature) retained per measures/counters map. */
const MAX_METRIC_KEYS_PER_BATCH = 500;
/** Max observation rows retained before flush. */
const MAX_OBSERVATIONS_PER_BATCH = 1000;
/**
 * In-memory business metrics aggregator using variantValues maps (.NET parity).
 */
class MetricsBatcher {
    constructor(options) {
        this.measures = new Map();
        this.counters = new Map();
        this.observations = [];
        this.droppedKeys = false;
        this.appKey = options.appKey;
        this.environment = options.environment;
        this.instanceName = options.instanceName;
        this.maxMetricKeys = options.maxMetricKeys ?? MAX_METRIC_KEYS_PER_BATCH;
        this.maxObservations = options.maxObservations ?? MAX_OBSERVATIONS_PER_BATCH;
    }
    key(metric, feature) {
        return `${metric}\0${feature ?? ''}`;
    }
    parseKey(key) {
        const sep = key.indexOf('\0');
        if (sep < 0) {
            return { metric: key };
        }
        const metric = key.slice(0, sep);
        const feature = key.slice(sep + 1);
        return feature ? { metric, feature } : { metric };
    }
    addToMap(store, metric, value, options) {
        const variant = options?.variant ?? 'enabled';
        const mapKey = this.key(metric, options?.feature);
        let variants = store.get(mapKey);
        if (!variants) {
            if (store.size >= this.maxMetricKeys) {
                this.droppedKeys = true;
                return;
            }
            variants = new Map();
            store.set(mapKey, variants);
        }
        variants.set(variant, (variants.get(variant) ?? 0) + value);
    }
    measure(metric, value, options) {
        this.addToMap(this.measures, metric, value, options);
    }
    incrementCounter(metric, value = 1, options) {
        this.addToMap(this.counters, metric, value, options);
    }
    observe(metric, value, options) {
        if (this.observations.length >= this.maxObservations) {
            this.droppedKeys = true;
            return;
        }
        this.observations.push({
            time: new Date(),
            metric,
            feature: options?.feature,
            variant: options?.variant ?? 'enabled',
            value,
        });
    }
    isEmpty() {
        return this.measures.size === 0 && this.counters.size === 0 && this.observations.length === 0;
    }
    hitCap() {
        return this.droppedKeys;
    }
    drainMap(store) {
        const out = [];
        for (const [key, variants] of store) {
            const parsed = this.parseKey(key);
            const variantValues = {};
            for (const [variant, value] of variants) {
                if (value !== 0) {
                    variantValues[variant] = value;
                }
            }
            if (Object.keys(variantValues).length > 0) {
                out.push({
                    metric: parsed.metric,
                    ...(parsed.feature ? { feature: parsed.feature } : {}),
                    variantValues,
                });
            }
        }
        store.clear();
        return out;
    }
    buildAndReset() {
        if (this.isEmpty()) {
            return null;
        }
        const observationGroups = new Map();
        for (const obs of this.observations) {
            const groupKey = `${obs.time.toISOString()}\0${obs.metric}\0${obs.feature ?? ''}`;
            let group = observationGroups.get(groupKey);
            if (!group) {
                group = {
                    time: toProtobufTimestamp(obs.time),
                    metric: obs.metric,
                    ...(obs.feature ? { feature: obs.feature } : {}),
                    variantValues: {},
                };
                observationGroups.set(groupKey, group);
            }
            group.variantValues[obs.variant] = obs.value;
        }
        this.observations = [];
        this.droppedKeys = false;
        const payload = {
            appKey: this.appKey,
            environment: this.environment,
            time: toProtobufTimestamp(),
            stats: this.drainMap(this.measures),
            counters: this.drainMap(this.counters),
            observations: [...observationGroups.values()],
        };
        if (this.instanceName) {
            payload.instanceName = this.instanceName;
        }
        return payload;
    }
    restoreFromPayload(payload) {
        for (const stat of payload.stats ?? []) {
            for (const [variant, value] of Object.entries(stat.variantValues ?? {})) {
                this.measure(stat.metric, value, { feature: stat.feature, variant });
            }
        }
        for (const counter of payload.counters ?? []) {
            for (const [variant, value] of Object.entries(counter.variantValues ?? {})) {
                this.incrementCounter(counter.metric, value, {
                    feature: counter.feature,
                    variant,
                });
            }
        }
        for (const obs of payload.observations ?? []) {
            for (const [variant, value] of Object.entries(obs.variantValues ?? {})) {
                this.observe(obs.metric, value, { feature: obs.feature, variant });
            }
        }
    }
}

const SDK_ID = 'remix';
const SDK_VERSION = '1.7.0';
const SDK_HEADER_ID = 'X-Toggly-Sdk';
const SDK_HEADER_VERSION = 'X-Toggly-Sdk-Version';
function sdkUserAgent() {
    return `toggly-${SDK_ID}/${SDK_VERSION}`;
}
function sdkCustomHeaders() {
    return {
        [SDK_HEADER_ID]: SDK_ID,
        [SDK_HEADER_VERSION]: SDK_VERSION,
    };
}
/** Browser and React Native use custom headers on HTTP (User-Agent is forbidden in browser fetch). */
function usesSdkCustomHeaders() {
    const g = globalThis;
    if (g.window !== undefined && g.document !== undefined) {
        return true;
    }
    if (g.navigator?.product === 'ReactNative') {
        return true;
    }
    return false;
}
function buildDefinitionFetchHeaders(existing = {}) {
    const headers = { ...existing };
    if (usesSdkCustomHeaders()) {
        Object.assign(headers, sdkCustomHeaders());
    }
    else {
        headers['User-Agent'] = sdkUserAgent();
    }
    return headers;
}

const DEFAULT_METRICS_BASE_URL = 'https://app.toggly.io/';
const DEFAULT_TELEMETRY_FLUSH_MS = 60000;
function ensureTrailingSlash(baseUrl) {
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}
/** Convert protobuf-timestamp usage payload to gateway HTTPS JSON (PHP parity). */
function usagePayloadToHttpJson(payload) {
    return {
        ...payload,
        time: protobufTimestampToIso(payload.time),
        ...(payload.processStartTime
            ? { processStartTime: protobufTimestampToIso(payload.processStartTime) }
            : {}),
    };
}
/** Convert protobuf-timestamp metrics payload to gateway HTTPS JSON (PHP parity). */
function metricsPayloadToHttpJson(payload) {
    return {
        ...payload,
        time: protobufTimestampToIso(payload.time),
        observations: (payload.observations ?? []).map((obs) => ({
            ...obs,
            time: protobufTimestampToIso(obs.time),
        })),
    };
}
/**
 * Soft-fail HTTPS JSON client for gateway-accepted usage/metrics paths.
 * Network and non-2xx errors never throw to callers.
 */
class HttpsTelemetryClient {
    constructor(options = {}) {
        this.baseUrl = ensureTrailingSlash(options.metricsBaseUrl ?? DEFAULT_METRICS_BASE_URL);
        this.userAgent = options.userAgent ?? sdkUserAgent();
        this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    }
    getUserAgent() {
        return this.userAgent;
    }
    getBaseUrl() {
        return this.baseUrl;
    }
    /**
     * POST JSON. Returns true on 2xx, false on soft-fail (network / non-2xx).
     */
    async post(path, body) {
        try {
            const url = new URL(path.replace(/^\//, ''), this.baseUrl).toString();
            const response = await this.fetchImpl(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'User-Agent': this.userAgent,
                },
                body: JSON.stringify(body),
            });
            return response.ok;
        }
        catch {
            return false;
        }
    }
    sendUsageStats(payload) {
        return this.post('api/usage/stats', usagePayloadToHttpJson(payload));
    }
    sendMetrics(payload) {
        return this.post('api/metrics', metricsPayloadToHttpJson(payload));
    }
}
function resolveMetricsBaseUrl(raw) {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) {
        return DEFAULT_METRICS_BASE_URL;
    }
    return ensureTrailingSlash(trimmed);
}
function isTelemetryEnvDisabled() {
    try {
        return typeof process !== 'undefined' && process.env?.TOGGLY_DISABLE_TELEMETRY === '1';
    }
    catch {
        return false;
    }
}
/**
 * Resolve an enable flag. `TOGGLY_DISABLE_TELEMETRY=1` is authoritative and
 * wins over any explicit `true` in config.
 */
function resolveTelemetryEnableFlag(explicit, defaultWhenUnset) {
    if (isTelemetryEnvDisabled()) {
        return false;
    }
    return explicit ?? defaultWhenUnset;
}

/**
 * Owns usage + metrics batchers, flush timers, and optional process signal handlers.
 */
class TelemetryRuntime {
    constructor(config, logger) {
        this.usageBatcher = null;
        this.metricsBatcher = null;
        this.usageClient = null;
        this.metricsClient = null;
        this.httpsClient = null;
        this.usageTimer = null;
        this.metricsTimer = null;
        /** Single-flight drain promise (CF Worker TelemetryRuntime pattern). */
        this.flushInFlight = null;
        /** Set when flush/close is requested during an in-flight drain. */
        this.pendingDrain = false;
        this.closed = false;
        this.processStartTime = new Date();
        this.signalHandlers = [];
        const hasAppKey = Boolean(config.appKey);
        this.transport = config.transport ?? 'grpc';
        this.attachProcessHandlers = config.attachProcessHandlers ?? this.transport === 'grpc';
        this.restoreOnSendFailure =
            config.restoreOnSendFailure ?? this.transport === 'https';
        this.config = {
            appKey: config.appKey,
            environment: config.environment,
            metricsBaseUrl: resolveMetricsBaseUrl(config.metricsBaseUrl ?? DEFAULT_METRICS_BASE_URL),
            // TOGGLY_DISABLE_TELEMETRY=1 wins over explicit true.
            enableUsageTracking: resolveTelemetryEnableFlag(config.enableUsageTracking, hasAppKey),
            enableMetrics: resolveTelemetryEnableFlag(config.enableMetrics, hasAppKey),
            usageFlushInterval: config.usageFlushInterval ?? DEFAULT_TELEMETRY_FLUSH_MS,
            metricsFlushInterval: config.metricsFlushInterval ?? DEFAULT_TELEMETRY_FLUSH_MS,
            instanceName: config.instanceName,
            appVersion: config.appVersion,
            usageClient: config.usageClient,
            metricsClient: config.metricsClient,
            fetchImpl: config.fetchImpl,
        };
        this.logger = logger ?? {
            debug: () => { },
            warn: (...args) => console.warn('[Toggly]', ...args),
            error: (...args) => console.error('[Toggly]', ...args),
        };
    }
    get usageEnabled() {
        return this.config.enableUsageTracking && !this.closed;
    }
    get metricsEnabled() {
        return this.config.enableMetrics && !this.closed;
    }
    start() {
        if (this.closed)
            return;
        if (!this.config.enableUsageTracking && !this.config.enableMetrics) {
            return;
        }
        if (this.config.usageClient !== undefined || this.config.metricsClient !== undefined) {
            this.usageClient = this.config.usageClient ?? null;
            this.metricsClient = this.config.metricsClient ?? null;
        }
        else if (this.transport === 'https') {
            this.httpsClient = new HttpsTelemetryClient({
                metricsBaseUrl: this.config.metricsBaseUrl,
                fetchImpl: this.config.fetchImpl,
            });
            this.usageClient = {
                sendStats: async (request) => {
                    const ok = await this.httpsClient.sendUsageStats(request);
                    return { ok };
                },
            };
            this.metricsClient = {
                sendMetrics: async (request) => {
                    const ok = await this.httpsClient.sendMetrics(request);
                    return { ok };
                },
            };
        }
        else {
            this.logger.warn('Usage/metrics enabled with gRPC transport but no clients were injected. ' +
                'Pass usageClient/metricsClient from createGrpcClients (optional @grpc/grpc-js).');
        }
        if (this.config.enableUsageTracking) {
            this.usageBatcher = new UsageBatcher({
                appKey: this.config.appKey,
                environment: this.config.environment,
                instanceName: this.config.instanceName,
                appVersion: this.config.appVersion,
                processStartTime: this.processStartTime,
            });
            if (this.config.usageFlushInterval > 0) {
                this.usageTimer = setInterval(() => {
                    void this.flush();
                }, this.config.usageFlushInterval);
                this.usageTimer.unref?.();
            }
        }
        if (this.config.enableMetrics) {
            this.metricsBatcher = new MetricsBatcher({
                appKey: this.config.appKey,
                environment: this.config.environment,
                instanceName: this.config.instanceName,
            });
            if (this.config.metricsFlushInterval > 0) {
                this.metricsTimer = setInterval(() => {
                    void this.flush();
                }, this.config.metricsFlushInterval);
                this.metricsTimer.unref?.();
            }
        }
        if (this.attachProcessHandlers) {
            this.attachHandlers();
        }
    }
    /* istanbul ignore next -- process signal exit paths; covered by attach/detach tests */
    attachHandlers() {
        if (typeof process === 'undefined' || typeof process.on !== 'function') {
            return;
        }
        const flush = () => {
            void this.flushAll();
        };
        process.on('beforeExit', flush);
        this.signalHandlers.push({ event: 'beforeExit', handler: flush });
        for (const signal of ['SIGTERM', 'SIGINT']) {
            try {
                const onSignal = () => {
                    void this.handleProcessSignal(signal);
                };
                process.on(signal, onSignal);
                this.signalHandlers.push({ event: signal, handler: onSignal });
            }
            catch {
                // Some runtimes disallow signal handlers
            }
        }
    }
    /* istanbul ignore next -- process.kill / process.exit on SIGTERM/SIGINT */
    async handleProcessSignal(signal) {
        try {
            await Promise.race([
                this.close(),
                new Promise((resolve) => {
                    const timer = setTimeout(resolve, TelemetryRuntime.SIGNAL_FLUSH_TIMEOUT_MS);
                    timer.unref?.();
                }),
            ]);
        }
        catch {
            // Best-effort flush; still exit
        }
        finally {
            this.detachProcessHandlers();
            this.reemitSignalAndExit(signal);
        }
    }
    /* istanbul ignore next -- process.kill / process.exit on SIGTERM/SIGINT */
    reemitSignalAndExit(signal) {
        try {
            process.kill(process.pid, signal);
        }
        catch {
            const code = signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 0;
            process.exit(code);
        }
    }
    detachProcessHandlers() {
        if (typeof process === 'undefined' || typeof process.off !== 'function') {
            return;
        }
        for (const { event, handler } of this.signalHandlers) {
            process.off(event, handler);
        }
        this.signalHandlers.length = 0;
    }
    recordCheck(feature, enabled, identity, variant, uniqueRequest = false) {
        this.usageBatcher?.recordCheck(feature, enabled, identity, variant, uniqueRequest);
    }
    recordUsage(feature, identity, variant) {
        this.usageBatcher?.recordUsage(feature, identity, variant);
    }
    recordView(feature, identity, variant) {
        this.usageBatcher?.recordView(feature, identity, variant);
    }
    measure(metric, value, options) {
        this.metricsBatcher?.measure(metric, value, options);
    }
    incrementCounter(metric, value = 1, options) {
        this.metricsBatcher?.incrementCounter(metric, value, options);
    }
    observe(metric, value, options) {
        this.metricsBatcher?.observe(metric, value, options);
    }
    shouldFlushForCaps() {
        return Boolean(this.usageBatcher?.hitFeatureCap() || this.metricsBatcher?.hitCap());
    }
    /**
     * Single-flight flush with pending-drain follow-up (CF Worker parity).
     * Concurrent flush/close during an active send coalesces onto one drain and
     * runs another pass so batches recorded mid-send are not stranded.
     */
    async flush() {
        this.pendingDrain = true;
        if (this.flushInFlight) {
            return this.flushInFlight;
        }
        this.flushInFlight = this.drainUntilIdle();
        return this.flushInFlight;
    }
    async flushAll() {
        await this.flush();
    }
    /** @deprecated Prefer {@link flush}; kept for callers that split usage/metrics. */
    async flushUsage() {
        await this.flush();
    }
    /** @deprecated Prefer {@link flush}; kept for callers that split usage/metrics. */
    async flushMetrics() {
        await this.flush();
    }
    async drainUntilIdle() {
        try {
            while (this.pendingDrain) {
                this.pendingDrain = false;
                await this.flushInternal();
            }
        }
        finally {
            this.flushInFlight = null;
            // Race: another flush()/close() set pendingDrain after the while check
            // but while we still owned inFlight — start a follow-up drain.
            if (this.pendingDrain) {
                await this.flush();
            }
        }
    }
    async flushInternal() {
        await Promise.all([this.sendUsageOnce(), this.sendMetricsOnce()]);
    }
    async sendUsageOnce() {
        if (!this.usageBatcher)
            return;
        const client = this.usageClient;
        if (!client?.sendStats) {
            this.logger.debug('Usage flush skipped: no usage client');
            return;
        }
        const bundle = this.usageBatcher.buildAndReset();
        if (!bundle)
            return;
        try {
            const result = await client.sendStats(bundle.payload);
            if (this.restoreOnSendFailure &&
                result &&
                typeof result === 'object' &&
                'ok' in result &&
                result.ok === false) {
                this.usageBatcher.restoreFromBundle(bundle);
                this.logger.debug('Usage HTTPS soft-fail; batch restored');
            }
        }
        catch (error) {
            if (this.restoreOnSendFailure) {
                this.usageBatcher.restoreFromBundle(bundle);
            }
            this.logger.error('Failed to send usage stats:', error);
        }
    }
    async sendMetricsOnce() {
        if (!this.metricsBatcher)
            return;
        const client = this.metricsClient;
        if (!client?.sendMetrics) {
            this.logger.debug('Metrics flush skipped: no metrics client');
            return;
        }
        const payload = this.metricsBatcher.buildAndReset();
        if (!payload)
            return;
        try {
            const result = await client.sendMetrics(payload);
            if (this.restoreOnSendFailure &&
                result &&
                typeof result === 'object' &&
                'ok' in result &&
                result.ok === false) {
                this.metricsBatcher.restoreFromPayload(payload);
                this.logger.debug('Metrics HTTPS soft-fail; batch restored');
            }
        }
        catch (error) {
            if (this.restoreOnSendFailure) {
                this.metricsBatcher.restoreFromPayload(payload);
            }
            this.logger.error('Failed to send metrics:', error);
        }
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        if (this.usageTimer) {
            clearInterval(this.usageTimer);
            this.usageTimer = null;
        }
        if (this.metricsTimer) {
            clearInterval(this.metricsTimer);
            this.metricsTimer = null;
        }
        this.detachProcessHandlers();
        try {
            // Sets pendingDrain so data recorded during an in-flight send is drained.
            await this.flush();
        }
        finally {
            try {
                this.usageClient?.close?.();
            }
            catch {
                // ignore
            }
            try {
                this.metricsClient?.close?.();
            }
            catch {
                // ignore
            }
            this.usageClient = null;
            this.metricsClient = null;
            this.httpsClient = null;
            this.usageBatcher = null;
            this.metricsBatcher = null;
        }
    }
}
/** Best-effort flush budget before re-emitting the signal so Node can exit. */
TelemetryRuntime.SIGNAL_FLUSH_TIMEOUT_MS = 2000;

export { DEFAULT_BASE_URL, DEFAULT_CONFIG, DEFAULT_ENVIRONMENT, DEFAULT_METRICS_BASE_URL, DEFAULT_TELEMETRY_FLUSH_MS, DEFAULT_TIMEOUT, ERROR_CODES, HEADERS, HttpsTelemetryClient, MAX_APPLICATION_UNIQUE_USER_HASHES, MAX_FEATURES_PER_BATCH, MAX_METRIC_KEYS_PER_BATCH, MAX_OBSERVATIONS_PER_BATCH, MAX_UNIQUE_USER_HASHES_PER_FEATURE, MetricsBatcher, REQUIREMENT, SDK_ID, SDK_VERSION, STORAGE_KEYS, TOGGLY_LOADER_KEY, TelemetryRuntime, TogglyConfigError, TogglyError, TogglyNetworkError, TogglyTimeoutError, UsageBatcher, buildDefinitionFetchHeaders, buildDefinitionsUrl, createLogger, createTimeout, deserializeFlags, evaluateFeatureGate, evaluateFeatureGateLocal, fetchWithTimeout, hashIdentity, isClient, isFeatureEnabled, isFeatureEnabledLocal, isServer, isTelemetryEnvDisabled, mergeConfig, metricsPayloadToHttpJson, normalizeFeatureKeys, parseIdentity, resolveMetricsBaseUrl, resolveTelemetryEnableFlag, sdkCustomHeaders, sdkUserAgent, serializeFlags, toProtobufTimestamp, usagePayloadToHttpJson };
//# sourceMappingURL=index.js.map
