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

export type EvaluatedDefinitionValue = boolean | EntityGate

export type EvaluatedDefinitions = Record<string, EvaluatedDefinitionValue>

export interface TogglyEntityContext {
  kind: string
  key: string
  attributes: Record<string, unknown>
}

export type EntityContextMapper<T = unknown> = (entity: T) => TogglyEntityContext

const equalityOps = new Set(['eq', 'neq'])
const comparisonOps = new Set(['gt', 'gte', 'lt', 'lte'])
const inOps = new Set(['in'])
const containsOps = new Set(['contains'])

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

/**
 * Resolves one evaluated definition to a boolean.
 *
 * An absent definition falls back to `defaultValue`; an entity gate without a
 * context always fails closed, so a default can never enable a gated feature.
 */
export function resolveEvaluatedDefinition(
  value: EvaluatedDefinitionValue | undefined,
  context?: TogglyEntityContext | null,
  defaultValue = false,
): boolean {
  if (value == null) {
    return defaultValue
  }
  if (value === true) {
    return true
  }
  if (value === false) {
    return false
  }
  if (!isEntityGate(value)) {
    return false
  }
  if (!context) {
    return false
  }
  return applyEntityGate(value, context.attributes)
}

/**
 * Flattens mixed definitions to plain booleans for consumers that cannot carry
 * entity gates (hook payloads, cached snapshots, legacy flag maps).
 */
export function toBooleanDefinitions(
  definitions: EvaluatedDefinitions,
  context?: TogglyEntityContext | null,
): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  for (const key of Object.keys(definitions)) {
    result[key] = resolveEvaluatedDefinition(definitions[key], context)
  }
  return result
}

export function applyEntityGate(
  gate: EntityGate,
  attributes: Record<string, unknown>,
): boolean {
  if (gate.rules.length === 0) {
    return false
  }
  const requirement = gate.requirement === 'any' ? 'any' : 'all'
  const results = gate.rules.map((rule) => evaluateRule(rule, attributes))
  return requirement === 'all' ? results.every(Boolean) : results.some(Boolean)
}

function evaluateRule(rule: EntityGateRule, attributes: Record<string, unknown>): boolean {
  const actualKey = findAttributeKey(attributes, rule.property)
  if (actualKey === undefined) {
    return false
  }

  const actual = attributes[actualKey]
  const op = rule.op.toLowerCase()
  const valueType = rule.type ?? 'string'

  if (equalityOps.has(op)) {
    return compareEquality(actual, rule.value, op === 'eq')
  }
  if (comparisonOps.has(op)) {
    return compareOrdered(actual, rule.value, valueType, op)
  }
  if (inOps.has(op)) {
    return compareIn(actual, rule.value)
  }
  if (containsOps.has(op)) {
    return compareContains(actual, rule.value, valueType)
  }
  return false
}

function findAttributeKey(
  attributes: Record<string, unknown>,
  property: string,
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(attributes, property)) {
    return property
  }
  const expected = property.toLowerCase()
  return Object.keys(attributes).find((key) => key.toLowerCase() === expected)
}

function compareEquality(actual: unknown, expected: string, shouldEqual: boolean): boolean {
  const actualString = actual == null ? '' : String(actual)
  const equal = actualString.toLowerCase() === expected.toLowerCase()
  return shouldEqual ? equal : !equal
}

function compareOrdered(actual: unknown, expected: string, valueType: string, op: string): boolean {
  if (valueType === 'datetime') {
    const actualDate = parseDateTime(actual)
    const expectedDate = parseDateTime(expected)
    if (actualDate == null || expectedDate == null) {
      return false
    }
    return compareNumbers(actualDate, expectedDate, op)
  }

  if (valueType !== 'number') {
    return false
  }

  const actualNumber = parseNumber(actual)
  const expectedNumber = parseNumber(expected)
  if (actualNumber == null || expectedNumber == null) {
    return false
  }
  return compareNumbers(actualNumber, expectedNumber, op)
}

function compareNumbers(actual: number, expected: number, op: string): boolean {
  switch (op) {
    case 'gt':
      return actual > expected
    case 'gte':
      return actual >= expected
    case 'lt':
      return actual < expected
    case 'lte':
      return actual <= expected
    default:
      return false
  }
}

function compareIn(actual: unknown, expected: string): boolean {
  const actualString = actual == null ? '' : String(actual)
  return expected
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .some((candidate) => candidate.toLowerCase() === actualString.toLowerCase())
}

function compareContains(actual: unknown, expected: string, valueType: string): boolean {
  if (valueType === 'string[]' && Array.isArray(actual)) {
    return actual.some((value) => String(value).toLowerCase() === expected.toLowerCase())
  }
  const actualString = actual == null ? '' : String(actual)
  return actualString.toLowerCase().includes(expected.toLowerCase())
}

function parseDateTime(value: unknown): number | null {
  if (value instanceof Date) {
    return value.getTime()
  }
  if (typeof value === 'number') {
    return value
  }
  const text = value == null ? '' : String(value)
  if (!text) {
    return null
  }
  const parsed = Date.parse(text)
  return Number.isNaN(parsed) ? null : parsed
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  const text = value == null ? '' : String(value)
  if (!text) {
    return null
  }
  const parsed = Number(text)
  return Number.isNaN(parsed) ? null : parsed
}

const contextMappers = new Map<string, EntityContextMapper>()

export function registerContext<T>(kind: string, mapper: EntityContextMapper<T>): void {
  contextMappers.set(kind, mapper as EntityContextMapper)
}

export function resolveEntityContext<T>(
  kind: string,
  entity: T,
): TogglyEntityContext | null {
  const mapper = contextMappers.get(kind)
  if (!mapper) {
    return null
  }
  return mapper(entity)
}

export function mapEntityContext<T>(
  kind: string,
  entity: T,
  mapper?: EntityContextMapper<T>,
): TogglyEntityContext | null {
  if (mapper) {
    return mapper(entity)
  }
  return resolveEntityContext(kind, entity)
}

export function clearRegisteredContexts(): void {
  contextMappers.clear()
}

export function normalizeEntityContext(
  context?: TogglyEntityContext | Record<string, unknown> | null,
  kind?: string,
): TogglyEntityContext | null {
  if (!context) {
    return null
  }
  if (
    typeof context === 'object' &&
    'kind' in context &&
    'key' in context &&
    'attributes' in context
  ) {
    return context as TogglyEntityContext
  }
  if (kind) {
    return mapEntityContext(kind, context)
  }
  return null
}

export type EvaluatedGateRequirement = 'all' | 'any'

export function evaluateEvaluatedGate(
  features: EvaluatedDefinitions,
  featureKeys: string[],
  requirement: EvaluatedGateRequirement = 'all',
  negate = false,
  entityContext?: TogglyEntityContext | null,
): boolean {
  if (featureKeys.length === 0) {
    return !negate
  }

  const evaluateKey = (key: string) => resolveEvaluatedDefinition(features[key], entityContext)

  let result: boolean
  if (requirement === 'any') {
    result = featureKeys.some(evaluateKey)
  } else {
    result = featureKeys.every(evaluateKey)
  }

  return negate ? !result : result
}
