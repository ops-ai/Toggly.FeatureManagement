import type { Hook } from '@ops-ai/toggly-hooks-types';

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
  addHook: (hook: Hook) => void
  removeHook: (name: string) => boolean
}
