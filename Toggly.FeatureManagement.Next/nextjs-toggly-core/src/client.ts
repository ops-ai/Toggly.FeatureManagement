import type { TogglyConfig, TogglyClient } from './types'
import { DEFAULT_CONFIG } from './constants'
import { createClient } from './client-base'
import { createTogglyClient as createBrowserClient } from './browser-client'
import { TelemetryRuntime } from './telemetry/index.js'
import { isTelemetryEnvDisabled } from './telemetry/https-client.js'

/** Default entry preserves trusted server/edge telemetry; browser exports omit it. */
export function createTogglyClient(config: TogglyConfig = {}): TogglyClient {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') return createBrowserClient(config)
  return createClient(config, { frontend: false, create(config) {
    if (!config.appKey || isTelemetryEnvDisabled()) {
      return null
    }
    if (!config.enableUsageTracking && !config.enableMetrics) {
      return null
    }
    return new TelemetryRuntime({
      appKey: config.appKey,
      environment: config.environment ?? DEFAULT_CONFIG.environment,
      metricsBaseUrl: config.metricsBaseUrl,
      enableUsageTracking: config.enableUsageTracking,
      enableMetrics: config.enableMetrics,
      usageFlushInterval: config.usageFlushInterval,
      metricsFlushInterval: config.metricsFlushInterval,
      instanceName: config.instanceName,
      appVersion: config.appVersion,
      transport: config.telemetryTransport ?? 'grpc',
      attachProcessHandlers: config.telemetryAttachProcessHandlers,
      usageClient: config.usageClient,
      metricsClient: config.metricsClient,
      fetchImpl: config.telemetryFetch,
    })
  } })
}
