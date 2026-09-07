import { MetricsBatcher } from '../../src/telemetry/metrics-batcher'

describe('MetricsBatcher', () => {
  it('aggregates measures/counters/observations into variantValues', () => {
    const batcher = new MetricsBatcher({
      appKey: 'app',
      environment: 'Production',
      instanceName: 'host-1',
    })

    batcher.measure('revenue', 10, { feature: 'Checkout', variant: 'enabled' })
    batcher.measure('revenue', 5, { feature: 'Checkout', variant: 'enabled' })
    batcher.incrementCounter('clicks', 2)
    batcher.observe('depth', 3, { variant: 'enabled' })

    const payload = batcher.buildAndReset()
    expect(payload).not.toBeNull()
    expect(payload!.appKey).toBe('app')
    expect(payload!.instanceName).toBe('host-1')
    expect(payload!.stats).toEqual([
      {
        metric: 'revenue',
        feature: 'Checkout',
        variantValues: { enabled: 15 },
      },
    ])
    expect(payload!.counters).toEqual([
      { metric: 'clicks', variantValues: { enabled: 2 } },
    ])
    expect(payload!.observations).toHaveLength(1)
    expect(payload!.observations[0].metric).toBe('depth')
    expect(payload!.observations[0].variantValues.enabled).toBe(3)
    expect(batcher.buildAndReset()).toBeNull()
  })

  it('restoreFromPayload rehydrates measures, counters, and observations', () => {
    const batcher = new MetricsBatcher({ appKey: 'app', environment: 'Production' })
    batcher.measure('revenue', 10, { feature: 'Checkout', variant: 'enabled' })
    batcher.incrementCounter('clicks', 2)
    batcher.observe('depth', 3, { feature: 'Checkout', variant: 'enabled' })
    const payload = batcher.buildAndReset()
    expect(payload).not.toBeNull()

    batcher.restoreFromPayload(payload!)
    const again = batcher.buildAndReset()!
    expect(again.stats[0].variantValues.enabled).toBe(10)
    expect(again.counters[0].variantValues.enabled).toBe(2)
    expect(again.observations[0].variantValues.enabled).toBe(3)
  })

  it('drops new metric keys and observations past caps', () => {
    const batcher = new MetricsBatcher({
      appKey: 'app',
      environment: 'Production',
      maxMetricKeys: 1,
      maxObservations: 1,
    })
    batcher.measure('a', 1)
    batcher.measure('b', 1)
    batcher.observe('o1', 1)
    batcher.observe('o2', 1)
    expect(batcher.hitCap()).toBe(true)
    const payload = batcher.buildAndReset()!
    expect(payload.stats).toHaveLength(1)
    expect(payload.observations).toHaveLength(1)
  })

  it('restoreFromPayload tolerates missing collections and empty variant maps', () => {
    const batcher = new MetricsBatcher({ appKey: 'app', environment: 'Production' })
    batcher.restoreFromPayload({
      appKey: 'app',
      environment: 'Production',
      time: { seconds: 1, nanos: 0 },
      stats: undefined,
      counters: undefined,
      observations: undefined,
    } as never)
    expect(batcher.buildAndReset()).toBeNull()

    batcher.restoreFromPayload({
      appKey: 'app',
      environment: 'Production',
      time: { seconds: 1, nanos: 0 },
      stats: [{ metric: 'm', variantValues: undefined as never }],
      counters: [{ metric: 'c', variantValues: undefined as never }],
      observations: [
        {
          metric: 'o',
          value: 1,
          time: { seconds: 1, nanos: 0 },
          variantValues: undefined as never,
        },
      ],
    })
    // Undefined variant maps contribute nothing.
    expect(batcher.buildAndReset()).toBeNull()

    // Feature-less metric keys (empty feature segment after separator).
    batcher.incrementCounter('clicks', 1, { feature: '' })
    const payload = batcher.buildAndReset()!
    expect(payload.counters[0].metric).toBe('clicks')
    expect(payload.counters[0].feature).toBeUndefined()
  })
})
