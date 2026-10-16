import {
  DEFAULT_METRICS_BASE_URL,
  DEFAULT_TELEMETRY_FETCH_TIMEOUT_MS,
  DEFAULT_TELEMETRY_FLUSH_MS,
  HttpsTelemetryClient,
  resolveMetricsBaseUrl,
  resolveTelemetryEnableFlag,
} from './https-client.js'
import {
  MetricsBatcher,
  type MetricsFeatureOptions,
  type MetricStatPayload,
} from './metrics-batcher.js'
import { UsageBatcher, type FeatureStatPayload } from './usage-batcher.js'
import { SystemMetricsCollector, type SystemMetricsSampler } from './system-metrics.js'

/** Bound wait for request-scoped / signal close so hung flush cannot stall forever. */
export const REQUEST_SCOPED_CLOSE_TIMEOUT_MS = 2_000

export interface UsageSender {
  sendStats(request: FeatureStatPayload): Promise<unknown>
  close?(): void
}

export interface MetricsSender {
  sendMetrics(request: MetricStatPayload): Promise<unknown>
  close?(): void
}

function isSoftFailResult(result: unknown): boolean {
  if (!result || typeof result !== 'object' || !('ok' in result)) return false
  return result.ok === false
}

/**
 * Usage + metrics telemetry config for Astro SSR.
 */
export interface UsageTelemetryConfig {
  appKey: string
  environment: string
  metricsBaseUrl?: string
  enableUsageTracking?: boolean
  enableMetrics?: boolean
  /**
   * Opt-in automatic process metrics (CpuUsage, MemoryWorkingSet, …).
   * Requires `enableMetrics`. Default false.
   */
  systemMetrics?: boolean
  usageFlushInterval?: number
  metricsFlushInterval?: number
  instanceName?: string
  appVersion?: string
  /**
   * When true (default), attach beforeExit/SIGTERM/SIGINT flush.
   * Edge-like hosts that lack signals should set false.
   */
  attachProcessHandlers?: boolean
  /** When true (default), restore batches if HTTPS/send returns soft-fail. */
  restoreOnSendFailure?: boolean
  fetchImpl?: typeof fetch
  /** Injected client for tests. When unset, HTTPS `api/usage/stats` is used. */
  usageClient?: UsageSender | null
  /** Injected metrics client for tests. When unset, HTTPS `api/metrics` is used. */
  metricsClient?: MetricsSender | null
  /** Injected system-metrics sampler for tests. */
  systemMetricsSampler?: SystemMetricsSampler
  systemMetricsIntervalMs?: number
  /** Abort hanging HTTPS posts after this many ms (default: 5000). */
  fetchTimeoutMs?: number
}

export interface TelemetryLogger {
  debug: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

/**
 * Owns usage + metrics batchers, flush timers, and soft-fail HTTPS restore.
 */
export class UsageTelemetryRuntime {
  private usageBatcher: UsageBatcher | null = null
  private metricsBatcher: MetricsBatcher | null = null
  private systemMetrics: SystemMetricsCollector | null = null
  private usageClient: UsageSender | null = null
  private metricsClient: MetricsSender | null = null
  private httpsClient: HttpsTelemetryClient | null = null
  private usageTimer: ReturnType<typeof setInterval> | null = null
  private metricsTimer: ReturnType<typeof setInterval> | null = null
  private flushInFlight: Promise<void> | null = null
  private pendingDrain = false
  private closed = false
  private readonly processStartTime = new Date()
  private readonly signalHandlers: Array<{
    event: NodeJS.Signals | 'beforeExit'
    handler: (...args: unknown[]) => void
  }> = []
  private readonly logger: TelemetryLogger
  private readonly restoreOnSendFailure: boolean
  private readonly attachProcessHandlers: boolean
  private readonly config: Required<
    Pick<
      UsageTelemetryConfig,
      | 'appKey'
      | 'environment'
      | 'metricsBaseUrl'
      | 'enableUsageTracking'
      | 'enableMetrics'
      | 'systemMetrics'
      | 'usageFlushInterval'
      | 'metricsFlushInterval'
    >
  > &
    Pick<
      UsageTelemetryConfig,
      | 'instanceName'
      | 'appVersion'
      | 'usageClient'
      | 'metricsClient'
      | 'systemMetricsSampler'
      | 'systemMetricsIntervalMs'
      | 'fetchImpl'
      | 'fetchTimeoutMs'
    >

