// Middleware
export {
  togglyMiddleware,
  featureGate,
  featureRoutes,
  withFeature,
  featuresHandler,
  getHonoToggly,
  closeHonoToggly,
} from './middleware.js'

// Types
export type {
  TogglyHonoConfig,
  TogglyContextData,
  FeatureGateOptions,
  FeatureRouteOptions,
} from './types.js'

// Re-export core types for convenience
export type {
  TogglyClient,
  TogglyConfig,
  TogglyServerConfig,
  TogglyState,
  FeatureDefinitions,
  FeatureRequirement,
  EvaluationContext,
  Hook,
  HookMetadata,
} from '@ops-ai/toggly-node-core'

// Re-export core utilities
export {
  createTogglyClient,
  initToggly,
  getToggly,
  useToggly,
  closeToggly,
  createLoggingHook,
  createMemoryCache,
  createFileCache,
} from '@ops-ai/toggly-node-core'
