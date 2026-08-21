import { describe, expect, it } from 'vitest'
import {
  applyEntityGate,
  isEntityGate,
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
      kind: 'Puppy',
      key: '1',
      attributes: { BirthDate: '2025-06-15T00:00:00Z' },
    }
    expect(resolveEvaluatedDefinition(datetimeGate, context, true)).toBe(false)
  })

  it('evaluates datetime gt locally', () => {
    const enabled = resolveEvaluatedDefinition(datetimeGate, {
      kind: 'Puppy',
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
      { kind: 'Puppy', key: '1', attributes: { BirthDate: '2026-06-15T00:00:00Z' } },
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
})
