import { cpus } from 'node:os'
import { monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks'
import type { MetricsFeatureOptions } from './metrics-batcher.js'

export const SYSTEM_METRICS_INTERVAL_MS = 10_000
/** Cap unsent samples per metric name if flush stalls. */
export const SYSTEM_METRICS_MAX_PENDING = 30

export type SystemMetricObservation = {
  metric: string
  value: number
}

export type SystemMetricsSampler = () => SystemMetricObservation[]

export type SystemMetricsObserve = (
  metric: string,
  value: number,
  options?: MetricsFeatureOptions,
) => void

export interface SystemMetricsCollectorOptions {
  observe: SystemMetricsObserve
  intervalMs?: number
  sampler?: SystemMetricsSampler
  /** Injected clock for tests (returns Date.now()-style ms). */
  now?: () => number
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}

type CpuSnapshot = { user: number; system: number; at: number }

/**
 * Opt-in Node process metrics: CpuUsage, MemoryWorkingSet, GCHeapSize,
 * ExceptionCount, TimeInGC, EventLoopDelay. Samples every 10s by default.
 */
export class SystemMetricsCollector {
  private readonly observe: SystemMetricsObserve
  private readonly intervalMs: number
  private readonly sampler: SystemMetricsSampler
  private readonly now: () => number
  private readonly setIntervalFn: typeof setInterval
  private readonly clearIntervalFn: typeof clearInterval
  private timer: ReturnType<typeof setInterval> | null = null
  private started = false
  private exceptionCount = 0
  private readonly onException: () => void
  private lastCpu: CpuSnapshot | null = null
  private eventLoopHistogram: ReturnType<typeof monitorEventLoopDelay> | null = null
  private gcObserver: PerformanceObserver | null = null
  private gcDurationMs = 0
  private pendingByMetric = new Map<string, number>()

  constructor(options: SystemMetricsCollectorOptions) {
    this.observe = options.observe
    this.intervalMs = options.intervalMs ?? SYSTEM_METRICS_INTERVAL_MS
    this.now = options.now ?? Date.now
    this.setIntervalFn = options.setIntervalFn ?? setInterval
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval
    this.onException = () => {
      this.exceptionCount += 1
    }
    this.sampler = options.sampler ?? (() => this.defaultSample())
  }

  start(): void {
    if (this.started) return
    this.started = true
    const usage = process.cpuUsage()
    this.lastCpu = { user: usage.user, system: usage.system, at: this.now() }
    this.attachExceptionMonitor()
    this.attachGcObserver()
    this.attachEventLoopMonitor()
    this.timer = this.setIntervalFn(() => {
      this.tick()
    }, this.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    if (this.timer) {
      this.clearIntervalFn(this.timer)
      this.timer = null
    }
    this.detachExceptionMonitor()
    this.detachGcObserver()
    this.detachEventLoopMonitor()
    this.pendingByMetric.clear()
  }

  /** Test helper: run one sample cycle immediately. */
  tick(): void {
    if (!this.started) return
    try {
      const samples = this.sampler()
      for (const { metric, value } of samples) {
        if (!Number.isFinite(value)) continue
        const pending = this.pendingByMetric.get(metric) ?? 0
        if (pending >= SYSTEM_METRICS_MAX_PENDING) continue
        this.pendingByMetric.set(metric, pending + 1)
        this.observe(metric, value)
      }
    } catch {
      // Never disrupt the host process.
    }
  }

  /** Call after a successful metrics flush to free the pending cap. */
  onFlushed(): void {
    this.pendingByMetric.clear()
  }

  private defaultSample(): SystemMetricObservation[] {
    const out: SystemMetricObservation[] = []
    const cpu = this.sampleCpu()
    if (cpu != null) out.push({ metric: 'CpuUsage', value: cpu })

    const mem = process.memoryUsage()
    out.push({ metric: 'MemoryWorkingSet', value: mem.rss })
    out.push({ metric: 'GCHeapSize', value: mem.heapUsed })

    if (this.exceptionCount > 0) {
      const pending = this.pendingByMetric.get('ExceptionCount') ?? 0
      if (pending < SYSTEM_METRICS_MAX_PENDING) {
        out.push({ metric: 'ExceptionCount', value: this.exceptionCount })
        this.exceptionCount = 0
      }
    }

    const timeInGc = this.sampleTimeInGc()
    if (timeInGc != null) out.push({ metric: 'TimeInGC', value: timeInGc })

    const delay = this.sampleEventLoopDelay()
    if (delay != null) out.push({ metric: 'EventLoopDelay', value: delay })

    return out
  }

  private sampleCpu(): number | null {
    const usage = process.cpuUsage()
    const at = this.now()
    const prev = this.lastCpu
    this.lastCpu = { user: usage.user, system: usage.system, at }
    if (!prev) return null
    const wallUs = Math.max(1, (at - prev.at) * 1000)
    const cpuUs = usage.user - prev.user + (usage.system - prev.system)
    const cpuCount = Math.max(1, cpus()?.length ?? 1)
    const pct = (cpuUs / wallUs / cpuCount) * 100
    if (!Number.isFinite(pct) || pct < 0) return null
    return Math.min(100, pct)
  }

  private sampleTimeInGc(): number | null {
    if (this.gcDurationMs <= 0) return null
    const pct = (this.gcDurationMs / this.intervalMs) * 100
    this.gcDurationMs = 0
    if (!Number.isFinite(pct) || pct < 0) return null
    return Math.min(100, pct)
  }

  private sampleEventLoopDelay(): number | null {
    const hist = this.eventLoopHistogram
    if (!hist) return null
    try {
      const meanNs = hist.mean
      hist.reset()
      if (!Number.isFinite(meanNs) || meanNs < 0) return null
      return meanNs / 1e6
    } catch {
      return null
    }
  }

  private attachExceptionMonitor(): void {
    try {
      process.on('uncaughtExceptionMonitor', this.onException)
    } catch {
      // ignore
    }
  }

  private detachExceptionMonitor(): void {
    try {
      process.off('uncaughtExceptionMonitor', this.onException)
    } catch {
      // ignore
    }
  }

  private attachGcObserver(): void {
    try {
      this.gcObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.gcDurationMs += entry.duration
        }
      })
      this.gcObserver.observe({ type: 'gc', buffered: true })
    } catch {
      this.gcObserver = null
    }
  }

  private detachGcObserver(): void {
    try {
      this.gcObserver?.disconnect()
    } catch {
      // ignore
    }
    this.gcObserver = null
    this.gcDurationMs = 0
  }

  private attachEventLoopMonitor(): void {
    try {
      this.eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 })
      this.eventLoopHistogram.enable()
    } catch {
      this.eventLoopHistogram = null
    }
  }

  private detachEventLoopMonitor(): void {
    try {
      this.eventLoopHistogram?.disable()
    } catch {
      // ignore
    }
    this.eventLoopHistogram = null
  }
}
