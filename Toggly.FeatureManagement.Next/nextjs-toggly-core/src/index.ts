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

// Entity context helpers, re-exported so wrapper packages share one implementation
export {
  normalizeEntityContext,
  registerContext,
  resolveEvaluatedDefinition,
  toBooleanDefinitions,
} from '@ops-ai/toggly-hooks-types'
export type {
  EntityGate,
  EvaluatedDefinitions,
  TogglyEntityContext,
} from '@ops-ai/toggly-hooks-types'

// Local evaluation helpers
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
export { fromHttpRequest } from '@ops-ai/toggly-eval'

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
  EvaluationMode,
  EvalContextOverrides,
  EvalContextArg,
} from './types'
