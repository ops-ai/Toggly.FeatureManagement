var dist = {};

var evaluationContext = {};

(function (exports$1) {
	Object.defineProperty(exports$1, "__esModule", { value: true });
	exports$1.MAX_EVALUATION_CLAIMS = void 0;
	exports$1.normalizeEvaluationClaims = normalizeEvaluationClaims;
	exports$1.appendEvaluationContext = appendEvaluationContext;
	exports$1.evaluationContextCacheKey = evaluationContextCacheKey;
	/** Maximum claim entries sent or honored on evaluated-signed requests (worker enforces the same cap). */
	exports$1.MAX_EVALUATION_CLAIMS = 20;
	/**
	 * Returns up to {@link MAX_EVALUATION_CLAIMS} claims, sorted by type for stable URLs and cache keys.
	 * Extra entries are dropped deterministically (alphabetically last types first).
	 */
	function normalizeEvaluationClaims(claims) {
	    if (!claims) {
	        return undefined;
	    }
	    const entries = Object.entries(claims)
	        .filter(([type, value]) => type && value !== undefined && value !== null && String(value).length > 0)
	        .sort(([a], [b]) => a.localeCompare(b));
	    if (entries.length === 0) {
	        return undefined;
	    }
	    return Object.fromEntries(entries.slice(0, exports$1.MAX_EVALUATION_CLAIMS));
	}
	/**
	 * Append identity, groups, and claims to an evaluated-signed fetch URL.
	 *
	 * Contract (Definitions worker):
	 * - evaluated mode: `?u=` for identity
	 * - variants mode: `?userId=` for identity
	 * - groups: repeatable `g` query params
	 * - claims: `claim.{type}={value}` per claim entry (max {@link MAX_EVALUATION_CLAIMS})
	 */
	function appendEvaluationContext(url, context, mode = 'evaluated') {
	    if (!context) {
	        return;
	    }
	    if (context.identity) {
	        if (mode === 'variants') {
	            url.searchParams.set('userId', context.identity);
	        }
	        else {
	            url.searchParams.set('u', context.identity);
	        }
	    }
	    if (context.groups) {
	        for (const group of context.groups) {
	            const trimmed = group.trim();
	            if (trimmed) {
	                url.searchParams.append('g', trimmed);
	            }
	        }
	    }
	    const claims = normalizeEvaluationClaims(context.claims);
	    if (claims) {
	        for (const [claimType, claimValue] of Object.entries(claims)) {
	            url.searchParams.set(`claim.${claimType}`, String(claimValue));
	        }
	    }
	}
	/**
	 * Stable cache key segment for evaluation context (identity + groups + claims).
	 */
	function evaluationContextCacheKey(context) {
	    if (!context) {
	        return '';
	    }
	    const parts = [];
	    if (context.identity) {
	        parts.push(`u:${context.identity}`);
	    }
	    if (context.groups?.length) {
	        parts.push(`g:${[...context.groups].sort().join(',')}`);
	    }
	    if (context.claims && Object.keys(context.claims).length > 0) {
	        const normalized = normalizeEvaluationClaims(context.claims);
	        if (normalized) {
	            const claimPairs = Object.entries(normalized)
	                .sort(([a], [b]) => a.localeCompare(b))
	                .map(([k, v]) => `${k}=${v}`);
	            parts.push(`c:${claimPairs.join('&')}`);
	        }
	    }
	    return parts.join('|');
	} 
} (evaluationContext));

var cacheLru = {};

