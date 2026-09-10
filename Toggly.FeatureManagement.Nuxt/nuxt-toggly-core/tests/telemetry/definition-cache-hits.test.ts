import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createTogglyClient } from '../../src/client'
import type { FeatureDefinitionModel } from '@ops-ai/toggly-eval'

class MockWebSocket extends EventEmitter {
  static instances: MockWebSocket[] = []
  url: string

  constructor(url: string) {
    super()
    this.url = url
    MockWebSocket.instances.push(this)
    queueMicrotask(() => this.emit('open'))
  }

  close(): void {
    this.emit('close')
  }
}

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function def(
  featureKey: string,
  filters: FeatureDefinitionModel['filters'] = [{ name: 'AlwaysOn', parameters: {} }],
): FeatureDefinitionModel {
  return { featureKey, filters }
}

function okResponse(body: unknown, revision?: string) {
  const headers = new Headers()
  if (revision) {
    headers.set('ETag', `"${revision}"`)
  }
  return {
    ok: true,
    status: 200,
    headers,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }
}

function notModified(revision?: string) {
  const headers = new Headers()
  if (revision) {
    headers.set('ETag', `"${revision}"`)
  }
  return {
    ok: false,
    status: 304,
    headers,
  }
}

function telemetryClientOptions(sendStats: ReturnType<typeof vi.fn>) {
  return {
    appKey: 'test-app',
    evaluationMode: 'local' as const,
    enableLiveUpdates: false,
    refreshInterval: 0,
    enableUsageTracking: true,
    enableMetrics: false,
    usageFlushInterval: 0,
    metricsFlushInterval: 0,
    telemetryAttachProcessHandlers: false,
    usageClient: { sendStats, close: vi.fn() },
    metricsClient: { sendMetrics: vi.fn(), close: vi.fn() },
  }
}

