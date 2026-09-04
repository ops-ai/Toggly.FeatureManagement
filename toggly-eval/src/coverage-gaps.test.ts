import { describe, expect, it, vi } from 'vitest'
import {
  evaluateDefinition,
  evaluateDefinitions,
  evaluateFeatureGate,
  indexDefinitions,
  parseDefinitionsPayload,
  snapshotEvaluatedBooleans,
  computePercentile,
  identityBucket,
  rolloutBucket,
  setTimeWindowNow,
  createDefaultRegistry,
  evaluateContextProperty,
  evaluateEntityFilters,
  fromHttpRequest,
  type FeatureDefinitionModel,
} from './index'
import { asBool, asFloat, asString, collectIndexedValues } from './params'
import { passesSegmentPercentageGate } from './segment'

const chromeUA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

describe('params helpers', () => {
  it('asFloat / asBool / asString edge cases', () => {
    expect(asFloat(undefined, 'x')).toBeUndefined()
    expect(asFloat({}, 'x')).toBeUndefined()
    expect(asFloat({ x: 12.5 }, 'x')).toBe(12.5)
    expect(asFloat({ x: '3.5' }, 'x')).toBe(3.5)
    expect(asFloat({ x: 'nope' }, 'x')).toBeUndefined()
    expect(asFloat({ x: true }, 'x')).toBeUndefined()
    expect(asFloat({ x: Number.NaN }, 'x')).toBeUndefined()

    expect(asBool(undefined, 'x')).toBeUndefined()
    expect(asBool({}, 'x')).toBeUndefined()
    expect(asBool({ x: true }, 'x')).toBe(true)
    expect(asBool({ x: false }, 'x')).toBe(false)
    expect(asBool({ x: 'true' }, 'x')).toBe(true)
    expect(asBool({ x: 'True' }, 'x')).toBe(true)
    expect(asBool({ x: '1' }, 'x')).toBe(true)
    expect(asBool({ x: 'false' }, 'x')).toBe(false)
    expect(asBool({ x: 'False' }, 'x')).toBe(false)
    expect(asBool({ x: '0' }, 'x')).toBe(false)
    expect(asBool({ x: 'maybe' }, 'x')).toBeUndefined()

    expect(asString(undefined, 'x')).toBeUndefined()
    expect(asString({}, 'x')).toBeUndefined()
    expect(asString({ x: 'hi' }, 'x')).toBe('hi')
    expect(asString({ x: 1 }, 'x')).toBeUndefined()
  })

  it('collectIndexedValues skips empty and non-strings', () => {
    expect(collectIndexedValues(undefined, ['Audience.Users'])).toEqual([])
    expect(
      collectIndexedValues(
        {
          'Audience.Users:0': 'alice',
          'Audience.Users:1': '',
          'Audience.Users:2': 42,
          other: 'x',
        },
        ['Audience.Users'],
      ),
    ).toEqual(['alice'])
  })
})

describe('hash aliases', () => {
  it('identityBucket and rolloutBucket match computePercentile', () => {
    const a = computePercentile('u', 'f')
    expect(identityBucket('u', 'f')).toBe(a)
    expect(identityBucket('u')).toBe(computePercentile('u', ''))
    expect(rolloutBucket('f', 'u')).toBe(a)
  })
})

