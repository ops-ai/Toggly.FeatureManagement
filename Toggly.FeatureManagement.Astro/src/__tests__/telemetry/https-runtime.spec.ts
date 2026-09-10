import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { UsageTelemetryRuntime } from '../../telemetry/runtime.js'
import {
  HttpsTelemetryClient,
  resolveTelemetryEnableFlag,
  usagePayloadToHttpJson,
} from '../../telemetry/https-client.js'
import { UsageBatcher } from '../../telemetry/usage-batcher.js'
import { sdkUserAgent } from '../../sdk-identity.js'

describe('HttpsTelemetryClient', () => {
  it('POSTs usage stats to api/usage/stats with UA and soft-fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockRejectedValueOnce(new Error('network'))

    const client = new HttpsTelemetryClient({
      metricsBaseUrl: 'https://app.example/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' })
    batcher.recordDefinitionCacheHit()
    const payload = batcher.buildAndReset()!.payload

    expect(await client.sendUsageStats(payload)).toBe(true)
    expect(await client.sendUsageStats(payload)).toBe(false)
    expect(await client.sendUsageStats(payload)).toBe(false)

    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe('https://app.example/api/usage/stats')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).headers).toMatchObject({
      'Content-Type': 'application/json',
      'User-Agent': sdkUserAgent(),
    })
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.definitionCacheHits).toBe(1)
    expect(typeof body.time).toBe('string')
  })

  it('converts protobuf timestamps to ISO for the gateway', () => {
    const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' })
    batcher.recordDefinitionCacheMiss()
    const json = usagePayloadToHttpJson(batcher.buildAndReset()!.payload)
    expect(typeof json.time).toBe('string')
    expect(json.definitionCacheMisses).toBe(1)
  })
})

describe('UsageTelemetryRuntime', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('flushes cache-only batches and restores on soft-fail', async () => {
    const sendStats = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true })

    const runtime = new UsageTelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      usageFlushInterval: 0,
      attachProcessHandlers: false,
      usageClient: { sendStats, close: vi.fn() },
    })
    runtime.start()

    runtime.recordDefinitionCacheHit()
    runtime.recordDefinitionCacheMiss()
    await runtime.flush()

    expect(sendStats).toHaveBeenCalledTimes(1)
    expect(sendStats.mock.calls[0]![0]).toMatchObject({
      definitionCacheHits: 1,
      definitionCacheMisses: 1,
    })

    // Soft-fail restored the counters; a later hit merges.
    runtime.recordDefinitionCacheHit()
    await runtime.flush()
    expect(sendStats.mock.calls[1]![0]).toMatchObject({
      definitionCacheHits: 2,
      definitionCacheMisses: 1,
    })

    await runtime.close()
  })

  it('honors TOGGLY_DISABLE_TELEMETRY=1 over explicit enable', async () => {
    vi.stubEnv('TOGGLY_DISABLE_TELEMETRY', '1')
    const sendStats = vi.fn().mockResolvedValue({ ok: true })

    const runtime = new UsageTelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      usageFlushInterval: 0,
      attachProcessHandlers: false,
      usageClient: { sendStats, close: vi.fn() },
    })
    runtime.start()
    runtime.recordDefinitionCacheHit()
    await runtime.flush()
    expect(sendStats).not.toHaveBeenCalled()
    expect(resolveTelemetryEnableFlag(true, true)).toBe(false)
    await runtime.close()
  })
})
