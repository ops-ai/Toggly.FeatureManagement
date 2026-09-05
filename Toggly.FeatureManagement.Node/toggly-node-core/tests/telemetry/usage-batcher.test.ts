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
    expect(stat.variantStats.enabled.requestCount).toBe(2)
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

  it('uses FNV-1a signed int32 identity hashes', () => {
    expect(hashIdentity('alice')).toBeTypeOf('number')
    expect(Number.isInteger(hashIdentity('alice'))).toBe(true)
    expect(hashIdentity('alice')).toBe(hashIdentity('alice'))
    expect(hashIdentity('alice')).not.toBe(hashIdentity('bob'))
  })
})