Object.defineProperty(cacheLru, "__esModule", { value: true });
cacheLru.emptyCacheLruIndex = emptyCacheLruIndex;
cacheLru.parseCacheLruIndex = parseCacheLruIndex;
cacheLru.serializeCacheLruIndex = serializeCacheLruIndex;
cacheLru.touchCacheLruKey = touchCacheLruKey;
cacheLru.removeCacheLruKeys = removeCacheLruKeys;
cacheLru.selectCacheLruKeysToEvict = selectCacheLruKeysToEvict;
cacheLru.isCacheLruEnabled = isCacheLruEnabled;
function emptyCacheLruIndex() {
    return { entries: {} };
}
function parseCacheLruIndex(raw) {
    if (!raw) {
        return emptyCacheLruIndex();
    }
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object' || !parsed.entries) {
            return emptyCacheLruIndex();
        }
        const entries = {};
        for (const [key, value] of Object.entries(parsed.entries)) {
            if (!value || typeof value !== 'object') {
                continue;
            }
            const lastAccessed = value.lastAccessed;
            if (typeof lastAccessed === 'number' && Number.isFinite(lastAccessed)) {
                entries[key] = { lastAccessed };
            }
        }
        return { entries };
    }
    catch {
        return emptyCacheLruIndex();
    }
}
function serializeCacheLruIndex(index) {
    return JSON.stringify({ entries: index.entries });
}
function touchCacheLruKey(index, key, now = Date.now()) {
    return {
        entries: {
            ...index.entries,
            [key]: { lastAccessed: now },
        },
    };
}
function removeCacheLruKeys(index, keys) {
    const entries = { ...index.entries };
    for (const key of keys) {
        delete entries[key];
    }
    return { entries };
}
function protectedKeySet(options) {
    const keys = new Set();
    if (options?.protectKey) {
        keys.add(options.protectKey);
    }
    if (options?.protectKeys) {
        for (const key of options.protectKeys) {
            if (key) {
                keys.add(key);
            }
        }
    }
    return keys;
}
/**
 * Oldest keys to remove so the index length is at most `maxKeys`.
 *
 * Skips keys in `protectKeys` / `protectKey` (typically the key(s) just written
 * for the same evaluation context — e.g. flags + variants siblings).
 */
function selectCacheLruKeysToEvict(index, maxKeys, options) {
    if (!Number.isFinite(maxKeys) || maxKeys <= 0) {
        return [];
    }
    const limit = Math.floor(maxKeys);
    if (limit <= 0) {
        return [];
    }
    const keys = Object.keys(index.entries);
    const over = keys.length - limit;
    if (over <= 0) {
        return [];
    }
    const protectedKeys = protectedKeySet(options);
    const sorted = keys
        .slice()
        .sort((a, b) => (index.entries[a].lastAccessed - index.entries[b].lastAccessed) || a.localeCompare(b));
    const toEvict = [];
    for (const key of sorted) {
        if (toEvict.length >= over) {
            break;
        }
        if (protectedKeys.has(key)) {
            continue;
        }
        toEvict.push(key);
    }
    return toEvict;
}
/** True when a positive finite max is configured. */
function isCacheLruEnabled(maxCacheKeys) {
    return typeof maxCacheKeys === 'number' && Number.isFinite(maxCacheKeys) && maxCacheKeys > 0;
}

var serializeForInlineScript = {};

Object.defineProperty(serializeForInlineScript, "__esModule", { value: true });
serializeForInlineScript.serializeJsonForInlineScript = serializeJsonForInlineScript;
/**
 * Serialize a value as JSON safe for embedding inside an inline `<script>` tag.
 *
 * `JSON.stringify` does not escape the `</script` sequence. Without this
 * replacement, attacker-influenced strings (e.g. identity, flag keys) can
 * break out of the script element. Matches the Cloudflare edge rewriter.
 */
function serializeJsonForInlineScript(value) {
    return JSON.stringify(value).replace(/<\/script/gi, '<\\/script');
}

var entityGate = {};

Object.defineProperty(entityGate, "__esModule", { value: true });
entityGate.isEntityGate = isEntityGate;
entityGate.resolveEvaluatedDefinition = resolveEvaluatedDefinition;
entityGate.toBooleanDefinitions = toBooleanDefinitions;
entityGate.applyEntityGate = applyEntityGate;
entityGate.registerContext = registerContext;
entityGate.resolveEntityContext = resolveEntityContext;
entityGate.mapEntityContext = mapEntityContext;
entityGate.clearRegisteredContexts = clearRegisteredContexts;
entityGate.normalizeEntityContext = normalizeEntityContext;
entityGate.evaluateEvaluatedGate = evaluateEvaluatedGate;
const equalityOps = new Set(['eq', 'neq']);
const comparisonOps = new Set(['gt', 'gte', 'lt', 'lte']);
const inOps = new Set(['in']);
const containsOps = new Set(['contains']);
function isEntityGate(value) {
    return typeof value === 'object' && value !== null && Array.isArray(value.rules);
}
/**
 * Resolves one evaluated definition to a boolean.
 *
 * An absent definition falls back to `defaultValue`; an entity gate without a
 * context always fails closed, so a default can never enable a gated feature.
 */
