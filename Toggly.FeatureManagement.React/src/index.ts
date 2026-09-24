export * from './contexts'
export * from './services'
export * from './components'
export { useVariant } from './hooks/useVariant'
export { decodeVariantValue } from './utils/decode-variant-value'
export {
  useFeatureFlag,
  useFeatureGate,
  type UseFeatureFlagOptions,
  type UseFeatureFlagResult,
  type UseFeatureGateOptions,
} from './hooks/useFeatureFlag'
export type { EvaluatedDefinitions, TogglyEntityContext } from './services/toggly.service'
export { isEntityGate, mapEntityContext, registerContext } from './services/toggly.service'
