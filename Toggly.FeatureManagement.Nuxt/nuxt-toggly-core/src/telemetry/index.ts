import {
  DEFAULT_METRICS_BASE_URL,
  DEFAULT_TELEMETRY_FLUSH_MS,
  HttpsTelemetryClient,
  resolveMetricsBaseUrl,
  resolveTelemetryEnableFlag,
} from './https-client.js'
import { MetricsBatcher, type MetricsFeatureOptions } from './metrics-batcher.js'
import { UsageBatcher, type UsageFlushBundle } from './usage-batcher.js'
import type { MetricStatPayload } from './metrics-batcher.js'

export interface UsageSender {
  sendStats(request: Record<string, unknown>): Promise<unknown>
  close?(): void
}

export interface MetricsSender {
  sendMetrics(request: Record<string, unknown>): Promise<unknown>
  close?(): void
}

export type TelemetryTransport = 'grpc' | 'https'

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
  /**
   * Transport used when clients are not injected.
   * - `grpc`: expect injected usage/metrics clients (server creates them)
   * - `https`: build soft-fail fetch clients to api/usage/stats + api/metrics
   */
  transport?: TelemetryTransport
  /**
   * When true (default for Node/server), attach beforeExit/SIGTERM/SIGINT flush.
   * Edge runtimes must set false — signal handlers are not available / unsafe.
   */
  attachProcessHandlers?: boolean
  /** When true, restore batches if HTTPS/send returns soft-fail (default for https). */
  restoreOnSendFailure?: boolean
  fetchImpl?: typeof fetch
  /** Injected clients for tests or gRPC transport. */
  usageClient?: UsageSender | null
  metricsClient?: MetricsSender | null
}

export interface TelemetryLogger {
  debug: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

/**
 * Owns usage + metrics batchers, flush timers, and optional process signal handlers.
 */
export class TelemetryRuntime {
  private usageBatcher: UsageBatcher | null = null
  private metricsBatcher: MetricsBatcher | null = null
  private usageClient: UsageSender | null = null
  private metricsClient: MetricsSender | null = null
  private httpsClient: HttpsTelemetryClient | null = null
  private usageTimer: ReturnType<typeof setInterval> | null = null
  private metricsTimer: ReturnType<typeof setInterval> | null = null
  /** Single-flight drain promise (CF Worker TelemetryRuntime pattern). */
  private flushInFlight: Promise<void> | null = null
  /** Set when flush/close is requested during an in-flight drain. */
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
  private readonly transport: TelemetryTransport
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
    Pick<TelemetryConfig, 'instanceName' | 'appVersion' | 'usageClient' | 'metricsClient' | 'fetchImpl'>

  constructor(config: TelemetryConfig, logger?: TelemetryLogger) {
    const hasAppKey = Boolean(config.appKey)
    this.transport = config.transport ?? 'grpc'
    this.attachProcessHandlers = config.attachProcessHandlers ?? this.transport === 'grpc'
    this.restoreOnSendFailure =
      config.restoreOnSendFailure ?? this.transport === 'https'
    this.config = {
      appKey: config.appKey,
      environment: config.environment,
      metricsBaseUrl: resolveMetricsBaseUrl(config.metricsBaseUrl ?? DEFAULT_METRICS_BASE_URL),
      // TOGGLY_DISABLE_TELEMETRY=1 wins over explicit true.
      enableUsageTracking: resolveTelemetryEnableFlag(
        config.enableUsageTracking,
        hasAppKey,
      ),
      enableMetrics: resolveTelemetryEnableFlag(config.enableMetrics, hasAppKey),
      usageFlushInterval: config.usageFlushInterval ?? DEFAULT_TELEMETRY_FLUSH_MS,
      metricsFlushInterval: config.metricsFlushInterval ?? DEFAULT_TELEMETRY_FLUSH_MS,
      instanceName: config.instanceName,
      appVersion: config.appVersion,
      usageClient: config.usageClient,
      metricsClient: config.metricsClient,
      fetchImpl: config.fetchImpl,
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

    if (this.config.usageClient !== undefined || this.config.metricsClient !== undefined) {
      this.usageClient = (this.config.usageClient as UsageSender) ?? null
      this.metricsClient = (this.config.metricsClient as MetricsSender) ?? null
    } else if (this.transport === 'https') {
      this.httpsClient = new HttpsTelemetryClient({
        metricsBaseUrl: this.config.metricsBaseUrl,
        fetchImpl: this.config.fetchImpl,
      })
      this.usageClient = {
        sendStats: async (request) => {
          const ok = await this.httpsClient!.sendUsageStats(
            request as unknown as Parameters<HttpsTelemetryClient['sendUsageStats']>[0],
          )
          return { ok }
        },
      }
      this.metricsClient = {
        sendMetrics: async (request) => {
          const ok = await this.httpsClient!.sendMetrics(
            request as unknown as Parameters<HttpsTelemetryClient['sendMetrics']>[0],
          )
          return { ok }
        },
      }
    } else {
      this.logger.warn(
        'Usage/metrics enabled with gRPC transport but no clients were injected. ' +
          'Pass usageClient/metricsClient from createGrpcClients (optional @grpc/grpc-js).',
      )
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
          void this.flush()
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
          void this.flush()
        }, this.config.metricsFlushInterval)
        this.metricsTimer.unref?.()
      }
    }

