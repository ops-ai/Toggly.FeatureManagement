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

// Server types
export type {
  TogglyServerConfig,
  TogglyEventContext,
  TogglyStorage,
  FeatureMiddlewareOptions,
  FeatureCheckOptions,
} from './types'

export {
  resolveFeatureCheckArgs,
  toEvalOverrides,
} from './feature-check'

export { fromHttpRequest } from '@ops-ai/nuxt-toggly-core'

// Server client
export {
  initServerToggly,
  getServerToggly,
  useServerToggly,
  refreshServerToggly,
  isServerFeatureOn,
  isServerFeatureOff,
  resetServerToggly,
  setServerStorage,
  getServerStorage,
  createMemoryStorage,
} from './server-client'

// Middleware utilities
export {
  defineFeatureMiddleware,
  defineFeatureHandler,
  useEventToggly,
  isEventFeatureOn,
  isEventFeatureOff,
  evaluateEventFeatureGate,
} from './middleware'