  constructor(config: UsageTelemetryConfig, logger?: TelemetryLogger) {
    const hasAppKey = Boolean(config.appKey)
    this.attachProcessHandlers = config.attachProcessHandlers ?? true
    this.restoreOnSendFailure = config.restoreOnSendFailure ?? true
    this.config = {
      appKey: config.appKey,
      environment: config.environment,
      metricsBaseUrl: resolveMetricsBaseUrl(config.metricsBaseUrl ?? DEFAULT_METRICS_BASE_URL),
      enableUsageTracking: resolveTelemetryEnableFlag(config.enableUsageTracking, hasAppKey),
      enableMetrics: resolveTelemetryEnableFlag(config.enableMetrics, hasAppKey),
      systemMetrics: config.systemMetrics === true,
      usageFlushInterval: config.usageFlushInterval ?? DEFAULT_TELEMETRY_FLUSH_MS,
      metricsFlushInterval: config.metricsFlushInterval ?? DEFAULT_TELEMETRY_FLUSH_MS,
      instanceName: config.instanceName,
      appVersion: config.appVersion,
      usageClient: config.usageClient,
      metricsClient: config.metricsClient,
      systemMetricsSampler: config.systemMetricsSampler,
      systemMetricsIntervalMs: config.systemMetricsIntervalMs,
      fetchImpl: config.fetchImpl,
      fetchTimeoutMs: config.fetchTimeoutMs ?? DEFAULT_TELEMETRY_FETCH_TIMEOUT_MS,
    }
    this.logger = logger ?? {
      debug: () => {},
      warn: (...args) => console.warn('[Toggly]', ...args),
      error: (...args) => console.error('[Toggly]', ...args),
    }
  }

  get usageEnabled(): boolean {
    return this.config.enableUsageTracking && !this.closed
  }

  get metricsEnabled(): boolean {
    return this.config.enableMetrics && !this.closed
  }

  start(): void {
    if (this.closed) return
    if (!this.config.enableUsageTracking && !this.config.enableMetrics) {
      return
    }

    this.ensureHttpsClient()
    if (this.config.enableUsageTracking) {
      this.startUsageTelemetry()
    }
    if (this.config.enableMetrics) {
      this.startMetricsTelemetry()
    }
    if (this.attachProcessHandlers) {
      this.attachHandlers()
    }
  }

  private ensureHttpsClient(): void {
    const needsHttps =
      (this.config.enableUsageTracking && this.config.usageClient === undefined) ||
      (this.config.enableMetrics && this.config.metricsClient === undefined)
    if (!needsHttps) return
    this.httpsClient = new HttpsTelemetryClient({
      metricsBaseUrl: this.config.metricsBaseUrl,
      fetchImpl: this.config.fetchImpl,
      fetchTimeoutMs: this.config.fetchTimeoutMs,
    })
  }

  private startUsageTelemetry(): void {
    this.usageClient = this.resolveUsageClient()
    this.usageBatcher = new UsageBatcher({
      appKey: this.config.appKey,
      environment: this.config.environment,
      instanceName: this.config.instanceName,
      appVersion: this.config.appVersion,
      processStartTime: this.processStartTime,
    })
    if (this.config.usageFlushInterval > 0) {
      this.usageTimer = setInterval(() => {
        void this.flush()
      }, this.config.usageFlushInterval)
      this.usageTimer.unref?.()
    }
  }

  private resolveUsageClient(): UsageSender | null {
    if (this.config.usageClient === undefined) {
      return {
        sendStats: async (request) => {
          const ok = await this.httpsClient!.sendUsageStats(request)
          return { ok }
        },
      }
    }
    return this.config.usageClient
  }

