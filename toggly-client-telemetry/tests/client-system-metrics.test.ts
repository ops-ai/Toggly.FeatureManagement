import {
  ClientSystemMetricsCollector,
  attachBrowserExceptionSources,
  attachClientSystemMetrics,
  attachReactNativeExceptionSources,
  CLIENT_SYSTEM_METRICS_INTERVAL_MS,
  CLIENT_SYSTEM_METRICS_MAX_PENDING,
} from '../src/client-system-metrics';
import { createTelemetryReporter } from '../src/index';

describe('ClientSystemMetricsCollector', () => {
  it('does not emit until exceptions accumulate', () => {
    const gauges: Array<[string, number]> = [];
    const collector = new ClientSystemMetricsCollector({
      setGauge: (metric, value) => gauges.push([metric, value]),
      attachExceptionSources: () => () => {},
      sampler: () => [],
    });
    collector.start();
    collector.tick();
    expect(gauges).toHaveLength(0);
    collector.stop();
  });

  it('emits ExceptionCount and clears the window', () => {
    const gauges: Array<[string, number]> = [];
    const collector = new ClientSystemMetricsCollector({
      setGauge: (metric, value) => gauges.push([metric, value]),
      attachExceptionSources: (onException) => {
        onException();
        onException();
        return () => {};
      },
    });
    collector.start();
    collector.tick();
    expect(gauges).toEqual([['ExceptionCount', 2]]);
    collector.tick();
    expect(gauges).toHaveLength(1);
    collector.stop();
  });

  it('caps pending samples per metric', () => {
    const gauges: string[] = [];
    const collector = new ClientSystemMetricsCollector({
      setGauge: (metric) => gauges.push(metric),
      attachExceptionSources: () => () => {},
      sampler: () => [{ metric: 'ExceptionCount', value: 1 }],
    });
    collector.start();
    for (let i = 0; i < CLIENT_SYSTEM_METRICS_MAX_PENDING + 3; i++) collector.tick();
    expect(gauges).toHaveLength(CLIENT_SYSTEM_METRICS_MAX_PENDING);
    collector.onFlushed();
    collector.tick();
    expect(gauges).toHaveLength(CLIENT_SYSTEM_METRICS_MAX_PENDING + 1);
    collector.stop();
  });

  it('defaults to a 10s interval', () => {
    expect(CLIENT_SYSTEM_METRICS_INTERVAL_MS).toBe(10_000);
  });
});

