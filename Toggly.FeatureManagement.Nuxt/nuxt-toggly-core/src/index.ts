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
  EvalContextOverrides,
  EvalContextArg,
} from './types'

// Constants
export { DEFAULT_CONFIG, STORAGE_KEYS, API_ENDPOINTS } from './constants'

// Telemetry (shared batchers + HTTPS; gRPC via ./telemetry/grpc subpath)
export {
  TelemetryRuntime,
  hashIdentity,
  toProtobufTimestamp,
  UsageBatcher,
  MetricsBatcher,
  HttpsTelemetryClient,
  DEFAULT_METRICS_BASE_URL,
  DEFAULT_TELEMETRY_FLUSH_MS,
  resolveMetricsBaseUrl,
  isTelemetryEnvDisabled,
  resolveTelemetryEnableFlag,
  usagePayloadToHttpJson,
  metricsPayloadToHttpJson,
  MAX_FEATURES_PER_BATCH,
  MAX_UNIQUE_USER_HASHES_PER_FEATURE,
  MAX_APPLICATION_UNIQUE_USER_HASHES,
  MAX_METRIC_KEYS_PER_BATCH,
  MAX_OBSERVATIONS_PER_BATCH,
} from './telemetry/public.js'
export type {
  TelemetryConfig,
  TelemetryLogger,
  TelemetryTransport,
  UsageSender,
  MetricsSender,
  MetricsFeatureOptions,
  FeatureStatPayload,
  MetricStatPayload,
  UsageFlushBundle,
  VariantStatsAgg,
} from './telemetry/public.js'

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
export { fromHttpRequest } from '@ops-ai/toggly-eval'

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
