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
})
