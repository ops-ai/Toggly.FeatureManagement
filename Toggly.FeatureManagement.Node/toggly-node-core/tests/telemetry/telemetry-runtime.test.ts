import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TelemetryRuntime } from '../../src/telemetry/index'
import type { MetricsGrpcClient, UsageGrpcClient } from '../../src/telemetry/grpc-clients'

describe('TelemetryRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes usage and metrics via injected gRPC stubs', async () => {
    const sendStats = vi.fn().mockResolvedValue({ featureCount: 1 })
    const sendMetrics = vi.fn().mockResolvedValue({ count: 1 })
    const usageClient: UsageGrpcClient = {
      sendStats,
      close: vi.fn(),
    }
    const metricsClient: MetricsGrpcClient = {
      sendMetrics,
      close: vi.fn(),
    }

    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient,
      metricsClient,
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
    const metricsPayload = sendMetrics.mock.calls[0][0] as {
      stats: Array<{ metric: string }>
      counters: Array<{ metric: string }>
      observations: Array<{ metric: string }>
    }
    expect(metricsPayload.stats[0].metric).toBe('revenue')
    expect(metricsPayload.counters[0].metric).toBe('clicks')
    expect(metricsPayload.observations[0].metric).toBe('depth')

    await runtime.close()
    expect(usageClient.close).toHaveBeenCalled()
    expect(metricsClient.close).toHaveBeenCalled()
  })

  it('auto-flushes on interval', async () => {
    const sendStats = vi.fn().mockResolvedValue({ featureCount: 1 })
    const usageClient: UsageGrpcClient = {
      sendStats,
      close: vi.fn(),
    }
    const metricsClient: MetricsGrpcClient = {
      sendMetrics: vi.fn().mockResolvedValue({ count: 0 }),
      close: vi.fn(),
    }

    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 1000,
      metricsFlushInterval: 0,
      usageClient,
      metricsClient,
    })
    runtime.start()
    runtime.recordCheck('FeatureA', true)

    await vi.advanceTimersByTimeAsync(1000)
    expect(sendStats).toHaveBeenCalled()

    await runtime.close()
  })
})
