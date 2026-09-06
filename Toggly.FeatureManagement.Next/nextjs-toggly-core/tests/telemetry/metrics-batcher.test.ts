import { describe, it, expect } from 'vitest'
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
})
