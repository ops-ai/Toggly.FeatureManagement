/**
 * Soft-decode a variant configuration value as `T`.
 *
 * - Missing / null / undefined → `null`
 * - With `isT` guard → `null` when the guard fails
 * - Without guard → value as `T` (compile-time only; matches industry JSON SDK practice)
 */
export declare function decodeVariantValue<T = unknown>(value: unknown, isT?: (v: unknown) => v is T): T | null;
