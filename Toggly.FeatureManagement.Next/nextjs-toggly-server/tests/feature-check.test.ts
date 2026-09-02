import { describe, it, expect } from 'vitest'
import {
  createFeatureCacheKey,
  resolveFeatureCheckArgs,
} from '../src/feature-check'

describe('resolveFeatureCheckArgs', () => {
  it('treats a string as identity', () => {
    expect(resolveFeatureCheckArgs('alice')).toEqual({ identity: 'alice' })
  })

  it('passes through options objects', () => {
    const order = { id: '1', vip: true }
    expect(
      resolveFeatureCheckArgs({
        identity: 'alice',
        context: order,
        contextKind: 'Order',
      })
    ).toEqual({
      identity: 'alice',
      context: order,
      contextKind: 'Order',
    })
  })

  it('returns empty options for missing args', () => {
    expect(resolveFeatureCheckArgs()).toEqual({})
    expect(resolveFeatureCheckArgs(undefined)).toEqual({})
  })
})

describe('createFeatureCacheKey', () => {
  it('keeps the historical identity-only key', () => {
    expect(createFeatureCacheKey('flag')).toBe('toggly:feature:flag')
    expect(createFeatureCacheKey('flag', 'alice')).toBe('toggly:feature:flag:alice')
  })

  it('differs when entity attributes differ with the same kind and key', () => {
    const kindKey = { kind: 'Order', key: '7' }
    const a = createFeatureCacheKey('flag', {
      context: { ...kindKey, attributes: { Vip: 'true' } },
      contextKind: 'Order',
    })
    const b = createFeatureCacheKey('flag', {
      context: { ...kindKey, attributes: { Vip: 'false' } },
      contextKind: 'Order',
    })
    expect(a).not.toBe(b)
    expect(a).toMatch(/^toggly:feature:flag:[0-9a-f]{16}$/)
  })

  it('is stable across object key order', () => {
    const left = createFeatureCacheKey('flag', {
      context: { b: 2, a: 1 },
      contextKind: 'Order',
    })
    const right = createFeatureCacheKey('flag', {
      context: { a: 1, b: 2 },
      contextKind: 'Order',
    })
    expect(left).toBe(right)
  })

  it('hashes array-valued context attributes', () => {
    const a = createFeatureCacheKey('flag', {
      context: { tags: ['a', 'b'] },
      contextKind: 'Order',
    })
    const b = createFeatureCacheKey('flag', {
      context: { tags: ['b', 'a'] },
      contextKind: 'Order',
    })
    expect(a).not.toBe(b)
  })

  it('hashes context without identity or kind', () => {
    const key = createFeatureCacheKey('flag', { context: { a: 1 } })
    expect(key).toMatch(/^toggly:feature:flag:[0-9a-f]{16}$/)
  })

  it('does not let identity delimiters collide with hashed entity keys', () => {
    const forged = createFeatureCacheKey('flag', 'Order:7')
    const entity = createFeatureCacheKey('flag', {
      context: { kind: 'Order', key: '7' },
      contextKind: 'Order',
    })
    expect(forged).not.toBe(entity)
  })
})
