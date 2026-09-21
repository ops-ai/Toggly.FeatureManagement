import {
  createTelemetryReporter,
  type TelemetryReporter,
} from '@ops-ai/toggly-client-telemetry'
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser'
import type {
  FrontendTelemetryFactory,
  FrontendTelemetryRuntime,
  TogglyConfig,
} from '@ops-ai/nuxt-toggly-core/browser'

const MAX_DIAGNOSTICS = 10

/** Create a browser reporter without starting work at module import time. */
export const createBrowserTelemetry: FrontendTelemetryFactory = (
  config: Readonly<TogglyConfig>,
): FrontendTelemetryRuntime | null => {
  const environmentDisabled =
    typeof process !== 'undefined' && process.env?.TOGGLY_DISABLE_TELEMETRY === '1'
  if (environmentDisabled || typeof window === 'undefined' || !config.appKey || config.enableTelemetry === false) {
    return null
  }

  const usageEnabled = config.enableUsageTracking !== false
  const metricsEnabled = config.enableMetrics !== false
  if (!usageEnabled && !metricsEnabled) return null

  let diagnosticCount = 0
  const diagnose = (message: string): void => {
    if (diagnosticCount++ >= MAX_DIAGNOSTICS) return
    console.warn(`[Toggly] ${message}`)
  }
  const reporter: TelemetryReporter = createTelemetryReporter({
    appKey: config.appKey,
    environment: config.environment,
    instanceId: config.instanceId,
    identity: config.identity,
    enableTelemetry: true,
    metricsBaseUrl: config.metricsBaseUrl,
    telemetryFlushIntervalMs: config.telemetryFlushIntervalMs,
    fetch: config.telemetryFetch as Parameters<typeof createTelemetryReporter>[0]['fetch'],
    onDiagnostic: code => diagnose(`frontend telemetry diagnostic: ${code}`),
  })
  const detach = attachBrowserLifecycle(reporter)
  let disposed = false

  return {
    usageEnabled,
    metricsEnabled,
    setContext(next) { reporter.setContext({appKey: next.appKey, environment: next.environment, instanceId: next.instanceId, identity: next.identity}) },
    captureCheck() { return usageEnabled ? reporter.captureCheck() : () => {} },
    recordCheck(featureKey, variant) {
      if (usageEnabled) reporter.recordCheck(featureKey, variant)
    },
    recordUsage(featureKey, variant) {
      if (usageEnabled) reporter.recordUsage(featureKey, variant)
    },
    recordView(featureKey, variant) {
      if (usageEnabled) reporter.recordView(featureKey, variant)
    },
    incrementCounter(metricKey, value) {
      if (metricsEnabled) reporter.incrementCounter(metricKey, value)
    },
    setGauge(metricKey, value) {
      if (metricsEnabled) reporter.setGauge(metricKey, value)
    },
    flush(options) {
      return reporter.flush(options)
    },
    unsupported(method) {
      diagnose(`browser ${method}() is unsupported; use telemetry.incrementCounter() or telemetry.setGauge()`)
    },
    dispose(options) {
      if (disposed) return
      disposed = true
      detach()
      reporter.dispose(options)
    },
  }
}
