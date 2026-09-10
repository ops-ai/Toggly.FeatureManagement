import { UsageBatcher, type FeatureStatPayload } from '../../src/telemetry/usage-batcher'
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

  it('drops features past maxFeatures and reports hitFeatureCap', () => {
    const batcher = new UsageBatcher({
      appKey: 'app',
      environment: 'Production',
      maxFeatures: 1,
    })
    batcher.recordCheck('FeatureA', true, 'user-1')
    batcher.recordCheck('FeatureB', false, 'user-2')
    expect(batcher.hitFeatureCap()).toBe(true)
    expect(batcher.featureCount()).toBe(1)
    const payload = batcher.buildAndReset()!.payload
    expect(payload.stats).toHaveLength(1)
    expect(payload.stats[0].feature).toBe('FeatureA')
  })

  it('records usage and view without identity and keeps request/used/viewed-only variants', () => {
    const batcher = new UsageBatcher({ appKey: 'app', environment: 'Production' })
    batcher.recordUsage('FeatureA')
    batcher.recordView('FeatureA')
    batcher.recordCheck('FeatureB', true, undefined, 'only-request', true)
    batcher.recordUsage('FeatureC', undefined, 'only-used')
    batcher.recordView('FeatureD', undefined, 'only-viewed')

    const payload = batcher.buildAndReset()!.payload
    expect(payload.stats.find((s) => s.feature === 'FeatureA')!.variantStats.enabled.usedCount).toBe(
      1,
    )
    expect(payload.stats.find((s) => s.feature === 'FeatureA')!.variantStats.enabled.viewedCount).toBe(
      1,
    )
    expect(
      payload.stats.find((s) => s.feature === 'FeatureB')!.variantStats['only-request'].requestCount,
    ).toBe(1)
    expect(payload.stats.find((s) => s.feature === 'FeatureC')!.variantStats['only-used'].usedCount).toBe(
      1,
    )
    expect(
      payload.stats.find((s) => s.feature === 'FeatureD')!.variantStats['only-viewed'].viewedCount,
    ).toBe(1)
  })

  it('caps unique hashes per feature and at application scope', () => {
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
    const payload = batcher.buildAndReset()!.payload
    expect(payload.uniqueUserHashes).toHaveLength(1)
    expect(payload.stats[0].uniqueContextIdentifierEnabledCount).toBe(1)
    // Per-set caps: used/viewed sets still accept their first hash even when appUnique is full.
    expect(payload.stats[0].uniqueUsersUsedCount).toBe(1)
    expect(payload.stats[0].uniqueViewedUserHashes).toHaveLength(1)
  })

  it('skips recordUsage/recordView when the feature cap is already hit', () => {
    const batcher = new UsageBatcher({
      appKey: 'app',
      environment: 'Production',
      maxFeatures: 1,
    })
    batcher.recordCheck('FeatureA', true)
    batcher.recordUsage('FeatureB', 'user-1')
    batcher.recordView('FeatureC', 'user-2')
    expect(batcher.hitFeatureCap()).toBe(true)
    expect(batcher.featureCount()).toBe(1)
    const payload = batcher.buildAndReset()!.payload
    expect(payload.stats).toHaveLength(1)
    expect(payload.stats[0].feature).toBe('FeatureA')
  })

  it('restoreFromBundle tolerates sparse payloads, empty feature keys, and feature caps', () => {
    const capped = new UsageBatcher({
      appKey: 'app',
      environment: 'Production',
      maxFeatures: 1,
    })
    capped.recordCheck('Keep', true, 'seed')

    capped.restoreFromBundle({
      payload: {
        appKey: 'app',
        environment: 'Production',
        time: { seconds: 1, nanos: 0 },
        stats: [
          {
            feature: '',
            uniqueContextIdentifierEnabledCount: 0,
            uniqueContextIdentifierDisabledCount: 0,
            uniqueUsersUsedCount: 0,
            uniqueUserHashes: [],
            uniqueViewedUserHashes: [],
            variantStats: {},
          },
          {
            feature: 'Dropped',
            uniqueContextIdentifierEnabledCount: 0,
            uniqueContextIdentifierDisabledCount: 0,
            uniqueUsersUsedCount: 0,
            uniqueUserHashes: [9],
            uniqueViewedUserHashes: [10],
            variantStats: { enabled: { checkCount: 1, requestCount: 0, usedCount: 0, viewedCount: 0 } },
          },
          {
            feature: 'Keep',
            uniqueContextIdentifierEnabledCount: 0,
            uniqueContextIdentifierDisabledCount: 0,
            uniqueUsersUsedCount: 0,
            uniqueUserHashes: [11],
            uniqueViewedUserHashes: [12],
            variantStats: {
              enabled: {
                checkCount: undefined as unknown as number,
                requestCount: undefined as unknown as number,
                usedCount: undefined as unknown as number,
                viewedCount: undefined as unknown as number,
              },
            },
          },
        ],
        totalUniqueUsers: 0,
        // exercise ?? fallbacks
        uniqueUserHashes: undefined as unknown as number[],
      },
      uniqueUsersEnabled: { Dropped: [1], Keep: [2] },
      uniqueUsersDisabled: undefined as unknown as Record<string, number[]>,
      uniqueUsersUsed: { Keep: [3] },
    })

    const restored = capped.buildAndReset()!.payload
    expect(restored.stats.map((s) => s.feature)).toEqual(['Keep'])
    expect(restored.stats[0].uniqueUserHashes).toContain(11)
    expect(restored.stats[0].uniqueViewedUserHashes).toContain(12)

    const emptyish = new UsageBatcher({ appKey: 'app', environment: 'Production' })
    emptyish.restoreFromBundle({
      payload: {
        appKey: 'app',
        environment: 'Production',
        time: { seconds: 1, nanos: 0 },
        stats: undefined as unknown as FeatureStatPayload['stats'],
        totalUniqueUsers: 0,
        uniqueUserHashes: [42],
      },
      uniqueUsersEnabled: {},
      uniqueUsersDisabled: {},
      uniqueUsersUsed: {},
    })
    // App unique hashes alone still flush.
    expect(emptyish.buildAndReset()!.payload.uniqueUserHashes).toContain(42)

    const sparseVariants = new UsageBatcher({ appKey: 'app', environment: 'Production' })
    sparseVariants.restoreFromBundle({
      payload: {
        appKey: 'app',
        environment: 'Production',
        time: { seconds: 1, nanos: 0 },
        stats: [
          {
            feature: 'Sparse',
            uniqueContextIdentifierEnabledCount: 0,
            uniqueContextIdentifierDisabledCount: 0,
            uniqueUsersUsedCount: 0,
            uniqueUserHashes: undefined as unknown as number[],
            uniqueViewedUserHashes: undefined as unknown as number[],
            variantStats: undefined as unknown as Record<string, never>,
          },
        ],
        totalUniqueUsers: 0,
        uniqueUserHashes: [],
      },
      uniqueUsersEnabled: {},
      uniqueUsersDisabled: {},
      uniqueUsersUsed: {},
    })
    expect(sparseVariants.featureCount()).toBe(1)
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
