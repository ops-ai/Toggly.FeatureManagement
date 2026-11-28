export interface VariantResult {
  name: string;
  configurationValue?: unknown;
}

import type { FeatureValueType } from '../feature-value-codec';

export interface EvaluatedVariantDef {
  enabled: boolean;
  variant?: string;
  configurationValue?: unknown;
  /** Declared catalog value type (OPS-2102); legacy catalogs omit it. */
  valueType?: FeatureValueType;
}
