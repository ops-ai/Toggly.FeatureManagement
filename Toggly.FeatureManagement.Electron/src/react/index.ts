export { Feature, type FeatureProps } from './Feature.js'
export {
  useFeatureFlag,
  useFeatureGate,
  readFeatureFlag,
  type UseFeatureFlagOptions,
  type UseFeatureFlagResult,
  type UseFeatureGateOptions,
} from './useFeatureFlag.js'

export {
  recordUsage,
  recordView,
  incrementCounter,
  setGauge,
  flushTelemetry,
} from '../renderer/index.js'

export type { TogglyTelemetry } from '../types.js'
