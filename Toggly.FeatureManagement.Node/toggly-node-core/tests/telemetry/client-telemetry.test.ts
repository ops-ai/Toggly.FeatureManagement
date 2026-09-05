import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTogglyClient, closeToggly } from '../../src/client'
import type { FeatureDefinitionModel } from '@ops-ai/toggly-eval'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function def(
  featureKey: string,
  filters: FeatureDefinitionModel['filters'] = [{ name: 'AlwaysOn', parameters: {} }],
): FeatureDefinitionModel {
  return { featureKey, filters }
}

describe('client telemetry wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeToggly()
  })

  afterEach(async () => {
    await closeToggly()
  })

  it('records checks on isFeatureOn and flushes usage/metrics APIs', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify([def('feature-a')]),
      json: async () => [def('feature-a')],
    })

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 1 })
    const sendMetrics = vi.fn().mockResolvedValue({ count: 1 })

    const client = createTogglyClient({
      appKey: 'test-app',
      identity: 'user-42',
      enableStreaming: false,
      refreshInterval: 0,
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: { sendMetrics, close: vi.fn() },
    })

    await client.init()
    expect(await client.isFeatureOn('feature-a')).toBe(true)

    client.recordUsage('feature-a')
    client.recordView('feature-a')
    client.measure('revenue', 10)
    client.incrementCounter('clicks', 2)
    client.observe('depth', 1)

    await client.flushTelemetry()

    expect(sendStats).toHaveBeenCalled()
    const usagePayload = sendStats.mock.calls[0][0] as {
      stats: Array<{
        feature: string
        variantStats: { enabled: { checkCount: number; usedCount: number; viewedCount: number } }
      }>
    }
    expect(usagePayload.stats[0].feature).toBe('feature-a')
    expect(usagePayload.stats[0].variantStats.enabled.checkCount).toBe(1)
    expect(usagePayload.stats[0].variantStats.enabled.usedCount).toBe(1)
    expect(usagePayload.stats[0].variantStats.enabled.viewedCount).toBe(1)

    expect(sendMetrics).toHaveBeenCalled()
    const metricsPayload = sendMetrics.mock.calls[0][0] as {
      stats: Array<{ metric: string }>
      counters: Array<{ metric: string }>
      observations: Array<{ metric: string }>
    }
    expect(metricsPayload.stats.some((s) => s.metric === 'revenue')).toBe(true)
    expect(metricsPayload.counters.some((c) => c.metric === 'clicks')).toBe(true)
    expect(metricsPayload.observations.some((o) => o.metric === 'depth')).toBe(true)

    await client.close()
  })
})
