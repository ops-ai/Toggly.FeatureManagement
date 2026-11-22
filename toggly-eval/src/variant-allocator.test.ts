import { describe, expect, it } from 'vitest'
import { computeContextPercentage } from './hash'
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

  it('coerces a numeric identity to match a named user with or without ignoreCase', () => {
    const def: FeatureDefinitionModel = {
      featureKey: 'numeric-user',
      filters: alwaysOn,
      variants: [{ name: 'A' }, { name: 'B' }],
      allocation: {
        defaultWhenEnabled: 'B',
        user: [{ variant: 'A', users: ['42'] }],
      },
    }
    const ignoreCaseOn = allocateVariant(
      def,
      { identity: 42 as unknown as string },
      { ignoreCase: true },
    )
    expect(ignoreCaseOn.assignmentReason).toBe('User')
    expect(ignoreCaseOn.variantName).toBe('A')

    const ignoreCaseOff = allocateVariant(def, {
      identity: 42 as unknown as string,
    })
    expect(ignoreCaseOff.assignmentReason).toBe('User')
    expect(ignoreCaseOff.variantName).toBe('A')

    const bigintId = allocateVariant(
      def,
      { identity: 42n as unknown as string },
      { ignoreCase: true },
    )
    expect(bigintId.assignmentReason).toBe('User')
    expect(bigintId.variantName).toBe('A')
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

  it('hashes a finite numeric id as decimal text and skips other non-strings', () => {
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
    expect(numeric.assignmentReason).toBe('Percentile')
    expect(numeric.variantName).toBe('A')

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

    const objectId = allocateVariant(
      def,
      { identity: { id: 42 } as unknown as string },
      { ignoreCase: true },
    )
    expect(objectId.assignmentReason).toBe('DefaultWhenEnabled')
    expect(objectId.variantName).toBe('B')

    const notFinite = allocateVariant(
      def,
      { identity: Number.NaN as unknown as string },
      { ignoreCase: false },
    )
    expect(notFinite.assignmentReason).toBe('DefaultWhenEnabled')
    expect(notFinite.variantName).toBe('B')
  })

  it('IgnoreCase on and off hash the same numeric identity into one percentile bucket', () => {
    const hint = 'allocation\nignore-case-numeric'
    const bucket = computeContextPercentage(`42\n${hint}`)
    const def: FeatureDefinitionModel = {
      featureKey: 'ignore-case-numeric',
      filters: alwaysOn,
      variants: [{ name: 'A' }, { name: 'B' }],
      allocation: {
        seed: hint,
        defaultWhenEnabled: 'B',
        percentile: [
          { variant: 'A', from: bucket, to: Math.min(100, bucket + 0.0001) },
        ],
      },
    }

    const ignoreCaseOn = allocateVariant(
      def,
      { identity: 42 as unknown as string },
      { ignoreCase: true },
    )
    const ignoreCaseOff = allocateVariant(def, {
      identity: 42 as unknown as string,
    })
    expect(ignoreCaseOn.assignmentReason).toBe('Percentile')
    expect(ignoreCaseOff.assignmentReason).toBe('Percentile')
    expect(ignoreCaseOn.variantName).toBe(ignoreCaseOff.variantName)
    expect(ignoreCaseOn.variantName).toBe('A')

    const bigintOn = allocateVariant(
      def,
      { identity: 42n as unknown as string },
      { ignoreCase: true },
    )
    const bigintOff = allocateVariant(def, {
      identity: 42n as unknown as string,
    })
    expect(bigintOn.assignmentReason).toBe('Percentile')
    expect(bigintOff.assignmentReason).toBe('Percentile')
    expect(bigintOn.variantName).toBe(bigintOff.variantName)
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
