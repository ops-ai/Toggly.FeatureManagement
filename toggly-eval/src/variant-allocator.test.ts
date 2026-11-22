import { describe, expect, it } from 'vitest'
import { allocateVariant } from './variant-allocator'
import type { FeatureDefinitionModel } from './types'

const alwaysOn: FeatureDefinitionModel['filters'] = [{ name: 'AlwaysOn' }]

describe('allocateVariant (unit edge cases beyond the gold corpus)', () => {
  it('defaults ignoreCase to false when options are omitted entirely', () => {
    const def: FeatureDefinitionModel = {
      featureKey: 'no-options',
      filters: alwaysOn,
      variants: [{ name: 'A' }, { name: 'B' }],
      allocation: {
        defaultWhenEnabled: 'B',
        user: [{ variant: 'A', users: ['Alice'] }],
      },
    }
    // Different case than the configured user → no match without options.
    const result = allocateVariant(def, { identity: 'alice' })
    expect(result.assignmentReason).toBe('DefaultWhenEnabled')
    expect(result.variantName).toBe('B')
  })

  it('user allocation with no identity in context never matches', () => {
    const def: FeatureDefinitionModel = {
      featureKey: 'no-identity',
      filters: alwaysOn,
      variants: [{ name: 'A' }, { name: 'B' }],
      allocation: {
        defaultWhenEnabled: 'B',
        user: [{ variant: 'A', users: ['alice'] }],
      },
    }
    const result = allocateVariant(def, {})
    expect(result.assignmentReason).toBe('DefaultWhenEnabled')
    expect(result.variantName).toBe('B')
  })

  it('group allocation with no groups in context never matches', () => {
    const def: FeatureDefinitionModel = {
      featureKey: 'no-groups',
      filters: alwaysOn,
      variants: [{ name: 'A' }, { name: 'B' }],
      allocation: {
        defaultWhenEnabled: 'B',
        group: [{ variant: 'A', groups: ['beta'] }],
      },
    }
    const result = allocateVariant(def, { identity: 'zoe', groups: [] })
    expect(result.assignmentReason).toBe('DefaultWhenEnabled')
    expect(result.variantName).toBe('B')
  })

  it('a defaultWhenEnabled/defaultWhenDisabled name with no matching variant resolves to a null variant', () => {
    const def: FeatureDefinitionModel = {
      featureKey: 'dangling-default',
      filters: alwaysOn,
      variants: [{ name: 'A' }],
      allocation: {
        defaultWhenEnabled: 'does-not-exist',
      },
    }
    const result = allocateVariant(def, {})
    expect(result.assignmentReason).toBe('DefaultWhenEnabled')
    expect(result.variantName).toBeNull()
    expect(result.configurationValue).toBeNull()
  })

  it('an empty allocation.user array falls through to group/percentile/default', () => {
    const def: FeatureDefinitionModel = {
      featureKey: 'empty-user-rules',
      filters: alwaysOn,
      variants: [{ name: 'A' }, { name: 'B' }],
      allocation: {
        defaultWhenEnabled: 'B',
        user: [],
      },
    }
    const result = allocateVariant(def, { identity: 'anyone' })
    expect(result.assignmentReason).toBe('DefaultWhenEnabled')
    expect(result.variantName).toBe('B')
  })

  it('fails closed when ignore-case user matching sees a non-string identity', () => {
    const def: FeatureDefinitionModel = {
      featureKey: 'numeric-user',
      filters: alwaysOn,
      variants: [{ name: 'A' }, { name: 'B' }],
      allocation: {
        defaultWhenEnabled: 'B',
        user: [{ variant: 'A', users: ['42'] }],
      },
    }
    const result = allocateVariant(
      def,
      { identity: 42 as unknown as string },
      { ignoreCase: true },
    )
    expect(result.assignmentReason).toBe('DefaultWhenEnabled')
    expect(result.variantName).toBe('B')
  })

  it('fails closed when a group slot is null and still matches a real group', () => {
    const def: FeatureDefinitionModel = {
      featureKey: 'null-group',
      filters: alwaysOn,
      variants: [{ name: 'A' }, { name: 'B' }],
      allocation: {
        defaultWhenEnabled: 'B',
        group: [{ variant: 'A', groups: ['beta'] }],
      },
    }
    const missed = allocateVariant(
      def,
      { groups: [null] as unknown as string[] },
      { ignoreCase: true },
    )
    expect(missed.assignmentReason).toBe('DefaultWhenEnabled')
    expect(missed.variantName).toBe('B')

    const matched = allocateVariant(
      def,
      { groups: [null, 'Beta'] as unknown as string[] },
      { ignoreCase: true },
    )
    expect(matched.assignmentReason).toBe('Group')
    expect(matched.variantName).toBe('A')
  })

  it('fails closed for ignore-case percentile allocation when the user id is not a string', () => {
    const def: FeatureDefinitionModel = {
      featureKey: 'numeric-percentile',
      filters: alwaysOn,
      variants: [{ name: 'A' }, { name: 'B' }],
      allocation: {
        defaultWhenEnabled: 'B',
        percentile: [{ variant: 'A', from: 0, to: 100 }],
      },
    }
    const numeric = allocateVariant(
      def,
      { identity: 42 as unknown as string },
      { ignoreCase: true },
    )
    expect(numeric.assignmentReason).toBe('DefaultWhenEnabled')
    expect(numeric.variantName).toBe('B')

    const named = allocateVariant(
      def,
      { identity: 'alice' },
      { ignoreCase: true },
    )
    expect(named.assignmentReason).toBe('Percentile')
    expect(named.variantName).toBe('A')

    const caseSensitive = allocateVariant(def, {
      identity: 42 as unknown as string,
    })
    expect(caseSensitive.assignmentReason).toBe('Percentile')
    expect(caseSensitive.variantName).toBe('A')

    const anonymous = allocateVariant(def, {}, { ignoreCase: true })
    expect(anonymous.assignmentReason).toBe('Percentile')
    expect(anonymous.variantName).toBe('A')
  })

  it('treats a missing configurationValue as null', () => {
    const def: FeatureDefinitionModel = {
      featureKey: 'no-config-value',
      filters: alwaysOn,
      variants: [{ name: 'A' }],
      allocation: { defaultWhenEnabled: 'A' },
    }
    const result = allocateVariant(def, {})
    expect(result.variantName).toBe('A')
    expect(result.configurationValue).toBeNull()
  })
})
