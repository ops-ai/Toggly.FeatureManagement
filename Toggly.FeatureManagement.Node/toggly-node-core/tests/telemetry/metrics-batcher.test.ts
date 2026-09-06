import { describe, it, expect } from 'vitest'
import { MetricsBatcher } from '../../src/telemetry/metrics-batcher'

describe('MetricsBatcher', () => {
  it('aggregates measure/increment/observe into variantValues', () => {
    const batcher = new MetricsBatcher({
      appKey: 'app',
      environment: 'Production',
      instanceName: 'host-1',
    })

    batcher.measure('revenue', 10)
    batcher.measure('revenue', 5, { feature: 'Checkout', variant: 'enabled' })
    batcher.measure('revenue', 2, { feature: 'Checkout', variant: 'disabled' })
    batcher.incrementCounter('clicks', 3)
    batcher.incrementCounter('clicks', 1, { feature: 'Banner' })
    batcher.observe('latency_ms', 12.5)
    batcher.observe('latency_ms', 8, { feature: 'Checkout', variant: 'control' })

    const payload = batcher.buildAndReset()
    expect(payload).not.toBeNull()
    expect(payload!.appKey).toBe('app')
    expect(payload!.instanceName).toBe('host-1')

    const globalRevenue = payload!.stats.find((s) => s.metric === 'revenue' && !s.feature)
    expect(globalRevenue?.variantValues.enabled).toBe(10)

    const checkoutRevenue = payload!.stats.find(
      (s) => s.metric === 'revenue' && s.feature === 'Checkout',
    )
    expect(checkoutRevenue?.variantValues.enabled).toBe(5)
    expect(checkoutRevenue?.variantValues.disabled).toBe(2)

    const clicks = payload!.counters.find((c) => c.metric === 'clicks' && !c.feature)
    expect(clicks?.variantValues.enabled).toBe(3)

    const bannerClicks = payload!.counters.find(
      (c) => c.metric === 'clicks' && c.feature === 'Banner',
    )
    expect(bannerClicks?.variantValues.enabled).toBe(1)

    expect(payload!.observations.length).toBeGreaterThanOrEqual(2)
    const globalObs = payload!.observations.find((o) => o.metric === 'latency_ms' && !o.feature)
    expect(globalObs?.variantValues.enabled).toBe(12.5)
    const checkoutObs = payload!.observations.find(
      (o) => o.metric === 'latency_ms' && o.feature === 'Checkout',
    )
    expect(checkoutObs?.variantValues.control).toBe(8)

    expect(batcher.buildAndReset()).toBeNull()
  })
})
