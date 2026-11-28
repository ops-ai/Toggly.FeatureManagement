/**
 * Soft-decode a variant configuration value as `T`.
 * Missing/null → null; with `isT` → null when guard fails; otherwise value as T.
 */
export declare function decodeVariantValue<T = unknown>(value: unknown, isT?: (v: unknown) => v is T): T | null;
