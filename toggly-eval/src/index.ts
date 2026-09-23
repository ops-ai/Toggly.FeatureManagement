export type {
  DefinitionsByKey,
  EntityEvalContext,
  EvalContext,
  FeatureDefinitionModel,
  FeatureFilter,
  FilterEvaluator,
  GateRequirement,
  GroupAllocation,
  PercentileAllocation,
  RequirementType,
  UserAllocation,
  VariantAllocation,
  VariantAssignmentReason,
  VariantAssignmentResult,
  VariantDefinition,
  VariantStatusOverride,
} from './types'

export {
  createDefaultRegistry,
  computePercentile,
  identityBucket,
  rolloutBucket,
  setTimeWindowNow,
} from './builtin'

export { computeContextPercentage } from './hash'

export { allocateVariant } from './variant-allocator'
export type { VariantAllocatorOptions } from './variant-allocator'

export {
  passesSegmentPercentageGate,
  browserFamily,
  browserLanguage,
  country,
  deviceType,
  operatingSystem,
  userClaims,
} from './segment'

export {
  evaluateContextProperty,
  evaluateEntityFilters,
  isContextPropertyFilter,
  splitFilters,
} from './context-property'

export { fromHttpRequest } from './http'
export type { HttpHeaderBag, HttpHeadersLike } from './http'

export {
  evaluateDefinition,
  evaluateDefinitions,
  evaluateFeatureGate,
  indexDefinitions,
  parseDefinitionsPayload,
  snapshotEvaluatedBooleans,
} from './engine'
