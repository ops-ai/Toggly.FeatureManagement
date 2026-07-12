"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyCacheLruIndex = emptyCacheLruIndex;
exports.parseCacheLruIndex = parseCacheLruIndex;
exports.serializeCacheLruIndex = serializeCacheLruIndex;
exports.touchCacheLruKey = touchCacheLruKey;
exports.removeCacheLruKeys = removeCacheLruKeys;
exports.selectCacheLruKeysToEvict = selectCacheLruKeysToEvict;
exports.isCacheLruEnabled = isCacheLruEnabled;
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
