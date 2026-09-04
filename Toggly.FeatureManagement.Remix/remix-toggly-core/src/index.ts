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
  EvaluationMode,
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
  LocalGate,
  EvaluatedDefinitions,
  EntityGate,
  EntityGateRule,
  TogglyEntityContext,
} from './types';

// Local evaluation types (definitions-signed rail)
export type {
  DefinitionsByKey,
  EvalContext,
  EntityEvalContext,
  FeatureDefinitionModel,
} from '@ops-ai/toggly-eval';

// Entity context helpers, re-exported so wrapper packages share one implementation
export { resolveEvaluatedDefinition, toBooleanDefinitions } from '@ops-ai/toggly-hooks-types';

// Local evaluation engine helpers for remix-toggly-server
export {
  evaluateDefinitions,
  indexDefinitions,
  parseDefinitionsPayload,
  snapshotEvaluatedBooleans,
  fromHttpRequest,
} from '@ops-ai/toggly-eval';

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
  isFeatureEnabledLocal,
  evaluateFeatureGate,
  evaluateFeatureGateLocal,
  normalizeEntityContext,
  registerContext,
  clearRegisteredContexts,
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
