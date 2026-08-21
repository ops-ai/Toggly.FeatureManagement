"use strict";
/**
 * Envelope timestamp freshness checks for signed definitions.
 *
 * Timestamps are Unix seconds (same units as Definitions `evaluated-signed`).
 * When `maxSignatureAgeSeconds` is unset or <= 0, freshness is not enforced
 * (back-compat). Clock skew allows a small future window for client clocks.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertEnvelopeFreshness = assertEnvelopeFreshness;
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
