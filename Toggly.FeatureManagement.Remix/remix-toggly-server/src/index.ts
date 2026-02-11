/**
 * @ops-ai/remix-toggly-server
 * Server-side utilities for Toggly feature flags in Remix
 */

// Re-export core types and utilities
export {
  TogglyConfig,
  FeatureFlags,
  IdentityContext,
  ServerFeatureContext,
  TogglyHook,
  HookMetadata,
  EvaluationSeriesData,
  IdentitySeriesData,
  FeatureRequirement,
  EvaluationResult,
  TogglyError,
  TogglyNetworkError,
  TogglyConfigError,
  TogglyTimeoutError,
  TOGGLY_LOADER_KEY,
  HEADERS,
  STORAGE_KEYS,
} from '@ops-ai/remix-toggly-core';

// Export server client
export { TogglyServerClient, createServerClient } from './client';

// Export loader utilities
export {
  TogglyLoaderOptions,
  createTogglyLoader,
  getFeatureFlags,
  isFeatureEnabled,
  WithTogglyContext,
} from './loader';

// Export action utilities
export {
  FeatureGatedActionOptions,
  TogglyActionContext,
  createFeatureGatedAction,
  createTogglyAction,
  requireFeature,
} from './action';
