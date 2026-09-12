'use strict';

var React = require('react');
var jsxRuntime = require('react/jsx-runtime');

var context = React.createContext({
    toggly: undefined,
});
var Provider = context.Provider, Consumer = context.Consumer;

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise */

var extendStatics = function(d, b) {
    extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
    return extendStatics(d, b);
};

function __extends(d, b) {
    if (typeof b !== "function" && b !== null)
        throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
    extendStatics(d, b);
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
}

var __assign = function() {
    __assign = Object.assign || function __assign(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};

function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

function __generator(thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
}

function __spreadArray(to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
}

var dist = {};

var evaluationContext = {};

(function (exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.MAX_EVALUATION_CLAIMS = void 0;
	exports.normalizeEvaluationClaims = normalizeEvaluationClaims;
	exports.buildEvaluatedSignedUrl = buildEvaluatedSignedUrl;
	exports.appendEvaluationContext = appendEvaluationContext;
	exports.evaluationContextCacheKey = evaluationContextCacheKey;
	/** Maximum claim entries sent or honored on evaluated-signed requests (worker enforces the same cap). */
	exports.MAX_EVALUATION_CLAIMS = 20;
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
	    return Object.fromEntries(entries.slice(0, exports.MAX_EVALUATION_CLAIMS));
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

var setEvaluationContext = {};

Object.defineProperty(setEvaluationContext, "__esModule", { value: true });
setEvaluationContext.bindEvaluationContextChangeState = bindEvaluationContextChangeState;
setEvaluationContext.bindTogglyServiceContextState = bindTogglyServiceContextState;
setEvaluationContext.setBrowserSdkEvaluationContext = setBrowserSdkEvaluationContext;
setEvaluationContext.setEvaluationContextSafely = setEvaluationContextSafely;
function bindEvaluationContextChangeState(bindings) {
    return {
        readState: () => ({
            identity: bindings.identity.get(),
            groups: [...bindings.groups.get()],
            claims: { ...bindings.claims.get() },
            features: bindings.features.get(),
            variants: bindings.variants.get(),
        }),
        writeState: (state) => {
            bindings.identity.set(state.identity);
            bindings.groups.set([...state.groups]);
            bindings.claims.set({ ...state.claims });
            bindings.features.set(state.features);
            bindings.variants.set(state.variants);
        },
    };
}
function bindTogglyServiceContextState(host) {
    return bindEvaluationContextChangeState({
        identity: {
            get: () => host._config.identity,
            set: (value) => {
                host._config.identity = value;
            },
        },
        groups: {
            get: () => host._groups,
            set: (value) => {
                host._groups = value;
            },
        },
        claims: {
            get: () => host._claims,
            set: (value) => {
                host._claims = value;
            },
        },
        features: {
            get: () => host._features,
            set: (value) => {
                host._features = value;
            },
        },
        variants: {
            get: () => host._variants,
            set: (value) => {
                host._variants = value;
            },
        },
    });
}
async function setBrowserSdkEvaluationContext(host, context, featureDefaults, runner) {
    return setEvaluationContextSafely(context, featureDefaults, {
        ...bindTogglyServiceContextState(host),
        notifyRefresh: () => runner.notifyFeaturesRefresh(),
        refreshStrict: () => runner.loadFeaturesStrict(),
    });
}
/**
 * Withhold prior evaluated state, apply partial context updates, and refresh under
 * strict mode. Restores the prior snapshot when refresh fails.
 */
async function setEvaluationContextSafely(context, featureDefaults, options) {
    const previous = options.readState();
    const withheld = {
        ...previous,
        features: { ...featureDefaults },
        variants: null,
    };
    options.writeState(withheld);
    options.notifyRefresh();
    const next = {
        ...withheld,
    };
    if (context.identity !== undefined) {
        next.identity = context.identity || undefined;
    }
    if (context.groups !== undefined) {
        next.groups = [...context.groups];
    }
    if (context.claims !== undefined) {
        next.claims = { ...context.claims };
    }
    options.writeState(next);
    try {
        await options.refreshStrict();
    }
    catch (error) {
        options.writeState(previous);
        options.notifyRefresh();
        throw error;
    }
}

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
function compareOrdered(actual, expected, valueType, op) {
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

(function (exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.toBooleanDefinitions = exports.resolveEvaluatedDefinition = exports.resolveEntityContext = exports.registerContext = exports.normalizeEntityContext = exports.mapEntityContext = exports.isEntityGate = exports.evaluateStoredFeatureKeys = exports.evaluateResolvedKeys = exports.evaluateEvaluatedGate = exports.clearRegisteredContexts = exports.applyEntityGate = exports.serializeJsonForInlineScript = exports.touchCacheLruKey = exports.serializeCacheLruIndex = exports.selectCacheLruKeysToEvict = exports.removeCacheLruKeys = exports.parseCacheLruIndex = exports.isCacheLruEnabled = exports.emptyCacheLruIndex = exports.setEvaluationContextSafely = exports.setBrowserSdkEvaluationContext = exports.bindTogglyServiceContextState = exports.bindEvaluationContextChangeState = exports.normalizeEvaluationClaims = exports.evaluationContextCacheKey = exports.buildEvaluatedSignedUrl = exports.appendEvaluationContext = exports.MAX_EVALUATION_CLAIMS = void 0;
	var evaluation_context_1 = evaluationContext;
	Object.defineProperty(exports, "MAX_EVALUATION_CLAIMS", { enumerable: true, get: function () { return evaluation_context_1.MAX_EVALUATION_CLAIMS; } });
	Object.defineProperty(exports, "appendEvaluationContext", { enumerable: true, get: function () { return evaluation_context_1.appendEvaluationContext; } });
	Object.defineProperty(exports, "buildEvaluatedSignedUrl", { enumerable: true, get: function () { return evaluation_context_1.buildEvaluatedSignedUrl; } });
	Object.defineProperty(exports, "evaluationContextCacheKey", { enumerable: true, get: function () { return evaluation_context_1.evaluationContextCacheKey; } });
	Object.defineProperty(exports, "normalizeEvaluationClaims", { enumerable: true, get: function () { return evaluation_context_1.normalizeEvaluationClaims; } });
	var set_evaluation_context_1 = setEvaluationContext;
	Object.defineProperty(exports, "bindEvaluationContextChangeState", { enumerable: true, get: function () { return set_evaluation_context_1.bindEvaluationContextChangeState; } });
	Object.defineProperty(exports, "bindTogglyServiceContextState", { enumerable: true, get: function () { return set_evaluation_context_1.bindTogglyServiceContextState; } });
	Object.defineProperty(exports, "setBrowserSdkEvaluationContext", { enumerable: true, get: function () { return set_evaluation_context_1.setBrowserSdkEvaluationContext; } });
	Object.defineProperty(exports, "setEvaluationContextSafely", { enumerable: true, get: function () { return set_evaluation_context_1.setEvaluationContextSafely; } });
	var cache_lru_1 = cacheLru;
	Object.defineProperty(exports, "emptyCacheLruIndex", { enumerable: true, get: function () { return cache_lru_1.emptyCacheLruIndex; } });
	Object.defineProperty(exports, "isCacheLruEnabled", { enumerable: true, get: function () { return cache_lru_1.isCacheLruEnabled; } });
	Object.defineProperty(exports, "parseCacheLruIndex", { enumerable: true, get: function () { return cache_lru_1.parseCacheLruIndex; } });
	Object.defineProperty(exports, "removeCacheLruKeys", { enumerable: true, get: function () { return cache_lru_1.removeCacheLruKeys; } });
	Object.defineProperty(exports, "selectCacheLruKeysToEvict", { enumerable: true, get: function () { return cache_lru_1.selectCacheLruKeysToEvict; } });
	Object.defineProperty(exports, "serializeCacheLruIndex", { enumerable: true, get: function () { return cache_lru_1.serializeCacheLruIndex; } });
	Object.defineProperty(exports, "touchCacheLruKey", { enumerable: true, get: function () { return cache_lru_1.touchCacheLruKey; } });
	var serialize_for_inline_script_1 = serializeForInlineScript;
	Object.defineProperty(exports, "serializeJsonForInlineScript", { enumerable: true, get: function () { return serialize_for_inline_script_1.serializeJsonForInlineScript; } });
	var entity_gate_1 = entityGate;
	Object.defineProperty(exports, "applyEntityGate", { enumerable: true, get: function () { return entity_gate_1.applyEntityGate; } });
	Object.defineProperty(exports, "clearRegisteredContexts", { enumerable: true, get: function () { return entity_gate_1.clearRegisteredContexts; } });
	Object.defineProperty(exports, "evaluateEvaluatedGate", { enumerable: true, get: function () { return entity_gate_1.evaluateEvaluatedGate; } });
	Object.defineProperty(exports, "evaluateResolvedKeys", { enumerable: true, get: function () { return entity_gate_1.evaluateResolvedKeys; } });
	Object.defineProperty(exports, "evaluateStoredFeatureKeys", { enumerable: true, get: function () { return entity_gate_1.evaluateStoredFeatureKeys; } });
	Object.defineProperty(exports, "isEntityGate", { enumerable: true, get: function () { return entity_gate_1.isEntityGate; } });
	Object.defineProperty(exports, "mapEntityContext", { enumerable: true, get: function () { return entity_gate_1.mapEntityContext; } });
	Object.defineProperty(exports, "normalizeEntityContext", { enumerable: true, get: function () { return entity_gate_1.normalizeEntityContext; } });
	Object.defineProperty(exports, "registerContext", { enumerable: true, get: function () { return entity_gate_1.registerContext; } });
	Object.defineProperty(exports, "resolveEntityContext", { enumerable: true, get: function () { return entity_gate_1.resolveEntityContext; } });
	Object.defineProperty(exports, "resolveEvaluatedDefinition", { enumerable: true, get: function () { return entity_gate_1.resolveEvaluatedDefinition; } });
	Object.defineProperty(exports, "toBooleanDefinitions", { enumerable: true, get: function () { return entity_gate_1.toBooleanDefinitions; } });
} (dist));

/**
 * Builds a flag-key → gate-id index. Throws if a flag key appears in more than one gate.
 */
function buildFlagGateIndex(gates) {
    const index = new Map();
    for (const gate of gates) {
        for (const flagKey of gate.flagKeys) {
            const existing = index.get(flagKey);
            if (existing !== undefined && existing !== gate.id) {
                throw new Error(`Flag key "${flagKey}" is registered on multiple local gates ("${existing}" and "${gate.id}")`);
            }
            index.set(flagKey, gate.id);
        }
    }
    return index;
}
function findGate(gates, gateId) {
    return gates.find((gate) => gate.id === gateId);
}
/**
 * Returns whether the local prerequisite allows the flag (true when ungated).
 */
function isLocalPrerequisiteMet(flagKey, gates, gateIndex) {
    const gateId = gateIndex.get(flagKey);
    if (gateId === undefined) {
        return true;
    }
    const gate = findGate(gates, gateId);
    return gate?.isEnabled() ?? true;
}
/**
 * Applies the local post-filter to a single remote boolean.
 */
function applyLocalGate(remote, flagKey, gates, gateIndex) {
    if (!remote) {
        return false;
    }
    return isLocalPrerequisiteMet(flagKey, gates, gateIndex);
}

/**
 * Internal class that manages hook registration and execution
 */
var HookExecutor = /** @class */ (function () {
    function HookExecutor() {
        this.hooks = [];
    }
    /**
     * Register a new hook
     */
    HookExecutor.prototype.addHook = function (hook) {
        var metadata = hook.getMetadata();
        // Check for duplicate hook names
        var existingHook = this.hooks.find(function (h) { return h.getMetadata().name === metadata.name; });
        if (existingHook) {
            console.warn("[Toggly] Hook with name \"".concat(metadata.name, "\" already registered. Skipping."));
            return;
        }
        this.hooks.push(hook);
    };
    /**
     * Remove a hook by name
     * @returns true if hook was found and removed, false otherwise
     */
    HookExecutor.prototype.removeHook = function (name) {
        var index = this.hooks.findIndex(function (h) { return h.getMetadata().name === name; });
        if (index > -1) {
            this.hooks.splice(index, 1);
            return true;
        }
        return false;
    };
    /**
     * Execute beforeEvaluation hooks in registration order (FIFO)
     * Collects data from each hook to pass to afterEvaluation
     */
    HookExecutor.prototype.executeBeforeEvaluation = function (flagKey, defaultValue) {
        return __awaiter(this, void 0, void 0, function () {
            var dataMap, _i, _a, hook, data, error_1;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        dataMap = new Map();
                        _i = 0, _a = this.hooks;
                        _b.label = 1;
                    case 1:
                        if (!(_i < _a.length)) return [3 /*break*/, 6];
                        hook = _a[_i];
                        if (!hook.beforeEvaluation) return [3 /*break*/, 5];
                        _b.label = 2;
                    case 2:
                        _b.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, hook.beforeEvaluation(flagKey, defaultValue)];
                    case 3:
                        data = _b.sent();
                        dataMap.set(hook.getMetadata().name, data);
                        return [3 /*break*/, 5];
                    case 4:
                        error_1 = _b.sent();
                        console.error("[Toggly] Error in hook \"".concat(hook.getMetadata().name, ".beforeEvaluation\":"), error_1);
                        return [3 /*break*/, 5];
                    case 5:
                        _i++;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/, dataMap];
                }
            });
        });
    };
    /**
     * Execute afterEvaluation hooks in reverse order (LIFO)
     * Passes data from corresponding beforeEvaluation
     */
    HookExecutor.prototype.executeAfterEvaluation = function (flagKey, dataMap, result) {
        return __awaiter(this, void 0, void 0, function () {
            var i, hook, data, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        i = this.hooks.length - 1;
                        _a.label = 1;
                    case 1:
                        if (!(i >= 0)) return [3 /*break*/, 6];
                        hook = this.hooks[i];
                        if (!hook.afterEvaluation) return [3 /*break*/, 5];
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 5]);
                        data = dataMap.get(hook.getMetadata().name);
                        return [4 /*yield*/, hook.afterEvaluation(flagKey, data, result)];
                    case 3:
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        error_2 = _a.sent();
                        console.error("[Toggly] Error in hook \"".concat(hook.getMetadata().name, ".afterEvaluation\":"), error_2);
                        return [3 /*break*/, 5];
                    case 5:
                        i--;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Execute beforeIdentify hooks in registration order (FIFO)
     */
    HookExecutor.prototype.executeBeforeIdentify = function (identity) {
        return __awaiter(this, void 0, void 0, function () {
            var dataMap, _i, _a, hook, data, error_3;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        dataMap = new Map();
                        _i = 0, _a = this.hooks;
                        _b.label = 1;
                    case 1:
                        if (!(_i < _a.length)) return [3 /*break*/, 6];
                        hook = _a[_i];
                        if (!hook.beforeIdentify) return [3 /*break*/, 5];
                        _b.label = 2;
                    case 2:
                        _b.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, hook.beforeIdentify(identity)];
                    case 3:
                        data = _b.sent();
                        dataMap.set(hook.getMetadata().name, data);
                        return [3 /*break*/, 5];
                    case 4:
                        error_3 = _b.sent();
                        console.error("[Toggly] Error in hook \"".concat(hook.getMetadata().name, ".beforeIdentify\":"), error_3);
                        return [3 /*break*/, 5];
                    case 5:
                        _i++;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/, dataMap];
                }
            });
        });
    };
    /**
     * Execute afterIdentify hooks in reverse order (LIFO)
     */
    HookExecutor.prototype.executeAfterIdentify = function (identity, dataMap) {
        return __awaiter(this, void 0, void 0, function () {
            var i, hook, data, error_4;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        i = this.hooks.length - 1;
                        _a.label = 1;
                    case 1:
                        if (!(i >= 0)) return [3 /*break*/, 6];
                        hook = this.hooks[i];
                        if (!hook.afterIdentify) return [3 /*break*/, 5];
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 5]);
                        data = dataMap.get(hook.getMetadata().name);
                        return [4 /*yield*/, hook.afterIdentify(identity, data)];
                    case 3:
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        error_4 = _a.sent();
                        console.error("[Toggly] Error in hook \"".concat(hook.getMetadata().name, ".afterIdentify\":"), error_4);
                        return [3 /*break*/, 5];
                    case 5:
                        i--;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Execute afterRefresh hooks in registration order (FIFO)
     */
    HookExecutor.prototype.executeAfterRefresh = function (flags) {
        return __awaiter(this, void 0, void 0, function () {
            var _i, _a, hook, error_5;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _i = 0, _a = this.hooks;
                        _b.label = 1;
                    case 1:
                        if (!(_i < _a.length)) return [3 /*break*/, 6];
                        hook = _a[_i];
                        if (!hook.afterRefresh) return [3 /*break*/, 5];
                        _b.label = 2;
                    case 2:
                        _b.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, hook.afterRefresh(flags)];
                    case 3:
                        _b.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        error_5 = _b.sent();
                        console.error("[Toggly] Error in hook \"".concat(hook.getMetadata().name, ".afterRefresh\":"), error_5);
                        return [3 /*break*/, 5];
                    case 5:
                        _i++;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    return HookExecutor;
}());

var SDK_ID = 'react';
var SDK_VERSION = '1.6.0';
var SDK_HEADER_ID = 'X-Toggly-Sdk';
var SDK_HEADER_VERSION = 'X-Toggly-Sdk-Version';
function sdkUserAgent() {
    return "toggly-".concat(SDK_ID, "/").concat(SDK_VERSION);
}
function sdkCustomHeaders() {
    var _a;
    return _a = {},
        _a[SDK_HEADER_ID] = SDK_ID,
        _a[SDK_HEADER_VERSION] = SDK_VERSION,
        _a;
}
function appendSdkQueryParams(params) {
    params.set('sdk', SDK_ID);
    params.set('sdkVersion', SDK_VERSION);
}
/** Browser and React Native use custom headers on HTTP (User-Agent is forbidden in browser fetch). */
function usesSdkCustomHeaders() {
    var _a;
    var g = globalThis;
    if (g.window !== undefined && g.document !== undefined) {
        return true;
    }
    if (((_a = g.navigator) === null || _a === void 0 ? void 0 : _a.product) === 'ReactNative') {
        return true;
    }
    return false;
}
function buildDefinitionFetchHeaders(existing) {
    if (existing === void 0) { existing = {}; }
    var headers = __assign({}, existing);
    if (usesSdkCustomHeaders()) {
        Object.assign(headers, sdkCustomHeaders());
    }
    else {
        headers['User-Agent'] = sdkUserAgent();
    }
    return headers;
}

var WS_RECONNECT_BASE_MS = 5000;
var WS_RECONNECT_MAX_MS = 60000;
var REFRESH_DEBOUNCE_MS = 300;
function buildWebSocketUrl(baseUri, appKey, cachedEtag) {
    var wsBase = baseUri
        .replace(/^https:\/\//, 'wss://')
        .replace(/^http:\/\//, 'ws://')
        .replace(/\/$/, '');
    var params = new URLSearchParams();
    if (cachedEtag) {
        params.set('rev', cachedEtag);
    }
    appendSdkQueryParams(params);
    var query = params.toString();
    return "".concat(wsBase, "/").concat(appKey, "/ws").concat(query ? "?".concat(query) : '');
}
function getNextReconnectDelayMs(attempt) {
    return Math.min(WS_RECONNECT_BASE_MS * Math.pow(2, attempt), WS_RECONNECT_MAX_MS);
}
function shouldFetchOnSync(message, cachedEtag) {
    if (message.type !== 'sync') {
        return false;
    }
    if (message.unchanged === true) {
        return false;
    }
    if (!cachedEtag) {
        return true;
    }
    if (message.etag && message.etag !== cachedEtag) {
        return true;
    }
    return false;
}
function shouldFetchOnFlagsUpdated(message, cachedEtag) {
    if (message.type !== 'flags-updated' && message.type !== 'update') {
        return false;
    }
    if (!message.etag || !cachedEtag) {
        return true;
    }
    return message.etag !== cachedEtag;
}
function shouldFetchOnSigningKeyUpdated(message) {
    return message.type === 'signing-key-updated';
}
function planFlagsUpdatedRefresh(message, previousRevision) {
    var _a;
    if (shouldFetchOnSigningKeyUpdated(message)) {
        return { action: 'refresh-jwks' };
    }
    if (shouldFetchOnFlagsUpdated(message, previousRevision)) {
        return { action: 'refresh-pinned', pin: (_a = message.etag) !== null && _a !== void 0 ? _a : null };
    }
    return { action: 'none' };
}
function applyFlagsUpdatedPlan(plan, message, hooks) {
    if (plan.action === 'refresh-jwks') {
        hooks.refreshJwks();
        return;
    }
    if (plan.action === 'refresh-pinned') {
        hooks.refreshPinned(plan.pin);
        return;
    }
    if (message.etag) {
        hooks.cacheEtagIfPresent(message.etag);
    }
}
/**
 * Append `?rev=` for a cache-proof definitions GET after `flags-updated`.
 * Invariant: never cache a WebSocket etag before HTTP confirms the revision;
 * post-notify GETs should use `?rev=` and must not send If-None-Match.
 */
function appendDefinitionsRevisionParam(url, rev) {
    if (!rev) {
        return url;
    }
    try {
        var parsed = new URL(url);
        parsed.searchParams.set('rev', rev);
        return parsed.toString();
    }
    catch (_a) {
        var separator = url.includes('?') ? '&' : '?';
        return "".concat(url).concat(separator, "rev=").concat(encodeURIComponent(rev));
    }
}

/**
 * Envelope timestamp freshness checks for signed definitions.
 *
 * Timestamps are Unix seconds (same units as Definitions `evaluated-signed`).
 * When `maxSignatureAgeSeconds` is unset or <= 0, freshness is not enforced
 * (back-compat). Clock skew allows a small future window for client clocks.
 */
function assertEnvelopeFreshness(timestamp, options) {
    const maxAge = options?.maxSignatureAgeSeconds;
    if (maxAge == null || maxAge <= 0) {
        return;
    }
    if (!Number.isFinite(timestamp)) {
        throw new Error('invalid signature timestamp');
    }
    const now = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
    const skew = options?.maxClockSkewSeconds ?? 60;
    if (timestamp > now + skew) {
        throw new Error('signature timestamp is in the future');
    }
    if (now - timestamp > maxAge) {
        throw new Error('signature timestamp exceeded maxSignatureAgeSeconds');
    }
}

/**
 * Browser / React Native signed-definitions verification (ES256).
 *
 * Matches Go toggly/crypto/verify.go and Node @ops-ai/toggly-node-core:
 * payload = exact raw defs JSON + "|" + timestamp
 * digest  = SHA-256(SHA-256(utf8(payload)))
 * signature = standard or URL-safe base64 of IEEE P1363 (r||s) or DER
 *
 * On Node (and Jest) we verify with crypto.verify(null, doubleHash).
 * In browsers, WebCrypto's ECDSA verify hashes again, so we pass the first
 * SHA-256 digest into subtle.verify (effective double-hash). DER signatures
 * are converted to P1363 before subtle.verify.
 */
/**
 * Extract the exact raw JSON text of a **top-level** property only.
 * Nested keys (e.g. data.defs) are ignored so unsigned outer fields cannot
 * be swapped in after verifying nested signed bytes.
 */
function extractRawJsonProperty(text, key) {
    let index = 0;
    let depth = 0;
    let inString = false;
    let escape = false;
    while (index < text.length) {
        const character = text[index];
        if (inString) {
            if (escape) {
                escape = false;
            }
            else if (character === '\\') {
                escape = true;
            }
            else if (character === '"') {
                inString = false;
            }
            index += 1;
            continue;
        }
        if (character === '"') {
            if (depth === 1) {
                const keyEnd = findStringEnd(text, index);
                if (keyEnd == null) {
                    return null;
                }
                const propertyName = text.slice(index + 1, keyEnd);
                let valueStart = keyEnd + 1;
                while (valueStart < text.length && /\s/.test(text[valueStart])) {
                    valueStart += 1;
                }
                if (propertyName === key && valueStart < text.length && text[valueStart] === ':') {
                    valueStart += 1;
                    while (valueStart < text.length && /\s/.test(text[valueStart])) {
                        valueStart += 1;
                    }
                    return extractJsonValue(text, valueStart);
                }
                index = keyEnd + 1;
                continue;
            }
            inString = true;
            index += 1;
            continue;
        }
        if (character === '{' || character === '[') {
            depth += 1;
        }
        else if (character === '}' || character === ']') {
            depth -= 1;
        }
        index += 1;
    }
    return null;
}
function findStringEnd(text, startQuote) {
    let escape = false;
    for (let i = startQuote + 1; i < text.length; i++) {
        const c = text[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (c === '\\') {
            escape = true;
            continue;
        }
        if (c === '"') {
            return i;
        }
    }
    return null;
}
function extractJsonValue(text, start) {
    if (start >= text.length) {
        return null;
    }
    const first = text[start];
    if (first === '{' || first === '[') {
        let depth = 0;
        let inString = false;
        let escape = false;
        for (let j = start; j < text.length; j++) {
            const c = text[j];
            if (inString) {
                if (escape) {
                    escape = false;
                }
                else if (c === '\\') {
                    escape = true;
                }
                else if (c === '"') {
                    inString = false;
                }
                continue;
            }
            if (c === '"') {
                inString = true;
            }
            else if (c === '{' || c === '[') {
                depth += 1;
            }
            else if (c === '}' || c === ']') {
                depth -= 1;
                if (depth === 0) {
                    return text.slice(start, j + 1);
                }
            }
        }
        return null;
    }
    if (first === '"') {
        const end = findStringEnd(text, start);
        return end == null ? null : text.slice(start, end + 1);
    }
    let j = start;
    while (j < text.length && /[^\s,}\]]/.test(text[j])) {
        j += 1;
    }
    return text.slice(start, j);
}
function parseSignedEnvelope(bodyText) {
    const parsed = JSON.parse(bodyText);
    if (parsed == null ||
        typeof parsed !== 'object' ||
        typeof parsed.signature !== 'string' ||
        parsed.signature.length === 0 ||
        typeof parsed.kid !== 'string' ||
        parsed.kid.length === 0 ||
        typeof parsed.timestamp !== 'number') {
        throw new Error('Invalid signed definitions envelope');
    }
    const defsRaw = extractRawJsonProperty(bodyText, 'defs') ??
        extractRawJsonProperty(bodyText, 'data');
    if (!defsRaw) {
        throw new Error('Signed envelope missing defs');
    }
    return { envelope: parsed, defsRaw };
}
/** Parse the verified raw defs JSON — never use envelope.defs after verify. */
function parseDefinitionsFromRaw(defsRaw) {
    return JSON.parse(defsRaw);
}
function padBase64Url(value) {
    const remainder = value.length % 4;
    if (remainder === 0)
        return value;
    return value + '='.repeat(4 - remainder);
}
function base64ToBytes(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = padBase64Url(normalized);
    const maybeBuffer = globalThis.Buffer;
    if (maybeBuffer) {
        const buf = maybeBuffer.from(padded, 'base64');
        return Uint8Array.from(buf);
    }
    if (typeof atob !== 'function') {
        throw new Error('base64 decoding is not available in this environment');
    }
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
/**
 * Convert ASN.1/DER ECDSA signature (SEQUENCE of two INTEGERs) to IEEE P1363
 * (r||s, 64 bytes for P-256). WebCrypto subtle.verify only accepts P1363.
 */
function derSignatureToP1363(der) {
    if (der.length < 8 || der[0] !== 0x30) {
        throw new Error('invalid DER signature');
    }
    let offset = 1;
    const readLength = () => {
        const first = der[offset++];
        if (first < 0x80) {
            return first;
        }
        const count = first & 0x7f;
        if (count === 0 || count > 2 || offset + count > der.length) {
            throw new Error('invalid DER length');
        }
        let value = 0;
        for (let i = 0; i < count; i++) {
            value = (value << 8) | der[offset++];
        }
        return value;
    };
    readLength(); // sequence length
    const readInteger = () => {
        if (der[offset++] !== 0x02) {
            throw new Error('invalid DER integer');
        }
        const length = readLength();
        if (offset + length > der.length) {
            throw new Error('invalid DER integer length');
        }
        let start = offset;
        let end = offset + length;
        // Strip leading zero padding used for sign bit.
        while (end - start > 32 && der[start] === 0x00) {
            start += 1;
        }
        const out = new Uint8Array(32);
        const src = der.subarray(start, end);
        if (src.length > 32) {
            throw new Error('DER integer too large for P-256');
        }
        out.set(src, 32 - src.length);
        offset = end;
        return out;
    };
    const r = readInteger();
    const s = readInteger();
    const p1363 = new Uint8Array(64);
    p1363.set(r, 0);
    p1363.set(s, 32);
    return p1363;
}
function toP1363Signature(signature) {
    if (signature.length === 64) {
        return signature;
    }
    return derSignatureToP1363(signature);
}
function isNodeRuntime() {
    return (typeof process !== 'undefined' &&
        typeof process.versions?.node === 'string');
}
async function sha1HexUpper(bytes) {
    if (isNodeRuntime()) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const nodeCrypto = require('crypto');
        return nodeCrypto.createHash('sha1').update(bytes).digest('hex').toUpperCase();
    }
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const exact = bytes.slice();
        const digest = await crypto.subtle.digest('SHA-1', exact);
        return Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
            .join('');
    }
    throw new Error('WebCrypto is required to validate JWKs');
}
async function sha256Bytes(data) {
    if (isNodeRuntime()) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const nodeCrypto = require('crypto');
        return Uint8Array.from(nodeCrypto.createHash('sha256').update(data).digest());
    }
    if (typeof crypto === 'undefined' || !crypto.subtle) {
        throw new Error('WebCrypto is required to hash signed definitions');
    }
    const digest = await crypto.subtle.digest('SHA-256', data.slice());
    return new Uint8Array(digest);
}
async function computeKid(x, y) {
    const xBytes = base64ToBytes(x);
    const yBytes = base64ToBytes(y);
    const combined = new Uint8Array(xBytes.length + yBytes.length);
    combined.set(xBytes, 0);
    combined.set(yBytes, xBytes.length);
    const digest = await sha1HexUpper(combined);
    return `${digest}ES256`;
}
/**
 * Verify a signed definitions envelope using exact raw defs bytes.
 *
 * After a successful verify, callers MUST apply `parseDefinitionsFromRaw(defsRaw)`
 * — never `envelope.defs` from JSON.parse of the outer body.
 */
