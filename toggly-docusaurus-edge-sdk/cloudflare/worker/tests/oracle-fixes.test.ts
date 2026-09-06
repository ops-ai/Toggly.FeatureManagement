import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTelemetryFromEnv,
  getOrCreateTelemetry,
  resetTelemetrySingleton,
  RequestScopedUsageRecorder,
  wrapReadableWithCompletion,
  type Env,
} from '../src/index';

describe('package root public metrics API', () => {
  beforeEach(() => {
    resetTelemetrySingleton();
  });

  it('exposes measure / incrementCounter / observe via createTelemetryFromEnv', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const env = {
      TOGGLY_APP_KEY: 'app',
      TOGGLY_ENVIRONMENT: 'Production',
      TOGGLY_API_BASE_URL: 'https://definitions.example',
      ORIGIN_BASE_URL: 'https://origin.example',
      TOGGLY_METRICS_BASE_URL: 'https://app.toggly.io/',
      TOGGLY_METRICS_ENABLED: 'true',
      TOGGLY_USAGE_ENABLED: 'false',
    } satisfies Env;

    // Seed singleton with injectable fetch, then resolve via public helper.
    getOrCreateTelemetry({
      appKey: env.TOGGLY_APP_KEY,
      environment: env.TOGGLY_ENVIRONMENT,
      metricsBaseUrl: 'https://app.toggly.io/',
      enableUsageTracking: false,
      enableMetrics: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const telemetry = createTelemetryFromEnv(env);
    expect(telemetry).not.toBeNull();
    expect(telemetry!.isMetricsEnabled()).toBe(true);

    telemetry!.measure('revenue', 10, { feature: 'checkout', variant: 'enabled' });
    telemetry!.incrementCounter('clicks', 2);
    telemetry!.observe('gauge', 42, { variant: 'disabled' });

    await telemetry!.flush();

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://app.toggly.io/api/metrics',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(
      (fetchImpl.mock.calls[0]![1] as RequestInit).body as string,
    ) as {
      stats: Array<{ metric: string; variantValues: Record<string, number> }>;
      counters: Array<{ metric: string; variantValues: Record<string, number> }>;
      observations: Array<{ metric: string; variantValues: Record<string, number> }>;
    };
    expect(body.stats[0]!.metric).toBe('revenue');
    expect(body.stats[0]!.variantValues.enabled).toBe(10);
    expect(body.counters[0]!.variantValues.enabled).toBe(2);
    expect(body.observations[0]!.variantValues.disabled).toBe(42);
  });
});

describe('RequestScopedUsageRecorder', () => {
  beforeEach(() => {
    resetTelemetrySingleton();
  });

  it('keeps checkCount for every gate while requestCount stays unique', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const runtime = getOrCreateTelemetry({
      appKey: 'app',
      environment: 'Production',
      metricsBaseUrl: 'https://app.toggly.io/',
      enableUsageTracking: true,
      enableMetrics: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })!;

    const usage = new RequestScopedUsageRecorder(runtime);
    expect(usage.recordGate('Feat', true)).toBe(true);
    expect(usage.recordGate('Feat', true)).toBe(false);
    expect(usage.recordGate('Feat', true)).toBe(false);
    expect(usage.recordGate('Other', true)).toBe(true);
    expect(usage.recordGate('Feat', false)).toBe(true);

    await runtime.flush();
    const body = JSON.parse(
      (fetchImpl.mock.calls[0]![1] as RequestInit).body as string,
    ) as {
      stats: Array<{
        feature: string;
        variantStats: Record<string, { checkCount: number; requestCount: number }>;
      }>;
    };

    const byFeature = Object.fromEntries(body.stats.map((s) => [s.feature, s]));
    expect(byFeature.Feat!.variantStats.enabled!.checkCount).toBe(3);
    expect(byFeature.Feat!.variantStats.enabled!.requestCount).toBe(1);
    expect(byFeature.Feat!.variantStats.disabled!.checkCount).toBe(1);
    expect(byFeature.Feat!.variantStats.disabled!.requestCount).toBe(1);
    expect(byFeature.Other!.variantStats.enabled!.requestCount).toBe(1);
  });
});

describe('wrapReadableWithCompletion', () => {
  it('preserves chunk order and flushes only after consumer completes', async () => {
    const chunks = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];
    let readIndex = 0;
    const upstream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (readIndex >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(chunks[readIndex++]!);
      },
    });

    const onComplete = vi.fn().mockResolvedValue(undefined);
    const waitUntil = vi.fn((p: Promise<unknown>) => p);

    const wrapped = wrapReadableWithCompletion(upstream, onComplete, waitUntil);
    const reader = wrapped.getReader();

    expect(onComplete).not.toHaveBeenCalled();

    const received: number[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received.push(value![0]!);
      // Completion scheduled only after the stream closes (final pull).
      if (received.length < 3) {
        expect(onComplete).not.toHaveBeenCalled();
      }
    }

    expect(received).toEqual([1, 2, 3]);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]![0];
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('schedules completion when the consumer cancels early', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([9]));
      },
    });

    const onComplete = vi.fn().mockResolvedValue(undefined);
    const waitUntil = vi.fn((p: Promise<unknown>) => p);
    const wrapped = wrapReadableWithCompletion(upstream, onComplete, waitUntil);
    const reader = wrapped.getReader();
    await reader.read();
    await reader.cancel('client-abort');

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]![0];
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('getOrCreateTelemetry config change', () => {
  beforeEach(() => {
    resetTelemetrySingleton();
  });

  it('flushes the previous isolate runtime when config key changes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const first = getOrCreateTelemetry({
      appKey: 'app-a',
      environment: 'Production',
      metricsBaseUrl: 'https://app.toggly.io/',
      enableUsageTracking: true,
      enableMetrics: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(first).not.toBeNull();
    first!.recordCheck('feat', true);

    const second = getOrCreateTelemetry({
      appKey: 'app-b',
      environment: 'Production',
      metricsBaseUrl: 'https://app.toggly.io/',
      enableUsageTracking: true,
      enableMetrics: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);

    // Fire-and-forget flush of the previous runtime — wait a tick for it.
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalled();
    });
    const usageCalls = fetchImpl.mock.calls.filter(
      (c) => typeof c[0] === 'string' && String(c[0]).includes('api/usage/stats'),
    );
    expect(usageCalls.length).toBeGreaterThanOrEqual(1);
  });
});
