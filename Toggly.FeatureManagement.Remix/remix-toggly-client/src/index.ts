/**
 * @ops-ai/remix-toggly-client
 * Client-side React components and hooks for Toggly feature flags in Remix
 */

// Re-export core types
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

// Export context and provider
export {
  TogglyProvider,
  TogglyProviderProps,
  TogglyContextValue,
  useTogglyContext,
  TogglyContext,
} from './context';

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
  FeatureProps,
  FeatureEnabled,
  FeatureEnabledProps,
  FeatureDisabled,
  FeatureDisabledProps,
  FeatureSwitch,
  FeatureSwitchProps,
  FeatureGate,
  FeatureGateProps,
} from './components/Feature';

// Export Remix-specific utilities
export {
  RemixTogglyProvider,
  RemixTogglyProviderProps,
  useTogglyLoaderData,
  useTogglyRouteLoaderData,
  extractServerContext,
  hasTogglyContext,
  LoaderDataWithToggly,
  TogglyScript,
  getWindowTogglyData,
} from './remix';