async function verifySignedDefinitions(defsRaw, envelope, jwks, allowedKids, freshness) {
    assertEnvelopeFreshness(envelope.timestamp, freshness);
    if (allowedKids?.length && !allowedKids.includes(envelope.kid)) {
        throw new Error(`kid not allowed: ${envelope.kid}`);
    }
    const matching = jwks.keys.find((k) => k.kid === envelope.kid);
    if (!matching) {
        throw new Error(`no matching jwk for kid "${envelope.kid}"`);
    }
    if (matching.alg !== 'ES256') {
        throw new Error(`unsupported alg: ${matching.alg ?? ''}`);
    }
    if (matching.crv !== 'P-256') {
        throw new Error(`unsupported crv: ${matching.crv ?? ''}`);
    }
    if (!matching.x || !matching.y) {
        throw new Error('missing x or y coordinate');
    }
    const expectedKid = await computeKid(matching.x, matching.y);
    if (matching.kid !== expectedKid) {
        throw new Error(`invalid kid: expected ${expectedKid}, got ${matching.kid}`);
    }
    const payloadBytes = new TextEncoder().encode(`${defsRaw}|${envelope.timestamp}`);
    const firstDigest = await sha256Bytes(payloadBytes);
    const doubleDigest = await sha256Bytes(firstDigest);
    const signature = base64ToBytes(envelope.signature);
    if (isNodeRuntime()) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const nodeCrypto = require('crypto');
        const key = nodeCrypto.createPublicKey({
            key: {
                kty: matching.kty ?? 'EC',
                crv: matching.crv ?? 'P-256',
                x: matching.x,
                y: matching.y,
            },
            format: 'jwk',
        });
        const encoding = signature.length === 64 ? 'ieee-p1363' : 'der';
        const ok = nodeCrypto.verify(null, doubleDigest, { key, dsaEncoding: encoding }, signature);
        if (!ok) {
            throw new Error('invalid signature');
        }
        return;
    }
    if (typeof crypto === 'undefined' || !crypto.subtle) {
        throw new Error('WebCrypto is required to verify signed definitions');
    }
    const cryptoKey = await crypto.subtle.importKey('jwk', {
        kty: matching.kty ?? 'EC',
        crv: matching.crv ?? 'P-256',
        x: matching.x,
        y: matching.y,
        ext: true,
    }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const p1363 = toP1363Signature(signature);
    const isValid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, p1363, firstDigest);
    if (!isValid) {
        throw new Error('invalid signature');
    }
}

