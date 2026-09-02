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
  EvaluationMode,
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
  isBrowser,
  isServer,
  isEdgeRuntime,
} from './utils'

// Client
export { createTogglyClient } from './client'

// Local evaluation helpers (server packages hydrate / snapshot via these)
export {
  evaluateDefinitions,
  evaluateFeatureGate as evaluateLocalFeatureGate,
  indexDefinitions,
  parseDefinitionsPayload,
  snapshotEvaluatedBooleans,
} from '@ops-ai/toggly-eval'
export type {
  EvalContext,
  FeatureDefinitionModel,
} from '@ops-ai/toggly-eval'

// Live socket helpers
export {
  resolveWebSocketConstructor,
  openLiveSocket,
  dispatchLiveMessage,
} from './live-socket'
export type {
  WebSocketConstructor,
  LiveSocket,
  LiveSocketHandlers,
} from './live-socket'
