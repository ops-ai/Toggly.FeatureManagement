import { describe, it, expect } from 'vitest'
import { UsageBatcher } from '../../telemetry/usage-batcher.js'
import { hashIdentity } from '../../telemetry/hash.js'

describe('UsageBatcher', () => {
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

  it('uses UTF-8 FNV-1a signed int32 identity hashes (Go-compatible)', () => {
    expect(hashIdentity('alice')).toBe(-2027809817)
    expect(hashIdentity('café')).toBe(-1473556407)
    expect(hashIdentity('🚀')).toBe(2141686490)
  })

  it('records checks, usage, and views with identity and variant branches', () => {
    const batcher = new UsageBatcher({
      appKey: 'app',
      environment: 'Production',
      instanceName: 'node-1',
      appVersion: '1.2.3',
    })

    batcher.recordCheck('FeatureA', true, 'alice', undefined, true)
    batcher.recordCheck('FeatureA', false, 'bob')
    batcher.recordCheck('FeatureA', true, undefined, 'control')
    batcher.recordUsage('FeatureA', 'alice')
    batcher.recordUsage('FeatureA')
    batcher.recordView('FeatureA', 'alice', 'treatment')
    batcher.recordView('FeatureB')

    const bundle = batcher.buildAndReset()
    expect(bundle).not.toBeNull()
    expect(bundle!.payload.instanceName).toBe('node-1')
    expect(bundle!.payload.appVersion).toBe('1.2.3')
    expect(bundle!.payload.totalUniqueUsers).toBeGreaterThan(0)

    const featureA = bundle!.payload.stats.find((s) => s.feature === 'FeatureA')!
    expect(featureA.variantStats.enabled.checkCount).toBe(1)
    expect(featureA.variantStats.enabled.requestCount).toBe(1)
    expect(featureA.variantStats.disabled.checkCount).toBe(1)
    expect(featureA.variantStats.control.checkCount).toBe(1)
    expect(featureA.variantStats.enabled.usedCount).toBe(2)
    expect(featureA.variantStats.treatment.viewedCount).toBe(1)
    expect(featureA.uniqueContextIdentifierEnabledCount).toBe(1)
    expect(featureA.uniqueContextIdentifierDisabledCount).toBe(1)
    expect(bundle!.uniqueUsersEnabled.FeatureA).toContain(hashIdentity('alice'))
    expect(bundle!.uniqueUsersDisabled.FeatureA).toContain(hashIdentity('bob'))
    expect(bundle!.uniqueUsersUsed.FeatureA).toContain(hashIdentity('alice'))
  })

  it('drops new features once the per-batch feature cap is hit', () => {
    const batcher = new UsageBatcher({
      appKey: 'app',
      environment: 'Production',
      maxFeatures: 1,
    })
    batcher.recordCheck('Keep', true)
    batcher.recordCheck('Drop', true)
    batcher.recordUsage('Drop', 'u1')
    batcher.recordView('Drop', 'u1')
    expect(batcher.hitFeatureCap()).toBe(true)
    expect(batcher.featureCount()).toBe(1)

    const payload = batcher.buildAndReset()!.payload
    expect(payload.stats).toHaveLength(1)
    expect(payload.stats[0].feature).toBe('Keep')
  })

  it('caps unique hashes and restores sparse / empty restore fields', () => {
    const batcher = new UsageBatcher({
      appKey: 'app',
      environment: 'Production',
      maxUniqueHashesPerFeature: 1,
      maxApplicationUniqueHashes: 1,
    })
    batcher.recordCheck('FeatureA', true, 'user-1')
    batcher.recordCheck('FeatureA', true, 'user-2')
    batcher.recordUsage('FeatureA', 'user-3')
    batcher.recordView('FeatureA', 'user-4')

    const drained = batcher.buildAndReset()!
    expect(drained.payload.uniqueUserHashes).toHaveLength(1)
    expect(drained.payload.stats[0].uniqueUserHashes).toHaveLength(1)

    // Empty-ish restore paths: missing optional maps / zero counters.
    batcher.restoreFromBundle({
      payload: {
        ...drained.payload,
        definitionCacheHits: undefined,
        definitionCacheMisses: undefined,
        stats: [
          {
            feature: 'FeatureA',
            uniqueContextIdentifierEnabledCount: 0,
            uniqueContextIdentifierDisabledCount: 0,
            uniqueUsersUsedCount: 0,
            uniqueUserHashes: [],
            uniqueViewedUserHashes: [hashIdentity('viewer')],
            variantStats: {
              enabled: { checkCount: 0, requestCount: 1, usedCount: 0, viewedCount: 0 },
            },
          },
          {
            feature: '',
            uniqueContextIdentifierEnabledCount: 0,
            uniqueContextIdentifierDisabledCount: 0,
            uniqueUsersUsedCount: 0,
            uniqueUserHashes: [],
            uniqueViewedUserHashes: [],
            variantStats: {},
          },
        ],
      },
      uniqueUsersEnabled: {},
      uniqueUsersDisabled: {},
      uniqueUsersUsed: { FeatureA: [hashIdentity('user-1')] },
    })

    const again = batcher.buildAndReset()!.payload
    expect(again.stats[0].variantStats.enabled.requestCount).toBe(1)
    expect(again.stats[0].uniqueViewedUserHashes).toContain(hashIdentity('viewer'))
  })
})