/**
 * Shared helpers for parsing evaluated-signed API responses.
 * When verifySignatures is enabled, verifies the ES256 envelope before applying defs.
 */
function resolveBaseUri(options) {
    const base = options.baseURI ?? options.baseUri ?? options.baseUrl;
    if (!base) {
        throw new Error('baseURI (or baseUri) is required when verifySignatures is enabled');
    }
    return base;
}
async function fetchJwks(baseUri, headers, fetchImpl = fetch) {
    const base = baseUri.replace(/\/$/, '');
    const response = await fetchImpl(`${base}/.well-known/jwks`, {
        method: 'GET',
        headers,
    });
    if (!response.ok) {
        throw new Error(`JWKS fetch failed: HTTP ${response.status}`);
    }
    return (await response.json());
}
/**
 * Read response body as text (prefer text() for raw-defs verification).
 */
async function readResponseBody(response) {
    if (typeof response.text === 'function') {
        return response.text();
    }
    return JSON.stringify(await response.json());
}
/**
 * Parse an evaluated-signed body.
 * With verifySignatures: verify envelope and return parsed defs (never envelope.defs).
 * Without: JSON.parse as today (may be `{ defs }` or a bare map).
 */
async function parseEvaluatedResponseBody(bodyText, options) {
    if (!options.verifySignatures) {
        return JSON.parse(bodyText);
    }
    const { envelope, defsRaw } = parseSignedEnvelope(bodyText);
    const jwks = options.getJwks
        ? await options.getJwks()
        : await fetchJwks(resolveBaseUri(options), options.headers, options.fetchImpl ?? fetch);
    await verifySignedDefinitions(defsRaw, {
        signature: envelope.signature,
        timestamp: envelope.timestamp,
        kid: envelope.kid,
    }, jwks, options.allowedKeyIds, options.maxSignatureAgeSeconds != null
        ? { maxSignatureAgeSeconds: options.maxSignatureAgeSeconds }
        : null);
    return parseDefinitionsFromRaw(defsRaw);
}
/** In-memory JWKS cache used by client SDKs across refreshes. */
class InMemoryJwksCache {
    constructor() {
        this.jwks = null;
    }
    clear() {
        this.jwks = null;
    }
    async get(options, forceRefresh = false) {
        if (!forceRefresh && this.jwks) {
            return this.jwks;
        }
        this.jwks = await fetchJwks(resolveBaseUri(options), options.headers, options.fetchImpl ?? fetch);
        return this.jwks;
    }
}
/**
 * Read an evaluated-signed HTTP body and return unwrapped defs.
 * Unsigned payloads may be `{ defs }` or a bare map; signed payloads are verified first.
 */
