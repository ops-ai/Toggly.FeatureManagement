import { describe, it, expect, vi, afterEach } from 'vitest'
import { createEdgeClient, resetEdgeToggly } from '../src/edge-client'
import type { UsageSender, MetricsSender } from '@ops-ai/nextjs-toggly-core'

describe('edge telemetry', () => {
  afterEach(() => {
    resetEdgeToggly()
  })

  it('records checks over HTTPS senders and flushes payload shape', async () => {
    const sendStats = vi.fn().mockResolvedValue({})
    const sendMetrics = vi.fn().mockResolvedValue({})
    const usageClient: UsageSender = { sendStats, close: vi.fn() }
    const metricsClient: MetricsSender = { sendMetrics, close: vi.fn() }

    const client = createEdgeClient({
      appKey: 'app',
      environment: 'Production',
      featureDefaults: { FeatureA: true },
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient,
      metricsClient,
      cache: false,
    })

    // Skip network: mark initialized via defaults path
    vi.spyOn(client, 'fetchDefinitions').mockResolvedValue({ FeatureA: true })
    await client.init()

    await client.isFeatureOn('FeatureA', { identity: 'user-1' })
    client.measure('revenue', 4, { feature: 'FeatureA' })
    await client.flushTelemetry()

    expect(sendStats).toHaveBeenCalled()
    const usagePayload = sendStats.mock.calls[0][0] as {
      stats: Array<{ feature: string; variantStats: Record<string, { checkCount: number }> }>
    }
    expect(usagePayload.stats[0].variantStats.enabled.checkCount).toBe(1)

    expect(sendMetrics).toHaveBeenCalled()
    const metricsPayload = sendMetrics.mock.calls[0][0] as {
      stats: Array<{ metric: string; variantValues: Record<string, number> }>
    }
    expect(metricsPayload.stats[0].metric).toBe('revenue')
    expect(metricsPayload.stats[0].variantValues.enabled).toBe(4)

    await client.close()
  })
})
