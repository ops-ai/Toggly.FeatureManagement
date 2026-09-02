"use strict";
/** FNV-1a 32-bit helpers matching Go `hash/fnv` New32a. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fnv1a32 = fnv1a32;
exports.identityBucket = identityBucket;
exports.rolloutBucket = rolloutBucket;
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