async function readAndParseEvaluatedResponse(response, options) {
    const parsed = await parseEvaluatedResponseBody(await readResponseBody(response), options);
    return options.verifySignatures ? parsed : unwrapDefsPayload(parsed);
}
/**
 * Parse an evaluated-signed response using an in-memory JWKS cache.
 * Client SDKs pass their existing config object plus optional fetch headers.
 */
async function readAndParseEvaluatedResponseCached(response, jwks, config, headers) {
    return readAndParseEvaluatedResponse(response, signedDefsClientOptions({
        verifySignatures: config.verifySignatures,
        baseURI: config.baseURI,
        baseUri: config.baseUri ?? config.baseUrl,
        allowedKeyIds: config.allowedKeyIds,
        maxSignatureAgeSeconds: config.maxSignatureAgeSeconds,
        headers,
        fetchImpl: config.fetchImpl,
    }, jwks));
}
const DEFINITIONS_REVISION_HEADER = 'X-Definitions-Revision';
function revisionFromResponse(response) {
    const headers = response.headers;
    if (!headers || typeof headers.get !== 'function') {
        return null;
    }
    return headers.get(DEFINITIONS_REVISION_HEADER) ?? headers.get('ETag');
}
function asHeaderRecord(init) {
    if (!init) {
        return {};
    }
    if (Array.isArray(init)) {
        return Object.fromEntries(init);
    }
    if (typeof init.forEach === 'function') {
        const record = {};
        init.forEach((value, key) => {
            record[key] = value;
        });
        return record;
    }
    const record = {};
    for (const [key, value] of Object.entries(init)) {
        if (typeof value === 'string') {
            record[key] = value;
        }
    }
    return record;
}
/**
 * Fetch evaluated-signed defs, honor If-None-Match / 304, and parse through the JWKS cache.
 */
async function fetchEvaluatedSignedDefinitions(url, jwks, config, request = {}) {
    const fetchImpl = config.fetchImpl ?? fetch;
    const headers = asHeaderRecord(request.headers);
    if (request.revision) {
        headers['If-None-Match'] = request.revision;
    }
    const response = await fetchImpl(url, { headers });
    const revision = revisionFromResponse(response);
    if (response.status === 304) {
        return { notModified: true, revision };
    }
    if (!response.ok) {
        throw new Error(`Failed to fetch feature flags: ${response.status} ${response.statusText}`);
    }
    const defs = await readAndParseEvaluatedResponseCached(response, jwks, config, request.headers);
    return { notModified: false, defs, revision };
}
/** Build parse options that reuse an in-memory JWKS cache. */
function signedDefsClientOptions(config, jwks) {
    const baseURI = config.baseURI ?? config.baseUri ?? config.baseUrl;
    return {
        ...config,
        baseURI,
        maxSignatureAgeSeconds: config.maxSignatureAgeSeconds ?? undefined,
        getJwks: () => jwks.get({
            baseURI,
            headers: config.headers,
            fetchImpl: config.fetchImpl,
        }),
    };
}
/** Unwrap `{ defs }` when present; otherwise treat payload as the defs map. */
function unwrapDefsPayload(payload) {
    if (typeof payload === 'object' && payload !== null && 'defs' in payload) {
        const defs = payload.defs;
        if (defs !== undefined) {
            return defs;
        }
    }
    return payload;
}
/** Coerce evaluated-variants payload to a defs map; arrays/primitives become `{}`. */
function asVariantDefsRecord(parsedDefs) {
    if (parsedDefs && typeof parsedDefs === 'object' && !Array.isArray(parsedDefs)) {
        return parsedDefs;
    }
    return {};
}
/**
 * Shared fallback when evaluated-signed fetch fails: prefer cached variants,
 * else flags/defaults when features were never loaded. Returns null to keep
 * in-memory state unchanged.
 */