describe('definition cache hit telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockWebSocket.instances = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records a miss on new 200 revision and a hit on 304', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse([def('feature-a')], 'rev-1'))
      .mockResolvedValueOnce(notModified('rev-1'))

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })
    const client = createTogglyClient(telemetryClientOptions(sendStats))

    await client.init()
    await client.refresh()
    await client.flushTelemetry()

    expect(sendStats).toHaveBeenCalled()
    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.definitionCacheHits).toBe(1)
    client.destroy()
  })

  it('records a hit when poll is skipped while WebSocket is live', async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValue(okResponse([def('feature-a')], 'rev-1'))

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })
    const client = createTogglyClient({
      ...telemetryClientOptions(sendStats),
      enableLiveUpdates: true,
      refreshInterval: 1_000,
      webSocketImpl: MockWebSocket as unknown as new (url: string) => unknown,
    })

    await client.init()
    await vi.advanceTimersByTimeAsync(0)
    expect(client.state.wsConnected).toBe(true)

    await client.flushTelemetry()
    sendStats.mockClear()

    await vi.advanceTimersByTimeAsync(1_000)
    await client.flushTelemetry()

    expect(sendStats).toHaveBeenCalled()
    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(payload.definitionCacheHits).toBe(1)
    expect(payload.definitionCacheMisses).toBeUndefined()
    client.destroy()
  })

  it('does not count concurrent in-flight refresh skips', async () => {
    let resolveFirst!: (value: unknown) => void
    const firstFetch = new Promise((resolve) => {
      resolveFirst = resolve
    })

    mockFetch
      .mockImplementationOnce(() => firstFetch)
      .mockResolvedValue(okResponse([def('feature-a')], 'rev-2'))

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })
    const client = createTogglyClient(telemetryClientOptions(sendStats))

    const initPromise = client.init()
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    const skipped = await client.refresh()
    expect(Object.keys(skipped).length).toBe(0)

    resolveFirst(okResponse([def('feature-a')], 'rev-1'))
    await initPromise

    await client.flushTelemetry()
    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.definitionCacheHits).toBeUndefined()
    client.destroy()
  })

  it('records a hit when startup loads a durable snapshot before network', async () => {
    mockFetch.mockResolvedValueOnce(notModified('rev-cached'))

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })
    const client = createTogglyClient(telemetryClientOptions(sendStats))

    client.hydrateDefinitions([def('cached-feature')])
    await client.init()
    await client.flushTelemetry()

    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    // Snapshot load hit + 304 refresh hit.
    expect(payload.definitionCacheHits).toBe(2)
    expect(payload.definitionCacheMisses).toBeUndefined()
    expect(await client.isFeatureOn('cached-feature')).toBe(true)
    client.destroy()
  })

  it('records a hit when network fails and last-known-good defs are kept', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse([def('feature-a')], 'rev-1'))
      .mockRejectedValueOnce(new Error('network down'))

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })
    const client = createTogglyClient(telemetryClientOptions(sendStats))

    await client.init()
    await expect(client.refresh()).rejects.toThrow('network down')
    await client.flushTelemetry()

    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.definitionCacheHits).toBe(1)
    expect(await client.isFeatureOn('feature-a')).toBe(true)
    client.destroy()
  })

  it('does not record a hit on network failure when only featureDefaults exist', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'))

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })
    const client = createTogglyClient({
      ...telemetryClientOptions(sendStats),
      featureDefaults: { 'feature-a': true },
    })

    await client.init()
    await client.flushTelemetry()

    // Defaults alone are not last-known-good definitions — no hit/miss.
    expect(sendStats).not.toHaveBeenCalled()
    expect(await client.isFeatureOn('feature-a')).toBe(true)
    client.destroy()
  })

  it('records a hit for HTTP 200 with the same revision (CDN replay)', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse([def('feature-a')], 'rev-1'))
      .mockResolvedValueOnce(okResponse([def('feature-a')], 'rev-1'))

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })
    const client = createTogglyClient(telemetryClientOptions(sendStats))

    await client.init()
    await client.refresh()
    await client.flushTelemetry()

    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.definitionCacheHits).toBe(1)
    client.destroy()
  })

  it('applies remote equal-etag 200 body and records a hit', async () => {
    // Same definition revision can still carry different evaluated flags when
    // identity changes (evaluated-signed). Body must be applied; outcome is hit.
    mockFetch
      .mockResolvedValueOnce(
        okResponse(
          {
            features: [
              { featureKey: 'feature-a', enabled: false },
              { featureKey: 'feature-b', enabled: false },
            ],
          },
          'rev-1',
        ),
      )
      .mockResolvedValueOnce(
        okResponse(
          {
            features: [
              { featureKey: 'feature-a', enabled: true },
              { featureKey: 'feature-b', enabled: true },
            ],
          },
          'rev-1',
        ),
      )

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })
    const client = createTogglyClient({
      ...telemetryClientOptions(sendStats),
      evaluationMode: 'remote',
      featureDefaults: { 'feature-a': false, 'feature-b': false },
    })

    await client.init()
    expect(await client.isFeatureOn('feature-a')).toBe(false)
    expect(await client.isFeatureOn('feature-b')).toBe(false)

    await client.refresh()
    expect(await client.isFeatureOn('feature-a')).toBe(true)
    expect(await client.isFeatureOn('feature-b')).toBe(true)

    await client.flushTelemetry()
    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.definitionCacheHits).toBe(1)
    client.destroy()
  })

  it('records a miss when WS flags-updated applies a new revision via refresh', async () => {
    vi.useFakeTimers()
    mockFetch
      .mockResolvedValueOnce(okResponse([def('feature-a')], 'rev-1'))
      .mockResolvedValueOnce(okResponse([def('feature-b')], 'rev-2'))

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })
    const client = createTogglyClient({
      ...telemetryClientOptions(sendStats),
      enableLiveUpdates: true,
      webSocketImpl: MockWebSocket as unknown as new (url: string) => unknown,
    })

    await client.init()
    await vi.advanceTimersByTimeAsync(0)
    await client.flushTelemetry()
    sendStats.mockClear()

    const ws = MockWebSocket.instances[0]
    ws.emit('message', JSON.stringify({ type: 'flags-updated', etag: 'rev-2' }))
    await vi.advanceTimersByTimeAsync(300)
    await client.flushTelemetry()

    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.definitionCacheHits).toBeUndefined()
    client.destroy()
  })

  it('does not increment definition cache counters on evaluate', async () => {
    mockFetch.mockResolvedValue(okResponse([def('feature-a')], 'rev-1'))

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })
    const client = createTogglyClient(telemetryClientOptions(sendStats))

    await client.init()
    await client.flushTelemetry()
    sendStats.mockClear()

    await client.isFeatureOn('feature-a')
    await client.isFeatureOn('feature-a')
    await client.flushTelemetry()

    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
      stats: Array<{ feature: string }>
    }
    expect(payload.definitionCacheHits).toBeUndefined()
    expect(payload.definitionCacheMisses).toBeUndefined()
    expect(payload.stats[0].feature).toBe('feature-a')
    client.destroy()
  })

  it('restores definition cache counters when send fails', async () => {
    const sendStats = vi
      .fn()
      .mockRejectedValueOnce(new Error('send failed'))
      .mockResolvedValueOnce({ featureCount: 0 })

    const { TelemetryRuntime } = await import('../../src/telemetry/index')
    const runtime = new TelemetryRuntime({
      appKey: 'test-app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: null,
      attachProcessHandlers: false,
      restoreOnSendFailure: true,
    })
    runtime.start()
    runtime.recordDefinitionCacheHit()
    runtime.recordDefinitionCacheMiss()
    await runtime.flush()
    runtime.recordDefinitionCacheHit()
    await runtime.flush()

    expect(sendStats).toHaveBeenCalledTimes(2)
    const retried = sendStats.mock.calls[1][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(retried.definitionCacheHits).toBe(2)
    expect(retried.definitionCacheMisses).toBe(1)
    await runtime.close()
  })

  it('sends cache-only flush without feature stats', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse([def('feature-a')], 'rev-1'))
      .mockResolvedValueOnce(notModified('rev-1'))

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })
    const client = createTogglyClient(telemetryClientOptions(sendStats))

    await client.init()
    await client.flushTelemetry()
    sendStats.mockClear()

    await client.refresh()
    await client.flushTelemetry()

    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
      stats: unknown[]
    }
    expect(payload.definitionCacheHits).toBe(1)
    expect(payload.definitionCacheMisses).toBeUndefined()
    expect(payload.stats).toEqual([])
    client.destroy()
  })
})
