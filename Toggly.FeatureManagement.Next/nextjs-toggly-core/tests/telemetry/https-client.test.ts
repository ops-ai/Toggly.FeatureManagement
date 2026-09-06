import { describe, it, expect, vi, afterEach } from 'vitest'
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
    vi.unstubAllEnvs()
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

    vi.stubEnv('TOGGLY_DISABLE_TELEMETRY', '1')
    expect(isTelemetryEnvDisabled()).toBe(true)
    expect(resolveTelemetryEnableFlag(true, true)).toBe(false)
  })

  it('posts usage and metrics JSON and soft-fails network errors', async () => {
    const fetchImpl = vi
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

    expect(await client.sendUsageStats(usagePayload)).toBe(true)
    expect(await client.sendMetrics(metricsPayload)).toBe(false)
    expect(await client.post('api/usage/stats', {})).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