function resolveEvaluatedFetchErrorState(input) {
    if (input.enableVariants) {
        const cachedVariants = input.readVariants() ?? null;
        if (cachedVariants) {
            return {
                variants: cachedVariants,
                features: input.variantsToFlags(cachedVariants),
            };
        }
        if (!input.featuresAlreadyLoaded) {
            return { variants: null, features: input.readFlags() ?? input.defaults };
        }
        return null;
    }
    if (!input.featuresAlreadyLoaded) {
        return { variants: null, features: input.readFlags() ?? input.defaults };
    }
    return null;
}

var canUseStorage = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
var CACHE_PREFIX = 'toggly:flags:';
var VARIANTS_CACHE_PREFIX = 'toggly:variants:';
var REVISION_CACHE_PREFIX = 'toggly:revision:';
var CACHE_LRU_KEY = 'toggly:cache-lru';
function getCacheKey(appKey, environment, contextKey) {
    if (contextKey === void 0) { contextKey = ''; }
    var suffix = contextKey ? ":".concat(contextKey) : '';
    return "".concat(CACHE_PREFIX).concat(appKey, ":").concat(environment).concat(suffix);
}
function getVariantsCacheKey(appKey, environment, contextKey) {
    if (contextKey === void 0) { contextKey = ''; }
    var suffix = contextKey ? ":".concat(contextKey) : '';
    return "".concat(VARIANTS_CACHE_PREFIX).concat(appKey, ":").concat(environment).concat(suffix);
}
function getRevisionCacheKey(appKey, environment) {
    return "".concat(REVISION_CACHE_PREFIX).concat(appKey, ":").concat(environment);
}
function isTrackedCacheKey(key) {
    return key.startsWith(CACHE_PREFIX) || key.startsWith(VARIANTS_CACHE_PREFIX);
}
function loadLruIndex() {
    try {
        return dist.parseCacheLruIndex(localStorage.getItem(CACHE_LRU_KEY));
    }
    catch (_a) {
        return dist.parseCacheLruIndex(null);
    }
}
function saveLruIndex(index) {
    try {
        localStorage.setItem(CACHE_LRU_KEY, dist.serializeCacheLruIndex(index));
    }
    catch ( /* storage full or unavailable */_a) { /* storage full or unavailable */ }
}
function touchCacheKey(key, maxCacheKeys) {
    if (!canUseStorage || !dist.isCacheLruEnabled(maxCacheKeys) || !isTrackedCacheKey(key)) {
        return;
    }
    try {
        saveLruIndex(dist.touchCacheLruKey(loadLruIndex(), key));
    }
    catch ( /* ignore LRU failures */_a) { /* ignore LRU failures */ }
}
function enforceMaxCacheKeys(protectKeys, maxCacheKeys) {
    if (!canUseStorage || !dist.isCacheLruEnabled(maxCacheKeys)) {
        return;
    }
    try {
        var index = loadLruIndex();
        var toEvict = dist.selectCacheLruKeysToEvict(index, maxCacheKeys, { protectKeys: protectKeys }).filter(function (key) { return isTrackedCacheKey(key); });
        if (toEvict.length === 0) {
            return;
        }
        for (var _i = 0, toEvict_1 = toEvict; _i < toEvict_1.length; _i++) {
            var key = toEvict_1[_i];
            try {
                localStorage.removeItem(key);
            }
            catch ( /* ignore per-key removal failures */_a) { /* ignore per-key removal failures */ }
        }
        index = dist.removeCacheLruKeys(index, toEvict);
        saveLruIndex(index);
    }
    catch ( /* ignore LRU failures */_b) { /* ignore LRU failures */ }
}
function removeCacheKeysFromLruIndex(keys, maxCacheKeys) {
    if (!canUseStorage || !dist.isCacheLruEnabled(maxCacheKeys)) {
        return;
    }
    try {
        saveLruIndex(dist.removeCacheLruKeys(loadLruIndex(), keys));
    }
    catch ( /* ignore LRU failures */_a) { /* ignore LRU failures */ }
}
function clearCachedFlagsAndVariants(appKey, environment, contextKey, maxCacheKeys) {
    if (contextKey === void 0) { contextKey = ''; }
    if (!canUseStorage)
        return;
    try {
        var flagsKey = getCacheKey(appKey, environment, contextKey);
        var variantsKey = getVariantsCacheKey(appKey, environment, contextKey);
        var revisionKey = getRevisionCacheKey(appKey, environment);
        localStorage.removeItem(flagsKey);
        localStorage.removeItem(variantsKey);
        localStorage.removeItem(revisionKey);
        removeCacheKeysFromLruIndex([flagsKey, variantsKey], maxCacheKeys);
    }
    catch ( /* ignore */_a) { /* ignore */ }
}
function readCachedRevision(appKey, environment) {
    if (!canUseStorage)
        return null;
    try {
        return localStorage.getItem(getRevisionCacheKey(appKey, environment));
    }
    catch (_a) {
        return null;
    }
}
function writeCachedRevision(appKey, environment, revision) {
    if (!canUseStorage)
        return;
    try {
        localStorage.setItem(getRevisionCacheKey(appKey, environment), revision);
    }
    catch ( /* storage full or unavailable */_a) { /* storage full or unavailable */ }
}
function variantDefsToFlags(defs) {
    var _a;
    var out = {};
    for (var _i = 0, _b = Object.keys(defs); _i < _b.length; _i++) {
        var key = _b[_i];
        out[key] = ((_a = defs[key]) === null || _a === void 0 ? void 0 : _a.enabled) === true;
    }
    return out;
}
function readCachedFlags(appKey, environment, contextKey, maxCacheKeys) {
    if (contextKey === void 0) { contextKey = ''; }
    if (!canUseStorage)
        return null;
    try {
        var key = getCacheKey(appKey, environment, contextKey);
        var raw = localStorage.getItem(key);
        var parsed = raw ? JSON.parse(raw) : null;
        if (raw != null && parsed != null) {
            touchCacheKey(key, maxCacheKeys);
        }
        return parsed;
    }
    catch (_a) {
        return null;
    }
}
function writeCachedFlags(appKey, environment, flags, contextKey, maxCacheKeys) {
    if (contextKey === void 0) { contextKey = ''; }
    if (!canUseStorage)
        return;
    try {
        var key = getCacheKey(appKey, environment, contextKey);
        var variantsKey = getVariantsCacheKey(appKey, environment, contextKey);
        localStorage.setItem(key, JSON.stringify(flags));
        touchCacheKey(key, maxCacheKeys);
        enforceMaxCacheKeys([key, variantsKey], maxCacheKeys);
    }
    catch ( /* storage full or unavailable */_a) { /* storage full or unavailable */ }
}
function readCachedVariants(appKey, environment, contextKey, maxCacheKeys) {
    if (contextKey === void 0) { contextKey = ''; }
    if (!canUseStorage)
        return null;
    try {
        var key = getVariantsCacheKey(appKey, environment, contextKey);
        var raw = localStorage.getItem(key);
        var parsed = raw ? JSON.parse(raw) : null;
        if (raw != null && parsed != null) {
            touchCacheKey(key, maxCacheKeys);
        }
        return parsed;
    }
    catch (_a) {
        return null;
    }
}
function writeCachedVariants(appKey, environment, variants, contextKey, maxCacheKeys) {
    if (contextKey === void 0) { contextKey = ''; }
    if (!canUseStorage)
        return;
    try {
        var key = getVariantsCacheKey(appKey, environment, contextKey);
        var flagsKey = getCacheKey(appKey, environment, contextKey);
        localStorage.setItem(key, JSON.stringify(variants));
        touchCacheKey(key, maxCacheKeys);
        enforceMaxCacheKeys([flagsKey, key], maxCacheKeys);
    }
    catch ( /* storage full or unavailable */_a) { /* storage full or unavailable */ }
}
var Toggly = /** @class */ (function () {
    function Toggly(config) {
        var _this = this;
        var _a, _b;
        this._config = {
            baseURI: 'https://definitions.toggly.io',
            verifySignatures: false,
            showFeatureDuringEvaluation: false,
            hooks: []
        };
        this._features = null;
        this._variants = null;
        this._loadingFeatures = false;
        this._hookExecutor = new HookExecutor();
        this._featuresRefreshListeners = new Set();
        this._localGates = [];
        this._localGateIndex = new Map();
        this._localGatesChangedListeners = new Set();
        this._groups = [];
        this._claims = {};
        this._ws = null;
        this._wsConnected = false;
        this._wsReconnectTimer = null;
        this._wsReconnectAttempt = 0;
        this._refreshDebounceTimer = null;
        this._cachedDefinitionsRevision = null;
        this._pendingDefinitionsPin = null;
        this._lastFallbackRefresh = 0;
        this._jwks = new InMemoryJwksCache();
        this.shouldShowFeatureDuringEvaluation = false;
        this.setContext = function (context) { return __awaiter(_this, void 0, void 0, function () {
            var _this = this;
            var _a;
            return __generator(this, function (_b) {
                return [2 /*return*/, dist.setBrowserSdkEvaluationContext(this, context, ((_a = this._config.featureDefaults) !== null && _a !== void 0 ? _a : {}), {
                        notifyFeaturesRefresh: function () { return _this.notifyFeaturesRefresh(); },
                        loadFeaturesStrict: function () { return _this._loadFeatures(true, { strict: true }); },
                    })];
            });
        }); };
        this._loadFeatures = function (forceRefresh, options) {
            if (forceRefresh === void 0) { forceRefresh = false; }
            return __awaiter(_this, void 0, void 0, function () {
                var now, isInitialLoad, appKey, env, contextKey, url, pin, fetchUrl, loaded, parsedDefs, defs, error_1, recovered;
                var _this = this;
                var _a, _b, _c, _d, _e;
                return __generator(this, function (_f) {
                    switch (_f.label) {
                        case 0:
                            if (!this._loadingFeatures) return [3 /*break*/, 2];
                            return [4 /*yield*/, new Promise(function (resolve) {
                                    var checkIfApiCallFinished = function () {
                                        if (!_this._loadingFeatures) {
                                            resolve();
                                        }
                                        else {
                                            setTimeout(checkIfApiCallFinished, 100);
                                        }
                                    };
                                    checkIfApiCallFinished();
                                })];
                        case 1:
                            _f.sent();
                            _f.label = 2;
                        case 2:
                            // Features already loaded
                            if (this._features !== null && !forceRefresh) {
                                // When WebSocket is connected, throttle HTTP refreshes to fallback interval
                                if (this._wsConnected) {
                                    now = Date.now();
                                    if (now - this._lastFallbackRefresh < Toggly.FALLBACK_REFRESH_INTERVAL) {
                                        return [2 /*return*/, this._booleanFeatures()];
                                    }
                                    this._lastFallbackRefresh = now;
                                }
                                return [2 /*return*/, this._booleanFeatures()];
                            }
                            this._loadingFeatures = true;
                            isInitialLoad = this._ws === null && !this._wsConnected;
                            appKey = (_a = this._config.appKey) !== null && _a !== void 0 ? _a : '';
                            env = (_b = this._config.environment) !== null && _b !== void 0 ? _b : 'Production';
                            contextKey = this._contextCacheKey();
                            _f.label = 3;
                        case 3:
                            _f.trys.push([3, 7, 10, 11]);
                            url = dist.buildEvaluatedSignedUrl((_c = this._config.baseURI) !== null && _c !== void 0 ? _c : 'https://definitions.toggly.io', appKey, env, this._getEvaluationContext(), !!this._config.enableVariants);
                            pin = this._pendingDefinitionsPin;
                            this._pendingDefinitionsPin = null;
                            fetchUrl = appendDefinitionsRevisionParam(url, pin);
                            return [4 /*yield*/, fetchEvaluatedSignedDefinitions(fetchUrl, this._jwks, __assign(__assign({}, this._config), { baseURI: (_d = this._config.baseURI) !== null && _d !== void 0 ? _d : 'https://definitions.toggly.io' }), {
                                    revision: pin ? null : this._definitionsRevision,
                                    headers: buildDefinitionFetchHeaders(),
                                })];
                        case 4:
                            loaded = _f.sent();
                            if (loaded.revision) {
                                this._cacheDefinitionsRevision(loaded.revision.replace(/^"+|"+$/g, ''));
                            }
                            if (loaded.notModified) {
                                return [2 /*return*/, this._booleanFeatures()];
                            }
                            parsedDefs = loaded.defs;
                            if (this._config.enableVariants) {
                                defs = asVariantDefsRecord(parsedDefs);
                                this._variants = defs;
                                this._features = variantDefsToFlags(defs);
                                if (this._features && this._canPersist) {
                                    writeCachedVariants(appKey, env, defs, contextKey, this._config.maxCacheKeys);
                                    writeCachedFlags(appKey, env, this._features, contextKey, this._config.maxCacheKeys);
                                }
                            }
                            else {
                                this._variants = null;
                                this._features = (parsedDefs !== null && parsedDefs !== void 0 ? parsedDefs : {});
                                if (this._features && this._canPersist) {
                                    writeCachedFlags(appKey, env, this._features, contextKey, this._config.maxCacheKeys);
                                }
                            }
                            if (!this._features) return [3 /*break*/, 6];
                            return [4 /*yield*/, this._hookExecutor.executeAfterRefresh(dist.toBooleanDefinitions(this._features))];
                        case 5:
                            _f.sent();
                            _f.label = 6;
                        case 6:
                            this.notifyFeaturesRefresh();
                            return [3 /*break*/, 11];
                        case 7:
                            error_1 = _f.sent();
                            this._reportError('Error fetching feature flags', error_1);
                            recovered = resolveEvaluatedFetchErrorState({
                                enableVariants: !!this._config.enableVariants,
                                featuresAlreadyLoaded: this._features !== null,
                                readVariants: function () {
                                    return _this._canPersist
                                        ? readCachedVariants(appKey, env, contextKey, _this._config.maxCacheKeys)
                                        : null;
                                },
                                readFlags: function () {
                                    return _this._canPersist
                                        ? readCachedFlags(appKey, env, contextKey, _this._config.maxCacheKeys)
                                        : null;
                                },
                                defaults: (_e = this._config.featureDefaults) !== null && _e !== void 0 ? _e : {},
                                variantsToFlags: variantDefsToFlags,
                            });
                            if (recovered) {
                                this._variants = recovered.variants;
                                this._features = recovered.features;
                            }
                            if (options === null || options === void 0 ? void 0 : options.strict) {
                                throw error_1;
                            }
                            console.warn('Toggly --- Using cached/default features as features could not be loaded from the Toggly API');
                            if (!this._features) return [3 /*break*/, 9];
                            return [4 /*yield*/, this._hookExecutor.executeAfterRefresh(dist.toBooleanDefinitions(this._features))];
                        case 8:
                            _f.sent();
                            _f.label = 9;
                        case 9:
                            this.notifyFeaturesRefresh();
                            return [3 /*break*/, 11];
                        case 10:
                            this._loadingFeatures = false;
                            return [7 /*endfinally*/];
                        case 11:
                            // Start WebSocket live updates after initial feature load
                            if (isInitialLoad) {
                                this.startWebSocket();
                            }
                            return [2 /*return*/, this._features ? dist.toBooleanDefinitions(this._features) : null];
                    }
                });
            });
        };
        this._featuresLoaded = function () { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this._features) {
                            return [2 /*return*/, dist.toBooleanDefinitions(this._features)];
                        }
                        return [4 /*yield*/, this._loadFeatures()];
                    case 1: return [2 /*return*/, _a.sent()];
                }
            });
        }); };
        this._evaluateFeatureGate = function (gate, requirement, negate, context, kind) {
            if (requirement === void 0) { requirement = 'all'; }
            if (negate === void 0) { negate = false; }
            return __awaiter(_this, void 0, void 0, function () {
                var entityContext;
                var _this = this;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, this._featuresLoaded()];
                        case 1:
                            _a.sent();
                            entityContext = dist.normalizeEntityContext(context, kind);
                            return [2 /*return*/, dist.evaluateStoredFeatureKeys(this._features, gate.map(String), requirement === 'any' ? 'any' : 'all', negate, function (key) { return _this._getEffectiveFlagValue(key, entityContext); })];
                    }
                });
            });
        };
        this.evaluateFeatureGate = function (featureKeys, requirement, negate, context, kind) {
            if (requirement === void 0) { requirement = 'all'; }
            if (negate === void 0) { negate = false; }
            return __awaiter(_this, void 0, void 0, function () {
                var dataMap, result;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0:
                            if (!(featureKeys.length > 0)) return [3 /*break*/, 4];
                            return [4 /*yield*/, this._hookExecutor.executeBeforeEvaluation(featureKeys[0])];
                        case 1:
                            dataMap = _a.sent();
                            return [4 /*yield*/, this._evaluateFeatureGate(featureKeys, requirement, negate, context, kind)];
                        case 2:
                            result = _a.sent();
                            return [4 /*yield*/, this._hookExecutor.executeAfterEvaluation(featureKeys[0], dataMap, result)];
                        case 3:
                            _a.sent();
                            return [2 /*return*/, result];
                        case 4: return [4 /*yield*/, this._evaluateFeatureGate(featureKeys, requirement, negate, context, kind)];
                        case 5: return [2 /*return*/, _a.sent()];
                    }
                });
            });
        };
        this.isFeatureOn = function (featureKey, context, kind) { return __awaiter(_this, void 0, void 0, function () {
            var dataMap, result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this._hookExecutor.executeBeforeEvaluation(featureKey)];
                    case 1:
                        dataMap = _a.sent();
                        return [4 /*yield*/, this._evaluateFeatureGate([featureKey], 'all', false, context, kind)];
                    case 2:
                        result = _a.sent();
                        return [4 /*yield*/, this._hookExecutor.executeAfterEvaluation(featureKey, dataMap, result)];
                    case 3:
                        _a.sent();
                        return [2 /*return*/, result];
                }
            });
        }); };
        this.isFeatureOff = function (featureKey, context, kind) { return __awaiter(_this, void 0, void 0, function () {
            var dataMap, result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this._hookExecutor.executeBeforeEvaluation(featureKey)];
                    case 1:
                        dataMap = _a.sent();
                        return [4 /*yield*/, this._evaluateFeatureGate([featureKey], 'all', true, context, kind)];
                    case 2:
                        result = _a.sent();
                        return [4 /*yield*/, this._hookExecutor.executeAfterEvaluation(featureKey, dataMap, result)];
                    case 3:
                        _a.sent();
                        return [2 /*return*/, result];
                }
            });
        }); };
        this.registerContext = function (kind, mapper) {
            dist.registerContext(kind, mapper);
        };
        this.startWebSocket = function () {
            var _a;
            if (!_this._config.appKey) {
                return;
            }
            if (_this._config.enableLiveUpdates === false) {
                return;
            }
            _this.stopWebSocket();
            var wsUrl = buildWebSocketUrl((_a = _this._config.baseURI) !== null && _a !== void 0 ? _a : 'https://definitions.toggly.io', _this._config.appKey, _this._definitionsRevision);
            var ws = new WebSocket(wsUrl);
            ws.onopen = function () {
                _this._wsConnected = true;
                _this._wsReconnectAttempt = 0;
                _this._lastFallbackRefresh = Date.now();
            };
            ws.onmessage = function (event) {
                var data = event.data;
                if (typeof data === 'string') {
                    if (data === 'update' || data === 'flags-updated') {
                        _this._scheduleDebouncedRefresh();
                        return;
                    }
                    try {
                        var message = JSON.parse(data);
                        if (message.type === 'ping') {
                            return;
                        }
                        if (message.type === 'sync') {
                            _this._handleWsSyncMessage(message);
                            return;
                        }
                        if (message.type === 'flags-updated' || message.type === 'update' || message.type === 'signing-key-updated') {
                            _this._handleWsUpdateMessage(message);
                        }
                    }
                    catch (e) {
                        // Unrecognized message, ignore
                    }
                }
            };
            ws.onclose = function () {
                _this._wsConnected = false;
                _this._ws = null;
                var delay = getNextReconnectDelayMs(_this._wsReconnectAttempt);
                _this._wsReconnectAttempt += 1;
                _this._wsReconnectTimer = setTimeout(function () {
                    _this.startWebSocket();
                }, delay);
            };
            ws.onerror = function (error) {
                console.error('[Toggly] WebSocket error:', error);
            };
            _this._ws = ws;
        };
        this.stopWebSocket = function () {
            if (_this._wsReconnectTimer) {
                clearTimeout(_this._wsReconnectTimer);
                _this._wsReconnectTimer = null;
            }
            if (_this._refreshDebounceTimer) {
                clearTimeout(_this._refreshDebounceTimer);
                _this._refreshDebounceTimer = null;
            }
            if (_this._ws) {
                _this._ws.onopen = null;
                _this._ws.onmessage = null;
                _this._ws.onclose = null;
                _this._ws.onerror = null;
                _this._ws.close();
                _this._ws = null;
            }
            _this._wsConnected = false;
        };
        /**
         * Force-refresh features from the API (bypasses the loaded cache).
         * Used by WebSocket handlers to pull fresh definitions on update signals.
         */
        this._refreshFeatures = function () { return __awaiter(_this, void 0, void 0, function () {
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0: return [4 /*yield*/, this._loadFeatures(true)];
                    case 1:
                        _c.sent();
                        if (this._features && this._canPersist) {
                            writeCachedFlags((_a = this._config.appKey) !== null && _a !== void 0 ? _a : '', (_b = this._config.environment) !== null && _b !== void 0 ? _b : 'Production', this._features, this._contextCacheKey(), this._config.maxCacheKeys);
                        }
                        return [2 /*return*/];
                }
            });
        }); };
        if (!config.appKey) {
            if (config.featureDefaults) {
                this._features = (_a = config.featureDefaults) !== null && _a !== void 0 ? _a : {};
                console.warn('Toggly --- Using feature defaults as no application key provided when initializing the Toggly');
            }
            else {
                console.warn('Toggly --- A valid application key is required to connect to your Toggly.io application for evaluating your features.');
            }
        }
        else {
            if (!config.environment) {
                config.environment = 'Production';
                console.warn('Toggly --- Using Production environment as no environment provided when initializing the Toggly');
            }
        }
        this._config = Object.assign({}, this._config, config);
        this.shouldShowFeatureDuringEvaluation = this._config.showFeatureDuringEvaluation;
        // Register initial hooks
        if (this._config.hooks) {
            this._config.hooks.forEach(function (hook) { return _this._hookExecutor.addHook(hook); });
        }
        if (this._config.localGates) {
            this.setLocalGates(this._config.localGates);
        }
        this._groups = this._config.groups ? __spreadArray([], this._config.groups, true) : [];
        this._claims = this._config.claims ? __assign({}, this._config.claims) : {};
        // Seed in-memory features (and variants) from localStorage for instant availability
        if (this._features === null && this._canPersist && this._config.appKey) {
            var appKey = this._config.appKey;
            var env = (_b = this._config.environment) !== null && _b !== void 0 ? _b : 'Production';
            var contextKey = dist.evaluationContextCacheKey({
                identity: this._config.identity,
                groups: this._groups.length ? this._groups : undefined,
                claims: Object.keys(this._claims).length ? this._claims : undefined,
            });
            if (this._config.enableVariants) {
                var vCached = readCachedVariants(appKey, env, contextKey, this._config.maxCacheKeys);
                if (vCached) {
                    this._variants = vCached;
                    this._features = variantDefsToFlags(vCached);
                }
            }
            if (this._features === null) {
                var cached = readCachedFlags(appKey, env, contextKey, this._config.maxCacheKeys);
                if (cached) {
                    this._features = cached;
                }
            }
        }
    }
    Object.defineProperty(Toggly.prototype, "lastError", {
        get: function () {
            return this._lastError;
        },
        enumerable: false,
        configurable: true
    });
    Toggly.prototype._reportError = function (message, error) {
        var _a, _b;
        this._lastError = message;
        (_b = (_a = this._config).onError) === null || _b === void 0 ? void 0 : _b.call(_a, message, error);
    };
    Object.defineProperty(Toggly.prototype, "_definitionsRevision", {
        get: function () {
            var _a;
            if (this._cachedDefinitionsRevision) {
                return this._cachedDefinitionsRevision;
            }
            if (!this._canPersist || !this._config.appKey) {
                return null;
            }
            return readCachedRevision(this._config.appKey, (_a = this._config.environment) !== null && _a !== void 0 ? _a : 'Production');
        },
        enumerable: false,
        configurable: true
    });
    Toggly.prototype._cacheDefinitionsRevision = function (revision) {
        var _a;
        if (!revision || !this._config.appKey) {
            return;
        }
        this._cachedDefinitionsRevision = revision;
        if (this._canPersist) {
            writeCachedRevision(this._config.appKey, (_a = this._config.environment) !== null && _a !== void 0 ? _a : 'Production', revision);
        }
    };
    Toggly.prototype._scheduleDebouncedRefresh = function (forceJwksRefresh) {
        var _this = this;
        if (forceJwksRefresh === void 0) { forceJwksRefresh = false; }
        if (this._refreshDebounceTimer) {
            clearTimeout(this._refreshDebounceTimer);
        }
        this._refreshDebounceTimer = setTimeout(function () {
            _this._refreshDebounceTimer = null;
            if (forceJwksRefresh) {
                _this._cachedDefinitionsRevision = null;
                if (_this._config.verifySignatures) {
                    _this._jwks.clear();
                }
            }
            void _this._refreshFeatures();
        }, REFRESH_DEBOUNCE_MS);
    };
    Toggly.prototype._handleWsSyncMessage = function (message) {
        var previousRevision = this._definitionsRevision;
        if (shouldFetchOnSync(message, previousRevision)) {
            // Do not cache WS etag before HTTP confirms — avoids conditional 304 with stale defs.
            this._scheduleDebouncedRefresh();
            return;
        }
        if (message.etag) {
            this._cacheDefinitionsRevision(message.etag);
        }
    };
    Toggly.prototype._beginPinnedDefinitionsRefresh = function (pin) {
        this._pendingDefinitionsPin = pin;
        this._cachedDefinitionsRevision = null;
        this._scheduleDebouncedRefresh();
    };
    Toggly.prototype._handleWsUpdateMessage = function (message) {
        var _this = this;
        applyFlagsUpdatedPlan(planFlagsUpdatedRefresh(message, this._definitionsRevision), message, {
            refreshJwks: function () { return _this._scheduleDebouncedRefresh(true); },
            refreshPinned: function (pin) { return _this._beginPinnedDefinitionsRefresh(pin); },
            cacheEtagIfPresent: function (etag) { return _this._cacheDefinitionsRevision(etag); },
        });
    };
    Object.defineProperty(Toggly.prototype, "_canPersist", {
        get: function () {
            return this._config.persistCache !== false && canUseStorage;
        },
        enumerable: false,
        configurable: true
    });
    Toggly.prototype._getEvaluationContext = function () {
        return {
            identity: this._config.identity || undefined,
            groups: this._groups.length ? __spreadArray([], this._groups, true) : undefined,
            claims: Object.keys(this._claims).length ? __assign({}, this._claims) : undefined,
        };
    };
    Toggly.prototype._contextCacheKey = function () {
        return dist.evaluationContextCacheKey(this._getEvaluationContext());
    };
    Toggly.prototype._booleanFeatures = function () {
        return this._features ? dist.toBooleanDefinitions(this._features) : null;
    };
    Toggly.prototype._getEffectiveFlagValue = function (flagKey, entityContext) {
        var _a;
        var remote = dist.resolveEvaluatedDefinition((_a = this._features) === null || _a === void 0 ? void 0 : _a[flagKey], entityContext);
        return applyLocalGate(remote, flagKey, this._localGates, this._localGateIndex);
    };
    /**
     * Current variant assignment for a feature (requires {@link TogglyOptions.enableVariants} and loaded data).
     */
    Toggly.prototype.getVariant = function (featureKey) {
        if (!this._config.enableVariants) {
            return null;
        }
        var variants = this._variants;
        if (!variants) {
            return null;
        }
        var entry = variants[featureKey];
        if (!entry || !entry.variant) {
            return null;
        }
        if (!applyLocalGate(entry.enabled === true, featureKey, this._localGates, this._localGateIndex)) {
            return null;
        }
        return {
            name: entry.variant,
            configurationValue: entry.configurationValue,
        };
    };
    /**
     * Configuration payload for the assigned variant, if any.
     */
    Toggly.prototype.getVariantValue = function (featureKey) {
        var _a;
        var variant = this.getVariant(featureKey);
        return (_a = variant === null || variant === void 0 ? void 0 : variant.configurationValue) !== null && _a !== void 0 ? _a : null;
    };
    /**
     * Subscribe to feature (and variant) data updates after HTTP refresh or WebSocket-driven reload.
     * @returns Unsubscribe function.
     */
    Toggly.prototype.subscribeFeaturesRefresh = function (listener) {
        var _this = this;
        this._featuresRefreshListeners.add(listener);
        return function () {
            _this._featuresRefreshListeners.delete(listener);
        };
    };
    Toggly.prototype.notifyFeaturesRefresh = function () {
        this._featuresRefreshListeners.forEach(function (listener) {
            try {
                listener();
            }
            catch (e) {
                console.error('[Toggly] Error in features refresh listener:', e);
            }
        });
    };
    Toggly.prototype.setLocalGates = function (gates) {
        this._localGates = __spreadArray([], gates, true);
        this._localGateIndex = buildFlagGateIndex(this._localGates);
    };
    Toggly.prototype.notifyLocalGatesChanged = function () {
        this._localGatesChangedListeners.forEach(function (listener) {
            try {
                listener();
            }
            catch (e) {
                console.error('[Toggly] Error in local gates listener:', e);
            }
        });
    };
    Toggly.prototype.subscribeLocalGatesChanged = function (listener) {
        var _this = this;
        this._localGatesChangedListeners.add(listener);
        return function () {
            _this._localGatesChangedListeners.delete(listener);
        };
    };
    /**
     * Clear current identity-scoped flags/variants localStorage entries and update the LRU index.
     */
    Toggly.prototype.clearFeatureFlagsCache = function () {
        var _a;
        if (!this._config.appKey || !this._canPersist) {
            this._features = null;
            this._variants = null;
            return;
        }
        clearCachedFlagsAndVariants(this._config.appKey, (_a = this._config.environment) !== null && _a !== void 0 ? _a : 'Production', this._contextCacheKey(), this._config.maxCacheKeys);
        this._features = null;
        this._variants = null;
    };
    /**
     * Add a hook dynamically
     */
    Toggly.prototype.addHook = function (hook) {
        this._hookExecutor.addHook(hook);
    };
    /**
     * Remove a hook by name
     * @returns true if hook was found and removed, false otherwise
     */
    Toggly.prototype.removeHook = function (name) {
        return this._hookExecutor.removeHook(name);
    };
    Toggly.FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000;
    return Toggly;
}());

