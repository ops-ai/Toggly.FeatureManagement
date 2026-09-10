import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashIdentity } from '../src/telemetry/hash';
import { UsageBatcher } from '../src/telemetry/usage-batcher';
import { MetricsBatcher } from '../src/telemetry/metrics-batcher';
import { HttpsTelemetryClient } from '../src/telemetry/https-client';
import {
  TelemetryRuntime,
  parseBoolEnv,
  resolveMetricsBaseUrl,
  resetTelemetrySingleton,
} from '../src/telemetry/runtime';
import { WORKER_USER_AGENT } from '../src/telemetry/version';

describe('hashIdentity', () => {
  it('uses UTF-8 FNV-1a signed int32 (Go-compatible)', () => {
    expect(hashIdentity('alice')).toBe(-2027809817);
    expect(hashIdentity('café')).toBe(-1473556407);
    expect(hashIdentity('🚀')).toBe(2141686490);
    expect(hashIdentity('alice')).toBe(hashIdentity('alice'));
    expect(hashIdentity('alice')).not.toBe(hashIdentity('bob'));
  });

  it('differs from UTF-16 code-unit hashing for multi-byte strings', () => {
    const value = 'café';
    let utf16Style = 2166136261;
    for (let i = 0; i < value.length; i++) {
      utf16Style ^= value.charCodeAt(i);
      utf16Style = Math.imul(utf16Style, 16777619);
    }
    const unsigned = utf16Style >>> 0;
    const utf16Signed = unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
    expect(hashIdentity(value)).not.toBe(utf16Signed);
  });
});

