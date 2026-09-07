import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTogglyClient } from '../../src/client'
import type { UsageSender, MetricsSender } from '../../src/telemetry/index'

describe('createTogglyClient telemetry', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '[]',
      headers: new Headers(),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('records checks when usage tracking is enabled', async () => {
    const sendStats = vi.fn().mockResolvedValue({})
    const usageClient: UsageSender = { sendStats, close: vi.fn() }
    const metricsClient: MetricsSender = {
      sendMetrics: vi.fn().mockResolvedValue({}),
      close: vi.fn(),
    }

    const client = createTogglyClient({
      appKey: 'app',
      environment: 'Production',
      evaluationMode: 'local',
      enableLiveUpdates: false,
      refreshInterval: 0,
      featureDefaults: { FeatureA: true },
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      telemetryAttachProcessHandlers: false,
      usageClient,
      metricsClient,
    })

    await client.init()
    await client.isFeatureOn('FeatureA', null, undefined, { identity: 'user-1' })
    await client.flushTelemetry()

    expect(sendStats).toHaveBeenCalled()
    const payload = sendStats.mock.calls[0][0] as {
      stats: Array<{ feature: string; variantStats: Record<string, { checkCount: number }> }>
    }
    expect(payload.stats[0].feature).toBe('FeatureA')
    expect(payload.stats[0].variantStats.enabled.checkCount).toBe(1)

    client.destroy()
  })
})
