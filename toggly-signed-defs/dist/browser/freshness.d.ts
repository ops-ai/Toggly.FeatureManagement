/**
 * Envelope timestamp freshness checks for signed definitions.
 *
 * Timestamps are Unix seconds (same units as Definitions `evaluated-signed`).
 * When `maxSignatureAgeSeconds` is unset or <= 0, freshness is not enforced
 * (back-compat). Clock skew allows a small future window for client clocks.
 */
export interface VerifyFreshnessOptions {
    /** Reject envelopes older than this many seconds. Omit / <=0 = disabled. */
    maxSignatureAgeSeconds?: number | null;
    /** Allowed future skew in seconds (default 60). */
    maxClockSkewSeconds?: number;
    /** Override "now" for tests (Unix seconds). */
    nowSeconds?: number;
}
export declare function assertEnvelopeFreshness(timestamp: number, options?: VerifyFreshnessOptions | null): void;
