/**
 * Assigned variant for a feature (aligned with @ops-ai/feature-flags-toggly).
 */
export interface VariantResult {
  name: string
  configurationValue?: unknown
}

/**
 * Raw evaluated entry from /evaluated-variants-signed `defs`.
 */
export interface EvaluatedVariantDef {
  enabled: boolean
  variant?: string
  configurationValue?: unknown
  /** Declared catalog value type (OPS-2102); legacy catalogs omit it. */
  valueType?: import('../utils/feature-value-codec').FeatureValueType
}
