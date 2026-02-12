// Core client
export { createTogglyClient } from './client'

// Hooks
export { HookExecutor } from './hooks'

// Utilities
export {
  generateUUID,
  evaluateGate,
  deepMerge,
  normalizeFeatureKeys,
  isBrowser,
  isServer,
  isEdgeRuntime,
} from './utils'

// Constants
export { DEFAULT_CONFIG, API_ENDPOINTS } from './constants'

// Types
export type {
  TogglyConfig,
  TogglyClient,
  TogglyState,
  FeatureDefinitions,
  FeatureDefinitionsResponse,
  FeatureRequirement,
  FeatureGate,
  EvaluationResult,
  EvaluationSeriesData,
  IdentitySeriesData,
  Hook,
  HookMetadata,
} from './types'
