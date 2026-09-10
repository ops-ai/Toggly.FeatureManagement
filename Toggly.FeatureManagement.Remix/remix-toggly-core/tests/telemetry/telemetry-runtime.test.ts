import { TelemetryRuntime } from '../../src/telemetry/index'
import type { MetricsSender, UsageSender } from '../../src/telemetry/index'
import {
  HttpsTelemetryClient,
  usagePayloadToHttpJson,
} from '../../src/telemetry/https-client'
import { UsageBatcher } from '../../src/telemetry/usage-batcher'

describe('TelemetryRuntime', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
    delete process.env.TOGGLY_DISABLE_TELEMETRY
  })

  it('flushes usage and metrics via injected senders', async () => {
    const sendStats = jest.fn().mockResolvedValue({ featureCount: 1 })
    const sendMetrics = jest.fn().mockResolvedValue({ count: 1 })
    const usageClient: UsageSender = { sendStats, close: jest.fn() }
    const metricsClient: MetricsSender = { sendMetrics, close: jest.fn() }

    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient,
      metricsClient,
      attachProcessHandlers: false,
    })
    runtime.start()

    runtime.recordCheck('FeatureA', true, 'user-1')
    runtime.recordUsage('FeatureA', 'user-1')
    runtime.measure('revenue', 9)
    runtime.incrementCounter('clicks')
    runtime.observe('depth', 2)

    await runtime.flushAll()

    expect(sendStats).toHaveBeenCalledTimes(1)
    const usagePayload = sendStats.mock.calls[0][0] as {
      stats: Array<{ feature: string; variantStats: Record<string, { checkCount: number }> }>
    }
    expect(usagePayload.stats[0].feature).toBe('FeatureA')
    expect(usagePayload.stats[0].variantStats.enabled.checkCount).toBe(1)

    expect(sendMetrics).toHaveBeenCalledTimes(1)
    await runtime.close()
    expect(usageClient.close).toHaveBeenCalled()
    expect(metricsClient.close).toHaveBeenCalled()
  })

  it('auto-flushes on interval', async () => {
    const sendStats = jest.fn().mockResolvedValue({ featureCount: 1 })
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 1000,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: jest.fn() },
      metricsClient: null,
      attachProcessHandlers: false,
    })
    runtime.start()
    runtime.recordCheck('FeatureA', true)

    await jest.advanceTimersByTimeAsync(1000)
    expect(sendStats).toHaveBeenCalled()
    await runtime.close()
  })

  it('drains a second feature recorded during an active send on close', async () => {
    let releaseSend!: () => void
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve
    })
    const sendStats = jest.fn().mockImplementation(async () => {
      await sendGate
      return { featureCount: 1 }
    })

    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: jest.fn() },
      metricsClient: null,
      attachProcessHandlers: false,
    })
    runtime.start()

    runtime.recordCheck('FeatureA', true, 'user-1')
    const firstFlush = runtime.flush()

    // Mid-send: another waitUntil/close path records more data.
    runtime.recordCheck('FeatureB', false, 'user-2')
    const closePromise = runtime.close()

    releaseSend()
    await firstFlush
    await closePromise

    expect(sendStats.mock.calls.length).toBeGreaterThanOrEqual(2)
    const features = sendStats.mock.calls.flatMap((call) => {
      const payload = call[0] as {
        stats: Array<{ feature: string }>
      }
      return payload.stats.map((s) => s.feature)
    })
    expect(features).toEqual(expect.arrayContaining(['FeatureA', 'FeatureB']))
  })

  it('honors TOGGLY_DISABLE_TELEMETRY=1 over explicit enable flags', () => {
    process.env.TOGGLY_DISABLE_TELEMETRY = '1'
    const sendStats = jest.fn()
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: jest.fn() },
      metricsClient: { sendMetrics: jest.fn(), close: jest.fn() },
      attachProcessHandlers: false,
    })
    runtime.start()
    expect(runtime.usageEnabled).toBe(false)
    expect(runtime.metricsEnabled).toBe(false)
    runtime.recordCheck('FeatureA', true)
    void runtime.flush()
    expect(sendStats).not.toHaveBeenCalled()
    delete process.env.TOGGLY_DISABLE_TELEMETRY
  })

  it('restores usage and metrics batches when HTTPS send soft-fails', async () => {
    const sendStats = jest.fn().mockResolvedValue({ ok: false })
    const sendMetrics = jest.fn().mockResolvedValue({ ok: false })
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: jest.fn() },
      metricsClient: { sendMetrics, close: jest.fn() },
      attachProcessHandlers: false,
      restoreOnSendFailure: true,
      transport: 'https',
    })
    runtime.start()
    runtime.recordCheck('FeatureA', true, 'user-1')
    runtime.recordView('FeatureA', 'user-1')
    runtime.measure('revenue', 3)
    runtime.shouldFlushForCaps()

    await runtime.flush()
    expect(sendStats).toHaveBeenCalledTimes(1)
    expect(sendMetrics).toHaveBeenCalledTimes(1)

    // Soft-fail restored the batches — next flush sends again.
    await runtime.flush()
    expect(sendStats).toHaveBeenCalledTimes(2)
    expect(sendMetrics).toHaveBeenCalledTimes(2)
    await runtime.close()
  })

  it('restores batches when senders throw and restoreOnSendFailure is set', async () => {
    const sendStats = jest.fn().mockRejectedValue(new Error('boom'))
    const sendMetrics = jest.fn().mockRejectedValue(new Error('boom'))
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: jest.fn() },
      metricsClient: { sendMetrics, close: jest.fn() },
      attachProcessHandlers: false,
      restoreOnSendFailure: true,
    })
    runtime.start()
    runtime.recordCheck('FeatureA', true)
    runtime.incrementCounter('clicks')
    await runtime.flush()
    await runtime.flush()
    expect(sendStats).toHaveBeenCalledTimes(2)
    expect(sendMetrics).toHaveBeenCalledTimes(2)
    await runtime.close()
  })

  it('includes definition cache hits/misses on usage flush', async () => {
    const sendStats = jest.fn().mockResolvedValue({ featureCount: 0 })
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: jest.fn() },
      metricsClient: null,
      attachProcessHandlers: false,
    })
    runtime.start()
    runtime.recordDefinitionCacheHit()
    runtime.recordDefinitionCacheMiss()
    await runtime.flush()

    const payload = sendStats.mock.calls[0][0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
      stats: unknown[]
    }
    expect(payload.definitionCacheHits).toBe(1)
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.stats).toEqual([])
    await runtime.close()
  })

  it('restores definition cache counters when send fails', async () => {
    const sendStats = jest
      .fn()
      .mockRejectedValueOnce(new Error('send failed'))
      .mockResolvedValueOnce({ featureCount: 0 })

    const runtime = new TelemetryRuntime({
      appKey: 'test-app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: jest.fn() },
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

  it('builds HTTPS clients when transport is https and no clients are injected', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true })
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      transport: 'https',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      attachProcessHandlers: false,
    })
    runtime.start()
    runtime.recordCheck('FeatureA', true, 'user-1')
    runtime.observe('depth', 2)
    await runtime.flush()
    expect(fetchImpl).toHaveBeenCalled()
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('api/usage/stats'))).toBe(true)
    expect(urls.some((u) => u.includes('api/metrics'))).toBe(true)
    await runtime.close()
  })

  it('warns when gRPC transport has no injected clients', () => {
    const warn = jest.fn()
    const runtime = new TelemetryRuntime(
      {
        appKey: 'app',
        environment: 'Production',
        enableUsageTracking: true,
        enableMetrics: false,
        usageFlushInterval: 0,
        metricsFlushInterval: 0,
        transport: 'grpc',
        attachProcessHandlers: false,
      },
      { debug: () => {}, warn, error: () => {} },
    )
    runtime.start()
    expect(warn).toHaveBeenCalled()
    runtime.recordCheck('FeatureA', true)
    void runtime.flushUsage()
    void runtime.flushMetrics()
  })

  it('attaches and detaches process handlers when requested', async () => {
    const sendStats = jest.fn().mockResolvedValue({})
    const onSpy = jest.spyOn(process, 'on')
    const offSpy = jest.spyOn(process, 'off')

    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats, close: jest.fn() },
      metricsClient: null,
      attachProcessHandlers: true,
    })
    runtime.start()
    expect(onSpy).toHaveBeenCalledWith('beforeExit', expect.any(Function))
    expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
    expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function))

    runtime.recordCheck('FeatureA', true)
    await runtime.close()
    expect(offSpy).toHaveBeenCalled()
    onSpy.mockRestore()
    offSpy.mockRestore()
  })

  it('skips start when both telemetry flags are off', () => {
    const sendStats = jest.fn()
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: false,
      enableMetrics: false,
      usageClient: { sendStats, close: jest.fn() },
      metricsClient: null,
      attachProcessHandlers: false,
    })
    runtime.start()
    runtime.recordCheck('FeatureA', true)
    expect(sendStats).not.toHaveBeenCalled()
  })

  it('skips flush when batchers have no data or clients are missing', async () => {
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: null,
      metricsClient: null,
      attachProcessHandlers: false,
    })
    runtime.start()
    await runtime.flush()
    await runtime.close()
  })

  it('no-ops start/close after closed and covers metrics-only timer path', async () => {
    const sendMetrics = jest.fn().mockResolvedValue({ count: 1 })
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: false,
      enableMetrics: true,
      usageFlushInterval: 0,
      metricsFlushInterval: 1000,
      usageClient: null,
      metricsClient: { sendMetrics, close: jest.fn() },
      attachProcessHandlers: false,
    })
    runtime.start()
    runtime.measure('revenue', 1)
    await jest.advanceTimersByTimeAsync(1000)
    expect(sendMetrics).toHaveBeenCalled()
    await runtime.close()
    await runtime.close()
    runtime.start()
    expect(runtime.usageEnabled).toBe(false)
    expect(runtime.metricsEnabled).toBe(false)
  })

  it('defaults transport to grpc with process handlers when not overridden', () => {
    const onSpy = jest.spyOn(process, 'on')
    const runtime = new TelemetryRuntime({
      appKey: 'app',
      environment: 'Production',
      enableUsageTracking: true,
      enableMetrics: false,
      usageFlushInterval: 0,
      metricsFlushInterval: 0,
      usageClient: { sendStats: jest.fn(), close: jest.fn() },
      metricsClient: null,
    })
    runtime.start()
    expect(onSpy).toHaveBeenCalledWith('beforeExit', expect.any(Function))
    void runtime.close()
    onSpy.mockRestore()
  })
})

describe('HttpsTelemetryClient', () => {
  it('posts ISO JSON to api/usage/stats and api/metrics with UA', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true })
    const client = new HttpsTelemetryClient({
      metricsBaseUrl: 'https://app.toggly.io/',
      userAgent: 'toggly-remix/1.9.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' })
    batcher.recordCheck('FeatureA', true, 'user-1')
    const bundle = batcher.buildAndReset()!
    const httpJson = usagePayloadToHttpJson(bundle.payload)
    expect(typeof httpJson.time).toBe('string')

    await client.sendUsageStats(bundle.payload)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://app.toggly.io/api/usage/stats')
    expect(fetchImpl.mock.calls[0][1].headers['User-Agent']).toBe('toggly-remix/1.9.0')
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string)
    expect(typeof body.time).toBe('string')
    expect(body.stats[0].variantStats.enabled.checkCount).toBe(1)
  })
})
