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

  it('retains the usage batch when flush has no sendStats client', async () => {
    const sendStats = vi.fn().mockResolvedValue({ featureCount: 1 })
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      // Client present but missing sendStats — flush must not buildAndReset.
      usageClient: { close: vi.fn() } as unknown as UsageGrpcClient,
      metricsClient: null,
    })
    runtime.start()
    runtime.recordCheck('FeatureA', true, 'user-1')

    await runtime.flushUsage()
    expect(sendStats).not.toHaveBeenCalled()

    // Attach a working client and flush again — prior observations must still be present.
    ;(runtime as unknown as { clients: { usage: UsageGrpcClient; metrics: null } }).clients = {
      usage: { sendStats, close: vi.fn() },
      metrics: null,
    }
    await runtime.flushUsage()
    expect(sendStats).toHaveBeenCalledTimes(1)
    const usagePayload = sendStats.mock.calls[0][0] as {
      stats: Array<{ feature: string; variantStats: Record<string, { checkCount: number }> }>
    }
    expect(usagePayload.stats[0].variantStats.enabled.checkCount).toBe(1)

    await runtime.close()
  })

  it('retains the metrics batch when flush has no sendMetrics client', async () => {
    const sendMetrics = vi.fn().mockResolvedValue({ count: 1 })
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: false,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: null,
      metricsClient: { close: vi.fn() } as unknown as MetricsGrpcClient,
    })
    runtime.start()
    runtime.measure('revenue', 9)

    await runtime.flushMetrics()
    expect(sendMetrics).not.toHaveBeenCalled()

    ;(runtime as unknown as { clients: { usage: null; metrics: MetricsGrpcClient } }).clients = {
      usage: null,
      metrics: { sendMetrics, close: vi.fn() },
    }
    await runtime.flushMetrics()
    expect(sendMetrics).toHaveBeenCalledTimes(1)

    await runtime.close()
  })

  it('restores the full usage batch when sendStats fails then succeeds', async () => {
    const sendStats = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient send failure'))
      .mockResolvedValueOnce({ featureCount: 1 })

    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: null,
    })
    runtime.start()

    runtime.recordCheck('FeatureA', true, 'user-1')
    runtime.recordDefinitionCacheHit()
    runtime.recordDefinitionCacheMiss()

    await runtime.flushUsage()
    expect(sendStats).toHaveBeenCalledTimes(1)

    await runtime.flushUsage()
    expect(sendStats).toHaveBeenCalledTimes(2)

    const payload = sendStats.mock.calls[1][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
      stats: Array<{
        feature: string
        variantStats: { enabled: { checkCount: number } }
      }>
    }
    expect(payload.definitionCacheHits).toBe(1)
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.stats[0].feature).toBe('FeatureA')
    expect(payload.stats[0].variantStats.enabled.checkCount).toBe(1)

    await runtime.close()
  })

  it('merges in-flight records when restoring a failed usage flush', async () => {
    let rejectSend!: (error: Error) => void
    const sendStats = vi.fn().mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSend = reject
        }),
    )
    sendStats.mockResolvedValueOnce({ featureCount: 1 })

    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: null,
    })
    runtime.start()

    runtime.recordCheck('FeatureA', true, 'user-1')
    runtime.recordDefinitionCacheHit()

    const flushPromise = runtime.flushUsage()
    await vi.waitFor(() => {
      expect(sendStats).toHaveBeenCalledTimes(1)
    })

    // Recorded while the first send is still in flight.
    runtime.recordCheck('FeatureB', false, 'user-2')
    runtime.recordDefinitionCacheHit()

    rejectSend(new Error('send failed'))
    await flushPromise

    await runtime.flushUsage()
    expect(sendStats).toHaveBeenCalledTimes(2)

    const payload = sendStats.mock.calls[1][0] as {
      definitionCacheHits?: number
      stats: Array<{
        feature: string
        variantStats: Record<string, { checkCount: number }>
      }>
    }
    expect(payload.definitionCacheHits).toBe(2)
    const byFeature = Object.fromEntries(
      payload.stats.map((s) => [s.feature, s.variantStats]),
    )
    expect(byFeature.FeatureA.enabled.checkCount).toBe(1)
    expect(byFeature.FeatureB.disabled.checkCount).toBe(1)

    await runtime.close()
  })

  it('SIGTERM flush re-emits signal so the process can exit', async () => {
    vi.useRealTimers()
    const sendStats = vi.fn().mockResolvedValue({ featureCount: 1 })
    const usageClient: UsageGrpcClient = {
      sendStats,
      close: vi.fn(),
    }
    const metricsClient: MetricsGrpcClient = {
      sendMetrics: vi.fn().mockResolvedValue({ count: 0 }),
      close: vi.fn(),
    }

    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)

    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient,
      metricsClient,
    })
    runtime.start()
    runtime.recordCheck('FeatureA', true)

    process.emit('SIGTERM', 'SIGTERM')

    await vi.waitFor(() => {
      expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
    })
    expect(sendStats).toHaveBeenCalled()

    kill.mockRestore()
    // Runtime already closed via signal path; safe if already closed
    await runtime.close()
  })
})
