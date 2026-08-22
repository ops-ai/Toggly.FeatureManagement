import { afterEach, describe, expect, it } from 'vitest'
import {
  applyEntityGate,
  clearRegisteredContexts,
  evaluateEvaluatedGate,
  evaluateResolvedKeys,
  evaluateStoredFeatureKeys,
  isEntityGate,
  mapEntityContext,
  normalizeEntityContext,
  registerContext,
  resolveEntityContext,
  resolveEvaluatedDefinition,
  toBooleanDefinitions,
  type EntityGate,
} from './entity-gate'

describe('entity-gate', () => {
  const datetimeGate: EntityGate = {
    requirement: 'all',
    rules: [{ property: 'BirthDate', op: 'gt', value: '2026-01-01', type: 'datetime' }],
  }

  it('detects entity gates', () => {
    expect(isEntityGate(true)).toBe(false)
    expect(isEntityGate(datetimeGate)).toBe(true)
  })

  it('fails closed without context', () => {
    expect(resolveEvaluatedDefinition(datetimeGate)).toBe(false)
  })

  it('falls back to the default value for an absent definition', () => {
    expect(resolveEvaluatedDefinition(undefined)).toBe(false)
    expect(resolveEvaluatedDefinition(undefined, null, true)).toBe(true)
  })

  it('keeps an explicit false over the default value', () => {
    expect(resolveEvaluatedDefinition(false, null, true)).toBe(false)
  })

  it('never lets the default value open an ungated entity gate', () => {
    expect(resolveEvaluatedDefinition(datetimeGate, null, true)).toBe(false)
  })

  it('ignores the default value once a gate can be evaluated', () => {
    const context = {
      kind: 'Order',
      key: '1',
      attributes: { BirthDate: '2025-06-15T00:00:00Z' },
    }
    expect(resolveEvaluatedDefinition(datetimeGate, context, true)).toBe(false)
  })

  it('evaluates datetime gt locally', () => {
    const enabled = resolveEvaluatedDefinition(datetimeGate, {
      kind: 'Order',
      key: '1',
      attributes: { BirthDate: '2026-06-15T00:00:00Z' },
    })
    expect(enabled).toBe(true)
  })

  it('flattens mixed definitions to booleans', () => {
    const flattened = toBooleanDefinitions({ On: true, Off: false, Gated: datetimeGate })
    expect(flattened).toEqual({ On: true, Off: false, Gated: false })
  })

  it('flattens gated definitions using the supplied context', () => {
    const flattened = toBooleanDefinitions(
      { Gated: datetimeGate },
      { kind: 'Order', key: '1', attributes: { BirthDate: '2026-06-15T00:00:00Z' } },
    )
    expect(flattened.Gated).toBe(true)
  })

  it('evaluates any/all requirements', () => {
    const gate: EntityGate = {
      requirement: 'any',
      rules: [
        { property: 'Color', op: 'eq', value: 'red' },
        { property: 'Color', op: 'eq', value: 'blue' },
      ],
    }
    expect(
      applyEntityGate(gate, { Color: 'blue' }),
    ).toBe(true)
    expect(
      applyEntityGate({ ...gate, requirement: 'all' }, { Color: 'blue' }),
    ).toBe(false)
  })

  it('fails closed on neq when the attribute is missing', () => {
    expect(
      applyEntityGate(
        { requirement: 'all', rules: [{ property: 'Color', op: 'neq', value: 'red' }] },
        {},
      ),
    ).toBe(false)
  })

  it('does not treat string ordered compares as numbers', () => {
    expect(
      applyEntityGate(
        { requirement: 'all', rules: [{ property: 'Code', op: 'gt', value: '9' }] },
        { Code: '10' },
      ),
    ).toBe(false)
  })

  it('compares equality with ordinal case-insensitivity', () => {
    expect(
      applyEntityGate(
        { requirement: 'all', rules: [{ property: 'Color', op: 'eq', value: 'RED' }] },
        { Color: 'red' },
      ),
    ).toBe(true)
  })

  it('fails closed for an empty rule list', () => {
    expect(applyEntityGate({ requirement: 'all', rules: [] }, { Color: 'red' })).toBe(false)
    expect(applyEntityGate({ requirement: 'any', rules: [] }, { Color: 'red' })).toBe(false)
  })

  it('looks up attributes case-insensitively', () => {
    expect(
      applyEntityGate(
        { requirement: 'all', rules: [{ property: 'color', op: 'eq', value: 'red' }] },
        { Color: 'red' },
      ),
    ).toBe(true)
  })

  it('rejects values that are not entity gates', () => {
    expect(isEntityGate(null)).toBe(false)
    expect(isEntityGate({ rules: 'nope' })).toBe(false)
    expect(isEntityGate({ rules: [], requirement: 'none' })).toBe(false)
    expect(isEntityGate({ rules: [] })).toBe(true)
  })

  it('fails closed for a non-gate object definition', () => {
    expect(resolveEvaluatedDefinition({ not: 'a-gate' } as unknown as EntityGate)).toBe(false)
  })

  it('compares numbers and datetimes with ordered operators', () => {
    expect(
      applyEntityGate(
        { requirement: 'all', rules: [{ property: 'Age', op: 'gte', value: '2', type: 'number' }] },
        { Age: 2 },
      ),
    ).toBe(true)
    expect(
      applyEntityGate(
        { requirement: 'all', rules: [{ property: 'Age', op: 'lt', value: '2', type: 'number' }] },
        { Age: '1.5' },
      ),
    ).toBe(true)
    expect(
      applyEntityGate(
        { requirement: 'all', rules: [{ property: 'Age', op: 'lte', value: '2', type: 'number' }] },
        { Age: 3 },
      ),
    ).toBe(false)
    expect(
      applyEntityGate(
        { requirement: 'all', rules: [{ property: 'Born', op: 'gt', value: '2026-01-01', type: 'datetime' }] },
        { Born: new Date('2026-06-01T00:00:00Z') },
      ),
    ).toBe(true)
    expect(
      applyEntityGate(
        { requirement: 'all', rules: [{ property: 'Born', op: 'gt', value: '2026-01-01', type: 'datetime' }] },
        { Born: Date.parse('2026-06-01T00:00:00Z') },
      ),
    ).toBe(true)
    expect(
      applyEntityGate(
        { requirement: 'all', rules: [{ property: 'Born', op: 'gt', value: 'not-a-date', type: 'datetime' }] },
        { Born: '2026-06-01T00:00:00Z' },
      ),
    ).toBe(false)
  })

  it('evaluates in and contains operators', () => {
    expect(
      applyEntityGate(
        { requirement: 'all', rules: [{ property: 'Color', op: 'in', value: 'red, blue' }] },
        { Color: 'BLUE' },
      ),
    ).toBe(true)
    expect(
      applyEntityGate(
        { requirement: 'all', rules: [{ property: 'Name', op: 'contains', value: 'pup' }] },
        { Name: 'Order' },
      ),
    ).toBe(true)
    expect(
      applyEntityGate(
        {
          requirement: 'all',
          rules: [{ property: 'Tags', op: 'contains', value: 'beta', type: 'string[]' }],
        },
        { Tags: ['GA', 'Beta'] },
      ),
    ).toBe(true)
  })

  it('fails closed for an unknown operator', () => {
    expect(
      applyEntityGate(
        { requirement: 'all', rules: [{ property: 'Color', op: 'matches', value: 'red' }] },
        { Color: 'red' },
      ),
    ).toBe(false)
  })

  it('evaluates mixed definitions as a feature gate', () => {
    const features = {
      On: true,
      Off: false,
      Gated: datetimeGate,
    }
    const order = {
      kind: 'Order',
      key: '1',
      attributes: { BirthDate: '2026-06-15T00:00:00Z' },
    }
    expect(evaluateEvaluatedGate(features, [], 'all', false)).toBe(true)
    expect(evaluateEvaluatedGate(features, [], 'all', true)).toBe(false)
    expect(evaluateEvaluatedGate(features, ['On', 'Off'], 'all')).toBe(false)
    expect(evaluateEvaluatedGate(features, ['On', 'Off'], 'any')).toBe(true)
    expect(evaluateEvaluatedGate(features, ['Gated'], 'all', false, order)).toBe(true)
    expect(evaluateEvaluatedGate(features, ['Gated'], 'all', true, order)).toBe(false)
  })

  it('fails closed when stored definitions are empty', () => {
    expect(evaluateStoredFeatureKeys({}, ['On'], 'all', false, () => true)).toBe(false)
    expect(evaluateStoredFeatureKeys(null, ['On'], 'all', true, () => true)).toBe(true)
    expect(evaluateResolvedKeys(['On'], 'any', false, (key) => key === 'On')).toBe(true)
  })
})

