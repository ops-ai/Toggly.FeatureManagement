import { describe, it, expect, afterEach } from 'vitest'
import {
  evaluateDefinition,
  evaluateDefinitions,
  evaluateFeatureGate,
  indexDefinitions,
  identityBucket,
  rolloutBucket,
  setTimeWindowNow,
  type FeatureDefinitionModel,
  type EvalContext,
} from './index'

function ctxFilter(
  prop: string,
  op: string,
  value: string,
  valueType: string,
): FeatureDefinitionModel['filters'] extends (infer F)[] | undefined ? F : never {
  return {
    name: 'ContextProperty',
    parameters: {
      Property: prop,
      Operator: op,
      Value: value,
      ValueType: valueType,
    },
  }
}

describe('builtin filters', () => {
  it('AlwaysOn / AlwaysOff', () => {
    expect(
      evaluateDefinition({
        featureKey: 'f',
        filters: [{ name: 'AlwaysOn', parameters: {} }],
      }),
    ).toBe(true)
    expect(
      evaluateDefinition({
        featureKey: 'f',
        filters: [{ name: 'AlwaysOff', parameters: {} }],
      }),
    ).toBe(false)
  })

  it('Targeting user and group', () => {
    const def: FeatureDefinitionModel = {
      featureKey: 'f',
      filters: [
        {
          name: 'Targeting',
          parameters: {
            'Audience.Users:0': 'alice',
            'Audience.Groups:0': 'beta',
            'Audience.DefaultRolloutPercentage': 0,
          },
        },
      ],
    }
    expect(evaluateDefinition(def, { identity: 'alice' })).toBe(true)
    expect(evaluateDefinition(def, { identity: 'bob', groups: ['beta'] })).toBe(
      true,
    )
    expect(evaluateDefinition(def, { identity: 'bob' })).toBe(false)
  })

  it('Targeting exclusion user wins over inclusion and rollout', () => {
    const def: FeatureDefinitionModel = {
      featureKey: 'f',
      filters: [
        {
          name: 'Targeting',
          parameters: {
            'Audience.Users:0': 'alice',
            'Audience.Exclusion.Users:0': 'alice',
            'Audience.DefaultRolloutPercentage': 100,
          },
        },
      ],
    }
    expect(evaluateDefinition(def, { identity: 'alice' })).toBe(false)
    expect(evaluateDefinition(def, { identity: 'bob' })).toBe(true)
  })

  it('Targeting exclusion group wins over default rollout', () => {
    const def: FeatureDefinitionModel = {
      featureKey: 'f',
      filters: [
        {
          name: 'Targeting',
          parameters: {
            'Audience.Exclusion.Groups:0': 'banned',
            'Audience.DefaultRolloutPercentage': 100,
          },
        },
      ],
    }
    expect(
      evaluateDefinition(def, { identity: 'u', groups: ['banned'] }),
    ).toBe(false)
    expect(evaluateDefinition(def, { identity: 'u', groups: ['ok'] })).toBe(
      true,
    )
  })

  it('accepts Microsoft.Targeting and colon-form audience keys', () => {
    const inclusion: FeatureDefinitionModel = {
      featureKey: 'f',
      filters: [
        {
          name: 'Microsoft.Targeting',
          parameters: {
            'Audience:Users:0': 'alice',
            'Audience.DefaultRolloutPercentage': 0,
          },
        },
      ],
    }
    expect(evaluateDefinition(inclusion, { identity: 'alice' })).toBe(true)
    expect(evaluateDefinition(inclusion, { identity: 'bob' })).toBe(false)

    const exclusion: FeatureDefinitionModel = {
      featureKey: 'f',
      filters: [
        {
          name: 'Microsoft.Targeting',
          parameters: {
            'Audience:Exclusion:Users:0': 'alice',
            'Audience.DefaultRolloutPercentage': 100,
          },
        },
      ],
    }
    expect(evaluateDefinition(exclusion, { identity: 'alice' })).toBe(false)
    expect(evaluateDefinition(exclusion, { identity: 'bob' })).toBe(true)
  })

  it('Targeting default rollout is deterministic', () => {
    const featureKey = 'f'
    const identity = 'user'
    const bucket = rolloutBucket(featureKey, identity)
    const defAbove: FeatureDefinitionModel = {
      featureKey,
      filters: [
        {
          name: 'Targeting',
          parameters: { 'Audience.DefaultRolloutPercentage': bucket + 0.01 },
        },
      ],
    }
    const defBelow: FeatureDefinitionModel = {
      featureKey,
      filters: [
        {
          name: 'Targeting',
          parameters: { 'Audience.DefaultRolloutPercentage': bucket - 0.01 },
        },
      ],
    }
    expect(evaluateDefinition(defAbove, { identity })).toBe(true)
    expect(evaluateDefinition(defBelow, { identity })).toBe(false)
  })

  it('TimeWindow respects now', () => {
    const now = new Date('2025-01-02T03:04:05.000Z')
    setTimeWindowNow(() => now)
    try {
      const def: FeatureDefinitionModel = {
        featureKey: 'f',
        filters: [
          {
            name: 'TimeWindow',
            parameters: {
              Start: new Date(now.getTime() - 60_000).toISOString(),
              End: new Date(now.getTime() + 60_000).toISOString(),
            },
          },
        ],
      }
      expect(evaluateDefinition(def, {})).toBe(true)
    } finally {
      setTimeWindowNow(undefined)
    }
  })

  it('Percentage is deterministic and identity-only', () => {
    const ctx: EvalContext = { identity: 'user-123' }
    const def: FeatureDefinitionModel = {
      featureKey: 'featureA',
      filters: [{ name: 'Percentage', parameters: { Value: 50 } }],
    }
    const a = evaluateDefinition(def, ctx)
    const b = evaluateDefinition(def, ctx)
    expect(a).toBe(b)
    const other: FeatureDefinitionModel = {
      featureKey: 'featureB',
      filters: [{ name: 'Percentage', parameters: { Value: 50 } }],
    }
    // Same identity → same bucket regardless of feature key
    expect(evaluateDefinition(other, ctx)).toBe(a)
    expect(identityBucket('user-123')).toBeTypeOf('number')
  })
})