var Feature = /** @class */ (function (_super) {
    __extends(Feature, _super);
    function Feature(props) {
        var _this = _super.call(this, props) || this;
        _this.runGate = function () {
            var _a, _b;
            var gate = _this.buildGate();
            if (gate.length === 0 || !_this.context.toggly) {
                return;
            }
            _this.context.toggly
                .evaluateFeatureGate(gate, (_a = _this.props.requirement) !== null && _a !== void 0 ? _a : 'all', (_b = _this.props.negate) !== null && _b !== void 0 ? _b : false, _this.props.context, _this.props.contextKind)
                .then(function (isEnabled) { return _this.setState({ shouldShow: _this.applyVariantFilter(isEnabled) }); });
        };
        _this.state = { shouldShow: false };
        return _this;
    }
    Feature.prototype.buildGate = function () {
        var gate = [];
        if (this.props.featureKey) {
            gate.push(this.props.featureKey);
        }
        if (this.props.featureKeys) {
            gate = gate.concat(this.props.featureKeys);
        }
        return gate;
    };
    Feature.prototype.applyVariantFilter = function (isEnabled) {
        var _a;
        var _b = this.props, variant = _b.variant, featureKey = _b.featureKey;
        if (!isEnabled || variant == null || variant === '') {
            return isEnabled;
        }
        if (!featureKey) {
            return false;
        }
        var assigned = (_a = this.context.toggly) === null || _a === void 0 ? void 0 : _a.getVariant(featureKey);
        return (assigned === null || assigned === void 0 ? void 0 : assigned.name) === variant;
    };
    Feature.prototype.componentDidMount = function () {
        var _a;
        var gate = this.buildGate();
        if (gate.length === 0) {
            this.setState({ shouldShow: !((_a = this.props.negate) !== null && _a !== void 0 ? _a : false) });
            return;
        }
        if (this.context.toggly) {
            this.runGate();
            this.unsubscribeRefresh = this.context.toggly.subscribeFeaturesRefresh(this.runGate);
            this.unsubscribeLocalGates = this.context.toggly.subscribeLocalGatesChanged(this.runGate);
        }
    };
    Feature.prototype.componentDidUpdate = function (prevProps) {
        var gateChanged = prevProps.featureKey !== this.props.featureKey ||
            prevProps.featureKeys !== this.props.featureKeys;
        var contextChanged = prevProps.context !== this.props.context ||
            prevProps.contextKind !== this.props.contextKind;
        if (gateChanged ||
            contextChanged ||
            prevProps.requirement !== this.props.requirement ||
            prevProps.negate !== this.props.negate ||
            prevProps.variant !== this.props.variant) {
            this.runGate();
        }
    };
    Feature.prototype.componentWillUnmount = function () {
        var _a, _b;
        (_a = this.unsubscribeRefresh) === null || _a === void 0 ? void 0 : _a.call(this);
        (_b = this.unsubscribeLocalGates) === null || _b === void 0 ? void 0 : _b.call(this);
        this.unsubscribeRefresh = undefined;
        this.unsubscribeLocalGates = undefined;
    };
    Feature.prototype.render = function () {
        if (this.props.render) {
            return jsxRuntime.jsx(jsxRuntime.Fragment, { children: this.props.render(this.state.shouldShow) });
        }
        // Off path: prefer a separate <Feature negate>. `fallback` is deprecated.
        if (this.state.shouldShow) {
            return this.props.children;
        }
        if (this.props.fallback != null) {
            if (typeof console !== 'undefined' && typeof console.warn === 'function') {
                console.warn('[Toggly] Feature `fallback` is deprecated. Use a separate <Feature negate> for the off path.');
            }
            return this.props.fallback;
        }
        return null;
    };
    Feature.contextType = context;
    return Feature;
}(React.Component));

