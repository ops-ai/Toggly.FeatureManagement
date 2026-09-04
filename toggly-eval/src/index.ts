export type {
  DefinitionsByKey,
  EntityEvalContext,
  EvalContext,
  FeatureDefinitionModel,
  FeatureFilter,
  FilterEvaluator,
  GateRequirement,
  RequirementType,
} from './types'

export {
  createDefaultRegistry,
  computePercentile,
  identityBucket,
  rolloutBucket,
  setTimeWindowNow,
} from './builtin'

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
