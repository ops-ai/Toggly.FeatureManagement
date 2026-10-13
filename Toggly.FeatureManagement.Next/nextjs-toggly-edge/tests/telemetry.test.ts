import { describe, it, expect, vi, afterEach } from 'vitest'
import { createEdgeClient, resetEdgeToggly } from '../src/edge-client'
import type { UsageSender, MetricsSender } from '@ops-ai/nextjs-toggly-core'

describe('edge telemetry', () => {
  afterEach(() => {
    resetEdgeToggly()
    vi.unstubAllEnvs()
  })

  it('records checks over HTTPS senders and flushes payload shape', async () => {
    const sendStats = vi.fn().mockResolvedValue({})
    const sendMetrics = vi.fn().mockResolvedValue({})
    const usageClient: UsageSender = { sendStats, close: vi.fn() }
    const metricsClient: MetricsSender = { sendMetrics, close: vi.fn() }

    const client = createEdgeClient({
      appKey: 'app',
      environment: 'Production',
      featureDefaults: { FeatureA: true },
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient,
      metricsClient,
      cache: false,
    })

    vi.spyOn(client, 'fetchDefinitions').mockResolvedValue({ FeatureA: true })
    await client.init()

    await client.isFeatureOn('FeatureA', { identity: 'user-1' })
    client.measure('revenue', 4, { feature: 'FeatureA' })
    await client.flushTelemetry()

    expect(sendStats).toHaveBeenCalled()
    const usagePayload = sendStats.mock.calls[0][0] as {
      stats: Array<{ feature: string; variantStats: Record<string, { checkCount: number }> }>
    }
    expect(usagePayload.stats[0].variantStats.enabled.checkCount).toBe(1)

    expect(sendMetrics).toHaveBeenCalled()
    const metricsPayload = sendMetrics.mock.calls[0][0] as {
      stats: Array<{ metric: string; variantValues: Record<string, number> }>
    }
    expect(metricsPayload.stats[0].metric).toBe('revenue')
    expect(metricsPayload.stats[0].variantValues.enabled).toBe(4)

    await client.close()
  })

  it('does not start telemetry when TOGGLY_DISABLE_TELEMETRY=1 even if explicitly enabled', async () => {
    vi.stubEnv('TOGGLY_DISABLE_TELEMETRY', '1')

    const sendStats = vi.fn().mockResolvedValue({})
    const usageClient: UsageSender = { sendStats, close: vi.fn() }

    const client = createEdgeClient({
      appKey: 'app',
      environment: 'Production',
      featureDefaults: { FeatureA: true },
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient,
      metricsClient: { sendMetrics: vi.fn(), close: vi.fn() },
      cache: false,
    })

    vi.spyOn(client, 'fetchDefinitions').mockResolvedValue({ FeatureA: true })
    await client.init()
    await client.isFeatureOn('FeatureA', { identity: 'user-1' })
    client.measure('revenue', 1)
    await client.flushTelemetry()

    expect(sendStats).not.toHaveBeenCalled()
    await client.close()
  })

  it('scheduleFlush hands flushTelemetry to waitUntil', async () => {
    const sendStats = vi.fn().mockResolvedValue({})
    const client = createEdgeClient({
      appKey: 'app',
      environment: 'Production',
      featureDefaults: { FeatureA: true },
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: null,
      cache: false,
    })
    vi.spyOn(client, 'fetchDefinitions').mockResolvedValue({ FeatureA: true })
    await client.init()
    await client.isFeatureOn('FeatureA')

    const waitUntil = vi.fn((p: Promise<unknown>) => p)
    client.scheduleFlush(waitUntil)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    await waitUntil.mock.calls[0]![0]
    expect(sendStats).toHaveBeenCalled()
    await client.close()
  })
})

describe('edge definition cache hit telemetry', () => {
  const mockFetch = vi.fn()

  afterEach(async () => {
    resetEdgeToggly()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function alwaysOn(featureKey: string) {
    return {
      featureKey,
      filters: [{ name: 'AlwaysOn', parameters: {} }],
    }
  }

  function okResponse(body: unknown) {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(body),
      json: async () => body,
    }
  }

  it('records a miss on network apply and a hit on TTL skip', async () => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockResolvedValue(okResponse([alwaysOn('feature-a')]))

    const sendStats = vi.fn().mockResolvedValue({})
    const client = createEdgeClient({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: null,
      cache: true,
      cacheTtl: 60,
    })

    await client.init()
    await client.fetchDefinitions() // TTL still valid → hit
    await client.flushTelemetry()

    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.definitionCacheHits).toBe(1)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    await client.close()
  })

  it('records a hit when network fails and last-good defs are kept', async () => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch
      .mockResolvedValueOnce(okResponse([alwaysOn('feature-a')]))
      .mockRejectedValueOnce(new Error('network down'))

    const sendStats = vi.fn().mockResolvedValue({})
    const client = createEdgeClient({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: null,
      cache: false,
    })

    await client.init()
    await client.fetchDefinitions()
    await client.flushTelemetry()

    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.definitionCacheHits).toBe(1)
    expect(client.isFeatureOnSync('feature-a')).toBe(true)
    await client.close()
  })
})
