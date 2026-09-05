import {
  createGrpcClients,
  DEFAULT_METRICS_BASE_URL,
  DEFAULT_TELEMETRY_FLUSH_MS,
  isGrpcAvailable,
  type GrpcClients,
  type MetricsGrpcClient,
  type UsageGrpcClient,
} from './grpc-clients.js'
import { MetricsBatcher, type MetricsFeatureOptions } from './metrics-batcher.js'
import { UsageBatcher } from './usage-batcher.js'

export interface TelemetryConfig {
  appKey: string
  environment: string
  metricsBaseUrl?: string
  enableUsageTracking?: boolean
  enableMetrics?: boolean
  usageFlushInterval?: number
  metricsFlushInterval?: number
  instanceName?: string
  appVersion?: string
  debug?: boolean
  /** Injected clients for tests. */
  usageClient?: UsageGrpcClient | null
  metricsClient?: MetricsGrpcClient | null
}

export interface TelemetryLogger {
  debug: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

/**
 * Owns usage + metrics batchers, flush timers, and process signal handlers.
 */
export class TelemetryRuntime {
  private usageBatcher: UsageBatcher | null = null
  private metricsBatcher: MetricsBatcher | null = null
  private clients: GrpcClients | null = null
  private usageTimer: ReturnType<typeof setInterval> | null = null
  private metricsTimer: ReturnType<typeof setInterval> | null = null
  private sendingUsage = false
  private sendingMetrics = false
  private closed = false
  private readonly processStartTime = new Date()
  private readonly signalHandlers: Array<{ event: NodeJS.Signals | 'beforeExit'; handler: (...args: unknown[]) => void }> =
    []
  private readonly logger: TelemetryLogger
  private readonly config: Required<
    Pick<
      TelemetryConfig,
      | 'appKey'
      | 'environment'
      | 'metricsBaseUrl'
      | 'enableUsageTracking'
      | 'enableMetrics'
      | 'usageFlushInterval'
      | 'metricsFlushInterval'
    >
  > &
    Pick<TelemetryConfig, 'instanceName' | 'appVersion' | 'usageClient' | 'metricsClient'>

  constructor(config: TelemetryConfig, logger?: TelemetryLogger) {
    const hasAppKey = Boolean(config.appKey)
    const telemetryEnvDisabled = process.env.TOGGLY_DISABLE_TELEMETRY === '1'
    this.config = {
      appKey: config.appKey,
      environment: config.environment,
      metricsBaseUrl: config.metricsBaseUrl ?? DEFAULT_METRICS_BASE_URL,
      enableUsageTracking:
        config.enableUsageTracking ?? (hasAppKey && !telemetryEnvDisabled),
      enableMetrics: config.enableMetrics ?? (hasAppKey && !telemetryEnvDisabled),
      usageFlushInterval: config.usageFlushInterval ?? DEFAULT_TELEMETRY_FLUSH_MS,
      metricsFlushInterval: config.metricsFlushInterval ?? DEFAULT_TELEMETRY_FLUSH_MS,
      instanceName: config.instanceName,
      appVersion: config.appVersion,
      usageClient: config.usageClient,
      metricsClient: config.metricsClient,
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

    const needsTransport = this.config.enableUsageTracking || this.config.enableMetrics
    if (needsTransport) {
      if (this.config.usageClient !== undefined || this.config.metricsClient !== undefined) {
        this.clients = {
          usage: this.config.usageClient as UsageGrpcClient,
          metrics: this.config.metricsClient as MetricsGrpcClient,
        }
      } else if (!isGrpcAvailable()) {
        this.logger.warn(
          'Usage/metrics enabled but @grpc/grpc-js and @grpc/proto-loader are not installed. ' +
            'Install them to send telemetry: npm install @grpc/grpc-js @grpc/proto-loader',
        )
      } else {
        this.clients = createGrpcClients(this.config.metricsBaseUrl)
        if (!this.clients) {
          this.logger.warn('Failed to create Toggly gRPC clients; telemetry disabled')
        }
      }
    }

    if (this.config.enableUsageTracking) {
      this.usageBatcher = new UsageBatcher({
        appKey: this.config.appKey,
        environment: this.config.environment,
        instanceName: this.config.instanceName,
        appVersion: this.config.appVersion,
        processStartTime: this.processStartTime,
      })
      if (this.config.usageFlushInterval > 0) {
        this.usageTimer = setInterval(() => {
          void this.flushUsage()
        }, this.config.usageFlushInterval)
        this.usageTimer.unref?.()
      }
    }

    if (this.config.enableMetrics) {
      this.metricsBatcher = new MetricsBatcher({
        appKey: this.config.appKey,
        environment: this.config.environment,
        instanceName: this.config.instanceName,
      })
      if (this.config.metricsFlushInterval > 0) {
        this.metricsTimer = setInterval(() => {
          void this.flushMetrics()
        }, this.config.metricsFlushInterval)
        this.metricsTimer.unref?.()
      }
    }

    this.attachProcessHandlers()
  }

  /** Best-effort flush budget before re-emitting the signal so Node can exit. */
  static readonly SIGNAL_FLUSH_TIMEOUT_MS = 2_000

  private attachProcessHandlers(): void {
    if (typeof process === 'undefined' || typeof process.on !== 'function') {
      return
    }

    const flush = () => {
      void this.flushAll()
    }

    process.on('beforeExit', flush)
    this.signalHandlers.push({ event: 'beforeExit', handler: flush })

    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      try {
        const onSignal = () => {
          void this.handleProcessSignal(signal)
        }
        process.on(signal, onSignal)
        this.signalHandlers.push({ event: signal, handler: onSignal })
      } catch {
        // Some runtimes disallow signal handlers
      }
    }
  }

