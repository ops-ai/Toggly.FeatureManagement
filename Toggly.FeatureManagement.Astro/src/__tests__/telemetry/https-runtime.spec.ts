import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  UsageTelemetryRuntime,
  REQUEST_SCOPED_CLOSE_TIMEOUT_MS,
} from '../../telemetry/runtime.js'
import {
  HttpsTelemetryClient,
  DEFAULT_METRICS_BASE_URL,
  DEFAULT_TELEMETRY_FETCH_TIMEOUT_MS,
  resolveMetricsBaseUrl,
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
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal)
    expect((init as RequestInit).headers).toMatchObject({
      'Content-Type': 'application/json',
      'User-Agent': sdkUserAgent(),
    })
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.definitionCacheHits).toBe(1)
    expect(typeof body.time).toBe('string')
  })

  it('aborts hung usage posts after fetchTimeoutMs and soft-fails', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      })

      const client = new HttpsTelemetryClient({
        metricsBaseUrl: 'https://app.example',
        fetchTimeoutMs: 50,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })

      const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' })
      batcher.recordDefinitionCacheHit()
      const sendPromise = client.sendUsageStats(batcher.buildAndReset()!.payload)

      await vi.advanceTimersByTimeAsync(50)
      expect(await sendPromise).toBe(false)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('exposes getters, default timeout, and metrics base URL helpers', () => {
    const client = new HttpsTelemetryClient({
      metricsBaseUrl: 'https://metrics.example',
      userAgent: 'custom-ua/1',
    })
    expect(client.getBaseUrl()).toBe('https://metrics.example/')
    expect(client.getUserAgent()).toBe('custom-ua/1')
    expect(DEFAULT_TELEMETRY_FETCH_TIMEOUT_MS).toBe(5_000)
    expect(resolveMetricsBaseUrl(undefined)).toBe(DEFAULT_METRICS_BASE_URL)
    expect(resolveMetricsBaseUrl('   ')).toBe(DEFAULT_METRICS_BASE_URL)
    expect(resolveMetricsBaseUrl('https://x.example')).toBe('https://x.example/')
  })

  it('converts protobuf timestamps to ISO for the gateway', () => {
    const batcher = new UsageBatcher({
      appKey: 'app',
      environment: 'Production',
      processStartTime: new Date('2020-01-01T00:00:00.000Z'),
    })
    batcher.recordDefinitionCacheMiss()
    const json = usagePayloadToHttpJson(batcher.buildAndReset()!.payload)
    expect(typeof json.time).toBe('string')
    expect(typeof json.processStartTime).toBe('string')
    expect(json.definitionCacheMisses).toBe(1)
  })
})

describe('UsageTelemetryRuntime', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
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

  it('builds the HTTPS usage client when no usageClient is injected', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true })
    const runtime = new UsageTelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      usageFlushInterval: 0,
      attachProcessHandlers: false,
      metricsBaseUrl: 'https://gw.example',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      instanceName: 'astro-ssr',
      appVersion: '9.9.9',
    })
    runtime.start()
    runtime.recordDefinitionCacheHit()
    await runtime.flush()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe('https://gw.example/api/usage/stats')
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal)
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toMatchObject({
      definitionCacheHits: 1,
      instanceName: 'astro-ssr',
      appVersion: '9.9.9',
    })
    await runtime.close()
  })

  it('restores the batch when sendStats throws', async () => {
    const sendStats = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ ok: true })
    const error = vi.fn()

    const runtime = new UsageTelemetryRuntime(
      {
        appKey: 'app',
        environment: 'Production',
        enableUsageTracking: true,
        usageFlushInterval: 0,
        attachProcessHandlers: false,
        usageClient: { sendStats },
      },
      { debug: vi.fn(), warn: vi.fn(), error },
    )
    runtime.start()
    runtime.recordDefinitionCacheHit()
    await runtime.flush()
    expect(error).toHaveBeenCalled()

    await runtime.flush()
    expect(sendStats.mock.calls[1]![0]).toMatchObject({ definitionCacheHits: 1 })
    await runtime.close()
  })

  it('skips flush when usageClient is explicitly null', async () => {
    const debug = vi.fn()
    const runtime = new UsageTelemetryRuntime(
      {
        appKey: 'app',
        environment: 'Production',
        enableUsageTracking: true,
        usageFlushInterval: 0,
        attachProcessHandlers: false,
        usageClient: null,
      },
      { debug, warn: vi.fn(), error: vi.fn() },
    )
    runtime.start()
    runtime.recordDefinitionCacheHit()
    await runtime.flush()
    expect(debug).toHaveBeenCalledWith('Usage flush skipped: no usage client')
    await runtime.close()
  })

  it('coalesces concurrent flush calls onto one in-flight drain', async () => {
    let resolveSend!: (value: { ok: boolean }) => void
    const sendStats = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveSend = resolve
        }),
    )

    const runtime = new UsageTelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      usageFlushInterval: 0,
      attachProcessHandlers: false,
      usageClient: { sendStats },
    })
    runtime.start()
    runtime.recordDefinitionCacheHit()

    const first = runtime.flush()
    const second = runtime.flush()
    expect(sendStats).toHaveBeenCalledTimes(1)
    resolveSend({ ok: true })
    await Promise.all([first, second])
    await runtime.close()
  })

  it('starts a periodic flush timer when usageFlushInterval > 0', async () => {
    vi.useFakeTimers()
    const sendStats = vi.fn().mockResolvedValue({ ok: true })
    const runtime = new UsageTelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      usageFlushInterval: 100,
      attachProcessHandlers: false,
      usageClient: { sendStats },
    })
    runtime.start()
    runtime.recordDefinitionCacheHit()
    await vi.advanceTimersByTimeAsync(100)
    expect(sendStats).toHaveBeenCalled()
    await runtime.close()
  })

  it('no-ops start/close after closed and when tracking disabled', async () => {
    const sendStats = vi.fn().mockResolvedValue({ ok: true })
    const disabled = new UsageTelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: false,
      usageFlushInterval: 0,
      attachProcessHandlers: false,
      usageClient: { sendStats },
    })
    disabled.start()
    disabled.recordDefinitionCacheHit()
    await disabled.flush()
    expect(sendStats).not.toHaveBeenCalled()
    expect(disabled.usageEnabled).toBe(false)
    await disabled.close()

    const runtime = new UsageTelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      usageFlushInterval: 0,
      attachProcessHandlers: false,
      usageClient: { sendStats, close: vi.fn() },
    })
    runtime.start()
    await runtime.close()
    expect(runtime.usageEnabled).toBe(false)
    runtime.start()
    runtime.recordDefinitionCacheHit()
    await runtime.flush()
    expect(sendStats).not.toHaveBeenCalled()
    await runtime.close()
  })

  it('bounds close() when flush hangs', async () => {
    const sendStats = vi.fn(() => new Promise(() => {}))
    const runtime = new UsageTelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      usageFlushInterval: 0,
      attachProcessHandlers: false,
      usageClient: { sendStats },
    })
    runtime.start()
    runtime.recordDefinitionCacheHit()

    const started = Date.now()
    await runtime.close({ timeoutMs: 40 })
    expect(Date.now() - started).toBeLessThan(500)
    expect(REQUEST_SCOPED_CLOSE_TIMEOUT_MS).toBe(2_000)
  })
})
