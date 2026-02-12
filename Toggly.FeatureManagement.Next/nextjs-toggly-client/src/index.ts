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
} from './hooks'

// Components
export {
  Feature,
  FeatureOff,
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
  FeatureProps,
} from './types'

// Re-export core types
export type {
  TogglyConfig,
  TogglyClient,
  TogglyState,
  FeatureDefinitions,
  FeatureRequirement,
  Hook,
  HookMetadata,
} from '@ops-ai/nextjs-toggly-core'