function createTogglyProvider(config) {
    return __awaiter(this, void 0, void 0, function () {
        var toggly, TogglyProvider;
        return __generator(this, function (_a) {
            toggly = new Toggly(config);
            TogglyProvider = function (_a) {
                var children = _a.children;
                return jsxRuntime.jsx(Provider, __assign({ value: { toggly: toggly } }, { children: children }));
            };
            return [2 /*return*/, TogglyProvider];
        });
    });
}

/**
 * Subscribes to the current {@link VariantResult} for a feature when variants are enabled on the service.
 * Re-renders after feature definitions refresh (HTTP load or WebSocket update).
 */
function useVariant(featureKey) {
    var toggly = React.useContext(context).toggly;
    var _a = React.useState(function () { var _a; return (_a = toggly === null || toggly === void 0 ? void 0 : toggly.getVariant(featureKey)) !== null && _a !== void 0 ? _a : null; }), variant = _a[0], setVariant = _a[1];
    React.useEffect(function () {
        if (!toggly) {
            setVariant(null);
            return undefined;
        }
        var sync = function () {
            setVariant(toggly.getVariant(featureKey));
        };
        sync();
        var unsubRefresh = toggly.subscribeFeaturesRefresh(sync);
        var unsubLocalGates = toggly.subscribeLocalGatesChanged(sync);
        return function () {
            unsubRefresh();
            unsubLocalGates();
        };
    }, [toggly, featureKey]);
    return variant;
}

