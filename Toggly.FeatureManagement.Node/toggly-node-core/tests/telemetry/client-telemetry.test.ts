import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTogglyClient, closeToggly } from '../../src/client'
import type { FeatureDefinitionModel } from '@ops-ai/toggly-eval'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function def(
  featureKey: string,
  filters: FeatureDefinitionModel['filters'] = [{ name: 'AlwaysOn', parameters: {} }],
): FeatureDefinitionModel {
  return { featureKey, filters }
}

describe('client telemetry wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    closeToggly()
  })

  afterEach(async () => {
    await closeToggly()
  })

  it('records checks on isFeatureOn and flushes usage/metrics APIs', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify([def('feature-a')]),
      json: async () => [def('feature-a')],
    })

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 1 })
    const sendMetrics = vi.fn().mockResolvedValue({ count: 1 })

    const client = createTogglyClient({
      appKey: 'test-app',
      identity: 'user-42',
      enableStreaming: false,
      refreshInterval: 0,
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: vi.fn() },
      metricsClient: { sendMetrics, close: vi.fn() },
    })

    await client.init()
    expect(await client.isFeatureOn('feature-a')).toBe(true)

    client.recordUsage('feature-a')
    client.recordView('feature-a')
    client.measure('revenue', 10)
    client.incrementCounter('clicks', 2)
    client.observe('depth', 1)

    await client.flushTelemetry()

    expect(sendStats).toHaveBeenCalled()
    const usagePayload = sendStats.mock.calls[0][0] as {
      stats: Array<{
        feature: string
        variantStats: { enabled: { checkCount: number; usedCount: number; viewedCount: number } }
      }>
    }
    expect(usagePayload.stats[0].feature).toBe('feature-a')
    expect(usagePayload.stats[0].variantStats.enabled.checkCount).toBe(1)
    expect(usagePayload.stats[0].variantStats.enabled.usedCount).toBe(1)
    expect(usagePayload.stats[0].variantStats.enabled.viewedCount).toBe(1)

    expect(sendMetrics).toHaveBeenCalled()
    const metricsPayload = sendMetrics.mock.calls[0][0] as {
      stats: Array<{ metric: string }>
      counters: Array<{ metric: string }>
      observations: Array<{ metric: string }>
    }
    expect(metricsPayload.stats.some((s) => s.metric === 'revenue')).toBe(true)
    expect(metricsPayload.counters.some((c) => c.metric === 'clicks')).toBe(true)
    expect(metricsPayload.observations.some((o) => o.metric === 'depth')).toBe(true)

    await client.close()
  })

  it('records checks on evaluateFeatureGate for each evaluated feature', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () =>
        JSON.stringify([
          def('feature-a'),
          def('feature-b', [{ name: 'AlwaysOff', parameters: {} }]),
        ]),
      json: async () => [
        def('feature-a'),
        def('feature-b', [{ name: 'AlwaysOff', parameters: {} }]),
      ],
    })

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 2 })

    const client = createTogglyClient({
      appKey: 'test-app',
      identity: 'gate-user',
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
    expect(await client.evaluateFeatureGate(['feature-a', 'feature-b'], 'any')).toBe(true)

    await client.flushTelemetry()

    expect(sendStats).toHaveBeenCalledTimes(1)
    const usagePayload = sendStats.mock.calls[0][0] as {
      stats: Array<{
        feature: string
        variantStats: {
          enabled?: { checkCount: number }
          disabled?: { checkCount: number }
        }
      }>
    }
    const byFeature = Object.fromEntries(
      usagePayload.stats.map((s) => [s.feature, s.variantStats]),
    )
    expect(byFeature['feature-a']?.enabled?.checkCount).toBe(1)
    expect(byFeature['feature-b']?.disabled?.checkCount).toBe(1)

    await client.close()
  })

  it('use() and usage-scope APIs record attempt, duration, and errors', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify([def('scoped')]),
      json: async () => [def('scoped')],
    })

    const sendStats = vi.fn().mockResolvedValue({ featureCount: 1 })
    const client = createTogglyClient({
      appKey: 'test-app',
      identity: 'scope-user',
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

    await client.use('scoped', async () => undefined)
    await client.use('scoped', async (scope) => {
      scope.fail()
    })
    await expect(
      client.use('scoped', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    const abort = new DOMException('Aborted', 'AbortError')
    await expect(
      client.use('scoped', async () => {
        throw abort
      }),
    ).rejects.toBe(abort)

    client.recordUsageError('scoped')
    client.recordUsageDuration('scoped', 25)
    client.recordUsageDuration('scoped', 10, undefined, 'enabled', true)
    client.recordUsageScopeOutcome('scoped', { failed: true, durationMs: 12 })

    await client.flushTelemetry()

    const usagePayload = sendStats.mock.calls[0][0] as {
      stats: Array<{
        feature: string
        variantStats: {
          enabled: {
            usedCount: number
            errorCount: number
            durationSumMs: number
            errorDurationSumMs: number
          }
        }
      }>
    }
    const enabled = usagePayload.stats[0].variantStats.enabled
    expect(enabled.usedCount).toBeGreaterThanOrEqual(4)
    expect(enabled.errorCount).toBeGreaterThanOrEqual(3)
    expect(enabled.durationSumMs).toBeGreaterThan(0)
    expect(enabled.errorDurationSumMs).toBeGreaterThan(0)

    await client.close()
  })

  it('use() without telemetry still invokes the callback', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify([def('offline')]),
      json: async () => [def('offline')],
    })

    const client = createTogglyClient({
      appKey: 'test-app',
      enableStreaming: false,
      refreshInterval: 0,
      enableUsageTracking: false,
      enableMetrics: false,
    })
    await client.init()
    let ran = false
    await client.use('offline', async (scope) => {
      scope.fail()
      ran = true
    })
    expect(ran).toBe(true)
    await client.close()
  })
})