    if (this.attachProcessHandlers) {
      this.attachHandlers()
    }
  }

  /** Best-effort flush budget before re-emitting the signal so Node can exit. */
  static readonly SIGNAL_FLUSH_TIMEOUT_MS = 2_000

  private attachHandlers(): void {
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

  recordCheck(
    feature: string,
    enabled: boolean,
    identity?: string,
    variant?: string,
    uniqueRequest = false,
  ): void {
    this.usageBatcher?.recordCheck(feature, enabled, identity, variant, uniqueRequest)
  }

  recordUsage(feature: string, identity?: string, variant?: string): void {
    this.usageBatcher?.recordUsage(feature, identity, variant)
  }

  recordView(feature: string, identity?: string, variant?: string): void {
    this.usageBatcher?.recordView(feature, identity, variant)
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

  shouldFlushForCaps(): boolean {
    return Boolean(this.usageBatcher?.hitFeatureCap() || this.metricsBatcher?.hitCap())
  }

  /**
   * Single-flight flush with pending-drain follow-up (CF Worker parity).
   * Concurrent flush/close during an active send coalesces onto one drain and
   * runs another pass so batches recorded mid-send are not stranded.
   */
  async flush(): Promise<void> {
    this.pendingDrain = true
    if (this.flushInFlight) {
      return this.flushInFlight
    }

    this.flushInFlight = this.drainUntilIdle()
    return this.flushInFlight
  }

  async flushAll(): Promise<void> {
    await this.flush()
  }

  /** @deprecated Prefer {@link flush}; kept for callers that split usage/metrics. */
  async flushUsage(): Promise<void> {
    await this.flush()
  }

  /** @deprecated Prefer {@link flush}; kept for callers that split usage/metrics. */
  async flushMetrics(): Promise<void> {
    await this.flush()
  }

  private async drainUntilIdle(): Promise<void> {
    try {
      while (this.pendingDrain) {
        this.pendingDrain = false
        await this.flushInternal()
      }
    } finally {
      this.flushInFlight = null
      // Race: another flush()/close() set pendingDrain after the while check
      // but while we still owned inFlight — start a follow-up drain.
      if (this.pendingDrain) {
        await this.flush()
      }
    }
  }

  private async flushInternal(): Promise<void> {
    await Promise.all([this.sendUsageOnce(), this.sendMetricsOnce()])
  }

  private async sendUsageOnce(): Promise<void> {
    if (!this.usageBatcher) return

    const client = this.usageClient
    if (!client?.sendStats) {
      this.logger.debug('Usage flush skipped: no usage client')
      return
    }

    const bundle = this.usageBatcher.buildAndReset()
    if (!bundle) return

    try {
      const result = await client.sendStats(bundle.payload as unknown as Record<string, unknown>)
      if (
        this.restoreOnSendFailure &&
        result &&
        typeof result === 'object' &&
        'ok' in result &&
        (result as { ok: boolean }).ok === false
      ) {
        this.usageBatcher.restoreFromBundle(bundle)
        this.logger.debug('Usage HTTPS soft-fail; batch restored')
      }
    } catch (error) {
      if (this.restoreOnSendFailure) {
        this.usageBatcher.restoreFromBundle(bundle)
      }
      this.logger.error('Failed to send usage stats:', error)
    }
  }

  private async sendMetricsOnce(): Promise<void> {
    if (!this.metricsBatcher) return

    const client = this.metricsClient
    if (!client?.sendMetrics) {
      this.logger.debug('Metrics flush skipped: no metrics client')
      return
    }

    const payload = this.metricsBatcher.buildAndReset()
    if (!payload) return

    try {
      const result = await client.sendMetrics(payload as unknown as Record<string, unknown>)
      if (
        this.restoreOnSendFailure &&
        result &&
        typeof result === 'object' &&
        'ok' in result &&
        (result as { ok: boolean }).ok === false
      ) {
        this.metricsBatcher.restoreFromPayload(payload)
        this.logger.debug('Metrics HTTPS soft-fail; batch restored')
      }
    } catch (error) {
      if (this.restoreOnSendFailure) {
        this.metricsBatcher.restoreFromPayload(payload)
      }
      this.logger.error('Failed to send metrics:', error)
    }
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
      // Sets pendingDrain so data recorded during an in-flight send is drained.
      await this.flush()
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
}

export type { UsageFlushBundle, MetricStatPayload }