  private startMetricsTelemetry(): void {
    this.metricsClient = this.resolveMetricsClient()
    this.metricsBatcher = new MetricsBatcher({
      appKey: this.config.appKey,
      environment: this.config.environment,
      instanceName: this.config.instanceName,
    })
    if (this.config.metricsFlushInterval > 0) {
      this.metricsTimer = setInterval(() => {
        void this.flush()
      }, this.config.metricsFlushInterval)
      this.metricsTimer.unref?.()
    }
    this.startSystemMetrics()
  }

  private resolveMetricsClient(): MetricsSender | null {
    if (this.config.metricsClient === undefined) {
      return {
        sendMetrics: async (request) => {
          const ok = await this.httpsClient!.sendMetrics(request)
          return { ok }
        },
      }
    }
    return this.config.metricsClient
  }

  static readonly SIGNAL_FLUSH_TIMEOUT_MS = REQUEST_SCOPED_CLOSE_TIMEOUT_MS
  static readonly REQUEST_SCOPED_CLOSE_TIMEOUT_MS = REQUEST_SCOPED_CLOSE_TIMEOUT_MS

  private attachHandlers(): void {
    if (typeof process === 'undefined' || typeof process.on !== 'function') {
      return
    }

    const onBeforeExit = (): void => {
      void this.flush()
    }
    process.on('beforeExit', onBeforeExit)
    this.signalHandlers.push({ event: 'beforeExit', handler: onBeforeExit })

    this.bindTerminationSignal('SIGTERM')
    this.bindTerminationSignal('SIGINT')
  }

  private bindTerminationSignal(signal: 'SIGTERM' | 'SIGINT'): void {
    try {
      const handler = (): void => {
        void this.handleProcessSignal(signal)
      }
      process.on(signal, handler)
      this.signalHandlers.push({ event: signal, handler })
    } catch {
      // Some runtimes disallow signal handlers
    }
  }

  private async handleProcessSignal(signal: NodeJS.Signals): Promise<void> {
    try {
      await this.closeWithin(UsageTelemetryRuntime.SIGNAL_FLUSH_TIMEOUT_MS)
    } catch {
      // Best-effort flush; still exit
    } finally {
      this.detachProcessHandlers()
      this.reemitSignalAndExit(signal)
    }
  }

