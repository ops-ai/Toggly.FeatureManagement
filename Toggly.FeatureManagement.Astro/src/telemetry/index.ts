export {
  UsageBatcher,
  MAX_UNIQUE_USER_HASHES_PER_FEATURE,
  MAX_APPLICATION_UNIQUE_USER_HASHES,
  MAX_FEATURES_PER_BATCH,
  type UsageBatcherOptions,
  type FeatureStatPayload,
  type UsageFlushBundle,
  type FeatureUsageAgg,
  type VariantStatsAgg,
} from './usage-batcher.js'

export {
  HttpsTelemetryClient,
  DEFAULT_METRICS_BASE_URL,
  DEFAULT_TELEMETRY_FLUSH_MS,
  DEFAULT_TELEMETRY_FETCH_TIMEOUT_MS,
  resolveMetricsBaseUrl,
  resolveTelemetryEnableFlag,
  isTelemetryEnvDisabled,
  usagePayloadToHttpJson,
  type HttpsTelemetryClientOptions,
} from './https-client.js'

export {
  UsageTelemetryRuntime,
  REQUEST_SCOPED_CLOSE_TIMEOUT_MS,
  type UsageTelemetryConfig,
  type UsageSender,
  type TelemetryLogger,
} from './runtime.js'

export { hashIdentity, toProtobufTimestamp, protobufTimestampToIso } from './hash.js'