describe('ClientSystemMetricsCollector long tasks', () => {
  it('emits LongTaskCount from the default sampler and clears on stop', () => {
    const gauges: Array<[string, number]> = [];
    const collector = new ClientSystemMetricsCollector({
      setGauge: (metric, value) => gauges.push([metric, value]),
      attachExceptionSources: () => () => {},
    });
    collector.start();
    (collector as unknown as { longTaskCount: number }).longTaskCount = 3;
    collector.tick();
    expect(gauges).toEqual([['LongTaskCount', 3]]);
    collector.stop();
    expect((collector as unknown as { longTaskCount: number }).longTaskCount).toBe(0);
  });

  it('ignores PerformanceObserver failures when attaching long tasks', () => {
    const Original = globalThis.PerformanceObserver;
    (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver = class {
      observe() {
        throw new Error('unsupported');
      }
      disconnect() {}
    };
    const collector = new ClientSystemMetricsCollector({
      setGauge: () => {},
      attachExceptionSources: () => () => {},
    });
    expect(() => collector.start()).not.toThrow();
    collector.stop();
    (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver = Original;
  });

  it('counts longtask entries from PerformanceObserver', () => {
    const Original = globalThis.PerformanceObserver;
    let callback: ((list: { getEntries: () => unknown[] }) => void) | undefined;
    (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver = class {
      constructor(cb: (list: { getEntries: () => unknown[] }) => void) {
        callback = cb;
      }
      observe() {}
      disconnect() {}
    };
    const gauges: Array<[string, number]> = [];
    const timers: Array<() => void> = [];
    const collector = new ClientSystemMetricsCollector({
      setGauge: (metric, value) => gauges.push([metric, value]),
      attachExceptionSources: () => () => {},
      setIntervalFn: ((fn: () => void) => {
        timers.push(fn);
        return { unref: () => {} } as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval,
      clearIntervalFn: (() => {}) as typeof clearInterval,
    });
    collector.start();
    callback?.({ getEntries: () => [{}, {}] });
    timers[0]?.();
    expect(gauges).toEqual([['LongTaskCount', 2]]);
    collector.stop();
    (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver = Original;
  });
});

describe('attachClientSystemMetrics', () => {
  it('does not start when systemMetrics is false', () => {
    const fetch = jest.fn();
    const reporter = createTelemetryReporter({ appKey: 'key', fetch, enableTelemetry: true });
    const detach = attachClientSystemMetrics(reporter, { systemMetrics: false, enableTelemetry: true });
    detach();
    reporter.dispose({ flush: false });
  });

  it('does not start when enableTelemetry is false', () => {
    const fetch = jest.fn();
    const reporter = createTelemetryReporter({ appKey: 'key', fetch, enableTelemetry: true });
    const detach = attachClientSystemMetrics(reporter, { systemMetrics: true, enableTelemetry: false });
    detach();
    reporter.dispose({ flush: false });
  });

  it('uses React Native exception sources when requested', () => {
    const previous = jest.fn();
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => {
        handler(new Error('boom'), true);
      },
    };
    const fetch = jest.fn().mockResolvedValue({ status: 202 });
    const reporter = createTelemetryReporter({ appKey: 'key', fetch, enableTelemetry: true });
    const detach = attachClientSystemMetrics(reporter, {
      systemMetrics: true,
      enableTelemetry: true,
      reactNativeExceptions: true,
      sampler: () => [],
    });
    detach();
    delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
    reporter.dispose({ flush: false });
  });

  it('resets pending cap after reporter flush resolves', async () => {
    const fetch = jest.fn().mockResolvedValue({ status: 202 });
    const reporter = createTelemetryReporter({ appKey: 'key', fetch, enableTelemetry: true });
    const detach = attachClientSystemMetrics(reporter, {
      systemMetrics: true,
      enableTelemetry: true,
      sampler: () => [{ metric: 'ExceptionCount', value: 1 }],
    });
    for (let i = 0; i < CLIENT_SYSTEM_METRICS_MAX_PENDING; i++) {
      reporter.setGauge('manual', 1);
    }
    await reporter.flush();
    reporter.setGauge('manual', 1);
    detach();
    reporter.dispose({ flush: false });
  });

  it('posts sampler gauges through the reporter on each interval tick', async () => {
    const fetch = jest.fn().mockResolvedValue({ status: 202 });
    const reporter = createTelemetryReporter({ appKey: 'key', fetch, enableTelemetry: true });
    let intervalFn: (() => void) | undefined;
    const detach = attachClientSystemMetrics(reporter, {
      systemMetrics: true,
      enableTelemetry: true,
      sampler: () => [{ metric: 'ExceptionCount', value: 4 }],
      setIntervalFn: ((fn: () => void) => {
        intervalFn = fn;
        return { unref: () => {} } as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval,
      clearIntervalFn: (() => {}) as typeof clearInterval,
    });
    intervalFn?.();
    await reporter.flush();
    expect(fetch).toHaveBeenCalled();
    detach();
    detach();
    reporter.dispose({ flush: false });
  });
});

describe('attachBrowserExceptionSources', () => {
  it('listens for error and unhandledrejection', () => {
    const listeners = new Map<string, EventListener>();
    const fakeWindow = {
      addEventListener: (type: string, handler: EventListener) => {
        listeners.set(type, handler);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    };
    (globalThis as { window?: unknown }).window = fakeWindow;

    let count = 0;
    const detach = attachBrowserExceptionSources(() => {
      count += 1;
    });
    listeners.get('error')?.(new Event('error'));
    listeners.get('unhandledrejection')?.(new Event('unhandledrejection'));
    expect(count).toBe(2);
    detach();
    expect(listeners.size).toBe(0);
    delete (globalThis as { window?: unknown }).window;
  });

  it('is a no-op when window is undefined', () => {
    delete (globalThis as { window?: unknown }).window;
    const detach = attachBrowserExceptionSources(() => {});
    detach();
  });
});

describe('attachReactNativeExceptionSources', () => {
  it('chains the previous ErrorUtils handler', () => {
    const previous = jest.fn();
    const next = jest.fn();
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => {
        handler(new Error('boom'), true);
        next.mockImplementation(handler);
      },
    };
    let count = 0;
    const detach = attachReactNativeExceptionSources(() => {
      count += 1;
    });
    expect(count).toBe(1);
    expect(previous).toHaveBeenCalled();
    detach();
    delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
  });
});