  private closeWithin(timeoutMs: number): Promise<void> {
    return Promise.race([
      this.close(),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs)
        timer.unref?.()
      }),
    ])
  }

  private reemitSignalAndExit(signal: NodeJS.Signals): void {
    try {
      process.kill(process.pid, signal)
    } catch {
      process.exit(this.exitCodeForSignal(signal))
    }
  }

  private exitCodeForSignal(signal: NodeJS.Signals): number {
    if (signal === 'SIGINT') return 130
    if (signal === 'SIGTERM') return 143
    return 0
  }

  private detachProcessHandlers(): void {
    if (typeof process === 'undefined' || typeof process.off !== 'function') {
      return
    }
    for (const entry of this.signalHandlers) {
      process.off(entry.event, entry.handler)
    }
    this.signalHandlers.length = 0
  }

  private startSystemMetrics(): void {
    if (!this.config.enableMetrics || !this.config.systemMetrics) return
    this.systemMetrics = new SystemMetricsCollector({
      observe: (metric, value, options) => this.observe(metric, value, options),
      sampler: this.config.systemMetricsSampler,
      intervalMs: this.config.systemMetricsIntervalMs,
    })
    this.systemMetrics.start()
  }

  recordDefinitionCacheHit(): void {
    this.usageBatcher?.recordDefinitionCacheHit()
  }

  recordDefinitionCacheMiss(): void {
    this.usageBatcher?.recordDefinitionCacheMiss()
  }

  measure(metric: string, value: number, options?: MetricsFeatureOptions): void {
    this.metricsBatcher?.measure(metric, value, options)
  }

  incrementCounter(metric: string, value = 1, options?: MetricsFeatureOptions): void {
    this.metricsBatcher?.incrementCounter(metric, value, options)
  }

  observe(metric: string, value: number, options?: MetricsFeatureOptions): void {
    this.metricsBatcher?.observe(metric, value, options)
  }

  async flush(): Promise<void> {
    this.pendingDrain = true
    if (this.flushInFlight) {
      return this.flushInFlight
    }

    this.flushInFlight = this.drainUntilIdle()
    return this.flushInFlight
  }

  private async drainUntilIdle(): Promise<void> {
    try {
      while (this.pendingDrain) {
        this.pendingDrain = false
        await this.sendUsageOnce()
        await this.sendMetricsOnce()
      }
    } finally {
      this.flushInFlight = null
      if (this.pendingDrain) {
        await this.flush()
      }
    }
  }

  private async sendUsageOnce(): Promise<void> {
    const batcher = this.usageBatcher
    if (!batcher) return

    const client = this.usageClient
    if (!client?.sendStats) {
      this.logger.debug('Usage flush skipped: no usage client')
      return
    }

    const bundle = batcher.buildAndReset()
    if (!bundle) return

    try {
      const result = await client.sendStats(bundle.payload)
      if (this.restoreOnSendFailure && isSoftFailResult(result)) {
        batcher.restoreFromBundle(bundle)
        this.logger.debug('Usage HTTPS soft-fail; batch restored')
      }
    } catch (error) {
      if (this.restoreOnSendFailure) {
        batcher.restoreFromBundle(bundle)
      }
      this.logger.error('Failed to send usage stats:', error)
    }
  }

  private async sendMetricsOnce(): Promise<void> {
    const batcher = this.metricsBatcher
    if (!batcher) return

    const client = this.metricsClient
    if (!client?.sendMetrics) {
      this.logger.debug('Metrics flush skipped: no metrics client')
      return
    }

    const payload = batcher.buildAndReset()
    if (!payload) return

    try {
      const result = await client.sendMetrics(payload)
      if (this.restoreOnSendFailure && isSoftFailResult(result)) {
        batcher.restoreFromPayload(payload)
        this.logger.debug('Metrics HTTPS soft-fail; batch restored')
      } else {
        this.systemMetrics?.onFlushed()
      }
    } catch (error) {
      if (this.restoreOnSendFailure) {
        batcher.restoreFromPayload(payload)
      }
      this.logger.error('Failed to send metrics:', error)
    }
  }

  /**
   * Flush remaining telemetry and tear down. When `timeoutMs` is set, abandon the
   * await after that bound (flush may continue in the background) so callers
   * such as request middleware never stall on a hung telemetry endpoint.
   */
  async close(options?: { timeoutMs?: number }): Promise<void> {
    if (this.closed) return
    this.closed = true

    if (this.usageTimer) {
      clearInterval(this.usageTimer)
      this.usageTimer = null
    }
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer)
      this.metricsTimer = null
    }

    this.systemMetrics?.stop()
    this.systemMetrics = null

    this.detachProcessHandlers()

    const finish = async (): Promise<void> => {
      try {
        await this.flush().catch(() => {
          // Soft-fail: close must not reject for telemetry errors.
        })
      } finally {
        try {
          this.usageClient?.close?.()
        } catch {
          // ignore
        }
        try {
          this.metricsClient?.close?.()
        } catch {
          // ignore
        }
        this.usageClient = null
        this.metricsClient = null
        this.httpsClient = null
        this.usageBatcher = null
        this.metricsBatcher = null
      }
    }

    const timeoutMs = options?.timeoutMs
    if (timeoutMs != null && timeoutMs >= 0) {
      const done = finish()
      await Promise.race([
        done,
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, timeoutMs)
          timer.unref?.()
        }),
      ])
      return
    }

    await finish()
  }
}

export type { UsageFlushBundle } from './usage-batcher.js'
export type { MetricsFeatureOptions, MetricStatPayload } from './metrics-batcher.js'