describe('UsageBatcher', () => {
  it('aggregates checks into variantStats enabled/disabled', () => {
    const batcher = new UsageBatcher({
      appKey: 'app',
      environment: 'Production',
      instanceName: 'worker-1',
      appVersion: '0.2.0',
    });

    batcher.recordCheck('FeatureA', true, 'user-1');
    batcher.recordCheck('FeatureA', true, 'user-1');
    batcher.recordCheck('FeatureA', false, 'user-2');
    batcher.recordUsage('FeatureA', 'user-1');
    batcher.recordView('FeatureA', 'user-3');

    const payload = batcher.buildAndReset();
    expect(payload).not.toBeNull();
    expect(payload!.payload.appKey).toBe('app');
    expect(typeof payload!.payload.time).toBe('string');
    expect(payload!.payload.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload!.payload.processStartTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const stat = payload!.payload.stats[0]!;
    expect(stat.variantStats.enabled!.checkCount).toBe(2);
    expect(stat.variantStats.enabled!.requestCount).toBe(0);
    expect(stat.variantStats.enabled!.usedCount).toBe(1);
    expect(stat.variantStats.enabled!.viewedCount).toBe(1);
    expect(stat.variantStats.disabled!.checkCount).toBe(1);
    expect(stat.uniqueUserHashes).toContain(hashIdentity('user-1'));
    expect(stat.uniqueViewedUserHashes).toContain(hashIdentity('user-3'));
    expect(batcher.buildAndReset()).toBeNull();
  });

  it('increments requestCount only when uniqueRequest is true', () => {
    const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' });
    batcher.recordCheck('FeatureA', true, 'user-1', undefined, true);
    batcher.recordCheck('FeatureA', true, 'user-1', undefined, false);
    batcher.recordCheck('FeatureA', false, 'user-2', undefined, true);

    const payload = batcher.buildAndReset();
    expect(payload!.payload.stats[0]!.variantStats.enabled!.checkCount).toBe(2);
    expect(payload!.payload.stats[0]!.variantStats.enabled!.requestCount).toBe(1);
    expect(payload!.payload.stats[0]!.variantStats.disabled!.requestCount).toBe(1);
  });

  it('enforces unique hash and feature caps', () => {
    const batcher = new UsageBatcher({
      appKey: 'app',
      environment: 'Production',
      maxUniqueHashesPerFeature: 2,
      maxApplicationUniqueHashes: 2,
      maxFeatures: 1,
    });

    batcher.recordUsage('OnlyFeature', 'u1');
    batcher.recordUsage('OnlyFeature', 'u2');
    batcher.recordUsage('OnlyFeature', 'u3'); // capped
    batcher.recordCheck('DroppedFeature', true, 'u4'); // feature cap

    expect(batcher.hitFeatureCap()).toBe(true);
    const payload = batcher.buildAndReset();
    expect(payload!.payload.stats).toHaveLength(1);
    expect(payload!.payload.stats[0]!.feature).toBe('OnlyFeature');
    expect(payload!.payload.stats[0]!.uniqueUserHashes).toHaveLength(2);
    expect(payload!.payload.uniqueUserHashes).toHaveLength(2);
  });

  it('restores payload after failed send', () => {
    const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' });
    batcher.recordCheck('F', true);
    const bundle = batcher.buildAndReset()!;
    expect(batcher.isEmpty()).toBe(true);
    batcher.restoreFromPayload(bundle);
    expect(batcher.isEmpty()).toBe(false);
    const again = batcher.buildAndReset()!;
    expect(again.payload.stats[0]!.variantStats.enabled!.checkCount).toBe(1);
  });

  it('restores enabled/disabled/used uniqueness sets (not only wire counts)', () => {
    const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' });
    batcher.recordCheck('Feat', true, 'alice');
    batcher.recordCheck('Feat', false, 'bob');
    batcher.recordUsage('Feat', 'carol');

    const bundle = batcher.buildAndReset()!;
    expect(bundle.payload.stats[0]!.uniqueContextIdentifierEnabledCount).toBe(1);
    expect(bundle.payload.stats[0]!.uniqueContextIdentifierDisabledCount).toBe(1);
    expect(bundle.payload.stats[0]!.uniqueUsersUsedCount).toBe(1);
    expect(bundle.uniqueUsersEnabled.Feat).toEqual([hashIdentity('alice')]);
    expect(bundle.uniqueUsersDisabled.Feat).toEqual([hashIdentity('bob')]);
    expect(bundle.uniqueUsersUsed.Feat).toEqual([hashIdentity('carol')]);

    // Simulate a concurrent record after drain, then soft-fail restore (union-merge).
    batcher.recordCheck('Feat', true, 'dave');
    batcher.restoreFromPayload(bundle);

    const restored = batcher.buildAndReset()!;
    expect(restored.payload.stats[0]!.uniqueContextIdentifierEnabledCount).toBe(2); // alice+dave
    expect(restored.payload.stats[0]!.uniqueContextIdentifierDisabledCount).toBe(1); // bob
    expect(restored.payload.stats[0]!.uniqueUsersUsedCount).toBe(1); // carol
    expect(restored.uniqueUsersEnabled.Feat).toEqual(
      expect.arrayContaining([hashIdentity('alice'), hashIdentity('dave')])
    );
    expect(restored.uniqueUsersDisabled.Feat).toEqual([hashIdentity('bob')]);
    expect(restored.uniqueUsersUsed.Feat).toEqual([hashIdentity('carol')]);
    // Variant counts: restored check (alice enabled + bob disabled) + dave enabled
    expect(restored.payload.stats[0]!.variantStats.enabled!.checkCount).toBe(2);
    expect(restored.payload.stats[0]!.variantStats.disabled!.checkCount).toBe(1);
    expect(restored.payload.stats[0]!.variantStats.enabled!.usedCount).toBe(1);
  });

  it('includes definitionCacheHits/Misses on flush payload', () => {
    const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' });
    batcher.recordDefinitionCacheHit();
    batcher.recordDefinitionCacheHit();
    batcher.recordDefinitionCacheMiss();

    const bundle = batcher.buildAndReset()!;
    expect(bundle.payload.definitionCacheHits).toBe(2);
    expect(bundle.payload.definitionCacheMisses).toBe(1);
    expect(bundle.payload.stats).toEqual([]);
    expect(batcher.isEmpty()).toBe(true);
    expect(batcher.buildAndReset()).toBeNull();
  });

  it('flushes cache-only batches (hits/misses alone are enough)', () => {
    const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' });
    expect(batcher.isEmpty()).toBe(true);
    batcher.recordDefinitionCacheHit();
    expect(batcher.isEmpty()).toBe(false);
    const bundle = batcher.buildAndReset()!;
    expect(bundle.payload.definitionCacheHits).toBe(1);
    expect(bundle.payload.definitionCacheMisses).toBeUndefined();
  });

  it('restores definition cache counters and merges in-flight after failed send', () => {
    const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' });
    batcher.recordDefinitionCacheHit();
    batcher.recordDefinitionCacheMiss();
    const bundle = batcher.buildAndReset()!;
    expect(batcher.isEmpty()).toBe(true);

    // In-flight while send fails
    batcher.recordDefinitionCacheHit();
    batcher.restoreFromPayload(bundle);

    const again = batcher.buildAndReset()!;
    expect(again.payload.definitionCacheHits).toBe(2); // restored 1 + in-flight 1
    expect(again.payload.definitionCacheMisses).toBe(1);
  });
});

describe('MetricsBatcher', () => {
  it('aggregates into variantValues maps', () => {
    const batcher = new MetricsBatcher({ appKey: 'app', environment: 'Production' });
    batcher.measure('revenue', 10, { feature: 'checkout', variant: 'enabled' });
    batcher.measure('revenue', 5, { feature: 'checkout', variant: 'enabled' });
    batcher.incrementCounter('clicks', 2);
    batcher.observe('gauge', 42, { variant: 'disabled' });

    const payload = batcher.buildAndReset();
    expect(payload).not.toBeNull();
    expect(typeof payload!.time).toBe('string');
    expect(payload!.stats[0]!.variantValues.enabled).toBe(15);
    expect(payload!.counters[0]!.variantValues.enabled).toBe(2);
    expect(payload!.observations[0]!.variantValues.disabled).toBe(42);
    expect(payload!.observations[0]!.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('HttpsTelemetryClient', () => {
  it('posts to api/usage/stats and api/metrics with worker UA', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const client = new HttpsTelemetryClient({
      metricsBaseUrl: 'https://app.toggly.io',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.sendUsageStats({ appKey: 'a' });
    await client.sendMetrics({ appKey: 'a' });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://app.toggly.io/api/usage/stats');
    expect(fetchImpl.mock.calls[1]![0]).toBe('https://app.toggly.io/api/metrics');

    const usageInit = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect((usageInit.headers as Record<string, string>)['User-Agent']).toBe(
      WORKER_USER_AGENT
    );
  });

  it('soft-fails network errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
    const client = new HttpsTelemetryClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.sendUsageStats({})).resolves.toBe(false);
  });
});

describe('TelemetryRuntime', () => {
  beforeEach(() => {
    resetTelemetrySingleton();
  });

  it('flushes via waitUntil sink without throwing on soft-fail', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      metricsBaseUrl: 'https://app.toggly.io/',
      enableUsageTracking: true,
      enableMetrics: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    runtime.recordCheck('Feat', true, 'user-1');
    runtime.measure('m', 1);

    const waitUntil = vi.fn((p: Promise<unknown>) => p);
    runtime.scheduleFlush(waitUntil);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]![0];

    // Soft-fail restores batch
    expect(runtime.usagePending()).toBe(true);
    expect(runtime.metricsPending()).toBe(true);
  });

  it('clears batches after successful flush', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      metricsBaseUrl: 'https://app.toggly.io/',
      enableUsageTracking: true,
      enableMetrics: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    runtime.recordCheck('Feat', true);
    await runtime.flush();
    expect(runtime.usagePending()).toBe(false);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://app.toggly.io/api/usage/stats',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('flushes cache-only definition hits via runtime and restores on soft-fail', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ ok: true });
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      metricsBaseUrl: 'https://app.toggly.io/',
      enableUsageTracking: true,
      enableMetrics: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    runtime.recordDefinitionCacheHit();
    runtime.recordDefinitionCacheMiss();
    await runtime.flush();
    expect(runtime.usagePending()).toBe(true);

    // In-flight while restored
    runtime.recordDefinitionCacheHit();
    await runtime.flush();
    expect(runtime.usagePending()).toBe(false);

    const body = JSON.parse(
      (fetchImpl.mock.calls[1]![1] as RequestInit).body as string
    ) as { definitionCacheHits: number; definitionCacheMisses: number };
    expect(body.definitionCacheHits).toBe(2);
    expect(body.definitionCacheMisses).toBe(1);
  });

  it('drains again when records arrive during an in-flight flush', async () => {
    let resolveFirstSend!: (value: { ok: boolean }) => void;
    const firstSend = new Promise<{ ok: boolean }>((resolve) => {
      resolveFirstSend = resolve;
    });
    let sendCount = 0;
    const fetchImpl = vi.fn().mockImplementation(() => {
      sendCount += 1;
      if (sendCount === 1) {
        return firstSend;
      }
      return Promise.resolve({ ok: true });
    });

    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      metricsBaseUrl: 'https://app.toggly.io/',
      enableUsageTracking: true,
      enableMetrics: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    runtime.recordCheck('First', true, 'u1');
    const flush1 = runtime.flush();

    // Wait until first POST is in flight (batch already drained into payload).
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    // Concurrent records + flush while first send is pending.
    runtime.recordCheck('Second', true, 'u2');
    const flush2 = runtime.flush();

    resolveFirstSend({ ok: true });
    await Promise.all([flush1, flush2]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const bodies = fetchImpl.mock.calls.map(
      (call) => JSON.parse((call[1] as RequestInit).body as string) as {
        stats: Array<{ feature: string }>;
      }
    );
    const features = bodies.flatMap((b) => b.stats.map((s) => s.feature));
    expect(features).toEqual(expect.arrayContaining(['First', 'Second']));
    expect(runtime.usagePending()).toBe(false);
  });
});

describe('config helpers', () => {
  it('parseBoolEnv and resolveMetricsBaseUrl', () => {
    expect(parseBoolEnv(undefined, true)).toBe(true);
    expect(parseBoolEnv('false', true)).toBe(false);
    expect(parseBoolEnv('1', false)).toBe(true);
    expect(resolveMetricsBaseUrl(undefined)).toBe('https://app.toggly.io/');
    expect(resolveMetricsBaseUrl('https://custom.example')).toBe(
      'https://custom.example/'
    );
  });
});