describe('percentage and targeting branches', () => {
  it('Percentage Value/Percentage keys, bounds, and missing identity', () => {
    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [{ name: 'Percentage', parameters: { Percentage: 100 } }],
        },
        { identity: 'u' },
      ),
    ).toBe(true)
    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [{ name: 'Percentage', parameters: { Value: 0 } }],
        },
        { identity: 'u' },
      ),
    ).toBe(false)
    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [{ name: 'Percentage', parameters: { Value: 50 } }],
        },
        {},
      ),
    ).toBe(false)
    expect(
      evaluateDefinition({
        featureKey: 'f',
        filters: [{ name: 'Percentage', parameters: {} }],
      }),
    ).toBe(false)
  })

  it('Targeting IgnoreCase, exclusion groups, and rollout branches', () => {
    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [
            {
              name: 'Targeting',
              parameters: {
                IgnoreCase: false,
                'Audience.Users:0': 'Alice',
                'Audience.DefaultRolloutPercentage': 0,
              },
            },
          ],
        },
        { identity: 'alice' },
      ),
    ).toBe(false)
    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [
            {
              name: 'Targeting',
              parameters: {
                IgnoreCase: 'false',
                'Audience.Users:0': 'Alice',
                'Audience.DefaultRolloutPercentage': 0,
              },
            },
          ],
        },
        { identity: 'Alice' },
      ),
    ).toBe(true)

    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [
            {
              name: 'Targeting',
              parameters: {
                'Audience.Exclusion.Groups:0': 'blocked',
                'Audience.Groups:0': 'blocked',
                'Audience.DefaultRolloutPercentage': 100,
              },
            },
          ],
        },
        { identity: 'u', groups: ['blocked'] },
      ),
    ).toBe(false)

    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [
            {
              name: 'Targeting',
              parameters: { Percentage: 100 },
            },
          ],
        },
        { identity: 'u' },
      ),
    ).toBe(true)

    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [
            {
              name: 'Targeting',
              parameters: { 'Audience.DefaultRolloutPercentage': 50 },
            },
          ],
        },
        {},
      ),
    ).toBe(false)

    expect(
      evaluateDefinition({
        featureKey: 'f',
        filters: [
          {
            name: 'Targeting',
            parameters: { 'Audience.DefaultRolloutPercentage': -1 },
          },
        ],
      }),
    ).toBe(false)
  })

  it('TimeWindow allows open-ended sides and fails closed on invalid present side', () => {
    const now = new Date('2025-01-02T03:04:05.000Z')
    setTimeWindowNow(() => now)
    try {
      // Start-only: past start → unconstrained end → true
      expect(
        evaluateDefinition({
          featureKey: 'f',
          filters: [
            {
              name: 'TimeWindow',
              parameters: { Start: '2020-01-01T00:00:00Z' },
            },
          ],
        }),
      ).toBe(true)

      // Start-only: future start → false
      expect(
        evaluateDefinition({
          featureKey: 'f',
          filters: [
            {
              name: 'TimeWindow',
              parameters: { Start: '2030-01-01T00:00:00Z' },
            },
          ],
        }),
      ).toBe(false)

      // End-only: future end → unconstrained start → true
      expect(
        evaluateDefinition({
          featureKey: 'f',
          filters: [
            {
              name: 'TimeWindow',
              parameters: { End: '2030-01-01T00:00:00Z' },
            },
          ],
        }),
      ).toBe(true)

      // End-only: past end → false
      expect(
        evaluateDefinition({
          featureKey: 'f',
          filters: [
            {
              name: 'TimeWindow',
              parameters: { End: '2020-01-01T00:00:00Z' },
            },
          ],
        }),
      ).toBe(false)

      // Neither bound → true
      expect(
        evaluateDefinition({
          featureKey: 'f',
          filters: [{ name: 'TimeWindow', parameters: {} }],
        }),
      ).toBe(true)

      // Invalid present side fails closed
      expect(
        evaluateDefinition({
          featureKey: 'f',
          filters: [
            {
              name: 'TimeWindow',
              parameters: { Start: 'not-a-date', End: 'also-bad' },
            },
          ],
        }),
      ).toBe(false)
      expect(
        evaluateDefinition({
          featureKey: 'f',
          filters: [
            {
              name: 'TimeWindow',
              parameters: { Start: 'not-a-date' },
            },
          ],
        }),
      ).toBe(false)
      expect(
        evaluateDefinition({
          featureKey: 'f',
          filters: [
            {
              name: 'TimeWindow',
              parameters: { End: 'also-bad' },
            },
          ],
        }),
      ).toBe(false)
    } finally {
      setTimeWindowNow(undefined)
    }
  })
})

