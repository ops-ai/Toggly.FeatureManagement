/**
 * Definition-refresh cache hit/miss telemetry [OPS-997]
 */

import { TogglyServerClient } from '../src/client';
import type { UsageSender, MetricsSender } from '@ops-ai/remix-toggly-core';
import { mockDefsFetchResponse } from './defs-helpers';

const mockFetch = jest.fn();
global.fetch = mockFetch;

let wsHandlers: Record<string, (...args: unknown[]) => void> = {};

jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => {
    wsHandlers = {};
    return {
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        wsHandlers[event] = handler;
      }),
      close: jest.fn(),
      removeAllListeners: jest.fn(),
      send: jest.fn(),
      readyState: 1,
    };
  });
});

function okWithRevision(flags: Record<string, boolean>, revision: string) {
  return mockDefsFetchResponse(flags, {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'etag' || name.toLowerCase() === 'x-definitions-revision'
          ? `"${revision}"`
          : null,
    },
  });
}

function notModified(revision?: string) {
  return {
    ok: false,
    status: 304,
    statusText: 'Not Modified',
    headers: {
      get: (name: string) =>
        revision &&
        (name.toLowerCase() === 'etag' || name.toLowerCase() === 'x-definitions-revision')
          ? `"${revision}"`
          : null,
    },
  };
}

function telemetryOptions(sendStats: jest.Mock) {
  const usageClient: UsageSender = { sendStats, close: jest.fn() };
  const metricsClient: MetricsSender = {
    sendMetrics: jest.fn().mockResolvedValue({}),
    close: jest.fn(),
  };
  return {
    appKey: 'test-app',
    environment: 'Production',
    enableUsageTracking: true,
    enableMetrics: false,
    usageFlushInterval: 0,
    metricsFlushInterval: 0,
    telemetryAttachProcessHandlers: false,
    usageClient,
    metricsClient,
  };
}

