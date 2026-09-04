// Server client management
export {
  initServerToggly,
  getServerToggly,
  waitForServerToggly,
  useServerToggly,
  refreshServerToggly,
  isServerFeatureOn,
  isServerFeatureOff,
  getServerFeatures,
  resetServerToggly,
  setServerStorage,
  getServerStorage,
  createMemoryStorage,
} from './server-client'

// Server Components
export { Feature, FeatureVariant } from './components'
export type { FeatureProps } from './components'

// Server Actions
export {
  checkFeature,
  checkFeatureOff,
  checkFeatureGate,
  withFeature,
  getFeatures,
  getFeatureStates,
} from './actions'

// Caching utilities
export {
  cachedIsFeatureOn,
  cachedEvaluateFeatureGate,
  cachedGetFeatures,
  createFeatureCacheKey,
  FEATURE_CACHE_TAG,
} from './cache'

// Types
export type {
  TogglyServerConfig,
  TogglyStorage,
  RequestContext,
  ServerFeatureOptions,
  FeatureGateResult,
  FeatureCheckOptions,
  EntityContextInput,
} from './types'

export type { TogglyEntityContext } from '@ops-ai/nextjs-toggly-core'

// Re-export core types
export type {
  TogglyConfig,
  TogglyClient,
  TogglyState,
  FeatureDefinitions,
  FeatureRequirement,
  Hook,
  HookMetadata,
  EvalContextOverrides,
  EvalContextArg,
} from '@ops-ai/nextjs-toggly-core'

export { fromHttpRequest } from '@ops-ai/nextjs-toggly-core'
