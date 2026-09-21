import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTogglyClient } from '../../src/client'
import type {
  FrontendTelemetryFactory,
  FrontendTelemetryRuntime,
} from '../../src/types'

function runtime() {
  const value: FrontendTelemetryRuntime = {
    usageEnabled: true,
    metricsEnabled: true,
    recordCheck: vi.fn(),
    recordUsage: vi.fn(),
    recordView: vi.fn(),
    incrementCounter: vi.fn(),
    setGauge: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    unsupported: vi.fn(),
  }
  return value
}

describe('browser frontend telemetry bridge', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{}')))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('records effective local and entity-gated outcomes before negation with short-circuiting', async () => {
    const telemetry = runtime()
    const factory: FrontendTelemetryFactory = vi.fn(() => telemetry)
    const client = createTogglyClient({
      appKey: 'app',
      featureDefaults: {
        locallyBlocked: true,
        entityFlag: {
          requirement: 'all',
          rules: [{ property: 'Plan', op: 'eq', value: 'pro', type: 'string' }],
        },
        skipped: true,
      },
      localGates: [{ id: 'blocked', flagKeys: ['locallyBlocked'], isEnabled: () => false }],
      refreshInterval: 0,
      enableLiveUpdates: false,
      frontendTelemetryFactory: factory,
    })

    await client.init()
    expect(await client.isFeatureOn('locallyBlocked')).toBe(false)
    expect(await client.isFeatureOn('entityFlag', {
      kind: 'Tenant',
      key: 'allowed',
      attributes: { Plan: 'pro' },
    })).toBe(true)
    expect(await client.evaluateFeatureGate(['locallyBlocked', 'skipped'], 'all', true)).toBe(true)

    expect(telemetry.recordCheck).toHaveBeenNthCalledWith(1, 'locallyBlocked', 'disabled')
    expect(telemetry.recordCheck).toHaveBeenNthCalledWith(2, 'entityFlag', 'enabled')
    expect(telemetry.recordCheck).toHaveBeenNthCalledWith(3, 'locallyBlocked', 'disabled')
    expect(telemetry.recordCheck).toHaveBeenCalledTimes(3)
    client.destroy()
  })

  it('keeps legacy identity second and variant third while compact metrics omit feature options', async () => {
    const telemetry = runtime()
    const client = createTogglyClient({
      appKey: 'app',
      refreshInterval: 0,
      enableLiveUpdates: false,
      frontendTelemetryFactory: () => telemetry,
    })
    await client.init()

    client.recordUsage('flag', 'identity-is-not-a-variant', 'blue')
    client.recordView('flag', 'identity-is-not-a-variant', 'green')
    client.incrementCounter('clicks', 2, { feature: 'must-not-leak' })
    client.setGauge('depth', 3)
    client.measure('duration', 1.5, { feature: 'must-not-leak' })
    client.observe('legacy-gauge', 7, { variant: 'must-not-leak' })
    await client.flushTelemetry()

    expect(telemetry.recordUsage).toHaveBeenCalledWith('flag', 'blue')
    expect(telemetry.recordView).toHaveBeenCalledWith('flag', 'green')
    expect(telemetry.incrementCounter).toHaveBeenCalledWith('clicks', 2)
    expect(telemetry.setGauge).toHaveBeenCalledWith('depth', 3)
    expect(telemetry.unsupported).toHaveBeenCalledWith('measure')
    expect(telemetry.unsupported).toHaveBeenCalledWith('observe')
    expect(telemetry.flush).toHaveBeenCalledOnce()
    client.destroy()
  })

  it('preserves one owner for same routing and isolates changed app or environment', async () => {
    const first = runtime()
    const second = runtime()
    const factory = vi.fn<FrontendTelemetryFactory>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const client = createTogglyClient({
      appKey: 'old-app',
      environment: 'old-env',
      refreshInterval: 0,
      enableLiveUpdates: false,
      frontendTelemetryFactory: factory,
    })

    await client.init()
    await client.init()
    expect(factory).toHaveBeenCalledTimes(1)

    await client.init({ appKey: 'new-app', environment: 'new-env' })
    expect(first.dispose).toHaveBeenCalledOnce()
    expect(factory).toHaveBeenCalledTimes(2)
    client.recordUsage('new-flag', undefined, 'blue')
    expect(first.recordUsage).not.toHaveBeenCalled()
    expect(second.recordUsage).toHaveBeenCalledWith('new-flag', 'blue')
    client.destroy()
    expect(second.dispose).toHaveBeenCalledOnce()
  })

  it('does not restart lifecycle resources when initialization completes after destroy', async () => {
    let resolveFetch!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveFetch = resolve })))
    const telemetry = runtime()
    const client = createTogglyClient({
      appKey: 'app',
      refreshInterval: 1000,
      enableLiveUpdates: false,
      frontendTelemetryFactory: () => telemetry,
    })

    const pending = client.init()
    client.destroy()
    resolveFetch(new Response('{}'))
    await pending

    expect(telemetry.dispose).toHaveBeenCalledOnce()
    await expect(client.refresh()).rejects.toThrow('destroyed')
  })
})
