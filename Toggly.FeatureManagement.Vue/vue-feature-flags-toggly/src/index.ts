export { default as toggly } from './plugins/toggly'
export {
  default as togglyService,
  Toggly,
  type TogglyOptions,
  type TogglyService,
  type EvaluatedVariantDef,
  type VariantResult,
} from './plugins/toggly.service'
export { useVariant, type UseVariantReturn } from './composables/useVariant'
