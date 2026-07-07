export { default as toggly } from './plugins/toggly'
export {
  default as togglyService,
  Toggly,
  type TogglyOptions,
  type TogglyService,
  type EvaluatedVariantDef,
  type VariantResult,
} from './plugins/toggly.service'
export type { LocalGate } from '@ops-ai/toggly-local-gates'
export { useVariant, type UseVariantReturn } from './composables/useVariant'
export {
  useFeatureFlag,
  useFeatureGate,
  type UseFeatureGateReturn,
  type UseFeatureGateOptions,
} from './composables/useFeatureGate'
export { default as FeatureGateBuilder } from './components/FeatureGateBuilder.vue'
