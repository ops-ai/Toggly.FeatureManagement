// Types
export type {
  TogglyConfig,
  TogglyClient,
  TogglyState,
  FeatureRequirement,
  FeatureGate,
  FeatureDefinitions,
  FeatureDefinitionsResponse,
  EvaluationResult,
  EvaluationSeriesData,
  IdentitySeriesData,
  Hook,
  HookMetadata,
} from './types'

// Constants
export { DEFAULT_CONFIG, STORAGE_KEYS, API_ENDPOINTS } from './constants'

// Hooks
export { HookExecutor } from './hooks'

// Utils
export {
  generateUUID,
  normalizeFeatureKeys,
  evaluateGate,
  deepMerge,
  isPlainObject,
  debounce,
  createDeferred,
} from './utils'

// Client
export { createTogglyClient } from './client'
