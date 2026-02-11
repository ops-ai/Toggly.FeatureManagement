/**
 * @ops-ai/remix-toggly-core
 *
 * Core types and utilities for Toggly Remix SDK.
 * This package contains shared types, utilities, and constants
 * used by both server and client packages.
 */

// Types
export type {
  FeatureRequirement,
  TogglyConfig,
  IdentityContext,
  FeatureFlags,
  EvaluationOptions,
  EvaluationResult,
  ServerFeatureContext,
  TogglyLoaderData,
  HookMetadata,
  EvaluationSeriesData,
  IdentitySeriesData,
  TogglyHook,
  StorageOptions,
} from './types';

// Error classes
export {
  TogglyError,
  TogglyNetworkError,
  TogglyConfigError,
  TogglyTimeoutError,
} from './types';

// Utilities
export {
  DEFAULT_CONFIG,
  mergeConfig,
  buildDefinitionsUrl,
  isFeatureEnabled,
  evaluateFeatureGate,
  normalizeFeatureKeys,
  createLogger,
  parseIdentity,
  serializeFlags,
  deserializeFlags,
  isServer,
  isClient,
  createTimeout,
  fetchWithTimeout,
} from './utils';

// Constants
export {
  DEFAULT_BASE_URL,
  DEFAULT_ENVIRONMENT,
  DEFAULT_TIMEOUT,
  STORAGE_KEYS,
  HEADERS,
  REQUIREMENT,
  ERROR_CODES,
  TOGGLY_LOADER_KEY,
} from './constants';
