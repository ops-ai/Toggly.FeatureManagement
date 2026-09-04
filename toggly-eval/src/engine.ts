import { createDefaultRegistry } from './builtin'
import { evaluateEntityFilters, splitFilters } from './context-property'
import type {
  DefinitionsByKey,
  EvalContext,
  FeatureDefinitionModel,
  FilterEvaluator,
  GateRequirement,
  RequirementType,
} from './types'

function normalizeRequirement(req: RequirementType | undefined): 'Any' | 'All' {
  if (!req) {
    return 'Any'
  }
  if (req.toLowerCase() === 'all') {
    return 'All'
  }
  return 'Any'
}

function evaluateGroup(
  registry: Map<string, FilterEvaluator>,
  featureKey: string,
  filters: NonNullable<FeatureDefinitionModel['filters']>,
  req: RequirementType | undefined,
  ctx: EvalContext,
): boolean {
  const requirement = normalizeRequirement(req)
  if (filters.length === 0) {
    return false
  }

  if (requirement === 'All') {
    for (const f of filters) {
      const ev = registry.get(f.name)
      if (!ev) {
        return false
      }
      if (!ev(featureKey, f.parameters, ctx)) {
        return false
      }
    }
    return true
  }

  for (const f of filters) {
    const ev = registry.get(f.name)
    if (!ev) {
      continue
    }
    if (ev(featureKey, f.parameters, ctx)) {
      return true
    }
  }
  return false
}

let defaultRegistry: Map<string, FilterEvaluator> | null = null

function getDefaultRegistry(): Map<string, FilterEvaluator> {
  if (!defaultRegistry) {
    defaultRegistry = createDefaultRegistry()
  }
  return defaultRegistry
}

/**
 * Evaluate a single feature definition against an evaluation context.
 * Missing / unknown filters are treated as false (IgnoreMissingFeatureFilters).
 */
export function evaluateDefinition(
  def: FeatureDefinitionModel,
  ctx: EvalContext = {},
  registry: Map<string, FilterEvaluator> = getDefaultRegistry(),
): boolean {
  const filters = def.filters ?? []
  if (filters.length === 0) {
    return false
  }

  const { entity: entityFilters, user: userFilters } = splitFilters(def)
  if (entityFilters.length > 0) {
    if (!ctx.entity) {
      return false
    }
    if (!evaluateEntityFilters(def, ctx.entity)) {
      return false
    }
    if (userFilters.length === 0) {
      return true
    }
    return evaluateGroup(
      registry,
      def.featureKey,
      userFilters,
      def.requirementType,
      ctx,
    )
  }

  return evaluateGroup(
    registry,
    def.featureKey,
    userFilters,
    def.requirementType,
    ctx,
  )
}

/**
 * Look up a definition by key and evaluate it. Unknown keys → false.
 */
export function evaluateDefinitions(
  defsByKey: DefinitionsByKey,
  featureKey: string,
  ctx: EvalContext = {},
  registry?: Map<string, FilterEvaluator>,
): boolean {
  const def = defsByKey.get(featureKey)
  if (!def) {
    return false
  }
  return evaluateDefinition(def, ctx, registry ?? getDefaultRegistry())
}

/**
 * Evaluate multiple feature keys with any/all + optional negate.
 */
export function evaluateFeatureGate(
  defsByKey: DefinitionsByKey,
  featureKeys: string[],
  requirement: GateRequirement = 'all',
  negate = false,
  ctx: EvalContext = {},
  registry?: Map<string, FilterEvaluator>,
): boolean {
  if (featureKeys.length === 0) {
    return !negate
  }

  const reg = registry ?? getDefaultRegistry()
  let result: boolean
  if (requirement === 'any') {
    result = featureKeys.some((key) =>
      evaluateDefinitions(defsByKey, key, ctx, reg),
    )
  } else {
    result = featureKeys.every((key) =>
      evaluateDefinitions(defsByKey, key, ctx, reg),
    )
  }
  return negate ? !result : result
}

/**
 * Index a definitions-signed array by featureKey.
 */
export function indexDefinitions(
  definitions: FeatureDefinitionModel[] | null | undefined,
): Map<string, FeatureDefinitionModel> {
  const map = new Map<string, FeatureDefinitionModel>()
  if (!definitions) {
    return map
  }
  for (const def of definitions) {
    if (def?.featureKey) {
      map.set(def.featureKey, def)
    }
  }
  return map
}

/**
 * Parse a definitions payload (array or signed envelope defs) into a map.
 */
export function parseDefinitionsPayload(raw: unknown): Map<string, FeatureDefinitionModel> {
  if (Array.isArray(raw)) {
    return indexDefinitions(raw as FeatureDefinitionModel[])
  }
  if (raw && typeof raw === 'object' && 'defs' in raw) {
    const defs = (raw as { defs: unknown }).defs
    if (Array.isArray(defs)) {
      return indexDefinitions(defs as FeatureDefinitionModel[])
    }
  }
  return new Map()
}

/**
 * Snapshot evaluated booleans for all known keys (entity gates fail closed
 * without entity context). Useful for hydration helpers.
 */
export function snapshotEvaluatedBooleans(
  defsByKey: DefinitionsByKey,
  ctx: EvalContext = {},
): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const key of defsByKey.keys()) {
    out[key] = evaluateDefinitions(defsByKey, key, ctx)
  }
  return out
}
