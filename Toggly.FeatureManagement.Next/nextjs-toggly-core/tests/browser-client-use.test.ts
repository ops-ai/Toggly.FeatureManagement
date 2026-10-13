import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTogglyClient } from '../src/browser-client'

describe('browser client use()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('records attempt and soft-fail through the browser reporter', async () => {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })
    vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/api/frontend/telemetry')) {
          bodies.push(JSON.parse(String(init?.body)))
          return { status: 202, ok: true }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ FeatureA: true }),
          text: async () => JSON.stringify({ FeatureA: true }),
        }
      }),
    )

    const client = createTogglyClient({
      appKey: 'app',
      environment: 'Test',
      enableUsageTracking: true,
      enableMetrics: false,
      refreshInterval: 0,
      enableLiveUpdates: false,
      metricsBaseUrl: 'https://collector.example',
    })
    await client.init()
    await client.use('Scoped', async () => undefined)
    await client.use('Scoped', async (scope) => {
      scope.fail()
    })
    await client.flushTelemetry()

    expect(bodies).toHaveLength(1)
    const scoped = (bodies[0].f as Record<string, Record<string, number[]>>).Scoped.enabled
    expect(scoped[1]).toBe(2)
    expect(scoped[3]).toBe(1)
    await client.close()
  })

  it('invokes the callback when usage tracking is disabled', async () => {
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })
    vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} })
    const client = createTogglyClient({
      appKey: 'app',
      enableUsageTracking: false,
      refreshInterval: 0,
      enableLiveUpdates: false,
    })
    let ran = false
    await client.use('Offline', async (scope) => {
      scope.fail()
      ran = true
    })
    expect(ran).toBe(true)
    await client.close()
  })
})
