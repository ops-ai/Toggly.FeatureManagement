import { createTelemetryReporter, type TelemetryReporter } from '@ops-ai/toggly-client-telemetry'
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser'
import { createClient } from './client-base'
import type { ClientTelemetry } from './telemetry-policy'
import type { BrowserTogglyClient, TogglyConfig } from './types'

function browserTelemetry(config: TogglyConfig): ClientTelemetry | null {
  if (!config.appKey || config.enableTelemetry === false || (config.enableUsageTracking === false && config.enableMetrics === false)) return null
  // Capture each owner's immutable app/environment even when the client reinitializes.
  const options = {...config}
  let reporter: TelemetryReporter | undefined
  let detach: (() => void) | undefined
  const diagnostics = new Set<string>()
  const diagnostic = (message: string) => {
    if (diagnostics.has(message) || diagnostics.size >= 8) return
    diagnostics.add(message)
    try { options.onError?.(message) } catch { /* Host diagnostics cannot change evaluation. */ }
  }
  const getReporter = () => {
    if (!reporter) {
      reporter = createTelemetryReporter({appKey: options.appKey, environment: options.environment, instanceId: options.instanceId, identity: options.identity, metricsBaseUrl: options.metricsBaseUrl, telemetryFlushIntervalMs: options.telemetryFlushIntervalMs, fetch: options.telemetryFetch, onDiagnostic: diagnostic})
      detach = attachBrowserLifecycle(reporter)
    }
    return reporter
  }
  const usage = options.enableUsageTracking !== false
  const metrics = options.enableMetrics !== false
  return {
    usageEnabled: usage,
    start() {},
    async close(settings) {detach?.(); reporter?.dispose(settings)},
    setContext(next) {
      options.appKey = next.appKey; options.environment = next.environment
      options.identity = next.identity; options.instanceId = next.instanceId
      reporter?.setContext(options)
    },
    captureCheck() {
      const record = usage ? getReporter().captureCheck() : undefined
      return (key, enabled) => record?.(key, enabled ? 'enabled' : 'disabled')
    },
    async flushAll() {await reporter?.flush()},
    recordCheck(key, enabled) {if (usage) getReporter().recordCheck(key, enabled ? 'enabled' : 'disabled')},
    recordUsage(key, _identity, variant = 'enabled') {if (usage) getReporter().recordUsage(key, variant)},
    recordView(key, _identity, variant = 'enabled') {if (usage) getReporter().recordView(key, variant)},
    recordDefinitionCacheHit() {},
    recordDefinitionCacheMiss() {},
    measure() {if (metrics) diagnostic('Browser measure is unsupported; use telemetry.incrementCounter or telemetry.setGauge with the intended metric semantics.')},
    observe() {if (metrics) diagnostic('Browser observations are unsupported; use telemetry.setGauge for the latest value.')},
    incrementCounter(key, value = 1, attribution) {
      if (!metrics) return
      if (attribution?.feature !== undefined || attribution?.variant !== undefined) diagnostic('Browser metrics are app-level; legacy feature and variant attribution is omitted.')
      getReporter().incrementCounter(key, value)
    },
    setGauge(key, value) {if (metrics) getReporter().setGauge(key, value)},
  }
}

export function createTogglyClient(config: TogglyConfig = {}): BrowserTogglyClient {
  const browser = typeof window !== 'undefined' && typeof document !== 'undefined'
  return createClient(config, {frontend: true, create: options => browser ? browserTelemetry(options) : null}) as BrowserTogglyClient
}
