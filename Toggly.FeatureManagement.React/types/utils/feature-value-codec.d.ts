/**
 * Soft-decode resolved feature values by declared FeatureValueType (OPS-2102).
 * Never throws for shape alone; never returns a wrong-typed value.
 *
 * Local copy of `@ops-ai/toggly-eval`'s `feature-value-codec.ts`: this package
 * does not otherwise depend on `toggly-eval`, so the handful of pure decode
 * helpers are duplicated here to avoid adding a new runtime dependency.
 */
export type FeatureValueType = 'boolean' | 'string' | 'number' | 'json' | 'datetime';
export declare function isFeatureValueType(value: unknown): value is FeatureValueType;
/** Prefer explicit catalog/evaluated valueType; soft-null when getter mismatches. */
export declare function valueTypeMatches(declared: FeatureValueType | undefined | null, requested: FeatureValueType): boolean;
export declare function decodeStringValue(raw: unknown, declared?: FeatureValueType | null): string | null;
export declare function decodeNumberValue(raw: unknown, declared?: FeatureValueType | null): number | null;
export declare function decodeJsonValue(raw: unknown, declared?: FeatureValueType | null): unknown | null;
/** ISO-8601 wire → Date; soft-null on failure. */
export declare function decodeDateTimeValue(raw: unknown, declared?: FeatureValueType | null): Date | null;
