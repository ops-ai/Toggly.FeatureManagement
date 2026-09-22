import { createTogglyClient as createBaseClient } from './client'
import type { TogglyClient, TogglyConfig } from './types'
import { DEFAULT_CONFIG } from './constants'
import { TelemetryRuntime } from './telemetry/index.js'
import { isTelemetryEnvDisabled } from './telemetry/https-client.js'

/** Main/server client with the existing trusted telemetry runtime. */
export function createTogglyClient(initialConfig: TogglyConfig = {}): TogglyClient {
  return createBaseClient({
    ...initialConfig,
    trustedTelemetryFactory: initialConfig.trustedTelemetryFactory ?? (config => {
      if (isTelemetryEnvDisabled()) return null
      return new TelemetryRuntime({
        appKey: config.appKey!,
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
    }),
  })
}