function resolveEvaluatedDefinition(value, context, defaultValue = false) {
    if (value == null) {
        return defaultValue;
    }
    if (value === true) {
        return true;
    }
    if (value === false) {
        return false;
    }
    if (!isEntityGate(value)) {
        return false;
    }
    if (!context) {
        return false;
    }
    return applyEntityGate(value, context.attributes);
}
/**
 * Flattens mixed definitions to plain booleans for consumers that cannot carry
 * entity gates (hook payloads, cached snapshots, legacy flag maps).
 */
function toBooleanDefinitions(definitions, context) {
    const result = {};
    for (const key of Object.keys(definitions)) {
        result[key] = resolveEvaluatedDefinition(definitions[key], context);
    }
    return result;
}
function applyEntityGate(gate, attributes) {
    const results = gate.rules.map((rule) => evaluateRule(rule, attributes));
    return gate.requirement === 'all' ? results.every(Boolean) : results.some(Boolean);
}
function evaluateRule(rule, attributes) {
    const actual = attributes[rule.property];
    const op = rule.op.toLowerCase();
    const valueType = rule.type === 'datetime' ? 'datetime' : 'string';
    if (equalityOps.has(op)) {
        return compareEquality(actual, rule.value, op === 'eq');
    }
    if (comparisonOps.has(op)) {
        return compareOrdered(actual, rule.value, valueType, op);
    }
    if (inOps.has(op)) {
        return compareIn(actual, rule.value);
    }
    if (containsOps.has(op)) {
        return compareContains(actual, rule.value, valueType);
    }
    return false;
}
function compareEquality(actual, expected, shouldEqual) {
    const actualString = actual == null ? '' : String(actual);
    const equal = actualString.localeCompare(expected, undefined, { sensitivity: 'accent' }) === 0
        || actualString.toLowerCase() === expected.toLowerCase();
    return shouldEqual ? equal : !equal;
}
function compareOrdered(actual, expected, valueType, op) {
    if (valueType === 'datetime') {
        const actualDate = parseDateTime(actual);
        const expectedDate = parseDateTime(expected);
        if (actualDate == null || expectedDate == null) {
            return false;
        }
        return compareNumbers(actualDate, expectedDate, op);
    }
    const actualNumber = parseNumber(actual);
    const expectedNumber = parseNumber(expected);
    if (actualNumber == null || expectedNumber == null) {
        return false;
    }
    return compareNumbers(actualNumber, expectedNumber, op);
}
function compareNumbers(actual, expected, op) {
    switch (op) {
        case 'gt':
            return actual > expected;
        case 'gte':
            return actual >= expected;
        case 'lt':
            return actual < expected;
        case 'lte':
            return actual <= expected;
        default:
            return false;
    }
}
function compareIn(actual, expected) {
    const actualString = actual == null ? '' : String(actual);
    return expected
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .some((candidate) => candidate.toLowerCase() === actualString.toLowerCase());
}
function compareContains(actual, expected, valueType) {
    if (valueType === 'string[]' && Array.isArray(actual)) {
        return actual.some((value) => String(value).toLowerCase() === expected.toLowerCase());
    }
    const actualString = actual == null ? '' : String(actual);
    return actualString.toLowerCase().includes(expected.toLowerCase());
}
function parseDateTime(value) {
    if (value instanceof Date) {
        return value.getTime();
    }
    if (typeof value === 'number') {
        return value;
    }
    const text = value == null ? '' : String(value);
    if (!text) {
        return null;
    }
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? null : parsed;
}
function parseNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const text = value == null ? '' : String(value);
    if (!text) {
        return null;
    }
    const parsed = Number(text);
    return Number.isNaN(parsed) ? null : parsed;
}
const contextMappers = new Map();
function registerContext(kind, mapper) {
    contextMappers.set(kind, mapper);
}
function resolveEntityContext(kind, entity) {
    const mapper = contextMappers.get(kind);
    if (!mapper) {
        return null;
    }
    return mapper(entity);
}
function mapEntityContext(kind, entity, mapper) {
    if (mapper) {
        return mapper(entity);
    }
    return resolveEntityContext(kind, entity);
}
function clearRegisteredContexts() {
    contextMappers.clear();
}
function normalizeEntityContext(context, kind) {
    if (!context) {
        return null;
    }
    if (typeof context === 'object' &&
        'kind' in context &&
        'key' in context &&
        'attributes' in context) {
        return context;
    }
    if (kind) {
        return mapEntityContext(kind, context);
    }
    return null;
}
function evaluateEvaluatedGate(features, featureKeys, requirement = 'all', negate = false, entityContext) {
    if (featureKeys.length === 0) {
        return !negate;
    }
    const evaluateKey = (key) => resolveEvaluatedDefinition(features[key], entityContext);
    let result;
    if (requirement === 'any') {
        result = featureKeys.some(evaluateKey);
    }
    else {
        result = featureKeys.every(evaluateKey);
    }
    return negate ? !result : result;
}

