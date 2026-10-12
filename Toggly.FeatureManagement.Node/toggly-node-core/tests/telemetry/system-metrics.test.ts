import { afterEach, describe, expect, it, vi } from 'vitest'
import { SystemMetricsCollector } from '../../src/telemetry/system-metrics.js'
import { TelemetryRuntime } from '../../src/telemetry/index.js'

describe('SystemMetricsCollector', () => {
  it('emits injected sampler values and stops on dispose', () => {
    const observed: Array<{ metric: string; value: number }> = []
    const intervals: Array<() => void> = []
    const clearIntervalFn = vi.fn()
    const collector = new SystemMetricsCollector({
      observe: (metric, value) => observed.push({ metric, value }),
      sampler: () => [
        { metric: 'CpuUsage', value: 12.5 },
        { metric: 'MemoryWorkingSet', value: 4096 },
      ],
      setIntervalFn: ((fn: () => void) => {
        intervals.push(fn)
        return 1 as unknown as ReturnType<typeof setInterval>
      }) as typeof setInterval,
      clearIntervalFn: clearIntervalFn as unknown as typeof clearInterval,
    })

    collector.start()
    expect(intervals).toHaveLength(1)
    intervals[0]!()
    expect(observed).toEqual([
      { metric: 'CpuUsage', value: 12.5 },
      { metric: 'MemoryWorkingSet', value: 4096 },
    ])

    collector.stop()
    expect(clearIntervalFn).toHaveBeenCalled()
    const before = observed.length
    intervals[0]!()
    expect(observed).toHaveLength(before)
  })
})

describe('TelemetryRuntime systemMetrics', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not start the collector when systemMetrics is false', async () => {
    const sendMetrics = vi.fn().mockResolvedValue({})
    const sampler = vi.fn(() => [{ metric: 'CpuUsage', value: 1 }])
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: false,
      enableMetrics: true,
      systemMetrics: false,
      metricsFlushInterval: 0,
      metricsClient: { sendMetrics, close: vi.fn() },
      systemMetricsSampler: sampler,
      systemMetricsIntervalMs: 10_000,
    })
    runtime.start()
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sampler).not.toHaveBeenCalled()
    await runtime.close()
  })

  it('samples and flushes when systemMetrics and enableMetrics are true', async () => {
    vi.useFakeTimers()
    const sendMetrics = vi.fn().mockResolvedValue({})
    const sampler = vi.fn(() => [{ metric: 'CpuUsage', value: 9 }])
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: false,
      enableMetrics: true,
      systemMetrics: true,
      metricsFlushInterval: 0,
      metricsClient: { sendMetrics, close: vi.fn() },
      systemMetricsSampler: sampler,
      systemMetricsIntervalMs: 10_000,
    })
    runtime.start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sampler).toHaveBeenCalled()
    await runtime.flushMetrics()
    expect(sendMetrics).toHaveBeenCalledTimes(1)
    const payload = sendMetrics.mock.calls[0]![0] as {
      observations: Array<{ metric: string; variantValues: Record<string, number> }>
    }
    expect(payload.observations.some((o) => o.metric === 'CpuUsage')).toBe(true)
    await runtime.close()
  })

  it('does not start when metrics are disabled even if systemMetrics is true', async () => {
    const sampler = vi.fn(() => [{ metric: 'CpuUsage', value: 1 }])
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: false,
      enableMetrics: false,
      systemMetrics: true,
      systemMetricsSampler: sampler,
      systemMetricsIntervalMs: 10_000,
    })
    runtime.start()
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sampler).not.toHaveBeenCalled()
    await runtime.close()
  })
})
