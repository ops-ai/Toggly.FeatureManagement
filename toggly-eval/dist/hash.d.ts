/** FNV-1a 32-bit helpers matching Go `hash/fnv` New32a. */
export declare function fnv1a32(bytes: Uint8Array): number;
/**
 * Deterministic bucket in [0.00, 99.99] from identity only (Percentage filter).
 */
export declare function identityBucket(identity: string): number;
/**
 * Deterministic bucket in [0.00, 99.99] from featureKey:identity (Targeting rollout).
 */
export declare function rolloutBucket(featureKey: string, identity: string): number;
