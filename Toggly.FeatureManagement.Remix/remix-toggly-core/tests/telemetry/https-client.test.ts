import {
  HttpsTelemetryClient,
  resolveMetricsBaseUrl,
  isTelemetryEnvDisabled,
  resolveTelemetryEnableFlag,
  metricsPayloadToHttpJson,
  usagePayloadToHttpJson,
  DEFAULT_METRICS_BASE_URL,
} from '../../src/telemetry/https-client'
import { toProtobufTimestamp } from '../../src/telemetry/hash'

describe('HttpsTelemetryClient', () => {
  afterEach(() => {
    delete process.env.TOGGLY_DISABLE_TELEMETRY
  })

  it('resolveMetricsBaseUrl defaults and normalizes trailing slash', () => {
    expect(resolveMetricsBaseUrl(undefined)).toBe(DEFAULT_METRICS_BASE_URL)
    expect(resolveMetricsBaseUrl('  ')).toBe(DEFAULT_METRICS_BASE_URL)
    expect(resolveMetricsBaseUrl('https://metrics.example.com')).toBe(
      'https://metrics.example.com/',
    )
  })

  it('kill switch helpers honour TOGGLY_DISABLE_TELEMETRY', () => {
    expect(isTelemetryEnvDisabled()).toBe(false)
    expect(resolveTelemetryEnableFlag(true, false)).toBe(true)
    expect(resolveTelemetryEnableFlag(undefined, true)).toBe(true)

    process.env.TOGGLY_DISABLE_TELEMETRY = '1'
    expect(isTelemetryEnvDisabled()).toBe(true)
    expect(resolveTelemetryEnableFlag(true, true)).toBe(false)
  })

  it('posts usage and metrics JSON and soft-fails network errors', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockRejectedValueOnce(new Error('network'))

    const client = new HttpsTelemetryClient({
      metricsBaseUrl: 'https://app.toggly.io',
      userAgent: 'test-ua',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(client.getBaseUrl()).toBe('https://app.toggly.io/')
    expect(client.getUserAgent()).toBe('test-ua')

    const usagePayload = {
      appKey: 'app',
      environment: 'Production',
      time: toProtobufTimestamp(new Date('2026-01-01T00:00:00.000Z')),
      stats: [],
    }
    const metricsPayload = {
      appKey: 'app',
      environment: 'Production',
      time: toProtobufTimestamp(new Date('2026-01-01T00:00:00.000Z')),
      metrics: {},
      observations: [
        {
          metric: 'depth',
          value: 1,
          time: toProtobufTimestamp(new Date('2026-01-01T00:00:01.000Z')),
        },
      ],
    }

    expect(usagePayloadToHttpJson(usagePayload).time).toBe('2026-01-01T00:00:00.000Z')
    expect(metricsPayloadToHttpJson(metricsPayload).observations?.[0]).toMatchObject({
      metric: 'depth',
      time: '2026-01-01T00:00:01.000Z',
    })
    expect(metricsPayloadToHttpJson({
      appKey: 'app',
      environment: 'Production',
      time: toProtobufTimestamp(new Date('2026-01-01T00:00:00.000Z')),
      metrics: {},
      observations: undefined as never,
    }).observations).toEqual([])

    expect(await client.sendUsageStats(usagePayload)).toBe(true)
    expect(await client.sendMetrics(metricsPayload)).toBe(false)
    expect(await client.post('api/usage/stats', {})).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('uses default base URL, user agent, and global fetch when options omitted', async () => {
    const originalFetch = globalThis.fetch
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true })
    globalThis.fetch = fetchImpl as unknown as typeof fetch
    try {
      const client = new HttpsTelemetryClient()
      expect(client.getBaseUrl()).toBe(DEFAULT_METRICS_BASE_URL)
      expect(client.getUserAgent()).toMatch(/^toggly-remix\//)
      expect(await client.post('/api/usage/stats', {})).toBe(true)
      expect(fetchImpl).toHaveBeenCalled()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
