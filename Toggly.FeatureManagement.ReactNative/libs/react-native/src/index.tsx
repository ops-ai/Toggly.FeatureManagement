// Components
export {
  TogglyProvider,
  TogglyProviderProps,
  createTogglyProvider,
} from './components/TogglyProvider';
export { Feature, FeatureProps, withFeature } from './components/Feature';

// Hooks
export {
  useFeatureFlag,
  useFeatureGate,
  UseFeatureFlagOptions,
  UseFeatureFlagResult,
  UseFeatureGateOptions,
} from './hooks/useFeatureFlag';
export { useToggly, UseTogglyResult } from './hooks/useToggly';

// Context
export {
  TogglyContext,
  TogglyContextValue,
  useTogglyContext,
  useTogglyService,
} from './contexts/TogglyContext';

// Re-export core types for convenience
export type {
  TogglyConfig,
  FeatureFlags,
  FeatureRequirement,
  TogglyStorage,
  NetworkInfoProvider,
  NetworkState,
  AppStateProvider,
  AppStateType,
  TogglyLoadStatus,
  TogglyInitResponse,
  TogglyDebugInfo,
  TogglyEventType,
  TogglyEventListener,
  TogglyEvent,
  FeatureStateChangeHandler,
  Hook,
  HookMetadata,
  EvaluationSeriesData,
  IdentitySeriesData,
} from '@ops-ai/react-native-toggly-core';

// Re-export core service for advanced usage
export { TogglyService, MemoryStorage } from '@ops-ai/react-native-toggly-core';
