/**
 * Types mirroring Go `toggly/definitions` for definitions-signed payloads.
 */

export type RequirementType = 'Any' | 'All' | string

export interface FeatureFilter {
  name: string
  parameters?: Record<string, unknown>
}

export interface FeatureDefinitionModel {
  featureKey: string
  filters?: FeatureFilter[]
  metrics?: string[]
  securedFeature?: boolean
  clientSdkEnabled?: boolean
  requirementType?: RequirementType
  contextKind?: string
  contextRequirementType?: RequirementType
  /** Catalog-local variant definitions (Microsoft.FeatureManagement parity). */
  variants?: VariantDefinition[]
  /** Variant allocation rules; absent/null means no allocation is configured. */
  allocation?: VariantAllocation | null
}

/**
 * Variant-allocation types mirroring `Microsoft.FeatureManagement`'s
 * `VariantDefinition` / `Allocation` model (see
 * `variant-allocator-corpus/README.md` at the repo root for the exact
 * schema these mirror).
 */
export type VariantStatusOverride = 'None' | 'Enabled' | 'Disabled'

export interface VariantDefinition {
  name: string
  /** Arbitrary JSON — object, array, scalar, or null. */
  configurationValue?: unknown
  statusOverride?: VariantStatusOverride
}

export interface UserAllocation {
  variant: string
  users: string[]
}

export interface GroupAllocation {
  variant: string
  groups: string[]
}

export interface PercentileAllocation {
  variant: string
  /** Inclusive lower bound, percent in [0, 100]. */
  from: number
  /** Exclusive upper bound, percent in [0, 100] — 100 is treated as unbounded-above. */
  to: number
}

export interface VariantAllocation {
  defaultWhenEnabled?: string | null
  defaultWhenDisabled?: string | null
  /** Custom percentile hash seed. Defaults to `allocation\n{featureKey}` when unset. */
  seed?: string | null
  user?: UserAllocation[] | null
  group?: GroupAllocation[] | null
  percentile?: PercentileAllocation[] | null
}

export type VariantAssignmentReason =
  | 'User'
  | 'Group'
  | 'Percentile'
  | 'DefaultWhenEnabled'
  | 'DefaultWhenDisabled'
  | 'None'

export interface VariantAssignmentResult {
  variantName: string | null
  configurationValue: unknown
  enabled: boolean
  assignmentReason: VariantAssignmentReason
}

/** Entity instance for ContextProperty evaluation. */
export interface EntityEvalContext {
  kind: string
  key: string
  attributes?: Record<string, unknown>
}

/** Evaluation context for local definition evaluation. */
export interface EvalContext {
  identity?: string
  groups?: string[]
  /** Custom attributes / claims used by Targeting and similar filters. */
  traits?: Record<string, unknown>
  /** Principal / JWT-style claims for UserClaims filters. */
  claims?: Record<string, string>
  /** HTTP request fields for segment identity filters. */
  request?: {
    userAgent?: string
    acceptLanguage?: string
    country?: string
  }
  entity?: EntityEvalContext | null
}

export type GateRequirement = 'all' | 'any'

export type DefinitionsByKey = ReadonlyMap<string, FeatureDefinitionModel>

export type FilterEvaluator = (
  featureKey: string,
  params: Record<string, unknown> | undefined,
  ctx: EvalContext,
) => boolean
