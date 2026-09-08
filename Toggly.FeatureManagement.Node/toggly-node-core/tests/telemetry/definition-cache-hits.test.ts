import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { MemoryCacheProvider, DefinitionsCache } from '../../src/cache'
import { CACHE_KEYS } from '../../src/constants'
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

vi.mock('ws', () => ({
  default: MockWebSocket,
}))

const { createTogglyClient, closeToggly } = await import('../../src/client')

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

describe('definition cache hit telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockWebSocket.instances = []
    closeToggly()
  })

  afterEach(async () => {
    await closeToggly()
    vi.useRealTimers()
  })

  it('records a miss on new 200 revision and a hit on 304', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse([def('feature-a')], 'rev-1'))
      .mockResolvedValueOnce(notModified('rev-1'))

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })

    const client = createTogglyClient({
      appKey: 'test-app',
      enableStreaming: false,
      refreshInterval: 0,
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: { sendMetrics: vi.fn(), close: vi.fn() },
    })

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
  })

  it('records a hit when poll is skipped while WebSocket is live', async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValue(okResponse([def('feature-a')], 'rev-1'))

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })

    const client = createTogglyClient({
      appKey: 'test-app',
      enableStreaming: true,
      refreshInterval: 1_000,
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: { sendMetrics: vi.fn(), close: vi.fn() },
    })

    await client.init()
    // Allow MockWebSocket open microtask
    await vi.advanceTimersByTimeAsync(0)
    expect(client.state.wsConnected).toBe(true)

    // Clear init miss from the flush baseline by flushing once.
    await client.flushTelemetry()
    sendStats.mockClear()

    // Interval fires while WS is live and within fallback window → skipped poll hit.
    await vi.advanceTimersByTimeAsync(1_000)
    await client.flushTelemetry()

    expect(sendStats).toHaveBeenCalled()
    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(payload.definitionCacheHits).toBe(1)
    expect(payload.definitionCacheMisses).toBeUndefined()
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

    const client = createTogglyClient({
      appKey: 'test-app',
      enableStreaming: false,
      refreshInterval: 0,
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: { sendMetrics: vi.fn(), close: vi.fn() },
    })

    const initPromise = client.init()
    // Wait until the init refresh has entered fetch (in-flight).
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    // Concurrent refresh while init refresh is in flight — must not count.
    const skipped = await client.refresh()
    expect(skipped).toEqual({})

    resolveFirst(okResponse([def('feature-a')], 'rev-1'))
    await initPromise

    await client.flushTelemetry()
    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    // Only the completed init refresh (miss), not the concurrent skip.
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.definitionCacheHits).toBeUndefined()
  })

  it('records a hit when startup loads a durable snapshot before network', async () => {
    const memory = new MemoryCacheProvider()
    const definitionsCache = new DefinitionsCache(memory)
    await definitionsCache.setDefinitionModels(CACHE_KEYS.DEFINITIONS, [def('cached-feature')])
    await definitionsCache.setEtag(CACHE_KEYS.ETAG, 'rev-cached')

    mockFetch.mockResolvedValueOnce(notModified('rev-cached'))

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })

    const client = createTogglyClient({
      appKey: 'test-app',
      cacheProvider: memory,
      enableStreaming: false,
      refreshInterval: 0,
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: { sendMetrics: vi.fn(), close: vi.fn() },
    })

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
  })

  it('records a hit when network fails and last-known-good defs are kept', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse([def('feature-a')], 'rev-1'))
      .mockRejectedValueOnce(new Error('network down'))

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })

    const client = createTogglyClient({
      appKey: 'test-app',
      enableStreaming: false,
      refreshInterval: 0,
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: { sendMetrics: vi.fn(), close: vi.fn() },
    })

    await client.init()
    await client.refresh()
    await client.flushTelemetry()

    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.definitionCacheHits).toBe(1)
    expect(await client.isFeatureOn('feature-a')).toBe(true)
  })

  it('records a hit for HTTP 200 with the same revision (CDN replay)', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse([def('feature-a')], 'rev-1'))
      .mockResolvedValueOnce(okResponse([def('feature-a')], 'rev-1'))

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })

    const client = createTogglyClient({
      appKey: 'test-app',
      enableStreaming: false,
      refreshInterval: 0,
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: { sendMetrics: vi.fn(), close: vi.fn() },
    })

    await client.init()
    await client.refresh()
    await client.flushTelemetry()

    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.definitionCacheHits).toBe(1)
  })

  it('records exactly one miss when cache persistence throws after a new revision', async () => {
    const { DefinitionsCache: DefinitionsCacheClass } = await import('../../src/cache')
    const persistSpy = vi
      .spyOn(DefinitionsCacheClass.prototype, 'setDefinitionModels')
      .mockRejectedValue(new Error('persist failed'))

    try {
      mockFetch
        .mockResolvedValueOnce(okResponse([def('seed')], 'rev-0'))
        .mockResolvedValueOnce(okResponse([def('feature-a')], 'rev-1'))

      const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })

      const client = createTogglyClient({
        appKey: 'test-app',
        enableStreaming: false,
        refreshInterval: 0,
        enableUsageTracking: true,
        enableMetrics: false,
        usageFlushInterval: 0,
        metricsFlushInterval: 0,
        usageClient: { sendStats, close: vi.fn() },
        metricsClient: { sendMetrics: vi.fn(), close: vi.fn() },
      })

      await client.init()
      await client.flushTelemetry()
      sendStats.mockClear()

      await client.refresh()
      await client.flushTelemetry()

      const payload = sendStats.mock.calls[0][0] as {
        definitionCacheHits?: number
        definitionCacheMisses?: number
      }
      expect(payload.definitionCacheMisses).toBe(1)
      expect(payload.definitionCacheHits).toBeUndefined()
      expect(await client.isFeatureOn('feature-a')).toBe(true)
    } finally {
      persistSpy.mockRestore()
    }
  })

  it('records exactly one miss when afterRefresh throws after a new revision', async () => {
    const { HookExecutor } = await import('../../src/hooks')
    const afterRefreshSpy = vi
      .spyOn(HookExecutor.prototype, 'executeAfterRefresh')
      .mockRejectedValue(new Error('afterRefresh failed'))

    try {
      mockFetch
        .mockResolvedValueOnce(okResponse([def('seed')], 'rev-0'))
        .mockResolvedValueOnce(okResponse([def('feature-a')], 'rev-1'))

      const sendStats = vi.fn().mockResolvedValue({ featureCount: 0 })

      const client = createTogglyClient({
        appKey: 'test-app',
        enableStreaming: false,
        refreshInterval: 0,
        enableUsageTracking: true,
        enableMetrics: false,
        usageFlushInterval: 0,
        metricsFlushInterval: 0,
        usageClient: { sendStats, close: vi.fn() },
        metricsClient: { sendMetrics: vi.fn(), close: vi.fn() },
      })

      await client.init()
      await client.flushTelemetry()
      sendStats.mockClear()

      await client.refresh()
      await client.flushTelemetry()

      const payload = sendStats.mock.calls[0][0] as {
        definitionCacheHits?: number
        definitionCacheMisses?: number
      }
      expect(payload.definitionCacheMisses).toBe(1)
      expect(payload.definitionCacheHits).toBeUndefined()
      expect(await client.isFeatureOn('feature-a')).toBe(true)
    } finally {
      afterRefreshSpy.mockRestore()
    }
  })
})
