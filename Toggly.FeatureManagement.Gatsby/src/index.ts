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
  TogglyTelemetry,
  TogglyReadableAtom,
  TogglyWritableAtom,
  VariantResult,
  EvaluatedVariantDef,
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
  $variants,
  $flag,
  $gate,
  initTogglyClient,
  refreshFlags,
  setIdentity,
  clearIdentity,
  getVariant,
  getVariantValue,
  stopRefreshInterval,
  disposeTogglyClient,
  recordUsage,
  recordView,
  incrementCounter,
  setGauge,
  flushTelemetry,
} from './client/store.js';

export { decodeVariantValue } from './decode-variant-value.js';

// Export server client (for SSR/SSG use cases)
export { createTogglyServerClient, TogglyServer } from './server/toggly-server.js';
export {
  createSegmentMembershipClient,
  SegmentMembershipError,
} from '@ops-ai/toggly-segments';
