import { describe, it, expect } from 'vitest'
import { UsageBatcher } from '../../src/telemetry/usage-batcher'
import { hashIdentity } from '../../src/telemetry/grpc-clients'

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

    const payload = batcher.buildAndReset()
    expect(payload).not.toBeNull()
    expect(payload!.appKey).toBe('app')
    expect(payload!.environment).toBe('Production')
    expect(payload!.instanceName).toBe('host-1')
    expect(payload!.appVersion).toBe('1.2.3')
    expect(payload!.processStartTime).toBeDefined()
    expect(payload!.stats).toHaveLength(1)

    const stat = payload!.stats[0]
    expect(stat.feature).toBe('FeatureA')
    expect(stat.variantStats.enabled.checkCount).toBe(2)
    // Without uniqueRequest, requestCount stays 0 (not every check).
    expect(stat.variantStats.enabled.requestCount).toBe(0)
    expect(stat.variantStats.enabled.usedCount).toBe(1)
    expect(stat.variantStats.enabled.viewedCount).toBe(1)
    expect(stat.variantStats.disabled.checkCount).toBe(1)
    expect(stat.uniqueContextIdentifierEnabledCount).toBe(1)
    expect(stat.uniqueContextIdentifierDisabledCount).toBe(1)
    expect(stat.uniqueUsersUsedCount).toBe(1)
    expect(stat.uniqueUserHashes).toContain(hashIdentity('user-1'))
    expect(stat.uniqueViewedUserHashes).toContain(hashIdentity('user-3'))
    expect(payload!.uniqueUserHashes).toEqual(
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

    // Two checks in one logical request: only the first is unique.
    batcher.recordCheck('FeatureA', true, 'user-1', undefined, true)
    batcher.recordCheck('FeatureA', true, 'user-1', undefined, false)
    // Separate request scope for disabled.
    batcher.recordCheck('FeatureA', false, 'user-2', undefined, true)

    const payload = batcher.buildAndReset()
    expect(payload!.stats[0].variantStats.enabled.checkCount).toBe(2)
    expect(payload!.stats[0].variantStats.enabled.requestCount).toBe(1)
    expect(payload!.stats[0].variantStats.disabled.checkCount).toBe(1)
    expect(payload!.stats[0].variantStats.disabled.requestCount).toBe(1)
  })

  it('uses UTF-8 FNV-1a signed int32 identity hashes (Go-compatible)', () => {
    expect(hashIdentity('alice')).toBeTypeOf('number')
    expect(Number.isInteger(hashIdentity('alice'))).toBe(true)
    expect(hashIdentity('alice')).toBe(hashIdentity('alice'))
    expect(hashIdentity('alice')).not.toBe(hashIdentity('bob'))

    // Go hash/fnv New32a on []byte(s), cast to int32 — fixtures from `go run`.
    expect(hashIdentity('alice')).toBe(-2027809817)
    expect(hashIdentity('café')).toBe(-1473556407)
    expect(hashIdentity('🚀')).toBe(2141686490)

    // UTF-8 multi-byte must differ from charCodeAt / UTF-16 unit hashing.
    let utf16Style = 2166136261
    for (let i = 0; i < 'café'.length; i++) {
      utf16Style ^= 'café'.charCodeAt(i)
      utf16Style = Math.imul(utf16Style, 16777619)
    }
    const utf16Signed =
      (utf16Style >>> 0) > 0x7fffffff ? (utf16Style >>> 0) - 0x100000000 : utf16Style >>> 0
    expect(hashIdentity('café')).not.toBe(utf16Signed)
  })
})
