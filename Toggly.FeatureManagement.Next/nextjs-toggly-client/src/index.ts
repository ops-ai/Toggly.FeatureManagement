'use client'

// Context and Provider
export { TogglyProvider, useToggly, useTogglyOptional } from './context'

// Hooks
export {
  useFeatureFlag,
  useFeatureOff,
  useFeatureGate,
  useFeatures,
  useIdentity,
  useVariant,
} from './hooks'

// Components
export {
  Feature,
  FeatureVariant,
  FeatureGate,
  FeatureSwitch,
} from './components'

// Types
export type {
  TogglyClientConfig,
  TogglyContextValue,
  TogglyProviderProps,
  UseFeatureFlagReturn,
  UseVariantReturn,
  FeatureProps,
} from './types'

// Re-export core types
export type {
  FrontendTelemetry,
  BrowserTogglyClient,
  TogglyConfig,
  TogglyClient,
  TogglyState,
  FeatureDefinitions,
  FeatureRequirement,
  Hook,
  HookMetadata,
  VariantResult,
  EvaluatedVariantDef,
} from '@ops-ai/nextjs-toggly-core'

export { decodeVariantValue } from '@ops-ai/nextjs-toggly-core'
