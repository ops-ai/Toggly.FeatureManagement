import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SYSTEM_METRICS_MAX_PENDING,
  SystemMetricsCollector,
} from '../../telemetry/system-metrics.js'
import { UsageTelemetryRuntime } from '../../telemetry/runtime.js'

function manualTimers() {
  const intervals: Array<() => void> = []
  const clearIntervalMock = vi.fn()
  const setIntervalFn = ((fn: () => void) => {
    intervals.push(fn)
    return 1 as unknown as ReturnType<typeof setInterval>
  }) as typeof setInterval
  return {
    intervals,
    setIntervalFn,
    clearIntervalFn: clearIntervalMock as unknown as typeof clearInterval,
    clearIntervalMock,
  }
}

describe('SystemMetricsCollector', () => {
  it('emits injected sampler values and stops on dispose', () => {
    const observed: Array<{ metric: string; value: number }> = []
    const { intervals, setIntervalFn, clearIntervalFn, clearIntervalMock } = manualTimers()
    const collector = new SystemMetricsCollector({
      observe: (metric, value) => observed.push({ metric, value }),
      sampler: () => [
        { metric: 'CpuUsage', value: 12.5 },
        { metric: 'MemoryWorkingSet', value: 4096 },
      ],
      setIntervalFn,
      clearIntervalFn,
    })

    collector.start()
    expect(intervals).toHaveLength(1)
    intervals[0]!()
    expect(observed).toEqual([
      { metric: 'CpuUsage', value: 12.5 },
      { metric: 'MemoryWorkingSet', value: 4096 },
    ])

    collector.stop()
    expect(clearIntervalMock).toHaveBeenCalled()
    const before = observed.length
    intervals[0]!()
    expect(observed).toHaveLength(before)
  })

  it('double start/stop are idempotent and tick before start is a no-op', () => {
    const observed: Array<{ metric: string; value: number }> = []
    const { intervals, setIntervalFn, clearIntervalFn } = manualTimers()
    const collector = new SystemMetricsCollector({
      observe: (metric, value) => observed.push({ metric, value }),
      sampler: () => [{ metric: 'CpuUsage', value: 1 }],
      setIntervalFn,
      clearIntervalFn,
    })
    collector.tick()
    expect(observed).toHaveLength(0)
    collector.start()
    collector.start()
    expect(intervals).toHaveLength(1)
    collector.stop()
    collector.stop()
  })

  it('skips non-finite values and swallows sampler errors', () => {
    const observed: number[] = []
    const { setIntervalFn, clearIntervalFn } = manualTimers()
    let n = 0
    const collector = new SystemMetricsCollector({
      observe: (_m, value) => observed.push(value),
      sampler: () => {
        n += 1
        if (n === 1) return [{ metric: 'CpuUsage', value: Number.NaN }]
        if (n === 2) throw new Error('boom')
        return [{ metric: 'CpuUsage', value: 3 }]
      },
      setIntervalFn,
      clearIntervalFn,
    })
    collector.start()
    collector.tick()
    collector.tick()
    collector.tick()
    expect(observed).toEqual([3])
    collector.stop()
  })

  it('enforces pending cap and clears on flush', () => {
    const observed: string[] = []
    const { setIntervalFn, clearIntervalFn } = manualTimers()
    const collector = new SystemMetricsCollector({
      observe: (metric) => observed.push(metric),
      sampler: () => [{ metric: 'CpuUsage', value: 1 }],
      setIntervalFn,
      clearIntervalFn,
    })
    collector.start()
    for (let i = 0; i < SYSTEM_METRICS_MAX_PENDING + 5; i += 1) {
      collector.tick()
    }
    expect(observed).toHaveLength(SYSTEM_METRICS_MAX_PENDING)
    collector.onFlushed()
    collector.tick()
    expect(observed).toHaveLength(SYSTEM_METRICS_MAX_PENDING + 1)
    collector.stop()
  })

  it('default sampler emits memory and cpu after a second tick', () => {
    const observed: Array<{ metric: string; value: number }> = []
    const { setIntervalFn, clearIntervalFn } = manualTimers()
    let t = 1_000
    const collector = new SystemMetricsCollector({
      observe: (metric, value) => observed.push({ metric, value }),
      now: () => t,
      setIntervalFn,
      clearIntervalFn,
    })
    collector.start()
    observed.length = 0
    t = 1_100
    collector.tick()
    const names = new Set(observed.map((o) => o.metric))
    expect(names.has('MemoryWorkingSet')).toBe(true)
    expect(names.has('GCHeapSize')).toBe(true)
    expect(names.has('CpuUsage')).toBe(true)
    collector.stop()
  })

  it('drains ExceptionCount via uncaughtExceptionMonitor', () => {
    const observed: Array<{ metric: string; value: number }> = []
    const { setIntervalFn, clearIntervalFn } = manualTimers()
    const collector = new SystemMetricsCollector({
      observe: (metric, value) => observed.push({ metric, value }),
      setIntervalFn,
      clearIntervalFn,
    })
    collector.start()
    process.emit('uncaughtExceptionMonitor', new Error('x'), 'uncaughtException')
    observed.length = 0
    collector.tick()
    expect(observed.some((o) => o.metric === 'ExceptionCount' && o.value === 1)).toBe(true)
    collector.stop()
  })
})

describe('UsageTelemetryRuntime systemMetrics', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not start the collector when systemMetrics is false', async () => {
    const sendMetrics = vi.fn().mockResolvedValue({ ok: true })
    const sampler = vi.fn(() => [{ metric: 'CpuUsage', value: 1 }])
    const runtime = new UsageTelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: false,
      enableMetrics: true,
      systemMetrics: false,
      metricsFlushInterval: 0,
      metricsClient: { sendMetrics, close: vi.fn() },
      systemMetricsSampler: sampler,
      systemMetricsIntervalMs: 10_000,
      attachProcessHandlers: false,
    })
    runtime.start()
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sampler).not.toHaveBeenCalled()
    await runtime.close()
  })

  it('samples and flushes when systemMetrics and enableMetrics are true', async () => {
    vi.useFakeTimers()
    const sendMetrics = vi.fn().mockResolvedValue({ ok: true })
    const sampler = vi.fn(() => [{ metric: 'CpuUsage', value: 9 }])
    const runtime = new UsageTelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: false,
      enableMetrics: true,
      systemMetrics: true,
      metricsFlushInterval: 0,
      metricsClient: { sendMetrics, close: vi.fn() },
      systemMetricsSampler: sampler,
      systemMetricsIntervalMs: 10_000,
      attachProcessHandlers: false,
    })
    runtime.start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sampler).toHaveBeenCalled()
    await runtime.flush()
    expect(sendMetrics).toHaveBeenCalledTimes(1)
    const payload = sendMetrics.mock.calls[0]![0] as {
      observations: Array<{ metric: string; variantValues: Record<string, number> }>
    }
    expect(payload.observations.some((o) => o.metric === 'CpuUsage')).toBe(true)
    await runtime.close()
  })

  it('does not start when metrics are disabled even if systemMetrics is true', async () => {
    const sampler = vi.fn(() => [{ metric: 'CpuUsage', value: 1 }])
    const runtime = new UsageTelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: false,
      enableMetrics: false,
      systemMetrics: true,
      systemMetricsSampler: sampler,
      systemMetricsIntervalMs: 10_000,
      attachProcessHandlers: false,
    })
    runtime.start()
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sampler).not.toHaveBeenCalled()
    await runtime.close()
  })
})
