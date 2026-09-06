import { HttpsTelemetryClient, DEFAULT_METRICS_BASE_URL } from './https-client';
import { MetricsBatcher, type MetricsFeatureOptions } from './metrics-batcher';
import { UsageBatcher, MAX_FEATURES_PER_BATCH } from './usage-batcher';
import { WORKER_USER_AGENT, WORKER_VERSION } from './version';

export interface TelemetryConfig {
  appKey: string;
  environment: string;
  metricsBaseUrl: string;
  enableUsageTracking: boolean;
  enableMetrics: boolean;
  instanceName?: string;
  appVersion?: string;
  fetchImpl?: typeof fetch;
}

export interface TelemetryRuntimeOptions extends TelemetryConfig {
  processStartTime?: Date;
}

/**
 * Isolate-scoped usage + metrics batcher with soft-fail HTTPS flush.
 * Call {@link scheduleFlush} with `ctx.waitUntil` so responses stay unblocked.
 */
export class TelemetryRuntime {
  private readonly config: TelemetryConfig;
  private readonly client: HttpsTelemetryClient;
  private readonly usage: UsageBatcher;
  private readonly metrics: MetricsBatcher;
  private flushInFlight: Promise<void> | null = null;
  /** Set when flush() is requested during an in-flight drain; triggers another pass. */
  private pendingDrain = false;

  constructor(options: TelemetryRuntimeOptions) {
    this.config = options;
    this.client = new HttpsTelemetryClient({
      metricsBaseUrl: options.metricsBaseUrl,
      userAgent: WORKER_USER_AGENT,
      fetchImpl: options.fetchImpl,
    });
    const processStartTime = options.processStartTime ?? new Date();
    this.usage = new UsageBatcher({
      appKey: options.appKey,
      environment: options.environment,
      instanceName: options.instanceName ?? 'docusaurus-edge-worker',
      appVersion: options.appVersion ?? WORKER_VERSION,
      processStartTime,
    });
    this.metrics = new MetricsBatcher({
      appKey: options.appKey,
      environment: options.environment,
      instanceName: options.instanceName ?? 'docusaurus-edge-worker',
    });
  }

  isUsageEnabled(): boolean {
    return this.config.enableUsageTracking;
  }

  isMetricsEnabled(): boolean {
    return this.config.enableMetrics;
  }

  recordCheck(
    feature: string,
    enabled: boolean,
    identity?: string,
    uniqueRequest = true
  ): void {
    if (!this.config.enableUsageTracking) return;
    try {
      this.usage.recordCheck(feature, enabled, identity, undefined, uniqueRequest);
    } catch {
      // never break flag eval
    }
  }

  recordUsage(feature: string, identity?: string, variant = 'enabled'): void {
    if (!this.config.enableUsageTracking) return;
    try {
      this.usage.recordUsage(feature, identity, variant);
    } catch {
      // soft-fail
    }
  }

  recordView(feature: string, identity?: string, variant = 'enabled'): void {
    if (!this.config.enableUsageTracking) return;
    try {
      this.usage.recordView(feature, identity, variant);
    } catch {
      // soft-fail
    }
  }

  measure(metric: string, value: number, options?: MetricsFeatureOptions): void {
    if (!this.config.enableMetrics) return;
    try {
      this.metrics.measure(metric, value, options);
    } catch {
      // soft-fail
    }
  }

  incrementCounter(
    metric: string,
    value = 1,
    options?: MetricsFeatureOptions
  ): void {
    if (!this.config.enableMetrics) return;
    try {
      this.metrics.incrementCounter(metric, value, options);
    } catch {
      // soft-fail
    }
  }

  observe(metric: string, value: number, options?: MetricsFeatureOptions): void {
    if (!this.config.enableMetrics) return;
    try {
      this.metrics.observe(metric, value, options);
    } catch {
      // soft-fail
    }
  }

