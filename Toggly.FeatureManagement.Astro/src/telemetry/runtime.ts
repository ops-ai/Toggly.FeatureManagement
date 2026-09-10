import {
  DEFAULT_METRICS_BASE_URL,
  DEFAULT_TELEMETRY_FETCH_TIMEOUT_MS,
  DEFAULT_TELEMETRY_FLUSH_MS,
  HttpsTelemetryClient,
  resolveMetricsBaseUrl,
  resolveTelemetryEnableFlag,
} from './https-client.js'
import { UsageBatcher, type UsageFlushBundle } from './usage-batcher.js'

/** Bound wait for request-scoped / signal close so hung flush cannot stall forever. */
export const REQUEST_SCOPED_CLOSE_TIMEOUT_MS = 2_000

export interface UsageSender {
  sendStats(request: Record<string, unknown>): Promise<unknown>
  close?(): void
}

/**
 * Minimal usage-only telemetry config for Astro SSR.
 * Full Metrics.SendMetrics parity is deferred (OPS-911 follow-up).
 */
export interface UsageTelemetryConfig {
  appKey: string
  environment: string
  metricsBaseUrl?: string
  enableUsageTracking?: boolean
  usageFlushInterval?: number
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
  /** Abort hanging HTTPS usage posts after this many ms (default: 5000). */
  fetchTimeoutMs?: number
}

export interface TelemetryLogger {
  debug: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

/**
 * Owns the usage batcher, flush timer, and soft-fail HTTPS restore.
 * Metrics batching is intentionally omitted for this Astro slice.
 */
export class UsageTelemetryRuntime {
  private usageBatcher: UsageBatcher | null = null
  private usageClient: UsageSender | null = null
  private httpsClient: HttpsTelemetryClient | null = null
  private usageTimer: ReturnType<typeof setInterval> | null = null
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
      'appKey' | 'environment' | 'metricsBaseUrl' | 'enableUsageTracking' | 'usageFlushInterval'
    >
  > &
    Pick<
      UsageTelemetryConfig,
      'instanceName' | 'appVersion' | 'usageClient' | 'fetchImpl' | 'fetchTimeoutMs'
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
      usageFlushInterval: config.usageFlushInterval ?? DEFAULT_TELEMETRY_FLUSH_MS,
      instanceName: config.instanceName,
      appVersion: config.appVersion,
      usageClient: config.usageClient,
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

  start(): void {
    if (this.closed) return
    if (!this.config.enableUsageTracking) {
      return
    }

    if (this.config.usageClient !== undefined) {
      this.usageClient = this.config.usageClient
    } else {
      this.httpsClient = new HttpsTelemetryClient({
        metricsBaseUrl: this.config.metricsBaseUrl,
        fetchImpl: this.config.fetchImpl,
        fetchTimeoutMs: this.config.fetchTimeoutMs,
      })
      this.usageClient = {
        sendStats: async (request) => {
          const ok = await this.httpsClient!.sendUsageStats(
            request as unknown as Parameters<HttpsTelemetryClient['sendUsageStats']>[0],
          )
          return { ok }
        },
      }
    }

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

    if (this.attachProcessHandlers) {
      this.attachHandlers()
    }
  }

  static readonly SIGNAL_FLUSH_TIMEOUT_MS = REQUEST_SCOPED_CLOSE_TIMEOUT_MS
  static readonly REQUEST_SCOPED_CLOSE_TIMEOUT_MS = REQUEST_SCOPED_CLOSE_TIMEOUT_MS

  private attachHandlers(): void {
    if (typeof process === 'undefined' || typeof process.on !== 'function') {
      return
    }

    const flush = () => {
      void this.flush()
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
          const timer = setTimeout(resolve, UsageTelemetryRuntime.SIGNAL_FLUSH_TIMEOUT_MS)
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

  recordDefinitionCacheHit(): void {
    this.usageBatcher?.recordDefinitionCacheHit()
  }

  recordDefinitionCacheMiss(): void {
    this.usageBatcher?.recordDefinitionCacheMiss()
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
      }
    } finally {
      this.flushInFlight = null
      if (this.pendingDrain) {
        await this.flush()
      }
    }
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

  /**
   * Flush remaining usage and tear down. When `timeoutMs` is set, abandon the
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

    this.detachProcessHandlers()

    try {
      const flush = this.flush().catch(() => {
        // Soft-fail: close must not reject for telemetry errors.
      })
      const timeoutMs = options?.timeoutMs
      if (timeoutMs != null && timeoutMs >= 0) {
        await Promise.race([
          flush,
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, timeoutMs)
            timer.unref?.()
          }),
        ])
      } else {
        await flush
      }
    } finally {
      try {
        this.usageClient?.close?.()
      } catch {
        // ignore
      }
      this.usageClient = null
      this.httpsClient = null
      this.usageBatcher = null
    }
  }
}

export type { UsageFlushBundle }
