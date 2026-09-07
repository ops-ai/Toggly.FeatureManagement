/**
 * Edge-safe telemetry public surface (no Node gRPC / fs imports).
 */
export { hashIdentity, toProtobufTimestamp } from './hash.js'
export {
  UsageBatcher,
  MAX_FEATURES_PER_BATCH,
  MAX_UNIQUE_USER_HASHES_PER_FEATURE,
  MAX_APPLICATION_UNIQUE_USER_HASHES,
  type FeatureStatPayload,
  type UsageFlushBundle,
  type VariantStatsAgg,
} from './usage-batcher.js'
export {
  MetricsBatcher,
  MAX_METRIC_KEYS_PER_BATCH,
  MAX_OBSERVATIONS_PER_BATCH,
  type MetricsFeatureOptions,
  type MetricStatPayload,
} from './metrics-batcher.js'
export {
  HttpsTelemetryClient,
  DEFAULT_METRICS_BASE_URL,
  DEFAULT_TELEMETRY_FLUSH_MS,
  resolveMetricsBaseUrl,
  isTelemetryEnvDisabled,
  resolveTelemetryEnableFlag,
  usagePayloadToHttpJson,
  metricsPayloadToHttpJson,
} from './https-client.js'
export {
  TelemetryRuntime,
  type TelemetryConfig,
  type TelemetryLogger,
  type TelemetryTransport,
  type UsageSender,
  type MetricsSender,
} from './index.js'