  /** True when in-memory caps suggest an immediate flush. */
  shouldFlushForCaps(): boolean {
    return this.usage.hitFeatureCap() || this.metrics.hitCap();
  }

  /**
   * Schedule a best-effort flush via Cloudflare `waitUntil` (or any Promise sink).
   * Does not await; safe to call from the request path.
   */
  scheduleFlush(waitUntil: (promise: Promise<unknown>) => void): void {
    if (!this.config.enableUsageTracking && !this.config.enableMetrics) {
      return;
    }
    waitUntil(this.flush());
  }

  /**
   * Single-flight flush with pending-drain follow-up.
   * Soft-fails network errors and restores batches on failure.
   * If flush() is called again while a drain is in flight, another drain runs
   * after the active one completes (records are not stranded on the first promise).
   */
  async flush(): Promise<void> {
    this.pendingDrain = true;
    if (this.flushInFlight) {
      return this.flushInFlight;
    }

    this.flushInFlight = this.drainUntilIdle();
    return this.flushInFlight;
  }

  private async drainUntilIdle(): Promise<void> {
    try {
      while (this.pendingDrain) {
        this.pendingDrain = false;
        await this.flushInternal();
      }
    } finally {
      this.flushInFlight = null;
      // Race: another flush() set pendingDrain after the while check but while
      // we still owned inFlight — start a follow-up drain and await it so every
      // waiter on this promise observes the extra pass.
      if (this.pendingDrain) {
        await this.flush();
      }
    }
  }

  private async flushInternal(): Promise<void> {
    const usageBundle =
      this.config.enableUsageTracking && !this.usage.isEmpty()
        ? this.usage.buildAndReset()
        : null;
    const metricsPayload =
      this.config.enableMetrics && !this.metrics.isEmpty()
        ? this.metrics.buildAndReset()
        : null;

    if (usageBundle) {
      const ok = await this.client.sendUsageStats(usageBundle.payload);
      if (!ok) {
        this.usage.restoreFromPayload(usageBundle);
      }
    }

    if (metricsPayload) {
      const ok = await this.client.sendMetrics(metricsPayload);
      if (!ok) {
        this.metrics.restoreFromPayload(metricsPayload);
      }
    }
  }

  /** Test helper: peek whether usage batch has data. */
  usagePending(): boolean {
    return !this.usage.isEmpty();
  }

  /** Test helper. */
  metricsPending(): boolean {
    return !this.metrics.isEmpty();
  }

  featureCount(): number {
    return this.usage.featureCount();
  }

  maxFeatures(): number {
    return MAX_FEATURES_PER_BATCH;
  }
}

export function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

export function resolveMetricsBaseUrl(raw?: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return DEFAULT_METRICS_BASE_URL;
  }
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/** Module-level isolate singleton so batches can accumulate across requests. */
let isolateRuntime: TelemetryRuntime | null = null;
let isolateKey: string | null = null;
const isolateStart = new Date();

export function getOrCreateTelemetry(config: TelemetryConfig): TelemetryRuntime | null {
  if (!config.enableUsageTracking && !config.enableMetrics) {
    return null;
  }
  if (!config.appKey) {
    return null;
  }

  const key = [
    config.appKey,
    config.environment,
    config.metricsBaseUrl,
    String(config.enableUsageTracking),
    String(config.enableMetrics),
  ].join('|');

  if (!isolateRuntime || isolateKey !== key) {
    const previous = isolateRuntime;
    isolateRuntime = new TelemetryRuntime({
      ...config,
      processStartTime: isolateStart,
    });
    isolateKey = key;
    // Best-effort flush of the prior isolate buffer when config changes mid-isolate.
    // Soft-fail lives inside flush(); fire-and-forget keeps this sync for callers.
    if (previous) {
      void previous.flush();
    }
  }
  return isolateRuntime;
}

/** Reset isolate singleton (tests). */
export function resetTelemetrySingleton(): void {
  isolateRuntime = null;
  isolateKey = null;
}
