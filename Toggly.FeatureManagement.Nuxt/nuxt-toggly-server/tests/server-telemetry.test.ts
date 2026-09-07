import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FeatureDefinitionModel, UsageSender, MetricsSender } from '@ops-ai/nuxt-toggly-core'
import {
  initServerToggly,
  isServerFeatureOn,
  resetServerToggly,
  recordServerUsage,
  measureServerMetric,
  flushServerTelemetry,
  closeServerToggly,
} from '../src/server-client'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const alwaysOn: FeatureDefinitionModel = {
  featureKey: 'feature-a',
  filters: [{ name: 'AlwaysOn', parameters: {} }],
}

function createMockResponse(data: unknown, status = 200) {
  const bodyText = typeof data === 'string' ? data : JSON.stringify(data)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => bodyText,
    json: async () => (typeof data === 'string' ? JSON.parse(data) : data),
    headers: { get: () => null },
  }
}

describe('server telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetServerToggly()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch.mockResolvedValue(createMockResponse([alwaysOn]))
  })

  afterEach(() => {
    resetServerToggly()
    vi.unstubAllEnvs()
  })

  it('records checks and flushes via injected senders', async () => {
    const sendStats = vi.fn().mockResolvedValue({ featureCount: 1 })
    const sendMetrics = vi.fn().mockResolvedValue({ count: 1 })
    const usageClient: UsageSender = { sendStats, close: vi.fn() }
    const metricsClient: MetricsSender = { sendMetrics, close: vi.fn() }

    await initServerToggly({
      appKey: 'test-key',
      enableLiveUpdates: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      telemetryAttachProcessHandlers: false,
      usageClient,
      metricsClient,
    })

    await isServerFeatureOn('feature-a', 'user-1')
    recordServerUsage('feature-a', 'user-1')
    measureServerMetric('revenue', 5, { feature: 'feature-a' })
    await flushServerTelemetry()

    expect(sendStats).toHaveBeenCalled()
    const usagePayload = sendStats.mock.calls[0][0] as {
      stats: Array<{ feature: string; variantStats: Record<string, { checkCount: number }> }>
    }
    expect(usagePayload.stats[0].feature).toBe('feature-a')
    expect(usagePayload.stats[0].variantStats.enabled.checkCount).toBe(1)
    expect(sendMetrics).toHaveBeenCalled()
  })

  it('honors TOGGLY_DISABLE_TELEMETRY=1 over explicit enable', async () => {
    vi.stubEnv('TOGGLY_DISABLE_TELEMETRY', '1')
    const sendStats = vi.fn().mockResolvedValue({})

    await initServerToggly({
      appKey: 'test-key',
      enableLiveUpdates: false,
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      telemetryAttachProcessHandlers: false,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: { sendMetrics: vi.fn(), close: vi.fn() },
    })

    await isServerFeatureOn('feature-a', 'user-1')
    await flushServerTelemetry()
    expect(sendStats).not.toHaveBeenCalled()
  })

  it('uses HTTPS transport when configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })

    await initServerToggly({
      appKey: 'test-key',
      enableLiveUpdates: false,
      telemetryTransport: 'https',
      telemetryAttachProcessHandlers: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      telemetryFetch: fetchImpl as unknown as typeof fetch,
    })

    await isServerFeatureOn('feature-a', 'user-1')
    await flushServerTelemetry()

    const urls = fetchImpl.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('api/usage/stats'))).toBe(true)
  })

  it('closeServerToggly flushes then destroys', async () => {
    const sendStats = vi.fn().mockResolvedValue({})
    await initServerToggly({
      appKey: 'test-key',
      enableLiveUpdates: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      telemetryAttachProcessHandlers: false,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: null,
      enableMetrics: false,
    })
    await isServerFeatureOn('feature-a')
    await closeServerToggly()
    expect(sendStats).toHaveBeenCalled()
  })
})
