import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TelemetryRuntime } from '../../src/telemetry/index'
import type { MetricsSender, UsageSender } from '../../src/telemetry/index'
import {
  HttpsTelemetryClient,
  usagePayloadToHttpJson,
} from '../../src/telemetry/https-client'
import { UsageBatcher } from '../../src/telemetry/usage-batcher'

describe('TelemetryRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes usage and metrics via injected senders', async () => {
    const sendStats = vi.fn().mockResolvedValue({ featureCount: 1 })
    const sendMetrics = vi.fn().mockResolvedValue({ count: 1 })
    const usageClient: UsageSender = { sendStats, close: vi.fn() }
    const metricsClient: MetricsSender = { sendMetrics, close: vi.fn() }

    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient,
      metricsClient,
      attachProcessHandlers: false,
    })
    runtime.start()

    runtime.recordCheck('FeatureA', true, 'user-1')
    runtime.recordUsage('FeatureA', 'user-1')
    runtime.measure('revenue', 9)
    runtime.incrementCounter('clicks')
    runtime.observe('depth', 2)

    await runtime.flushAll()

    expect(sendStats).toHaveBeenCalledTimes(1)
    const usagePayload = sendStats.mock.calls[0][0] as {
      stats: Array<{ feature: string; variantStats: Record<string, { checkCount: number }> }>
    }
    expect(usagePayload.stats[0].feature).toBe('FeatureA')
    expect(usagePayload.stats[0].variantStats.enabled.checkCount).toBe(1)

    expect(sendMetrics).toHaveBeenCalledTimes(1)
    await runtime.close()
    expect(usageClient.close).toHaveBeenCalled()
    expect(metricsClient.close).toHaveBeenCalled()
  })

  it('auto-flushes on interval', async () => {
    const sendStats = vi.fn().mockResolvedValue({ featureCount: 1 })
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 1000,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: null,
      attachProcessHandlers: false,
    })
    runtime.start()
    runtime.recordCheck('FeatureA', true)

    await vi.advanceTimersByTimeAsync(1000)
    expect(sendStats).toHaveBeenCalled()
    await runtime.close()
  })
})

describe('HttpsTelemetryClient', () => {
  it('posts ISO JSON to api/usage/stats and api/metrics with UA', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
    const client = new HttpsTelemetryClient({
      metricsBaseUrl: 'https://app.toggly.io/',
      userAgent: 'toggly-next/1.9.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' })
    batcher.recordCheck('FeatureA', true, 'user-1')
    const bundle = batcher.buildAndReset()!
    const httpJson = usagePayloadToHttpJson(bundle.payload)
    expect(typeof httpJson.time).toBe('string')

    await client.sendUsageStats(bundle.payload)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://app.toggly.io/api/usage/stats')
    expect(fetchImpl.mock.calls[0][1].headers['User-Agent']).toBe('toggly-next/1.9.0')
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string)
    expect(typeof body.time).toBe('string')
    expect(body.stats[0].variantStats.enabled.checkCount).toBe(1)
  })
})
