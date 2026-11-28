export interface EntityGateRule {
  property: string
  op: string
  value: string
  type?: 'datetime' | 'number' | 'boolean' | 'string' | 'string[]'
}

export interface EntityGate {
  requirement: 'all' | 'any'
  rules: EntityGateRule[]
}

/** First-class flag value type (OPS-2099 / OPS-2102). */
export type FeatureValueType = 'boolean' | 'string' | 'number' | 'json' | 'datetime'

/** Evaluated-signed value envelope (non-boolean flags). */
export interface EvaluatedValueEnvelope {
  enabled: boolean
  valueType?: FeatureValueType
  value?: unknown
  variant?: string
  configurationValue?: unknown
}

export type EvaluatedDefinitionValue = boolean | EntityGate | EvaluatedValueEnvelope

export type EvaluatedDefinitions = Record<string, EvaluatedDefinitionValue>

export function isEvaluatedDefinitions(value: unknown): value is EvaluatedDefinitions {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isEntityGate(value: unknown): value is EntityGate {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const gate = value as EntityGate
  if (!Array.isArray(gate.rules)) {
    return false
  }
  if (gate.requirement != null && gate.requirement !== 'all' && gate.requirement !== 'any') {
    return false
  }
  return true
}
