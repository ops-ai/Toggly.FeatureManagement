export interface VariantResult {
  name: string;
  configurationValue?: unknown;
}

export interface EvaluatedVariantDef {
  enabled: boolean;
  variant?: string;
  configurationValue?: unknown;
}