describe('segment fail-closed paths', () => {
  it('rejects empty lists, missing request fields, and Other UA families', () => {
    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [{ name: 'BrowserFamily', parameters: { Percentage: 100 } }],
        },
        { identity: 'u', request: { userAgent: chromeUA } },
      ),
    ).toBe(false)

    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [
            {
              name: 'BrowserFamily',
              parameters: { Percentage: 100, 'BrowserFamily:0': 'Chrome' },
            },
          ],
        },
        { identity: 'u' },
      ),
    ).toBe(false)

    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [
            {
              name: 'BrowserLanguage',
              parameters: { Percentage: 100, 'BrowserLanguage:0': 'en' },
            },
          ],
        },
        { identity: 'u', request: {} },
      ),
    ).toBe(false)

    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [
            {
              name: 'Country',
              parameters: { Percentage: 100, 'Country:0': 'US' },
            },
          ],
        },
        { identity: 'u', request: {} },
      ),
    ).toBe(false)

    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [
            {
              name: 'DeviceType',
              parameters: { Percentage: 100, 'DeviceType:0': 'iPhone' },
            },
          ],
        },
        { identity: 'u', request: { userAgent: chromeUA } },
      ),
    ).toBe(false)

    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [
            {
              name: 'DeviceType',
              parameters: { Percentage: 100, 'DeviceType:0': 'iPhone' },
            },
          ],
        },
        { identity: 'u' },
      ),
    ).toBe(false)

    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [
            {
              name: 'OS',
              parameters: { Percentage: 100, 'OperatingSystem:0': 'Windows' },
            },
          ],
        },
        { identity: 'u' },
      ),
    ).toBe(false)

    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [
            {
              name: 'UserClaims',
              parameters: { Percentage: 100, Claim: 'role' },
            },
          ],
        },
        { identity: 'u', claims: { role: 'admin' } },
      ),
    ).toBe(false)

    expect(
      evaluateDefinition(
        {
          featureKey: 'f',
          filters: [
            {
              name: 'UserClaims',
              parameters: {
                Percentage: 100,
                Claim: 'role',
                Value: 'admin',
              },
            },
          ],
        },
        { identity: 'u', claims: {} },
      ),
    ).toBe(false)
  })

  it('passesSegmentPercentageGate bounds', () => {
    expect(passesSegmentPercentageGate(undefined, 'f', 'u')).toBe(false)
    expect(passesSegmentPercentageGate(0, 'f', 'u')).toBe(false)
    expect(passesSegmentPercentageGate(100, 'f', 'u')).toBe(true)
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    try {
      expect(passesSegmentPercentageGate(50, 'f')).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('engine helpers and requirement modes', () => {
  it('handles All requirement, unknown filters, and empty filters', () => {
    const allDef: FeatureDefinitionModel = {
      featureKey: 'all',
      requirementType: 'All',
      filters: [
        { name: 'AlwaysOn', parameters: {} },
        { name: 'AlwaysOff', parameters: {} },
      ],
    }
    expect(evaluateDefinition(allDef)).toBe(false)
    expect(
      evaluateDefinition({
        featureKey: 'all-on',
        requirementType: 'all',
        filters: [
          { name: 'AlwaysOn', parameters: {} },
          { name: 'AlwaysOn', parameters: {} },
        ],
      }),
    ).toBe(true)

    expect(
      evaluateDefinition({
        featureKey: 'unknown',
        requirementType: 'Any',
        filters: [{ name: 'DoesNotExist', parameters: {} }],
      }),
    ).toBe(false)
    expect(
      evaluateDefinition({
        featureKey: 'unknown-all',
        requirementType: 'All',
        filters: [{ name: 'DoesNotExist', parameters: {} }],
      }),
    ).toBe(false)
    expect(evaluateDefinition({ featureKey: 'empty', filters: [] })).toBe(false)
    expect(evaluateDefinition({ featureKey: 'missing' })).toBe(false)
  })

  it('parseDefinitionsPayload and snapshotEvaluatedBooleans', () => {
    expect(indexDefinitions(null).size).toBe(0)
    expect(indexDefinitions(undefined).size).toBe(0)
    expect(indexDefinitions([{ featureKey: '', filters: [] } as FeatureDefinitionModel]).size).toBe(
      0,
    )

    const arr = parseDefinitionsPayload([
      { featureKey: 'a', filters: [{ name: 'AlwaysOn', parameters: {} }] },
    ])
    expect(evaluateDefinitions(arr, 'a')).toBe(true)

    const envelope = parseDefinitionsPayload({
      defs: [{ featureKey: 'b', filters: [{ name: 'AlwaysOff', parameters: {} }] }],
    })
    expect(evaluateDefinitions(envelope, 'b')).toBe(false)
    expect(parseDefinitionsPayload({ defs: 'nope' }).size).toBe(0)
    expect(parseDefinitionsPayload({}).size).toBe(0)
    expect(parseDefinitionsPayload(null).size).toBe(0)

    const map = indexDefinitions([
      { featureKey: 'on', filters: [{ name: 'AlwaysOn', parameters: {} }] },
      { featureKey: 'off', filters: [{ name: 'AlwaysOff', parameters: {} }] },
    ])
    expect(snapshotEvaluatedBooleans(map)).toEqual({ on: true, off: false })
    expect(evaluateFeatureGate(map, [], 'all')).toBe(true)
    expect(evaluateFeatureGate(map, [], 'any', true)).toBe(false)
  })

  it('entity-only definitions succeed without user filters', () => {
    const def: FeatureDefinitionModel = {
      featureKey: 'entity-only',
      requirementType: 'Any',
      contextRequirementType: 'Any',
      filters: [
        {
          name: 'ContextProperty',
          parameters: {
            Property: 'Color',
            Operator: 'eq',
            Value: 'red',
            ValueType: 'string',
          },
        },
      ],
    }
    expect(
      evaluateDefinition(def, {
        entity: { kind: 'O', key: '1', attributes: { Color: 'red' } },
      }),
    ).toBe(true)
  })

  it('createDefaultRegistry exposes segment aliases', () => {
    const reg = createDefaultRegistry()
    for (const name of [
      'BrowserFamily',
      'OS',
      'OperatingSystem',
      'CountryFamily',
      'Microsoft.Percentage',
      'UserClaims',
    ]) {
      expect(reg.has(name)).toBe(true)
    }
  })
})

describe('context-property operators', () => {
  it('covers neq, lt/lte/gte, contains, string[], and datetime date-only', () => {
    expect(
      evaluateContextProperty(
        { Property: 'Color', Operator: 'neq', Value: 'red', ValueType: 'string' },
        { kind: 'P', key: '1', attributes: { Color: 'blue' } },
      ),
    ).toBe(true)

    expect(
      evaluateContextProperty(
        { Property: 'Age', Operator: 'lt', Value: '10', ValueType: 'number' },
        { kind: 'P', key: '1', attributes: { Age: 3 } },
      ),
    ).toBe(true)
    expect(
      evaluateContextProperty(
        { Property: 'Age', Operator: 'lte', Value: '3', ValueType: 'number' },
        { kind: 'P', key: '1', attributes: { Age: '3' } },
      ),
    ).toBe(true)
    expect(
      evaluateContextProperty(
        { Property: 'Age', Operator: 'gte', Value: '3', ValueType: 'number' },
        { kind: 'P', key: '1', attributes: { Age: 3 } },
      ),
    ).toBe(true)
    expect(
      evaluateContextProperty(
        { Property: 'Age', Operator: 'gt', Value: '2', ValueType: 'number' },
        { kind: 'P', key: '1', attributes: { Age: 3 } },
      ),
    ).toBe(true)

    expect(
      evaluateContextProperty(
        {
          Property: 'Tags',
          Operator: 'contains',
          Value: 'beta',
          ValueType: 'string[]',
        },
        { kind: 'P', key: '1', attributes: { Tags: ['alpha', 'Beta'] } },
      ),
    ).toBe(true)
    expect(
      evaluateContextProperty(
        {
          Property: 'Name',
          Operator: 'contains',
          Value: 'ob',
          ValueType: 'string',
        },
        { kind: 'P', key: '1', attributes: { Name: 'Bob' } },
      ),
    ).toBe(true)
    expect(
      evaluateContextProperty(
        {
          Property: 'Tags',
          Operator: 'contains',
          Value: 'beta',
          ValueType: 'string[]',
        },
        { kind: 'P', key: '1', attributes: { Tags: 'not-array' } },
      ),
    ).toBe(false)

    expect(
      evaluateContextProperty(
        {
          Property: 'Born',
          Operator: 'gte',
          Value: '2026-06-10',
          ValueType: 'datetime',
        },
        { kind: 'O', key: '1', attributes: { Born: '2026-07-01' } },
      ),
    ).toBe(true)
    expect(
      evaluateContextProperty(
        {
          Property: 'Born',
          Operator: 'lt',
          Value: '2026-08-01T00:00:00Z',
          ValueType: 'datetime',
        },
        {
          kind: 'O',
          key: '1',
          attributes: { Born: new Date('2026-07-01T00:00:00Z') },
        },
      ),
    ).toBe(true)
    expect(
      evaluateContextProperty(
        {
          Property: 'Born',
          Operator: 'lte',
          Value: '2026-07-01T00:00:00Z',
          ValueType: 'datetime',
        },
        {
          kind: 'O',
          key: '1',
          attributes: { Born: new Date('2026-07-01T00:00:00Z') },
        },
      ),
    ).toBe(true)

    expect(
      evaluateContextProperty(
        { Property: 'Age', Operator: 'wat', Value: '1', ValueType: 'number' },
        { kind: 'P', key: '1', attributes: { Age: 1 } },
      ),
    ).toBe(false)
    expect(
      evaluateContextProperty(
        { Property: 'Age', Operator: 'gt', Value: 'x', ValueType: 'number' },
        { kind: 'P', key: '1', attributes: { Age: 1 } },
      ),
    ).toBe(false)
    expect(
      evaluateContextProperty(
        {
          Property: 'Born',
          Operator: 'gt',
          Value: 'nope',
          ValueType: 'datetime',
        },
        { kind: 'O', key: '1', attributes: { Born: 'also-nope' } },
      ),
    ).toBe(false)
    expect(
      evaluateContextProperty(
        { Property: ' ', Operator: 'eq', Value: 'x', ValueType: 'string' },
        { kind: 'P', key: '1', attributes: { Color: 'x' } },
      ),
    ).toBe(false)
    expect(
      evaluateContextProperty(undefined, {
        kind: 'P',
        key: '1',
        attributes: {},
      }),
    ).toBe(false)
  })

  it('entity filters Any vs All and missing attributes map', () => {
    const def: FeatureDefinitionModel = {
      featureKey: 'f',
      contextRequirementType: 'Any',
      filters: [
        {
          name: 'ContextProperty',
          parameters: {
            Property: 'A',
            Operator: 'eq',
            Value: '1',
            ValueType: 'string',
          },
        },
        {
          name: 'ContextProperty',
          parameters: {
            Property: 'B',
            Operator: 'eq',
            Value: '2',
            ValueType: 'string',
          },
        },
      ],
    }
    expect(
      evaluateEntityFilters(def, {
        kind: 'P',
        key: '1',
        attributes: { B: '2' },
      }),
    ).toBe(true)
    expect(
      evaluateEntityFilters(
        { featureKey: 'f', filters: [{ name: 'AlwaysOn', parameters: {} }] },
        { kind: 'P', key: '1', attributes: {} },
      ),
    ).toBe(false)
    expect(
      evaluateContextProperty(
        { Property: 'Color', Operator: 'eq', Value: 'red', ValueType: 'string' },
        { kind: 'P', key: '1' },
      ),
    ).toBe(false)
  })
})

describe('fromHttpRequest extras', () => {
  it('supports array headers and cloudfront country', () => {
    const ctx = fromHttpRequest({
      'user-agent': ['UA-A', 'UA-B'],
      'accept-language': '',
      'cloudfront-viewer-country': 'FR',
    })
    expect(ctx.request?.userAgent).toBe('UA-A')
    expect(ctx.request?.acceptLanguage).toBeUndefined()
    expect(ctx.request?.country).toBe('FR')
  })
})