  /**
   * Flush telemetry with a timeout, then restore default signal behavior and
   * re-emit so the process does not hang with a custom handler installed.
   */
  private async handleProcessSignal(signal: NodeJS.Signals): Promise<void> {
    try {
      await Promise.race([
        this.close(),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, TelemetryRuntime.SIGNAL_FLUSH_TIMEOUT_MS)
          timer.unref?.()
        }),
      ])
    } catch {
      // Best-effort flush; still exit
    } finally {
      this.detachProcessHandlers()
      this.reemitSignalAndExit(signal)
    }
  }

  private reemitSignalAndExit(signal: NodeJS.Signals): void {
    try {
      // Default handler after our listener is gone terminates the process.
      process.kill(process.pid, signal)
    } catch {
      const code = signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 0
      process.exit(code)
    }
  }

  private detachProcessHandlers(): void {
    if (typeof process === 'undefined' || typeof process.off !== 'function') {
      return
    }
    for (const { event, handler } of this.signalHandlers) {
      process.off(event, handler)
    }
    this.signalHandlers.length = 0
  }

  recordCheck(feature: string, enabled: boolean, identity?: string, variant?: string): void {
    this.usageBatcher?.recordCheck(feature, enabled, identity, variant)
  }

  recordUsage(feature: string, identity?: string, variant?: string): void {
    this.usageBatcher?.recordUsage(feature, identity, variant)
  }

  recordView(feature: string, identity?: string, variant?: string): void {
    this.usageBatcher?.recordView(feature, identity, variant)
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

  async flushUsage(): Promise<void> {
    if (!this.usageBatcher || this.sendingUsage) return
    const payload = this.usageBatcher.buildAndReset()
    if (!payload) return

    const client = this.clients?.usage
    if (!client?.sendStats) {
      this.logger.debug('Usage flush skipped: no gRPC client')
      return
    }

    this.sendingUsage = true
    try {
      await client.sendStats(payload as unknown as Record<string, unknown>)
    } catch (error) {
      this.logger.error('Failed to send usage stats:', error)
      // Re-aggregate lost on failure is acceptable for best-effort telemetry
    } finally {
      this.sendingUsage = false
    }
  }

  async flushMetrics(): Promise<void> {
    if (!this.metricsBatcher || this.sendingMetrics) return
    const payload = this.metricsBatcher.buildAndReset()
    if (!payload) return

    const client = this.clients?.metrics
    if (!client?.sendMetrics) {
      this.logger.debug('Metrics flush skipped: no gRPC client')
      return
    }

    this.sendingMetrics = true
    try {
      await client.sendMetrics(payload as unknown as Record<string, unknown>)
    } catch (error) {
      this.logger.error('Failed to send metrics:', error)
    } finally {
      this.sendingMetrics = false
    }
  }

  async flushAll(): Promise<void> {
    await Promise.all([this.flushUsage(), this.flushMetrics()])
  }

  async close(): Promise<void> {
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

    this.detachProcessHandlers()

    try {
      await this.flushAll()
    } finally {
      try {
        this.clients?.usage?.close?.()
      } catch {
        // ignore
      }
      try {
        this.clients?.metrics?.close?.()
      } catch {
        // ignore
      }
      this.clients = null
      this.usageBatcher = null
      this.metricsBatcher = null
    }
  }
}