describe('definition cache hit telemetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    wsHandlers = {};
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('records a miss on new 200 revision and a hit on 304', async () => {
    mockFetch
      .mockResolvedValueOnce(okWithRevision({ 'feature-a': true }, 'rev-1'))
      .mockResolvedValueOnce(notModified('rev-1'));

    const sendStats = jest.fn().mockResolvedValue({ featureCount: 0 });
    const client = new TogglyServerClient(telemetryOptions(sendStats));

    await client.init();
    await client.fetchFlags();
    await client.flushTelemetry();

    expect(sendStats).toHaveBeenCalled();
    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number;
      definitionCacheMisses?: number;
    };
    expect(payload.definitionCacheMisses).toBe(1);
    expect(payload.definitionCacheHits).toBe(1);
    client.close();
  });

  it('records a hit for HTTP 200 with the same revision (CDN replay)', async () => {
    mockFetch
      .mockResolvedValueOnce(okWithRevision({ 'feature-a': true }, 'rev-1'))
      .mockResolvedValueOnce(okWithRevision({ 'feature-a': true }, 'rev-1'));

    const sendStats = jest.fn().mockResolvedValue({ featureCount: 0 });
    const client = new TogglyServerClient(telemetryOptions(sendStats));

    await client.init();
    await client.fetchFlags();
    await client.flushTelemetry();

    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number;
      definitionCacheMisses?: number;
    };
    expect(payload.definitionCacheMisses).toBe(1);
    expect(payload.definitionCacheHits).toBe(1);
    client.close();
  });

  it('records a hit when network fails and last-known-good defs are kept', async () => {
    mockFetch
      .mockResolvedValueOnce(okWithRevision({ 'feature-a': true }, 'rev-1'))
      .mockRejectedValueOnce(new Error('network down'));

    const sendStats = jest.fn().mockResolvedValue({ featureCount: 0 });
    const client = new TogglyServerClient(telemetryOptions(sendStats));

    await client.init();
    await client.fetchFlags();
    await client.flushTelemetry();

    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number;
      definitionCacheMisses?: number;
    };
    expect(payload.definitionCacheMisses).toBe(1);
    expect(payload.definitionCacheHits).toBe(1);
    expect(await client.isEnabled('feature-a')).toBe(true);
    client.close();
  });

  it('does not record a hit on network failure when only featureDefaults exist', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));

    const sendStats = jest.fn().mockResolvedValue({ featureCount: 0 });
    const client = new TogglyServerClient({
      ...telemetryOptions(sendStats),
      featureDefaults: { 'feature-a': true },
    });

    await client.init();
    await client.flushTelemetry();

    expect(sendStats).not.toHaveBeenCalled();
    expect(await client.isEnabled('feature-a')).toBe(true);
    client.close();
  });

  it('does not count concurrent in-flight refresh skips', async () => {
    let resolveFirst!: (value: unknown) => void;
    const firstFetch = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    mockFetch
      .mockImplementationOnce(() => firstFetch)
      .mockResolvedValue(okWithRevision({ 'feature-a': true }, 'rev-2'));

    const sendStats = jest.fn().mockResolvedValue({ featureCount: 0 });
    const client = new TogglyServerClient(telemetryOptions(sendStats));

    const initPromise = client.init();
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalled();

    const joined = client.fetchFlags();
    resolveFirst(okWithRevision({ 'feature-a': true }, 'rev-1'));
    await initPromise;
    await joined;

    await client.flushTelemetry();
    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number;
      definitionCacheMisses?: number;
    };
    expect(payload.definitionCacheMisses).toBe(1);
    expect(payload.definitionCacheHits).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    client.close();
  });

  it('records a miss when WS flags-updated applies a new revision via refresh', async () => {
    jest.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(okWithRevision({ 'feature-a': true }, 'rev-1'))
      .mockResolvedValueOnce(okWithRevision({ 'feature-b': true }, 'rev-2'));

    const sendStats = jest.fn().mockResolvedValue({ featureCount: 0 });
    const client = new TogglyServerClient(telemetryOptions(sendStats));

    await client.init();
    await client.flushTelemetry();
    sendStats.mockClear();

    wsHandlers['message']?.(
      Buffer.from(JSON.stringify({ type: 'flags-updated', etag: 'rev-2' })),
    );
    await jest.advanceTimersByTimeAsync(300);
    await client.flushTelemetry();

    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number;
      definitionCacheMisses?: number;
    };
    expect(payload.definitionCacheMisses).toBe(1);
    expect(payload.definitionCacheHits).toBeUndefined();
    client.close();
  });

  it('does not increment definition cache counters on evaluate', async () => {
    mockFetch.mockResolvedValue(okWithRevision({ 'feature-a': true }, 'rev-1'));

    const sendStats = jest.fn().mockResolvedValue({ featureCount: 0 });
    const client = new TogglyServerClient(telemetryOptions(sendStats));

    await client.init();
    await client.flushTelemetry();
    sendStats.mockClear();

    await client.isEnabled('feature-a');
    await client.isEnabled('feature-a');
    await client.flushTelemetry();

    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number;
      definitionCacheMisses?: number;
      stats: Array<{ feature: string }>;
    };
    expect(payload.definitionCacheHits).toBeUndefined();
    expect(payload.definitionCacheMisses).toBeUndefined();
    expect(payload.stats[0].feature).toBe('feature-a');
    client.close();
  });

  it('sends cache-only flush without feature stats', async () => {
    mockFetch
      .mockResolvedValueOnce(okWithRevision({ 'feature-a': true }, 'rev-1'))
      .mockResolvedValueOnce(notModified('rev-1'));

    const sendStats = jest.fn().mockResolvedValue({ featureCount: 0 });
    const client = new TogglyServerClient(telemetryOptions(sendStats));

    await client.init();
    await client.flushTelemetry();
    sendStats.mockClear();

    await client.fetchFlags();
    await client.flushTelemetry();

    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number;
      definitionCacheMisses?: number;
      stats: unknown[];
    };
    expect(payload.definitionCacheHits).toBe(1);
    expect(payload.definitionCacheMisses).toBeUndefined();
    expect(payload.stats).toEqual([]);
    client.close();
  });

  it('keeps applying equal-etag 200 body while counting a hit', async () => {
    mockFetch
      .mockResolvedValueOnce(okWithRevision({ 'feature-a': false }, 'rev-1'))
      .mockResolvedValueOnce({
        ...mockDefsFetchResponse({ 'feature-a': true }),
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'etag' ? '"rev-1"' : null,
        },
      });

    const sendStats = jest.fn().mockResolvedValue({ featureCount: 0 });
    const client = new TogglyServerClient(telemetryOptions(sendStats));

    await client.init();
    expect(await client.isEnabled('feature-a')).toBe(false);

    await client.fetchFlags();
    expect(await client.isEnabled('feature-a')).toBe(true);

    await client.flushTelemetry();
    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number;
      definitionCacheMisses?: number;
    };
    expect(payload.definitionCacheMisses).toBe(1);
    expect(payload.definitionCacheHits).toBe(1);
    client.close();
  });
});
