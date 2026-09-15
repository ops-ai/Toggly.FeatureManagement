/**
 * @ops-ai/react-router-toggly/client
 * Client-side React components and hooks for Toggly feature flags in React Router
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
export {
  registerContext,
  normalizeEntityContext,
} from '../core';
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
  TogglyEntityContext,
} from '../core';

// Export context and provider
export {
  TogglyProvider,
  useTogglyContext,
  TogglyContext,
} from './context';
export type { TogglyProviderProps, TogglyContextValue } from './context';

// Export hooks
export {
  useToggly,
  useFeature,
  useFeatureDisabled,
  useFeatureGate,
  useFeatureFlags,
  useFeatures,
  useFeatureCallback,
  useFeatureValue,
  useFeatureChange,
  useIdentity,
  useTogglyReady,
  useRefreshFlags,
  useFeatureRender,
  useABTest,
  useFeatureWithLoading,
} from './hooks';

// Export components
export {
  Feature,
  FeatureEnabled,
  FeatureDisabled,
  FeatureSwitch,
  FeatureGate,
} from './components/Feature';
export type {
  FeatureProps,
  FeatureEnabledProps,
  FeatureDisabledProps,
  FeatureSwitchProps,
  FeatureGateProps,
} from './components/Feature';

// Export React Router-specific utilities
export {
  RouterTogglyProvider,
  useTogglyLoaderData,
  useTogglyRouteLoaderData,
  extractServerContext,
  hasTogglyContext,
  TogglyScript,
  getWindowTogglyData,
} from './router';
export type { RouterTogglyProviderProps, LoaderDataWithToggly } from './router';
