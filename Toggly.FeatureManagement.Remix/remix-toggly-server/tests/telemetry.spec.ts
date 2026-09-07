/**
 * Server client usage + metrics telemetry wiring [OPS-923]
 */

import { TogglyServerClient } from '../src/client';
import type { UsageSender, MetricsSender } from '@ops-ai/remix-toggly-core';

jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(),
    removeAllListeners: jest.fn(),
    send: jest.fn(),
    readyState: 1,
  }));
});

describe('TogglyServerClient telemetry', () => {
  const prevKill = process.env.TOGGLY_DISABLE_TELEMETRY;

  afterEach(() => {
    if (prevKill === undefined) {
      delete process.env.TOGGLY_DISABLE_TELEMETRY;
    } else {
      process.env.TOGGLY_DISABLE_TELEMETRY = prevKill;
    }
  });

  it('records checks when usage tracking is enabled', async () => {
    const sendStats = jest.fn().mockResolvedValue({});
    const usageClient: UsageSender = { sendStats, close: jest.fn() };
    const metricsClient: MetricsSender = {
      sendMetrics: jest.fn().mockResolvedValue({}),
      close: jest.fn(),
    };

    const client = new TogglyServerClient({
      appKey: 'app',
      environment: 'Production',
      featureDefaults: { FeatureA: true },
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      telemetryAttachProcessHandlers: false,
      usageClient,
      metricsClient,
    });

    await client.init();
    await client.isEnabled('FeatureA', { identity: 'user-1' });
    await client.flushTelemetry();

    expect(sendStats).toHaveBeenCalled();
    const payload = sendStats.mock.calls[0][0] as {
      stats: Array<{
        feature: string;
        variantStats: Record<string, { checkCount: number }>;
      }>;
    };
    expect(payload.stats[0].feature).toBe('FeatureA');
    expect(payload.stats[0].variantStats.enabled.checkCount).toBe(1);

    client.close();
    await new Promise((resolve) => setImmediate(resolve));
    expect(usageClient.close).toHaveBeenCalled();
  });

  it('does not start telemetry when TOGGLY_DISABLE_TELEMETRY=1', async () => {
    process.env.TOGGLY_DISABLE_TELEMETRY = '1';
    const sendStats = jest.fn().mockResolvedValue({});

    const client = new TogglyServerClient({
      appKey: 'app',
      environment: 'Production',
      featureDefaults: { FeatureA: true },
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      telemetryAttachProcessHandlers: false,
      usageClient: { sendStats, close: jest.fn() },
      metricsClient: { sendMetrics: jest.fn(), close: jest.fn() },
    });

    await client.init();
    await client.isEnabled('FeatureA');
    client.measure('revenue', 1);
    await client.flushTelemetry();
    expect(sendStats).not.toHaveBeenCalled();
    client.close();
  });

  it('exposes measure / counter / observe / recordUsage / recordView', async () => {
    const sendStats = jest.fn().mockResolvedValue({});
    const sendMetrics = jest.fn().mockResolvedValue({});

    const client = new TogglyServerClient({
      appKey: 'app',
      environment: 'Production',
      featureDefaults: { FeatureA: true },
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      telemetryAttachProcessHandlers: false,
      usageClient: { sendStats, close: jest.fn() },
      metricsClient: { sendMetrics, close: jest.fn() },
    });

    client.recordUsage('FeatureA', 'user-1');
    client.recordView('FeatureA', 'user-1');
    client.measure('revenue', 9, { feature: 'FeatureA' });
    client.incrementCounter('clicks');
    client.observe('depth', 2);
    await client.flushTelemetry();

    expect(sendStats).toHaveBeenCalled();
    expect(sendMetrics).toHaveBeenCalled();
    client.close();
  });

  it('records each gate key once', async () => {
    const sendStats = jest.fn().mockResolvedValue({});

    const client = new TogglyServerClient({
      appKey: 'app',
      environment: 'Production',
      featureDefaults: { A: true, B: false },
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      telemetryAttachProcessHandlers: false,
      usageClient: { sendStats, close: jest.fn() },
      metricsClient: null,
    });

    await client.init();
    await client.evaluateGate(['A', 'B'], 'any');
    await client.flushTelemetry();
    expect(sendStats).toHaveBeenCalled();
    const payload = sendStats.mock.calls[0][0] as {
      stats: Array<{ feature: string }>;
    };
    expect(payload.stats.map((s) => s.feature).sort()).toEqual(['A', 'B']);
    client.close();
  });
});
