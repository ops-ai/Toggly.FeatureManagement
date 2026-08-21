// Client
export {
  createTogglyClient,
  initToggly,
  getToggly,
  useToggly,
  closeToggly,
} from './client.js'

// Types
export type {
  TogglyClient,
  TogglyConfig,
  TogglyServerConfig,
  TogglyState,
  FeatureDefinitions,
  FeatureDefinitionsResponse,
  FeatureDefinition,
  FeatureRequirement,
  FeatureGateResult,
  EvaluationContext,
  CacheProvider,
  TogglyRequestContext,
  TogglyEntityContext,
  EvaluatedDefinitions,
  Hook,
  HookMetadata,
  EvaluationSeriesData,
  IdentitySeriesData,
} from './types.js'

// Hooks
export { HookExecutor, createLoggingHook } from './hooks.js'

// Cache
export {
  MemoryCacheProvider,
  FileCacheProvider,
  DefinitionsCache,
  createMemoryCache,
  createFileCache,
} from './cache.js'

// Utilities
export {
  generateUUID,
  evaluateGate,
  normalizeFeatureKeys,
  deepMerge,
  isPlainObject,
  debounce,
  sleep,
  retry,
  createLogger,
  hashString,
  getPercentageBucket,
} from './utils.js'

// Signature verification
export {
  assertEnvelopeFreshness,
  extractRawJsonProperty,
  parseSignedEnvelope,
  parseDefinitionsFromRaw,
  verifySignedDefinitions,
  validateAndParseEs256Key,
} from './verify.js'
export type { VerifyFreshnessOptions } from './verify.js'

export {
  registerContext,
  registerEntityContextSchema,
  registerEntityContextsAtStartup,
} from './entity-context-registration.js'
export type { EntityContextPropertySchema, EntityContextSchemaRegistration } from './entity-context-registration.js'
