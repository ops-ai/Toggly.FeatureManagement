/**
 * @ops-ai/remix-toggly-server
 * Server-side utilities for Toggly feature flags in Remix
 */

// Re-export core value exports
export {
  TogglyError,
  TogglyNetworkError,
  TogglyConfigError,
  TogglyTimeoutError,
  TOGGLY_LOADER_KEY,
  HEADERS,
  STORAGE_KEYS,
} from '@ops-ai/remix-toggly-core';

// Re-export core type exports
export type {
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
} from '@ops-ai/remix-toggly-core';

export { fromHttpRequest } from '@ops-ai/remix-toggly-core';

// Export server client
export { TogglyServerClient, createServerClient } from './client';

// Export loader utilities
export {
  createTogglyLoader,
  getFeatureFlags,
  isFeatureEnabled,
} from './loader';
export type { TogglyLoaderOptions, WithTogglyContext } from './loader';

// Export action utilities
export {
  createFeatureGatedAction,
  createTogglyAction,
  requireFeature,
} from './action';
export type { FeatureGatedActionOptions, TogglyActionContext } from './action';
