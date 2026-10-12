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

describe('attachClientSystemMetrics', () => {
  it('does not start when systemMetrics is false', () => {
    const fetch = jest.fn();
    const reporter = createTelemetryReporter({ appKey: 'key', fetch, enableTelemetry: true });
    const detach = attachClientSystemMetrics(reporter, { systemMetrics: false, enableTelemetry: true });
    detach();
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
});

describe('attachBrowserExceptionSources', () => {
  it('listens for error and unhandledrejection', () => {
    if (typeof window === 'undefined') return;
    let count = 0;
    const detach = attachBrowserExceptionSources(() => {
      count += 1;
    });
    window.dispatchEvent(new Event('error'));
    window.dispatchEvent(new Event('unhandledrejection'));
    expect(count).toBe(2);
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