(function (exports$1) {
	Object.defineProperty(exports$1, "__esModule", { value: true });
	exports$1.toBooleanDefinitions = exports$1.resolveEvaluatedDefinition = exports$1.resolveEntityContext = exports$1.registerContext = exports$1.normalizeEntityContext = exports$1.mapEntityContext = exports$1.isEntityGate = exports$1.evaluateEvaluatedGate = exports$1.clearRegisteredContexts = exports$1.applyEntityGate = exports$1.serializeJsonForInlineScript = exports$1.touchCacheLruKey = exports$1.serializeCacheLruIndex = exports$1.selectCacheLruKeysToEvict = exports$1.removeCacheLruKeys = exports$1.parseCacheLruIndex = exports$1.isCacheLruEnabled = exports$1.emptyCacheLruIndex = exports$1.normalizeEvaluationClaims = exports$1.evaluationContextCacheKey = exports$1.appendEvaluationContext = exports$1.MAX_EVALUATION_CLAIMS = void 0;
	var evaluation_context_1 = evaluationContext;
	Object.defineProperty(exports$1, "MAX_EVALUATION_CLAIMS", { enumerable: true, get: function () { return evaluation_context_1.MAX_EVALUATION_CLAIMS; } });
	Object.defineProperty(exports$1, "appendEvaluationContext", { enumerable: true, get: function () { return evaluation_context_1.appendEvaluationContext; } });
	Object.defineProperty(exports$1, "evaluationContextCacheKey", { enumerable: true, get: function () { return evaluation_context_1.evaluationContextCacheKey; } });
	Object.defineProperty(exports$1, "normalizeEvaluationClaims", { enumerable: true, get: function () { return evaluation_context_1.normalizeEvaluationClaims; } });
	var cache_lru_1 = cacheLru;
	Object.defineProperty(exports$1, "emptyCacheLruIndex", { enumerable: true, get: function () { return cache_lru_1.emptyCacheLruIndex; } });
	Object.defineProperty(exports$1, "isCacheLruEnabled", { enumerable: true, get: function () { return cache_lru_1.isCacheLruEnabled; } });
	Object.defineProperty(exports$1, "parseCacheLruIndex", { enumerable: true, get: function () { return cache_lru_1.parseCacheLruIndex; } });
	Object.defineProperty(exports$1, "removeCacheLruKeys", { enumerable: true, get: function () { return cache_lru_1.removeCacheLruKeys; } });
	Object.defineProperty(exports$1, "selectCacheLruKeysToEvict", { enumerable: true, get: function () { return cache_lru_1.selectCacheLruKeysToEvict; } });
	Object.defineProperty(exports$1, "serializeCacheLruIndex", { enumerable: true, get: function () { return cache_lru_1.serializeCacheLruIndex; } });
	Object.defineProperty(exports$1, "touchCacheLruKey", { enumerable: true, get: function () { return cache_lru_1.touchCacheLruKey; } });
	var serialize_for_inline_script_1 = serializeForInlineScript;
	Object.defineProperty(exports$1, "serializeJsonForInlineScript", { enumerable: true, get: function () { return serialize_for_inline_script_1.serializeJsonForInlineScript; } });
	var entity_gate_1 = entityGate;
	Object.defineProperty(exports$1, "applyEntityGate", { enumerable: true, get: function () { return entity_gate_1.applyEntityGate; } });
	Object.defineProperty(exports$1, "clearRegisteredContexts", { enumerable: true, get: function () { return entity_gate_1.clearRegisteredContexts; } });
	Object.defineProperty(exports$1, "evaluateEvaluatedGate", { enumerable: true, get: function () { return entity_gate_1.evaluateEvaluatedGate; } });
	Object.defineProperty(exports$1, "isEntityGate", { enumerable: true, get: function () { return entity_gate_1.isEntityGate; } });
	Object.defineProperty(exports$1, "mapEntityContext", { enumerable: true, get: function () { return entity_gate_1.mapEntityContext; } });
	Object.defineProperty(exports$1, "normalizeEntityContext", { enumerable: true, get: function () { return entity_gate_1.normalizeEntityContext; } });
	Object.defineProperty(exports$1, "registerContext", { enumerable: true, get: function () { return entity_gate_1.registerContext; } });
	Object.defineProperty(exports$1, "resolveEntityContext", { enumerable: true, get: function () { return entity_gate_1.resolveEntityContext; } });
	Object.defineProperty(exports$1, "resolveEvaluatedDefinition", { enumerable: true, get: function () { return entity_gate_1.resolveEvaluatedDefinition; } });
	Object.defineProperty(exports$1, "toBooleanDefinitions", { enumerable: true, get: function () { return entity_gate_1.toBooleanDefinitions; } }); 
} (dist));

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
 * Build the feature definitions URL
 */
