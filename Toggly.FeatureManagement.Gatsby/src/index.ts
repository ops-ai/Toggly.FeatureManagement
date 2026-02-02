/**
 * Toggly Feature Flags SDK for Gatsby
 * 
 * Main entry point for the SDK
 */

// Export types
export type {
  TogglyPluginOptions,
  Flags,
  GateRequirement,
  UseFeatureFlagResult,
  UseFeatureGateResult,
  UseTogglyResult,
  FeatureProps,
  FeatureGateProps,
  TogglyProviderProps,
} from './types/index.js';

// Export hooks
export { useFeatureFlag, useFeatureGate, useToggly } from './hooks/index.js';

// Export components
export { TogglyProvider, Feature, FeatureGate } from './components/index.js';

// Export client store utilities (for advanced use cases)
export {
  $flags,
  $isReady,
  $error,
  $flag,
  $gate,
  initTogglyClient,
  refreshFlags,
  setIdentity,
  clearIdentity,
  stopRefreshInterval,
} from './client/store.js';

// Export server client (for SSR/SSG use cases)
export { createTogglyServerClient, TogglyServer } from './server/toggly-server.js';
