'use strict';

var dist$1 = {};

var evaluationContext = {};

(function (exports$1) {
	Object.defineProperty(exports$1, "__esModule", { value: true });
	exports$1.MAX_EVALUATION_CLAIMS = void 0;
	exports$1.normalizeEvaluationClaims = normalizeEvaluationClaims;
	exports$1.buildEvaluatedSignedUrl = buildEvaluatedSignedUrl;
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
	/** Build an evaluated-signed (or variants-signed) definitions URL with evaluation context. */
	function buildEvaluatedSignedUrl(baseURI, appKey, environment, context, variants) {
	    const base = baseURI.replace(/\/$/, '');
	    const path = variants ? 'evaluated-variants-signed' : 'evaluated-signed';
	    const url = new URL(`${base}/${path}/${appKey}/${environment}`);
	    appendEvaluationContext(url, context, variants ? 'variants' : 'evaluated');
	    return url.toString();
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
entityGate.evaluateResolvedKeys = evaluateResolvedKeys;
entityGate.evaluateStoredFeatureKeys = evaluateStoredFeatureKeys;
entityGate.evaluateEvaluatedGate = evaluateEvaluatedGate;
const equalityOps = new Set(['eq', 'neq']);
const comparisonOps = new Set(['gt', 'gte', 'lt', 'lte']);
const inOps = new Set(['in']);
const containsOps = new Set(['contains']);
function isEntityGate(value) {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const gate = value;
    if (!Array.isArray(gate.rules)) {
        return false;
    }
    if (gate.requirement != null && gate.requirement !== 'all' && gate.requirement !== 'any') {
        return false;
    }
    return true;
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
    if (gate.rules.length === 0) {
        return false;
    }
    const requirement = gate.requirement === 'any' ? 'any' : 'all';
    const results = gate.rules.map((rule) => evaluateRule(rule, attributes));
    return requirement === 'all' ? results.every(Boolean) : results.some(Boolean);
}
function evaluateRule(rule, attributes) {
    const actualKey = findAttributeKey(attributes, rule.property);
    if (actualKey === undefined) {
        return false;
    }
    const actual = attributes[actualKey];
    const op = rule.op.toLowerCase();
    const valueType = rule.type ?? 'string';
    if (equalityOps.has(op)) {
        return compareEquality(actual, rule.value, op === 'eq');
    }
    if (comparisonOps.has(op)) {
        return compareOrdered$1(actual, rule.value, valueType, op);
    }
    if (inOps.has(op)) {
        return compareIn(actual, rule.value);
    }
    if (containsOps.has(op)) {
        return compareContains(actual, rule.value, valueType);
    }
    return false;
}
function findAttributeKey(attributes, property) {
    if (Object.prototype.hasOwnProperty.call(attributes, property)) {
        return property;
    }
    const expected = property.toLowerCase();
    return Object.keys(attributes).find((key) => key.toLowerCase() === expected);
}
function compareEquality(actual, expected, shouldEqual) {
    const actualString = actual == null ? '' : String(actual);
    const equal = actualString.toLowerCase() === expected.toLowerCase();
    return shouldEqual ? equal : !equal;
}
function compareOrdered$1(actual, expected, valueType, op) {
    if (valueType === 'datetime') {
        const actualDate = parseDateTime(actual);
        const expectedDate = parseDateTime(expected);
        if (actualDate == null || expectedDate == null) {
            return false;
        }
        return compareNumbers(actualDate, expectedDate, op);
    }
    if (valueType !== 'number') {
        return false;
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
function evaluateResolvedKeys(featureKeys, requirement, negate, isEnabled) {
    if (featureKeys.length === 0) {
        return !negate;
    }
    const result = requirement === 'any' ? featureKeys.some(isEnabled) : featureKeys.every(isEnabled);
    return negate ? !result : result;
}
/**
 * Client-SDK gate evaluation over stored mixed defs. An empty definition
 * set fails closed (`negate`) so a missing payload cannot open a gate.
 */
function evaluateStoredFeatureKeys(features, featureKeys, requirement, negate, isEnabled) {
    if (featureKeys.length > 0 && (!features || Object.keys(features).length === 0)) {
        return negate;
    }
    return evaluateResolvedKeys(featureKeys, requirement, negate, isEnabled);
}
function evaluateEvaluatedGate(features, featureKeys, requirement = 'all', negate = false, entityContext) {
    return evaluateStoredFeatureKeys(features, featureKeys, requirement, negate, (key) => resolveEvaluatedDefinition(features[key], entityContext));
}

(function (exports$1) {
	Object.defineProperty(exports$1, "__esModule", { value: true });
	exports$1.toBooleanDefinitions = exports$1.resolveEvaluatedDefinition = exports$1.resolveEntityContext = exports$1.registerContext = exports$1.normalizeEntityContext = exports$1.mapEntityContext = exports$1.isEntityGate = exports$1.evaluateStoredFeatureKeys = exports$1.evaluateResolvedKeys = exports$1.evaluateEvaluatedGate = exports$1.clearRegisteredContexts = exports$1.applyEntityGate = exports$1.serializeJsonForInlineScript = exports$1.touchCacheLruKey = exports$1.serializeCacheLruIndex = exports$1.selectCacheLruKeysToEvict = exports$1.removeCacheLruKeys = exports$1.parseCacheLruIndex = exports$1.isCacheLruEnabled = exports$1.emptyCacheLruIndex = exports$1.normalizeEvaluationClaims = exports$1.evaluationContextCacheKey = exports$1.buildEvaluatedSignedUrl = exports$1.appendEvaluationContext = exports$1.MAX_EVALUATION_CLAIMS = void 0;
	var evaluation_context_1 = evaluationContext;
	Object.defineProperty(exports$1, "MAX_EVALUATION_CLAIMS", { enumerable: true, get: function () { return evaluation_context_1.MAX_EVALUATION_CLAIMS; } });
	Object.defineProperty(exports$1, "appendEvaluationContext", { enumerable: true, get: function () { return evaluation_context_1.appendEvaluationContext; } });
	Object.defineProperty(exports$1, "buildEvaluatedSignedUrl", { enumerable: true, get: function () { return evaluation_context_1.buildEvaluatedSignedUrl; } });
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
	Object.defineProperty(exports$1, "evaluateResolvedKeys", { enumerable: true, get: function () { return entity_gate_1.evaluateResolvedKeys; } });
	Object.defineProperty(exports$1, "evaluateStoredFeatureKeys", { enumerable: true, get: function () { return entity_gate_1.evaluateStoredFeatureKeys; } });
	Object.defineProperty(exports$1, "isEntityGate", { enumerable: true, get: function () { return entity_gate_1.isEntityGate; } });
	Object.defineProperty(exports$1, "mapEntityContext", { enumerable: true, get: function () { return entity_gate_1.mapEntityContext; } });
	Object.defineProperty(exports$1, "normalizeEntityContext", { enumerable: true, get: function () { return entity_gate_1.normalizeEntityContext; } });
	Object.defineProperty(exports$1, "registerContext", { enumerable: true, get: function () { return entity_gate_1.registerContext; } });
	Object.defineProperty(exports$1, "resolveEntityContext", { enumerable: true, get: function () { return entity_gate_1.resolveEntityContext; } });
	Object.defineProperty(exports$1, "resolveEvaluatedDefinition", { enumerable: true, get: function () { return entity_gate_1.resolveEvaluatedDefinition; } });
	Object.defineProperty(exports$1, "toBooleanDefinitions", { enumerable: true, get: function () { return entity_gate_1.toBooleanDefinitions; } }); 
} (dist$1));

var dist = {};

var builtin = {};

var hash = {};

/** FNV-1a 32-bit helpers matching Go `hash/fnv` New32a. */
Object.defineProperty(hash, "__esModule", { value: true });
hash.fnv1a32 = fnv1a32;
hash.identityBucket = identityBucket;
hash.rolloutBucket = rolloutBucket;
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
function fnv1a32(bytes) {
    let hash = FNV_OFFSET >>> 0;
    for (let i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
    return hash >>> 0;
}
function utf8Bytes(s) {
    return new TextEncoder().encode(s);
}
/**
 * Deterministic bucket in [0.00, 99.99] from identity only (Percentage filter).
 */
function identityBucket(identity) {
    const v = fnv1a32(utf8Bytes(identity)) % 10000;
    return v / 100.0;
}
/**
 * Deterministic bucket in [0.00, 99.99] from featureKey:identity (Targeting rollout).
 */
function rolloutBucket(featureKey, identity) {
    const enc = new TextEncoder();
    const keyBytes = enc.encode(featureKey);
    const idBytes = enc.encode(identity);
    const combined = new Uint8Array(keyBytes.length + 1 + idBytes.length);
    combined.set(keyBytes, 0);
    combined[keyBytes.length] = 58; // ':'
    combined.set(idBytes, keyBytes.length + 1);
    const v = fnv1a32(combined) % 10000;
    return v / 100.0;
}

(function (exports$1) {
	Object.defineProperty(exports$1, "__esModule", { value: true });
	exports$1.rolloutBucket = exports$1.identityBucket = exports$1.targeting = exports$1.timeWindow = exports$1.percentage = exports$1.alwaysOff = exports$1.alwaysOn = void 0;
	exports$1.asFloat = asFloat;
	exports$1.asBool = asBool;
	exports$1.asString = asString;
	exports$1.setTimeWindowNow = setTimeWindowNow;
	exports$1.createDefaultRegistry = createDefaultRegistry;
	const hash_1 = hash;
	Object.defineProperty(exports$1, "identityBucket", { enumerable: true, get: function () { return hash_1.identityBucket; } });
	Object.defineProperty(exports$1, "rolloutBucket", { enumerable: true, get: function () { return hash_1.rolloutBucket; } });
	function asFloat(params, key) {
	    if (!params) {
	        return undefined;
	    }
	    const v = params[key];
	    if (typeof v === 'number' && Number.isFinite(v)) {
	        return v;
	    }
	    if (typeof v === 'string') {
	        const f = Number.parseFloat(v);
	        return Number.isFinite(f) ? f : undefined;
	    }
	    return undefined;
	}
	function asBool(params, key) {
	    if (!params) {
	        return undefined;
	    }
	    const v = params[key];
	    if (typeof v === 'boolean') {
	        return v;
	    }
	    if (typeof v === 'string') {
	        if (v === 'true' || v === 'True' || v === '1') {
	            return true;
	        }
	        if (v === 'false' || v === 'False' || v === '0') {
	            return false;
	        }
	    }
	    return undefined;
	}
	function asString(params, key) {
	    if (!params) {
	        return undefined;
	    }
	    const v = params[key];
	    return typeof v === 'string' ? v : undefined;
	}
	function asStringValue(v) {
	    return typeof v === 'string' ? v : undefined;
	}
	function parseTime(s) {
	    const t = Date.parse(s);
	    if (Number.isNaN(t)) {
	        return undefined;
	    }
	    return new Date(t);
	}
	function collectPrefixedStrings(params, prefix) {
	    if (!params) {
	        return [];
	    }
	    const out = [];
	    const needle = `${prefix}:`;
	    for (const [k, v] of Object.entries(params)) {
	        if (!k.startsWith(needle)) {
	            continue;
	        }
	        const s = asStringValue(v);
	        if (s) {
	            out.push(s);
	        }
	    }
	    return out;
	}
	function contains(list, val, ignoreCase) {
	    for (const s of list) {
	        if (ignoreCase) {
	            if (s.toLowerCase() === val.toLowerCase()) {
	                return true;
	            }
	        }
	        else if (s === val) {
	            return true;
	        }
	    }
	    return false;
	}
	const alwaysOn = () => true;
	exports$1.alwaysOn = alwaysOn;
	const alwaysOff = () => false;
	exports$1.alwaysOff = alwaysOff;
	const percentage = (_featureKey, params, ctx) => {
	    let pct = asFloat(params, 'Value');
	    if (pct === undefined) {
	        pct = asFloat(params, 'Percentage');
	    }
	    if (pct === undefined || pct <= 0) {
	        return false;
	    }
	    if (pct >= 100) {
	        return true;
	    }
	    if (!ctx.identity) {
	        return false;
	    }
	    return (0, hash_1.identityBucket)(ctx.identity) < pct;
	};
	exports$1.percentage = percentage;
	let timeWindowNow;
	/** Test hook to pin TimeWindow "now". */
	function setTimeWindowNow(fn) {
	    timeWindowNow = fn;
	}
	const timeWindow = (_featureKey, params, _ctx) => {
	    const startS = asString(params, 'Start');
	    const endS = asString(params, 'End');
	    if (!startS || !endS) {
	        return false;
	    }
	    const start = parseTime(startS);
	    const end = parseTime(endS);
	    if (!start || !end) {
	        return false;
	    }
	    const now = (timeWindowNow?.() ?? new Date()).getTime();
	    return now >= start.getTime() && now <= end.getTime();
	};
	exports$1.timeWindow = timeWindow;
	const targeting = (featureKey, params, ctx) => {
	    const ignoreCase = asBool(params, 'IgnoreCase') ?? false;
	    const identity = ctx.identity ?? '';
	    if (identity) {
	        const users = collectPrefixedStrings(params, 'Audience.Users');
	        if (contains(users, identity, ignoreCase)) {
	            return true;
	        }
	    }
	    if (ctx.groups && ctx.groups.length > 0) {
	        const groups = collectPrefixedStrings(params, 'Audience.Groups');
	        for (const g of ctx.groups) {
	            if (contains(groups, g, ignoreCase)) {
	                return true;
	            }
	        }
	    }
	    let pct = asFloat(params, 'Audience.DefaultRolloutPercentage');
	    if (pct === undefined) {
	        pct = asFloat(params, 'Percentage');
	    }
	    if (pct === undefined || pct <= 0) {
	        return false;
	    }
	    if (pct >= 100) {
	        return true;
	    }
	    if (!identity) {
	        return false;
	    }
	    return (0, hash_1.rolloutBucket)(featureKey, identity) < pct;
	};
	exports$1.targeting = targeting;
	function createDefaultRegistry() {
	    const reg = new Map();
	    reg.set('AlwaysOn', exports$1.alwaysOn);
	    reg.set('AlwaysOff', exports$1.alwaysOff);
	    reg.set('Percentage', exports$1.percentage);
	    reg.set('TimeWindow', exports$1.timeWindow);
	    reg.set('Targeting', exports$1.targeting);
	    return reg;
	} 
} (builtin));

var contextProperty = {};

Object.defineProperty(contextProperty, "__esModule", { value: true });
contextProperty.isContextPropertyFilter = isContextPropertyFilter;
contextProperty.splitFilters = splitFilters;
contextProperty.evaluateContextProperty = evaluateContextProperty;
contextProperty.evaluateEntityFilters = evaluateEntityFilters;
const CONTEXT_PROPERTY = 'ContextProperty';
function entityAttr(entity, name) {
    const attrs = entity.attributes;
    if (!attrs) {
        return { found: false };
    }
    if (Object.prototype.hasOwnProperty.call(attrs, name)) {
        return { found: true, value: attrs[name] };
    }
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(attrs)) {
        if (k.toLowerCase() === lower) {
            return { found: true, value: v };
        }
    }
    return { found: false };
}
function isContextPropertyFilter(f) {
    return f.name.toLowerCase() === CONTEXT_PROPERTY.toLowerCase();
}
function splitFilters(def) {
    const entity = [];
    const user = [];
    for (const f of def.filters ?? []) {
        if (isContextPropertyFilter(f)) {
            entity.push(f);
        }
        else {
            user.push(f);
        }
    }
    return { entity, user };
}
function paramString(params, key) {
    if (!params) {
        return undefined;
    }
    if (Object.prototype.hasOwnProperty.call(params, key) && params[key] != null) {
        return String(params[key]);
    }
    const lower = key.toLowerCase();
    for (const [k, v] of Object.entries(params)) {
        if (k.toLowerCase() === lower && v != null) {
            return String(v);
        }
    }
    return undefined;
}
function toFloat(v) {
    if (typeof v === 'number' && Number.isFinite(v)) {
        return v;
    }
    if (typeof v === 'string') {
        const f = Number.parseFloat(v);
        return Number.isFinite(f) ? f : undefined;
    }
    const f = Number.parseFloat(String(v));
    return Number.isFinite(f) ? f : undefined;
}
function parseFlexibleTime(v) {
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
        return v;
    }
    const s = String(v);
    const layouts = [
        s, // Date.parse handles RFC3339 / ISO
    ];
    for (const candidate of layouts) {
        const t = Date.parse(candidate);
        if (!Number.isNaN(t)) {
            return new Date(t);
        }
    }
    // Date-only
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const t = Date.parse(`${s}T00:00:00Z`);
        if (!Number.isNaN(t)) {
            return new Date(t);
        }
    }
    return undefined;
}
function compareOrdered(actual, expected, valueType, op) {
    if (valueType === 'datetime') {
        const a = parseFlexibleTime(actual);
        const e = parseFlexibleTime(expected);
        if (!a || !e) {
            return false;
        }
        const at = a.getTime();
        const et = e.getTime();
        switch (op) {
            case 'gt':
                return at > et;
            case 'gte':
                return at >= et;
            case 'lt':
                return at < et;
            case 'lte':
                return at <= et;
            default:
                return false;
        }
    }
    if (valueType === 'number') {
        const a = toFloat(actual);
        const e = toFloat(expected);
        if (a === undefined || e === undefined) {
            return false;
        }
        switch (op) {
            case 'gt':
                return a > e;
            case 'gte':
                return a >= e;
            case 'lt':
                return a < e;
            case 'lte':
                return a <= e;
            default:
                return false;
        }
    }
    return false;
}
function compareContext(actual, op, expected, valueType) {
    switch (op) {
        case 'eq':
            return String(actual).toLowerCase() === expected.toLowerCase();
        case 'neq':
            return String(actual).toLowerCase() !== expected.toLowerCase();
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte':
            return compareOrdered(actual, expected, valueType, op);
        case 'in': {
            const actualS = String(actual);
            for (const c of expected.split(',')) {
                const trimmed = c.trim();
                if (trimmed && trimmed.toLowerCase() === actualS.toLowerCase()) {
                    return true;
                }
            }
            return false;
        }
        case 'contains': {
            if (valueType === 'string[]') {
                if (Array.isArray(actual)) {
                    for (const v of actual) {
                        if (String(v).toLowerCase() === expected.toLowerCase()) {
                            return true;
                        }
                    }
                }
                return false;
            }
            return String(actual).toLowerCase().includes(expected.toLowerCase());
        }
        default:
            return false;
    }
}
function evaluateContextProperty(params, entity) {
    const property = paramString(params, 'Property');
    const opRaw = paramString(params, 'Operator');
    const expected = paramString(params, 'Value');
    if (!property ||
        !opRaw ||
        expected === undefined ||
        property.trim() === '' ||
        opRaw.trim() === '') {
        return false;
    }
    let valueType = paramString(params, 'ValueType') ?? 'string';
    const op = opRaw.toLowerCase();
    valueType = valueType.toLowerCase();
    const looked = entityAttr(entity, property);
    if (!looked.found) {
        return false;
    }
    return compareContext(looked.value, op, expected, valueType);
}
function normalizeRequirement$1(req) {
    if (!req) {
        return 'Any';
    }
    if (req.toLowerCase() === 'all') {
        return 'All';
    }
    return 'Any';
}
function evaluateEntityFilters(def, entity) {
    const { entity: filters } = splitFilters(def);
    if (filters.length === 0) {
        return false;
    }
    const req = normalizeRequirement$1(def.contextRequirementType || def.requirementType);
    if (req === 'All') {
        for (const f of filters) {
            if (!evaluateContextProperty(f.parameters, entity)) {
                return false;
            }
        }
        return true;
    }
    for (const f of filters) {
        if (evaluateContextProperty(f.parameters, entity)) {
            return true;
        }
    }
    return false;
}

var engine = {};

Object.defineProperty(engine, "__esModule", { value: true });
engine.evaluateDefinition = evaluateDefinition;
engine.evaluateDefinitions = evaluateDefinitions;
engine.evaluateFeatureGate = evaluateFeatureGate$1;
engine.indexDefinitions = indexDefinitions;
engine.parseDefinitionsPayload = parseDefinitionsPayload;
engine.snapshotEvaluatedBooleans = snapshotEvaluatedBooleans;
const builtin_1 = builtin;
const context_property_1 = contextProperty;
function normalizeRequirement(req) {
    if (!req) {
        return 'Any';
    }
    if (req.toLowerCase() === 'all') {
        return 'All';
    }
    return 'Any';
}
function evaluateGroup(registry, featureKey, filters, req, ctx) {
    const requirement = normalizeRequirement(req);
    if (filters.length === 0) {
        return false;
    }
    if (requirement === 'All') {
        for (const f of filters) {
            const ev = registry.get(f.name);
            if (!ev) {
                return false;
            }
            if (!ev(featureKey, f.parameters, ctx)) {
                return false;
            }
        }
        return true;
    }
    for (const f of filters) {
        const ev = registry.get(f.name);
        if (!ev) {
            continue;
        }
        if (ev(featureKey, f.parameters, ctx)) {
            return true;
        }
    }
    return false;
}
let defaultRegistry = null;
function getDefaultRegistry() {
    if (!defaultRegistry) {
        defaultRegistry = (0, builtin_1.createDefaultRegistry)();
    }
    return defaultRegistry;
}
/**
 * Evaluate a single feature definition against an evaluation context.
 * Missing / unknown filters are treated as false (IgnoreMissingFeatureFilters).
 */
function evaluateDefinition(def, ctx = {}, registry = getDefaultRegistry()) {
    const filters = def.filters ?? [];
    if (filters.length === 0) {
        return false;
    }
    const { entity: entityFilters, user: userFilters } = (0, context_property_1.splitFilters)(def);
    if (entityFilters.length > 0) {
        if (!ctx.entity) {
            return false;
        }
        if (!(0, context_property_1.evaluateEntityFilters)(def, ctx.entity)) {
            return false;
        }
        if (userFilters.length === 0) {
            return true;
        }
        return evaluateGroup(registry, def.featureKey, userFilters, def.requirementType, ctx);
    }
    return evaluateGroup(registry, def.featureKey, userFilters, def.requirementType, ctx);
}
/**
 * Look up a definition by key and evaluate it. Unknown keys → false.
 */
function evaluateDefinitions(defsByKey, featureKey, ctx = {}, registry) {
    const def = defsByKey.get(featureKey);
    if (!def) {
        return false;
    }
    return evaluateDefinition(def, ctx, registry ?? getDefaultRegistry());
}
/**
 * Evaluate multiple feature keys with any/all + optional negate.
 */
function evaluateFeatureGate$1(defsByKey, featureKeys, requirement = 'all', negate = false, ctx = {}, registry) {
    if (featureKeys.length === 0) {
        return !negate;
    }
    const reg = registry ?? getDefaultRegistry();
    let result;
    if (requirement === 'any') {
        result = featureKeys.some((key) => evaluateDefinitions(defsByKey, key, ctx, reg));
    }
    else {
        result = featureKeys.every((key) => evaluateDefinitions(defsByKey, key, ctx, reg));
    }
    return negate ? !result : result;
}
/**
 * Index a definitions-signed array by featureKey.
 */
function indexDefinitions(definitions) {
    const map = new Map();
    if (!definitions) {
        return map;
    }
    for (const def of definitions) {
        if (def?.featureKey) {
            map.set(def.featureKey, def);
        }
    }
    return map;
}
/**
 * Parse a definitions payload (array or signed envelope defs) into a map.
 */
function parseDefinitionsPayload(raw) {
    if (Array.isArray(raw)) {
        return indexDefinitions(raw);
    }
    if (raw && typeof raw === 'object' && 'defs' in raw) {
        const defs = raw.defs;
        if (Array.isArray(defs)) {
            return indexDefinitions(defs);
        }
    }
    return new Map();
}
/**
 * Snapshot evaluated booleans for all known keys (entity gates fail closed
 * without entity context). Useful for hydration helpers.
 */
function snapshotEvaluatedBooleans(defsByKey, ctx = {}) {
    const out = {};
    for (const key of defsByKey.keys()) {
        out[key] = evaluateDefinitions(defsByKey, key, ctx);
    }
    return out;
}

(function (exports$1) {
	Object.defineProperty(exports$1, "__esModule", { value: true });
	exports$1.snapshotEvaluatedBooleans = exports$1.parseDefinitionsPayload = exports$1.indexDefinitions = exports$1.evaluateFeatureGate = exports$1.evaluateDefinitions = exports$1.evaluateDefinition = exports$1.splitFilters = exports$1.isContextPropertyFilter = exports$1.evaluateEntityFilters = exports$1.evaluateContextProperty = exports$1.setTimeWindowNow = exports$1.rolloutBucket = exports$1.identityBucket = exports$1.createDefaultRegistry = void 0;
	var builtin_1 = builtin;
	Object.defineProperty(exports$1, "createDefaultRegistry", { enumerable: true, get: function () { return builtin_1.createDefaultRegistry; } });
	Object.defineProperty(exports$1, "identityBucket", { enumerable: true, get: function () { return builtin_1.identityBucket; } });
	Object.defineProperty(exports$1, "rolloutBucket", { enumerable: true, get: function () { return builtin_1.rolloutBucket; } });
	Object.defineProperty(exports$1, "setTimeWindowNow", { enumerable: true, get: function () { return builtin_1.setTimeWindowNow; } });
	var context_property_1 = contextProperty;
	Object.defineProperty(exports$1, "evaluateContextProperty", { enumerable: true, get: function () { return context_property_1.evaluateContextProperty; } });
	Object.defineProperty(exports$1, "evaluateEntityFilters", { enumerable: true, get: function () { return context_property_1.evaluateEntityFilters; } });
	Object.defineProperty(exports$1, "isContextPropertyFilter", { enumerable: true, get: function () { return context_property_1.isContextPropertyFilter; } });
	Object.defineProperty(exports$1, "splitFilters", { enumerable: true, get: function () { return context_property_1.splitFilters; } });
	var engine_1 = engine;
	Object.defineProperty(exports$1, "evaluateDefinition", { enumerable: true, get: function () { return engine_1.evaluateDefinition; } });
	Object.defineProperty(exports$1, "evaluateDefinitions", { enumerable: true, get: function () { return engine_1.evaluateDefinitions; } });
	Object.defineProperty(exports$1, "evaluateFeatureGate", { enumerable: true, get: function () { return engine_1.evaluateFeatureGate; } });
	Object.defineProperty(exports$1, "indexDefinitions", { enumerable: true, get: function () { return engine_1.indexDefinitions; } });
	Object.defineProperty(exports$1, "parseDefinitionsPayload", { enumerable: true, get: function () { return engine_1.parseDefinitionsPayload; } });
	Object.defineProperty(exports$1, "snapshotEvaluatedBooleans", { enumerable: true, get: function () { return engine_1.snapshotEvaluatedBooleans; } }); 
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
    dist$1.appendEvaluationContext(url, {
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
    return dist$1.resolveEvaluatedDefinition(value, entityContext);
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
    return dist.evaluateDefinitions(defsByKey, featureKey, evalCtx);
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
    const enabled = dist.evaluateFeatureGate(defsByKey, featureKeys, requirement, negate, evalCtx);
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
    const enabled = dist$1.evaluateEvaluatedGate(flags, featureKeys, requirement, negate, entityContext);
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

exports.DEFAULT_BASE_URL = DEFAULT_BASE_URL;
exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
exports.DEFAULT_ENVIRONMENT = DEFAULT_ENVIRONMENT;
exports.DEFAULT_TIMEOUT = DEFAULT_TIMEOUT;
exports.ERROR_CODES = ERROR_CODES;
exports.HEADERS = HEADERS;
exports.REQUIREMENT = REQUIREMENT;
exports.STORAGE_KEYS = STORAGE_KEYS;
exports.TOGGLY_LOADER_KEY = TOGGLY_LOADER_KEY;
exports.TogglyConfigError = TogglyConfigError;
exports.TogglyError = TogglyError;
exports.TogglyNetworkError = TogglyNetworkError;
exports.TogglyTimeoutError = TogglyTimeoutError;
exports.buildDefinitionsUrl = buildDefinitionsUrl;
exports.clearRegisteredContexts = dist$1.clearRegisteredContexts;
exports.createLogger = createLogger;
exports.createTimeout = createTimeout;
exports.deserializeFlags = deserializeFlags;
exports.evaluateDefinitions = dist.evaluateDefinitions;
exports.evaluateFeatureGate = evaluateFeatureGate;
exports.evaluateFeatureGateLocal = evaluateFeatureGateLocal;
exports.fetchWithTimeout = fetchWithTimeout;
exports.indexDefinitions = dist.indexDefinitions;
exports.isClient = isClient;
exports.isFeatureEnabled = isFeatureEnabled;
exports.isFeatureEnabledLocal = isFeatureEnabledLocal;
exports.isServer = isServer;
exports.mergeConfig = mergeConfig;
exports.normalizeEntityContext = dist$1.normalizeEntityContext;
exports.normalizeFeatureKeys = normalizeFeatureKeys;
exports.parseDefinitionsPayload = dist.parseDefinitionsPayload;
exports.parseIdentity = parseIdentity;
exports.registerContext = dist$1.registerContext;
exports.resolveEvaluatedDefinition = dist$1.resolveEvaluatedDefinition;
exports.serializeFlags = serializeFlags;
exports.snapshotEvaluatedBooleans = dist.snapshotEvaluatedBooleans;
exports.toBooleanDefinitions = dist$1.toBooleanDefinitions;
//# sourceMappingURL=index.js.map
