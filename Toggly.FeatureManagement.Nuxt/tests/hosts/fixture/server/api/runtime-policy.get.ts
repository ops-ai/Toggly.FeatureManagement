import { useServerToggly, recordServerUsage, recordServerView, incrementServerCounter, measureServerMetric, flushServerTelemetry } from '@ops-ai/nuxt-toggly-server'

export default defineEventHandler(async () => {
  const client = useServerToggly()
  const policy = {
    usage: client.config.enableUsageTracking,
    metrics: client.config.enableMetrics,
    usageSender: !!client.config.usageClient,
    metricsSender: !!client.config.metricsClient,
  }
  // A regressed module must not run trusted sends during its failing test.
  if (policy.usage !== false || policy.metrics !== false) return { policy }
  recordServerUsage('Enabled', 'alice')
  recordServerView('Enabled', 'alice')
  incrementServerCounter('server-policy-counter')
  measureServerMetric('server-policy-measure', 3)
  await flushServerTelemetry()
  return { policy, enabled: await client.isFeatureOn('Enabled') }
})
