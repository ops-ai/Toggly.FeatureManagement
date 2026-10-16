import type { TelemetryReporter } from './types.js';

export const CLIENT_SYSTEM_METRICS_INTERVAL_MS = 10_000;
export const CLIENT_SYSTEM_METRICS_MAX_PENDING = 30;

export type ClientSystemMetricObservation = { metric: string; value: number };

export type ClientSystemMetricsSampler = () => ClientSystemMetricObservation[];

export type ClientSystemMetricsSetGauge = (metric: string, value: number) => void;

/** Timer handle without referencing DOM/Node globals in published .d.ts. */
export type ClientSystemMetricsTimerHandle = { unref?: () => void };

export type ClientSystemMetricsSetInterval = (
  handler: () => void,
  ms: number,
) => ClientSystemMetricsTimerHandle;

export type ClientSystemMetricsClearInterval = (
  handle: ClientSystemMetricsTimerHandle,
) => void;

/** Minimal long-task observer surface (avoids PerformanceObserver in .d.ts). */
type LongTaskObserver = { disconnect: () => void; observe: (options: { type: string; buffered: boolean }) => void };

export interface ClientSystemMetricsCollectorOptions {
  setGauge: ClientSystemMetricsSetGauge;
  intervalMs?: number;
  sampler?: ClientSystemMetricsSampler;
  now?: () => number;
  setIntervalFn?: ClientSystemMetricsSetInterval;
  clearIntervalFn?: ClientSystemMetricsClearInterval;
  attachExceptionSources?: (onException: () => void) => () => void;
}

/** Opt-in browser/RN-friendly metrics: ExceptionCount and optional LongTaskCount. */
export class ClientSystemMetricsCollector {
  private readonly setGauge: ClientSystemMetricsSetGauge;
  private readonly intervalMs: number;
  private readonly sampler: ClientSystemMetricsSampler;
  private readonly now: () => number;
  private readonly setIntervalFn: ClientSystemMetricsSetInterval;
  private readonly clearIntervalFn: ClientSystemMetricsClearInterval;
  private readonly attachExceptionSources?: ClientSystemMetricsCollectorOptions['attachExceptionSources'];
  private timer: ClientSystemMetricsTimerHandle | null = null;
  private started = false;
  private exceptionCount = 0;
  private longTaskCount = 0;
  private longTaskObserver: LongTaskObserver | null = null;
  private detachExceptionSources: (() => void) | undefined;
  private pendingByMetric = new Map<string, number>();

