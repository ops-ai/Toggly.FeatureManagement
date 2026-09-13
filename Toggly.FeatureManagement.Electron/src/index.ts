/**
 * Default entry re-exports the renderer API (Flutter-like DX in the Chromium process).
 * Main process code should import `@ops-ai/electron-feature-flags-toggly/main`.
 * Preload should import `@ops-ai/electron-feature-flags-toggly/preload`.
 */
export {
  isFeatureOn,
  isFeatureOff,
  evaluateFeatureGate,
  getFlags,
  setContext,
  clearContext,
  onFlagsUpdated,
} from './renderer/index.js'

export type {
  TogglyBridge,
  FeatureFlagsSnapshot,
  FeatureRequirement,
  SetContextInput,
  EntityContextInput,
  TogglyElectronConfig,
  Hook,
} from './types.js'
