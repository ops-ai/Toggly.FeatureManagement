/**
 * First-class flag value type (OPS-2099 / OPS-2102), when the catalog or
 * evaluated envelope declared one. Absent for legacy/untyped catalogs.
 */
export type FeatureValueType = 'boolean' | 'string' | 'number' | 'json' | 'datetime';

/**
 * Assigned variant for a feature (aligned with @ops-ai/feature-flags-toggly).
 */
export interface VariantResult {
  name: string;
  configurationValue?: unknown;
  valueType?: FeatureValueType;
}

/**
 * Raw evaluated entry from `/evaluated-variants-signed` `defs`.
 */
export interface EvaluatedVariantDef {
  enabled: boolean;
  variant?: string;
  configurationValue?: unknown;
  valueType?: FeatureValueType;
}
