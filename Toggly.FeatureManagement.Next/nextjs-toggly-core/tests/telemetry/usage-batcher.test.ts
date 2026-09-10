import { describe, it, expect } from 'vitest'
import { UsageBatcher } from '../../src/telemetry/usage-batcher'
import { hashIdentity } from '../../src/telemetry/hash'

describe('UsageBatcher', () => {
  it('aggregates checks into variantStats enabled/disabled', () => {
    const batcher = new UsageBatcher({
      appKey: 'app',
      environment: 'Production',
      instanceName: 'host-1',
      appVersion: '1.2.3',
    })

    batcher.recordCheck('FeatureA', true, 'user-1')
    batcher.recordCheck('FeatureA', true, 'user-1')
    batcher.recordCheck('FeatureA', false, 'user-2')
    batcher.recordUsage('FeatureA', 'user-1')
    batcher.recordView('FeatureA', 'user-3')

    const bundle = batcher.buildAndReset()
    expect(bundle).not.toBeNull()
    const payload = bundle!.payload
    expect(payload.appKey).toBe('app')
    expect(payload.environment).toBe('Production')
    expect(payload.instanceName).toBe('host-1')
    expect(payload.appVersion).toBe('1.2.3')
    expect(payload.processStartTime).toBeDefined()
    expect(payload.stats).toHaveLength(1)

    const stat = payload.stats[0]
    expect(stat.feature).toBe('FeatureA')
    expect(stat.variantStats.enabled.checkCount).toBe(2)
    expect(stat.variantStats.enabled.requestCount).toBe(0)
    expect(stat.variantStats.enabled.usedCount).toBe(1)
    expect(stat.variantStats.enabled.viewedCount).toBe(1)
    expect(stat.variantStats.disabled.checkCount).toBe(1)
    expect(stat.uniqueContextIdentifierEnabledCount).toBe(1)
    expect(stat.uniqueContextIdentifierDisabledCount).toBe(1)
    expect(stat.uniqueUsersUsedCount).toBe(1)
    expect(stat.uniqueUserHashes).toContain(hashIdentity('user-1'))
    expect(stat.uniqueViewedUserHashes).toContain(hashIdentity('user-3'))
    expect(payload.uniqueUserHashes).toEqual(
      expect.arrayContaining([
        hashIdentity('user-1'),
        hashIdentity('user-2'),
        hashIdentity('user-3'),
      ]),
    )

    expect(batcher.buildAndReset()).toBeNull()
  })

  it('increments requestCount only when uniqueRequest is true', () => {
    const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' })

    batcher.recordCheck('FeatureA', true, 'user-1', undefined, true)
    batcher.recordCheck('FeatureA', true, 'user-1', undefined, false)
    batcher.recordCheck('FeatureA', false, 'user-2', undefined, true)

    const payload = batcher.buildAndReset()!.payload
    expect(payload.stats[0].variantStats.enabled.checkCount).toBe(2)
    expect(payload.stats[0].variantStats.enabled.requestCount).toBe(1)
    expect(payload.stats[0].variantStats.disabled.checkCount).toBe(1)
    expect(payload.stats[0].variantStats.disabled.requestCount).toBe(1)
  })

  it('uses UTF-8 FNV-1a signed int32 identity hashes (Go-compatible)', () => {
    expect(hashIdentity('alice')).toBe(-2027809817)
    expect(hashIdentity('café')).toBe(-1473556407)
    expect(hashIdentity('🚀')).toBe(2141686490)
  })

  it('restoreFromBundle rehydrates variant and unique hashes after soft-fail', () => {
    const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' })
    batcher.recordCheck('FeatureA', true, 'user-1', undefined, true)
    batcher.recordView('FeatureA', 'user-2')
    const bundle = batcher.buildAndReset()
    expect(bundle).not.toBeNull()
    expect(batcher.buildAndReset()).toBeNull()

    batcher.restoreFromBundle(bundle!)
    const again = batcher.buildAndReset()!.payload
    expect(again.stats[0].variantStats.enabled.checkCount).toBe(1)
    expect(again.stats[0].variantStats.enabled.viewedCount).toBe(1)
    expect(again.uniqueUserHashes).toEqual(
      expect.arrayContaining([hashIdentity('user-1'), hashIdentity('user-2')]),
    )
  })

  it('includes definition cache hits/misses on flush and resets them', () => {
    const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' })

    batcher.recordDefinitionCacheHit()
    batcher.recordDefinitionCacheHit()
    batcher.recordDefinitionCacheMiss()

    const bundle = batcher.buildAndReset()
    expect(bundle).not.toBeNull()
    expect(bundle!.payload.definitionCacheHits).toBe(2)
    expect(bundle!.payload.definitionCacheMisses).toBe(1)
    expect(bundle!.payload.stats).toEqual([])

    expect(batcher.buildAndReset()).toBeNull()
  })

  it('does not omit cache-only batches when feature stats are empty', () => {
    const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' })
    batcher.recordDefinitionCacheHit()
    expect(batcher.isEmpty()).toBe(false)
    expect(batcher.buildAndReset()?.payload.definitionCacheHits).toBe(1)
  })

  it('restoreFromBundle merges definition cache counters with in-flight records', () => {
    const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' })
    batcher.recordCheck('FeatureA', true, 'user-1')
    batcher.recordDefinitionCacheHit()
    batcher.recordDefinitionCacheMiss()

    const drained = batcher.buildAndReset()
    expect(drained).not.toBeNull()

    batcher.recordCheck('FeatureA', true, 'user-2')
    batcher.recordDefinitionCacheHit()

    batcher.restoreFromBundle(drained!)

    const payload = batcher.buildAndReset()!.payload
    expect(payload.definitionCacheHits).toBe(2)
    expect(payload.definitionCacheMisses).toBe(1)
    expect(payload.stats[0].variantStats.enabled.checkCount).toBe(2)
  })
})