describe('ContextProperty', () => {
  it('evaluates entity rules and fails closed without entity', () => {
    const def: FeatureDefinitionModel = {
      featureKey: 'orders',
      requirementType: 'Any',
      contextRequirementType: 'All',
      filters: [
        ctxFilter('Color', 'eq', 'red', 'string'),
        ctxFilter('Age', 'gte', '2', 'number'),
        { name: 'AlwaysOn', parameters: {} },
      ],
    }
    const entity = {
      kind: 'Order',
      key: '1',
      attributes: { color: 'red', Age: 3 },
    }
    expect(evaluateDefinition(def, { entity })).toBe(true)
    expect(evaluateDefinition(def, {})).toBe(false)
  })

  it('fails closed on missing attr; supports in and datetime', () => {
    const missing: FeatureDefinitionModel = {
      featureKey: 'f',
      requirementType: 'All',
      filters: [ctxFilter('Color', 'neq', 'red', 'string')],
    }
    expect(
      evaluateDefinition(missing, {
        entity: { kind: 'P', key: '1', attributes: {} },
      }),
    ).toBe(false)

    const inDef: FeatureDefinitionModel = {
      featureKey: 'f',
      requirementType: 'All',
      filters: [ctxFilter('Color', 'in', 'red, blue', 'string')],
    }
    expect(
      evaluateDefinition(inDef, {
        entity: { kind: 'P', key: '1', attributes: { Color: 'BLUE' } },
      }),
    ).toBe(true)

    const dt = new Date('2026-07-01T00:00:00.000Z')
    const dtDef: FeatureDefinitionModel = {
      featureKey: 'f',
      requirementType: 'All',
      filters: [ctxFilter('Born', 'gt', '2026-06-10T00:00:00Z', 'datetime')],
    }
    expect(
      evaluateDefinition(dtDef, {
        entity: { kind: 'O', key: '1', attributes: { Born: dt } },
      }),
    ).toBe(true)
  })
})

describe('index + gate helpers', () => {
  afterEach(() => {
    setTimeWindowNow(undefined)
  })

  it('indexes and evaluates by key', () => {
    const map = indexDefinitions([
      {
        featureKey: 'on',
        filters: [{ name: 'AlwaysOn', parameters: {} }],
      },
      {
        featureKey: 'off',
        filters: [{ name: 'AlwaysOff', parameters: {} }],
      },
    ])
    expect(evaluateDefinitions(map, 'on')).toBe(true)
    expect(evaluateDefinitions(map, 'off')).toBe(false)
    expect(evaluateDefinitions(map, 'missing')).toBe(false)
    expect(evaluateFeatureGate(map, ['on', 'off'], 'any')).toBe(true)
    expect(evaluateFeatureGate(map, ['on', 'off'], 'all')).toBe(false)
    expect(evaluateFeatureGate(map, ['on'], 'all', true)).toBe(false)
  })

  it('parses signed-def style AlwaysOn array', () => {
    const map = indexDefinitions([
      {
        featureKey: 'demo',
        filters: [{ name: 'AlwaysOn', parameters: {} }],
        metrics: [],
        securedFeature: false,
        clientSdkEnabled: true,
        requirementType: 'Any',
      },
    ])
    expect(evaluateDefinitions(map, 'demo')).toBe(true)
  })
})
