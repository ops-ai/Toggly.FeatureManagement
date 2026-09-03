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
  EvaluatedDefinitions,
  TogglyEntityContext,
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

// Entity context helpers, re-exported so wrapper packages share one implementation
export {
  normalizeEntityContext,
  registerContext,
  resolveEvaluatedDefinition,
  toBooleanDefinitions,
} from '@ops-ai/toggly-hooks-types'
export type { EntityGate } from '@ops-ai/toggly-hooks-types'

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
