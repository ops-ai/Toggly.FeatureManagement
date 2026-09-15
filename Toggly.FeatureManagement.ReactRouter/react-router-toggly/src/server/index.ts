/**
 * @ops-ai/react-router-toggly/server
 * Server-side utilities for Toggly feature flags in React Router
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
} from '../core';

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
} from '../core';

export { fromHttpRequest } from '../core';

export type {
  UsageSender,
  MetricsSender,
  MetricsFeatureOptions,
  TelemetryConfig,
  TelemetryTransport,
} from '../core';

// Ambient EvalContext store
export {
  getAmbientEvalOverrides,
  mergeIdentityContext,
  runWithEvalContext,
} from './eval-context-store';

export { extractEvalContext } from './extract-context';
export type { EvalContextProviders } from './extract-context';

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
