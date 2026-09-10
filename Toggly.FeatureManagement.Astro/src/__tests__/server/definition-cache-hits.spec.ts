import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TogglyServer } from '../../server/toggly-server.js'
import { SDK_VERSION, sdkUserAgent } from '../../sdk-identity.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function createMockResponse(body: unknown, status = 200) {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: () => Promise.resolve(bodyText),
    json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
  }
}

function featureDefs(flags: Record<string, boolean>) {
  return Object.entries(flags).map(([featureKey, enabled]) => ({
    featureKey,
    filters: [{ name: enabled ? 'AlwaysOn' : 'AlwaysOff', parameters: {} }],
  }))
}

function createDefsResponse(flags: Record<string, boolean>) {
  return createMockResponse(featureDefs(flags))
}

function telemetryOptions(sendStats: ReturnType<typeof vi.fn>) {
  return {
    appKey: 'test-key',
    environment: 'Production' as const,
    enableUsageTracking: true,
    usageFlushInterval: 0,
    telemetryAttachProcessHandlers: false,
    usageClient: { sendStats, close: vi.fn() },
  }
}

describe('Astro server definition cache hit telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('records a miss on network apply and a hit on TTL skip', async () => {
    mockFetch.mockResolvedValue(createDefsResponse({ Feature1: true }))
    const sendStats = vi.fn().mockResolvedValue({ ok: true })
    const server = new TogglyServer({
      ...telemetryOptions(sendStats),
      featureFlagsRefreshInterval: 180_000,
    })

    await server.getFlags()
    await server.getFlags() // TTL still valid → hit (once)
    await server.flushTelemetry()

    const payload = sendStats.mock.calls[0]![0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.definitionCacheHits).toBe(1)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    await server.close()
  })

  it('does not increment again for extra getFlag evaluates in the same TTL window', async () => {
    mockFetch.mockResolvedValue(createDefsResponse({ A: true, B: false, C: true }))
    const sendStats = vi.fn().mockResolvedValue({ ok: true })
    const server = new TogglyServer({
      ...telemetryOptions(sendStats),
      featureFlagsRefreshInterval: 180_000,
    })

    await server.getFlags() // miss
    await server.getFlag('A')
    await server.getFlag('B')
    await server.getFlag('C')
    await server.flushTelemetry()

    const payload = sendStats.mock.calls[0]![0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.definitionCacheHits).toBe(1)
    await server.close()
  })

  it('records a hit when network fails and last-good defs are kept', async () => {
    mockFetch
      .mockResolvedValueOnce(createDefsResponse({ Feature1: true }))
      .mockRejectedValueOnce(new Error('network down'))

    const sendStats = vi.fn().mockResolvedValue({ ok: true })
    const server = new TogglyServer({
      ...telemetryOptions(sendStats),
      featureFlagsRefreshInterval: 1_000,
    })

    await server.getFlags()
    vi.advanceTimersByTime(1_500)
    await server.getFlags()
    await server.flushTelemetry()

    const payload = sendStats.mock.calls[0]![0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.definitionCacheHits).toBe(1)
    await server.close()
  })

  it('does not record a hit on network failure when only flagDefaults exist', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'))
    const sendStats = vi.fn().mockResolvedValue({ ok: true })
    const server = new TogglyServer({
      ...telemetryOptions(sendStats),
      flagDefaults: { Feature1: true },
    })

    await server.getFlags()
    await server.flushTelemetry()

    expect(sendStats).not.toHaveBeenCalled()
    await server.close()
  })

  it('does not count concurrent in-flight refresh skips', async () => {
    let resolveFirst!: (value: unknown) => void
    const firstFetch = new Promise((resolve) => {
      resolveFirst = resolve
    })

    mockFetch.mockImplementationOnce(() => firstFetch)

    const sendStats = vi.fn().mockResolvedValue({ ok: true })
    const server = new TogglyServer(telemetryOptions(sendStats))

    const p1 = server.refreshFlags()
    const p2 = server.refreshFlags()

    resolveFirst(createDefsResponse({ Feature1: true }))
    await Promise.all([p1, p2])
    await server.flushTelemetry()

    const payload = sendStats.mock.calls[0]![0] as {
      definitionCacheHits?: number
      definitionCacheMisses?: number
    }
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.definitionCacheHits).toBeUndefined()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    await server.close()
  })

  it('flushes cache-only batches over HTTPS with toggly-astro UA', async () => {
    const telemetryFetch = vi.fn().mockResolvedValue({ ok: true })
    mockFetch.mockResolvedValue(createDefsResponse({ Feature1: true }))

    const server = new TogglyServer({
      appKey: 'test-key',
      environment: 'Production',
      enableUsageTracking: true,
      usageFlushInterval: 0,
      telemetryAttachProcessHandlers: false,
      metricsBaseUrl: 'https://app.example/',
      telemetryFetch: telemetryFetch as unknown as typeof fetch,
      featureFlagsRefreshInterval: 180_000,
    })

    await server.getFlags()
    await server.getFlags()
    await server.flushTelemetry()

    expect(telemetryFetch).toHaveBeenCalled()
    const [url, init] = telemetryFetch.mock.calls[0]!
    expect(String(url)).toBe('https://app.example/api/usage/stats')
    expect((init as RequestInit).headers).toMatchObject({
      'User-Agent': sdkUserAgent(),
    })
    expect(sdkUserAgent()).toBe(`toggly-astro/${SDK_VERSION}`)
    expect(SDK_VERSION).toBe('1.14.0')

    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.definitionCacheMisses).toBe(1)
    expect(body.definitionCacheHits).toBe(1)
    // appVersion is consuming-app identity only — never defaulted to SDK_VERSION
    expect(body.appVersion).toBeUndefined()
    await server.close()
  })

  it('includes configured appVersion on usage payloads without using SDK_VERSION', async () => {
    const sendStats = vi.fn().mockResolvedValue({ ok: true })
    mockFetch.mockResolvedValue(createDefsResponse({ Feature1: true }))

    const server = new TogglyServer({
      ...telemetryOptions(sendStats),
      appVersion: 'app-deploy-9',
    })

    await server.getFlags()
    await server.flushTelemetry()

    expect(sendStats).toHaveBeenCalled()
    const payload = sendStats.mock.calls[0]![0] as Record<string, unknown>
    expect(payload.appVersion).toBe('app-deploy-9')
    expect(payload.appVersion).not.toBe(SDK_VERSION)
    await server.close()
  })

  it('honors TOGGLY_DISABLE_TELEMETRY=1', async () => {
    vi.stubEnv('TOGGLY_DISABLE_TELEMETRY', '1')
    mockFetch.mockResolvedValue(createDefsResponse({ Feature1: true }))
    const sendStats = vi.fn().mockResolvedValue({ ok: true })

    const server = new TogglyServer({
      ...telemetryOptions(sendStats),
      enableUsageTracking: true,
    })

    await server.getFlags()
    await server.flushTelemetry()
    expect(sendStats).not.toHaveBeenCalled()
    await server.close()
  })
})