  constructor(options: ClientSystemMetricsCollectorOptions) {
    this.setGauge = options.setGauge;
    this.intervalMs = options.intervalMs ?? CLIENT_SYSTEM_METRICS_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    // Native browser timers require the Window/WorkerGlobalScope receiver.
    this.setIntervalFn =
      options.setIntervalFn ??
      (globalThis.setInterval.bind(globalThis) as ClientSystemMetricsSetInterval);
    this.clearIntervalFn =
      options.clearIntervalFn ??
      (globalThis.clearInterval.bind(globalThis) as ClientSystemMetricsClearInterval);
    this.attachExceptionSources = options.attachExceptionSources;
    this.sampler = options.sampler ?? (() => this.defaultSample());
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const onException = () => {
      this.exceptionCount += 1;
    };
    if (this.attachExceptionSources) {
      this.detachExceptionSources = this.attachExceptionSources(onException);
    } else {
      this.detachExceptionSources = attachBrowserExceptionSources(onException);
    }
    this.attachLongTaskObserver();
    this.timer = this.setIntervalFn(() => {
      this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.timer) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
    this.detachExceptionSources?.();
    this.detachExceptionSources = undefined;
    this.detachLongTaskObserver();
    this.pendingByMetric.clear();
  }

  tick(): void {
    if (!this.started) return;
    try {
      for (const { metric, value } of this.sampler()) {
        if (!Number.isFinite(value)) continue;
        const pending = this.pendingByMetric.get(metric) ?? 0;
        if (pending >= CLIENT_SYSTEM_METRICS_MAX_PENDING) continue;
        this.pendingByMetric.set(metric, pending + 1);
        this.setGauge(metric, value);
      }
    } catch {
      // Never disrupt the host application.
    }
  }

  onFlushed(): void {
    this.pendingByMetric.clear();
  }

  private defaultSample(): ClientSystemMetricObservation[] {
    const out: ClientSystemMetricObservation[] = [];
    if (this.exceptionCount > 0) {
      out.push({ metric: 'ExceptionCount', value: this.exceptionCount });
      this.exceptionCount = 0;
    }
    if (this.longTaskCount > 0) {
      out.push({ metric: 'LongTaskCount', value: this.longTaskCount });
      this.longTaskCount = 0;
    }
    return out;
  }

  private attachLongTaskObserver(): void {
    const Observer = (globalThis as { PerformanceObserver?: new (cb: (list: { getEntries: () => unknown[] }) => void) => LongTaskObserver }).PerformanceObserver;
    if (typeof Observer !== 'function') return;
    try {
      this.longTaskObserver = new Observer((list) => {
        this.longTaskCount += list.getEntries().length;
      });
      this.longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch {
      this.longTaskObserver = null;
    }
  }

  private detachLongTaskObserver(): void {
    try {
      this.longTaskObserver?.disconnect();
    } catch {
      // ignore
    }
    this.longTaskObserver = null;
    this.longTaskCount = 0;
  }
}

export function attachBrowserExceptionSources(onException: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const errorHandler = () => {
    onException();
  };
  const rejectionHandler = () => {
    onException();
  };
  window.addEventListener('error', errorHandler);
  window.addEventListener('unhandledrejection', rejectionHandler);
  return () => {
    window.removeEventListener('error', errorHandler);
    window.removeEventListener('unhandledrejection', rejectionHandler);
  };
}

type ReactNativeErrorUtils = {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

declare global {
  // eslint-disable-next-line no-var
  var ErrorUtils: ReactNativeErrorUtils | undefined;
}

/** Chain React Native's global JS error handler without replacing app behavior. */
export function attachReactNativeExceptionSources(onException: () => void): () => void {
  const utils = globalThis.ErrorUtils;
  if (!utils?.setGlobalHandler) return () => {};
  const previous = utils.getGlobalHandler?.();
  utils.setGlobalHandler((error, isFatal) => {
    onException();
    previous?.(error, isFatal);
  });
  return () => {
    if (utils.setGlobalHandler) utils.setGlobalHandler(previous ?? (() => {}));
  };
}

export interface AttachClientSystemMetricsOptions {
  systemMetrics?: boolean;
  enableTelemetry?: boolean;
  intervalMs?: number;
  reactNativeExceptions?: boolean;
  sampler?: ClientSystemMetricsSampler;
  now?: () => number;
  setIntervalFn?: ClientSystemMetricsSetInterval;
  clearIntervalFn?: ClientSystemMetricsClearInterval;
}

/** Start sampling when systemMetrics and telemetry are enabled; stop via returned detach. */
export function attachClientSystemMetrics(
  reporter: TelemetryReporter,
  options: AttachClientSystemMetricsOptions,
): () => void {
  if (options.systemMetrics !== true || options.enableTelemetry === false) {
    return () => {};
  }
  const collector = new ClientSystemMetricsCollector({
    // ExceptionCount / LongTaskCount are per-window deltas — counters sum
    // across ticks in one flush; gauges would overwrite earlier samples.
    setGauge: (metric, value) => {
      if (metric === 'ExceptionCount' || metric === 'LongTaskCount') {
        reporter.incrementCounter(metric, value);
      } else {
        reporter.setGauge(metric, value);
      }
    },
    intervalMs: options.intervalMs,
    sampler: options.sampler,
    now: options.now,
    setIntervalFn: options.setIntervalFn,
    clearIntervalFn: options.clearIntervalFn,
    attachExceptionSources: options.reactNativeExceptions
      ? attachReactNativeExceptionSources
      : undefined,
  });
  collector.start();
  const originalFlush = reporter.flush.bind(reporter);
  let active = true;
  (reporter as TelemetryReporter & { flush: typeof reporter.flush }).flush = (flushOptions) =>
    originalFlush(flushOptions).then(() => {
      if (active) collector.onFlushed();
    });
  return () => {
    if (!active) return;
    active = false;
    (reporter as TelemetryReporter & { flush: typeof reporter.flush }).flush = originalFlush;
    collector.stop();
  };
}
