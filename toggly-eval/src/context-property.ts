import type {
  EntityEvalContext,
  FeatureDefinitionModel,
  FeatureFilter,
  RequirementType,
} from './types'

const CONTEXT_PROPERTY = 'ContextProperty'

function entityAttr(
  entity: EntityEvalContext,
  name: string,
): { found: true; value: unknown } | { found: false } {
  const attrs = entity.attributes
  if (!attrs) {
    return { found: false }
  }
  if (Object.prototype.hasOwnProperty.call(attrs, name)) {
    return { found: true, value: attrs[name] }
  }
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(attrs)) {
    if (k.toLowerCase() === lower) {
      return { found: true, value: v }
    }
  }
  return { found: false }
}

export function isContextPropertyFilter(f: FeatureFilter): boolean {
  return f.name.toLowerCase() === CONTEXT_PROPERTY.toLowerCase()
}

export function splitFilters(def: FeatureDefinitionModel): {
  entity: FeatureFilter[]
  user: FeatureFilter[]
} {
  const entity: FeatureFilter[] = []
  const user: FeatureFilter[] = []
  for (const f of def.filters ?? []) {
    if (isContextPropertyFilter(f)) {
      entity.push(f)
    } else {
      user.push(f)
    }
  }
  return { entity, user }
}

function paramString(
  params: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!params) {
    return undefined
  }
  if (Object.prototype.hasOwnProperty.call(params, key) && params[key] != null) {
    return String(params[key])
  }
  const lower = key.toLowerCase()
  for (const [k, v] of Object.entries(params)) {
    if (k.toLowerCase() === lower && v != null) {
      return String(v)
    }
  }
  return undefined
}

function toFloat(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v
  }
  if (typeof v === 'string') {
    const f = Number.parseFloat(v)
    return Number.isFinite(f) ? f : undefined
  }
  const f = Number.parseFloat(String(v))
  return Number.isFinite(f) ? f : undefined
}

function parseFlexibleTime(v: unknown): Date | undefined {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v
  }
  const s = String(v)
  const layouts = [
    s, // Date.parse handles RFC3339 / ISO
  ]
  for (const candidate of layouts) {
    const t = Date.parse(candidate)
    if (!Number.isNaN(t)) {
      return new Date(t)
    }
  }
  // Date-only
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(`${s}T00:00:00Z`)
    if (!Number.isNaN(t)) {
      return new Date(t)
    }
  }
  return undefined
}

function compareOrdered(
  actual: unknown,
  expected: string,
  valueType: string,
  op: string,
): boolean {
  if (valueType === 'datetime') {
    const a = parseFlexibleTime(actual)
    const e = parseFlexibleTime(expected)
    if (!a || !e) {
      return false
    }
    const at = a.getTime()
    const et = e.getTime()
    switch (op) {
      case 'gt':
        return at > et
      case 'gte':
        return at >= et
      case 'lt':
        return at < et
      case 'lte':
        return at <= et
      default:
        return false
    }
  }
  if (valueType === 'number') {
    const a = toFloat(actual)
    const e = toFloat(expected)
    if (a === undefined || e === undefined) {
      return false
    }
    switch (op) {
      case 'gt':
        return a > e
      case 'gte':
        return a >= e
      case 'lt':
        return a < e
      case 'lte':
        return a <= e
      default:
        return false
    }
  }
  return false
}

function compareContext(
  actual: unknown,
  op: string,
  expected: string,
  valueType: string,
): boolean {
  switch (op) {
    case 'eq':
      return String(actual).toLowerCase() === expected.toLowerCase()
    case 'neq':
      return String(actual).toLowerCase() !== expected.toLowerCase()
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return compareOrdered(actual, expected, valueType, op)
    case 'in': {
      const actualS = String(actual)
      for (const c of expected.split(',')) {
        const trimmed = c.trim()
        if (trimmed && trimmed.toLowerCase() === actualS.toLowerCase()) {
          return true
        }
      }
      return false
    }
    case 'contains': {
      if (valueType === 'string[]') {
        if (Array.isArray(actual)) {
          for (const v of actual) {
            if (String(v).toLowerCase() === expected.toLowerCase()) {
              return true
            }
          }
        }
        return false
      }
      return String(actual).toLowerCase().includes(expected.toLowerCase())
    }
    default:
      return false
  }
}

export function evaluateContextProperty(
  params: Record<string, unknown> | undefined,
  entity: EntityEvalContext,
): boolean {
  const property = paramString(params, 'Property')
  const opRaw = paramString(params, 'Operator')
  const expected = paramString(params, 'Value')
  if (
    !property ||
    !opRaw ||
    expected === undefined ||
    property.trim() === '' ||
    opRaw.trim() === ''
  ) {
    return false
  }
  let valueType = paramString(params, 'ValueType') ?? 'string'
  const op = opRaw.toLowerCase()
  valueType = valueType.toLowerCase()
  const looked = entityAttr(entity, property)
  if (!looked.found) {
    return false
  }
  return compareContext(looked.value, op, expected, valueType)
}

function normalizeRequirement(req: RequirementType | undefined): 'Any' | 'All' {
  if (!req) {
    return 'Any'
  }
  if (req.toLowerCase() === 'all') {
    return 'All'
  }
  return 'Any'
}

export function evaluateEntityFilters(
  def: FeatureDefinitionModel,
  entity: EntityEvalContext,
): boolean {
  const { entity: filters } = splitFilters(def)
  if (filters.length === 0) {
    return false
  }
  const req = normalizeRequirement(
    def.contextRequirementType || def.requirementType,
  )
  if (req === 'All') {
    for (const f of filters) {
      if (!evaluateContextProperty(f.parameters, entity)) {
        return false
      }
    }
    return true
  }
  for (const f of filters) {
    if (evaluateContextProperty(f.parameters, entity)) {
      return true
    }
  }
  return false
}
