// Components
export { TogglyProvider, createTogglyProvider } from './components/TogglyProvider';
export type { TogglyProviderProps } from './components/TogglyProvider';
export { Feature, withFeature } from './components/Feature';
export type { FeatureProps } from './components/Feature';

// Hooks
export { useFeatureFlag, useFeatureGate } from './hooks/useFeatureFlag';
export type {
  UseFeatureFlagOptions,
  UseFeatureFlagResult,
  UseFeatureGateOptions,
} from './hooks/useFeatureFlag';
export { useToggly } from './hooks/useToggly';
export type { UseTogglyResult } from './hooks/useToggly';

// Context
export { TogglyContext, useTogglyContext, useTogglyService } from './contexts/TogglyContext';
export type { TogglyContextValue } from './contexts/TogglyContext';

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
