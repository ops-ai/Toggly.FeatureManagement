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

export { DEFAULT_BASE_URL, DEFAULT_CONFIG, DEFAULT_ENVIRONMENT, DEFAULT_TIMEOUT, ERROR_CODES, HEADERS, REQUIREMENT, STORAGE_KEYS, TOGGLY_LOADER_KEY, TogglyConfigError, TogglyError, TogglyNetworkError, TogglyTimeoutError, buildDefinitionsUrl, createLogger, createTimeout, deserializeFlags, evaluateFeatureGate, evaluateFeatureGateLocal, fetchWithTimeout, isClient, isFeatureEnabled, isFeatureEnabledLocal, isServer, mergeConfig, normalizeFeatureKeys, parseIdentity, serializeFlags };
//# sourceMappingURL=index.js.map
