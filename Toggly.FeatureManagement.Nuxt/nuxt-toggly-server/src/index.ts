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
  EventEvalContextProviders,
} from './types'

export {
  resolveFeatureCheckArgs,
  mergeFeatureCheckOptions,
  toEvalOverrides,
  mergeEvalArg,
} from './feature-check'

export { fromHttpRequest } from '@ops-ai/nuxt-toggly-core'

export {
  configureEventEvalContext,
  resetEventEvalContextProviders,
  getEventEvalContextProviders,
  getCachedEventEvalContext,
  setCachedEventEvalContext,
  syncDefaultEventAmbient,
  resolveEventEvalContext,
} from './event-context'

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
  defineTogglyContextMiddleware,
  defineFeatureMiddleware,
  defineFeatureHandler,
  useEventToggly,
  getEventToggly,
  isEventFeatureOn,
  isEventFeatureOff,
  evaluateEventFeatureGate,
} from './middleware'
