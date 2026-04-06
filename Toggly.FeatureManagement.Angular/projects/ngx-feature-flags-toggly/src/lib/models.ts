import type { Hook } from '@ops-ai/toggly-hooks-types';

/** Assigned variant for a feature (from evaluated-variants-signed). */
export interface VariantResult {
  name: string
  configurationValue?: unknown
}

/** Raw evaluated variant entry from the definitions API. */
export interface EvaluatedVariantDef {
  enabled: boolean
  variant?: string
  configurationValue?: unknown
}

export interface ITogglyOptions {
  baseURI?: string
  appKey?: string
  environment?: string
  identity?: string
  featureDefaults?: { [key: string]: boolean }
  showFeatureDuringEvaluation?: boolean
  customDefinitionsUrl?: string
  /** Hooks to extend SDK behavior at key lifecycle points */
  hooks?: Hook[]
  /** Enable localStorage caching of definitions. Default: true. Set false for SSR-only or privacy-sensitive contexts. */
  persistCache?: boolean
  /**
   * When true, fetches from evaluated-variants-signed and exposes variant APIs.
   * Default: false.
   */
  enableVariants?: boolean
}

export interface ITogglyService {
  shouldShowFeatureDuringEvaluation: boolean
  evaluateFeatureGate: (
    featureKeys: string[],
    requirement: string,
    negate: boolean,
  ) => Promise<boolean>
  isFeatureOn: (featureKey: string) => Promise<boolean>
  isFeatureOff: (featureKey: string) => Promise<boolean>
  getVariant: (featureKey: string) => Promise<VariantResult | null>
  getVariantValue: (featureKey: string) => Promise<unknown | null>
  addHook: (hook: Hook) => void
  removeHook: (name: string) => boolean
}