describe('entity context registration', () => {
  afterEach(() => {
    clearRegisteredContexts()
  })

  it('maps a registered entity and ignores an unknown kind', () => {
    registerContext('Order', (order: { id: string; color: string }) => ({
      kind: 'Order',
      key: order.id,
      attributes: { Color: order.status },
    }))

    expect(mapEntityContext('Order', { id: '1', color: 'red' })).toEqual({
      kind: 'Order',
      key: '1',
      attributes: { Color: 'red' },
    })
    expect(resolveEntityContext('Kitten', { id: '1' })).toBeNull()
    expect(mapEntityContext('Kitten', { id: '1' })).toBeNull()
  })

  it('normalizes a Toggly context or a registered entity', () => {
    const context = { kind: 'Order', key: '1', attributes: { Color: 'red' } }
    expect(normalizeEntityContext(context)).toEqual(context)
    expect(normalizeEntityContext(null)).toBeNull()
    expect(normalizeEntityContext({ id: '1' }, 'Order')).toBeNull()

    registerContext('Order', (order: { id: string }) => ({
      kind: 'Order',
      key: order.id,
      attributes: {},
    }))
    expect(normalizeEntityContext({ id: '9' }, 'Order')).toEqual({
      kind: 'Order',
      key: '9',
      attributes: {},
    })
  })
})
