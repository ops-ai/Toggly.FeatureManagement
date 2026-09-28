import { describe, expect, it } from 'vitest'
import { isEntityGate, isEvaluatedDefinitions } from './evaluated-definitions'

describe('evaluated definitions guards', () => {
  it('accepts an evaluated-definition record with boolean and entity-gate values', () => {
    expect(
      isEvaluatedDefinitions({
        Checkout: true,
        ProductBadge: {
          requirement: 'all',
          rules: [{ property: 'region', op: 'eq', value: 'US' }],
        },
      })
    ).toBe(true)
  })

  it.each([null, true, 'definitions', []])('rejects non-record evaluated definitions: %j', (value) => {
    expect(isEvaluatedDefinitions(value)).toBe(false)
  })

  it.each([
    { requirement: 'all', rules: [] },
    { requirement: 'any', rules: [] },
    { rules: [] },
  ])('accepts a compatible entity gate: %j', (value) => {
    expect(isEntityGate(value)).toBe(true)
  })

  it.each([
    null,
    true,
    { requirement: 'all' },
    { requirement: 'all', rules: 'not-an-array' },
    { requirement: 'none', rules: [] },
  ])('rejects an invalid entity gate: %j', (value) => {
    expect(isEntityGate(value)).toBe(false)
  })
})
