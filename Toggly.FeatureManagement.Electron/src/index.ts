/**
 * Default entry re-exports the renderer API (Flutter-like DX in the Chromium process).
 * Main process code should import `@ops-ai/electron-feature-flags-toggly/main`.
 * Preload should import `@ops-ai/electron-feature-flags-toggly/preload`.
 */
export {
  recordUsage,
  recordView,
  incrementCounter,
  setGauge,
  flushTelemetry,
  isFeatureOn,
  isFeatureOff,
  evaluateFeatureGate,
  getVariant,
  getVariantValue,
  getFlags,
  setContext,
  clearContext,
  onFlagsUpdated,
  decodeVariantValue,
} from './renderer/index.js'

export type {
  TogglyBridge,
  FeatureFlagsSnapshot,
  FeatureRequirement,
  SetContextInput,
  EntityContextInput,
  TogglyTelemetry,
  TogglyElectronConfig,
  Hook,
  VariantResult,
  EvaluatedVariantDef,
} from './types.js'
