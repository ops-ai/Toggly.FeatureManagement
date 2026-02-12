// Re-export core types and utilities
export type {
  TogglyConfig,
  TogglyClient,
  TogglyState,
  FeatureRequirement,
  FeatureGate,
  FeatureDefinitions,
  Hook,
  HookMetadata,
} from '@ops-ai/nuxt-toggly-core'

export {
  createTogglyClient,
  HookExecutor,
  evaluateGate,
  normalizeFeatureKeys,
} from '@ops-ai/nuxt-toggly-core'

// Client types
export type {
  TogglyClientConfig,
  UseTogglyReturn,
  UseFeatureFlagReturn,
  UseFeatureGateReturn,
  FeatureProps,
} from './types'

export { TOGGLY_INJECTION_KEY } from './types'

// Composables
export {
  createToggly,
  useToggly,
  provideToggly,
  getTogglyClient,
  createTogglyPlugin,
  resetToggly,
} from './composables/useToggly'

export { useFeatureFlag, useFeatureOff } from './composables/useFeatureFlag'

export { useFeatureGate, useFeatureProps } from './composables/useFeatureGate'

// Components
export { Feature, FeatureEnabled, FeatureDisabled } from './components/Feature'

// Directives
export { vFeature, vFeatureShow, vFeatureClass } from './directives/vFeature'