function useTogglyService() {
    return React.useContext(context).toggly;
}
/**
 * Hook to check if a single feature flag is enabled.
 */
function useFeatureFlag(featureKey, options) {
    if (options === void 0) { options = {}; }
    var _a = options.negate, negate = _a === void 0 ? false : _a;
    return useFeatureGate(featureKey ? [featureKey] : [], { requirement: 'all', negate: negate });
}
/**
 * Hook to evaluate multiple feature keys as a gate.
 */
function useFeatureGate(featureKeys, options) {
    var _this = this;
    if (options === void 0) { options = {}; }
    var _a = options.requirement, requirement = _a === void 0 ? 'all' : _a, _b = options.negate, negate = _b === void 0 ? false : _b, _c = options.defaultValue, defaultValue = _c === void 0 ? false : _c, context = options.context, contextKind = options.contextKind;
    var toggly = useTogglyService();
    var _d = React.useState(defaultValue), isEnabled = _d[0], setIsEnabled = _d[1];
    var _e = React.useState(true), isLoading = _e[0], setIsLoading = _e[1];
    var keysKey = React.useMemo(function () { return featureKeys.join('\0'); }, [featureKeys]);
    var stableKeys = React.useMemo(function () { return __spreadArray([], featureKeys, true); }, [keysKey]);
    var evaluate = React.useCallback(function () { return __awaiter(_this, void 0, void 0, function () {
        var result;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!toggly) {
                        setIsEnabled(defaultValue);
                        setIsLoading(false);
                        return [2 /*return*/];
                    }
                    if (stableKeys.length === 0) {
                        setIsEnabled(!negate);
                        setIsLoading(false);
                        return [2 /*return*/];
                    }
                    setIsLoading(true);
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, 4, 5]);
                    return [4 /*yield*/, toggly.evaluateFeatureGate(stableKeys, requirement, negate, context, contextKind)];
                case 2:
                    result = _b.sent();
                    setIsEnabled(result);
                    return [3 /*break*/, 5];
                case 3:
                    _b.sent();
                    setIsEnabled(defaultValue);
                    return [3 /*break*/, 5];
                case 4:
                    setIsLoading(false);
                    return [7 /*endfinally*/];
                case 5: return [2 /*return*/];
            }
        });
    }); }, [toggly, stableKeys, keysKey, requirement, negate, defaultValue, context, contextKind]);
    React.useEffect(function () {
        void evaluate();
    }, [evaluate]);
    React.useEffect(function () {
        if (!toggly || stableKeys.length === 0) {
            return;
        }
        var unsubRefresh = toggly.subscribeFeaturesRefresh(function () {
            void evaluate();
        });
        var unsubLocalGates = toggly.subscribeLocalGatesChanged(function () {
            void evaluate();
        });
        return function () {
            unsubRefresh();
            unsubLocalGates();
        };
    }, [toggly, keysKey, evaluate, stableKeys.length]);
    var refresh = React.useCallback(function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, evaluate()];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); }, [evaluate]);
    return { isEnabled: isEnabled, isLoading: isLoading, refresh: refresh };
}

exports.Consumer = Consumer;
exports.Feature = Feature;
exports.Provider = Provider;
exports.Toggly = Toggly;
exports.context = context;
exports.createTogglyProvider = createTogglyProvider;
exports.isEntityGate = dist.isEntityGate;
exports.mapEntityContext = dist.mapEntityContext;
exports.normalizeEntityContext = dist.normalizeEntityContext;
exports.registerContext = dist.registerContext;
exports.useFeatureFlag = useFeatureFlag;
exports.useFeatureGate = useFeatureGate;
exports.useVariant = useVariant;
//# sourceMappingURL=index.cjs.map