function buildDefinitionsUrl(config, context) {
    const { baseUrl, appKey, environment, groups, claims } = mergeConfig(config);
    if (!appKey) {
        throw new Error('appKey is required');
    }
    const url = new URL(`${baseUrl}/evaluated-signed/${appKey}/${environment}`);
    const fromParam = typeof context === 'string' ? { identity: context } : context;
    dist.appendEvaluationContext(url, {
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
    return dist.resolveEvaluatedDefinition(value, entityContext);
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
    const enabled = dist.evaluateEvaluatedGate(flags, featureKeys, requirement, negate, entityContext);
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

var clearRegisteredContexts$1 = dist.clearRegisteredContexts;
var normalizeEntityContext$1 = dist.normalizeEntityContext;
var registerContext$1 = dist.registerContext;
var resolveEvaluatedDefinition$1 = dist.resolveEvaluatedDefinition;
var toBooleanDefinitions$1 = dist.toBooleanDefinitions;
export { DEFAULT_BASE_URL, DEFAULT_CONFIG, DEFAULT_ENVIRONMENT, DEFAULT_TIMEOUT, ERROR_CODES, HEADERS, REQUIREMENT, STORAGE_KEYS, TOGGLY_LOADER_KEY, TogglyConfigError, TogglyError, TogglyNetworkError, TogglyTimeoutError, buildDefinitionsUrl, clearRegisteredContexts$1 as clearRegisteredContexts, createLogger, createTimeout, deserializeFlags, evaluateFeatureGate, fetchWithTimeout, isClient, isFeatureEnabled, isServer, mergeConfig, normalizeEntityContext$1 as normalizeEntityContext, normalizeFeatureKeys, parseIdentity, registerContext$1 as registerContext, resolveEvaluatedDefinition$1 as resolveEvaluatedDefinition, serializeFlags, toBooleanDefinitions$1 as toBooleanDefinitions };
//# sourceMappingURL=index.js.map
