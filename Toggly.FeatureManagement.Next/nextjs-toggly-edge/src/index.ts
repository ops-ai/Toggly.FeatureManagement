// Edge client
export {
  TogglyEdgeClient,
  createEdgeClient,
  initEdgeToggly,
  getEdgeToggly,
  resetEdgeToggly,
} from './edge-client'

// Middleware utilities
export {
  createFeatureMiddleware,
  createPathFeatureMiddleware,
  withFeatureGate,
  createFeatureHandler,
  isFeatureEnabledForRequest,
  getFeaturesForRequest,
} from './middleware'

// Types
export type {
  TogglyEdgeConfig,
  MiddlewareFeatureOptions,
  FeatureMiddlewareHandler,
  FeatureMiddlewareContext,
  FeaturePathMatcher,
  EdgeClientState,
} from './types'

// Re-export core types
export type {
  TogglyConfig,
  FeatureDefinitions,
  FeatureRequirement,
  Hook,
  HookMetadata,
} from '@ops-ai/nextjs-toggly-core'

// Re-export utilities
export { normalizeFeatureKeys, evaluateGate } from '@ops-ai/nextjs-toggly-core'
