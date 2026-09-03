import { useState, useEffect, useCallback } from 'react';
import type {
  FeatureFlags,
  TogglyDebugInfo,
  TogglyEntityContext,
  TogglyEventType,
  TogglyEventListener,
  FeatureStateChangeHandler,
} from '@ops-ai/react-native-toggly-core';
import { useTogglyContext } from '../contexts/TogglyContext';

/**
 * Result of the useToggly hook
 */
export interface UseTogglyResult {
  /**
   * Whether the SDK is initialized and ready
   */
  isReady: boolean;

  /**
   * Whether features are currently being refreshed
   */
  isRefreshing: boolean;

  /**
   * Current user identity
   */
  identity: string | null;

  /**
   * Current feature flags
   */
  features: FeatureFlags | null;

  /**
   * Check if a feature is enabled
   */
  isFeatureOn: (
    featureKey: string,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => Promise<boolean>;

  /**
   * Check if a feature is disabled
   */
  isFeatureOff: (
    featureKey: string,
    context?: TogglyEntityContext | Record<string, unknown> | null,
    kind?: string,
  ) => Promise<boolean>;

  /**
   * Refresh feature flags from the server
   */
  refresh: () => Promise<void>;

  /**
   * Set user identity for targeting
   */
  setIdentity: (identity: string | null) => Promise<void>;

  /**
   * Get debug information
   */
  getDebugInfo: () => TogglyDebugInfo;

  /**
   * Subscribe to Toggly events
   */
  on: (eventType: TogglyEventType, listener: TogglyEventListener) => () => void;

  /**
   * Add a feature state change handler
   */
  onFeatureChange: (handler: FeatureStateChangeHandler) => () => void;
}

/**
 * Hook to access all Toggly functionality
 *
 * @returns Toggly state and methods
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const {
 *     isReady,
 *     features,
 *     isFeatureOn,
 *     setIdentity,
 *     refresh
 *   } = useToggly();
 *
 *   useEffect(() => {
 *     if (user) {
 *       setIdentity(user.id);
 *     }
 *   }, [user, setIdentity]);
 *
 *   if (!isReady) return <LoadingScreen />;
 *
 *   return <MainApp features={features} />;
 * }
 * ```
 */
export function useToggly(): UseTogglyResult {
  const { toggly, isReady } = useTogglyContext();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [identity, setIdentityState] = useState<string | null>(
    toggly.currentIdentity
  );
  const [features, setFeatures] = useState<FeatureFlags | null>(
    toggly.currentFeatures
  );

  // Update state when features change
  useEffect(() => {
    if (!isReady) return;

    const unsubscribe = toggly.on('refreshed', (event) => {
      setFeatures(event.data as FeatureFlags);
    });

    return unsubscribe;
  }, [toggly, isReady]);

  // Update identity state when it changes
  useEffect(() => {
    if (!isReady) return;

    const unsubscribe = toggly.on('identityChanged', (event) => {
      const data = event.data as { newIdentity: string | null };
      setIdentityState(data.newIdentity);
    });

    return unsubscribe;
  }, [toggly, isReady]);

  const isFeatureOn = useCallback(
    async (
      featureKey: string,
      context?: TogglyEntityContext | Record<string, unknown> | null,
      kind?: string,
    ): Promise<boolean> => {
      return toggly.isFeatureOn(featureKey, context, kind);
    },
    [toggly]
  );

  const isFeatureOff = useCallback(
    async (
      featureKey: string,
      context?: TogglyEntityContext | Record<string, unknown> | null,
      kind?: string,
    ): Promise<boolean> => {
      return toggly.isFeatureOff(featureKey, context, kind);
    },
    [toggly]
  );

  const refresh = useCallback(async (): Promise<void> => {
    setIsRefreshing(true);
    try {
      await toggly.refresh();
      setFeatures(toggly.currentFeatures);
    } finally {
      setIsRefreshing(false);
    }
  }, [toggly]);

  const setIdentity = useCallback(
    async (newIdentity: string | null): Promise<void> => {
      await toggly.setIdentity(newIdentity);
      setIdentityState(toggly.currentIdentity);
      setFeatures(toggly.currentFeatures);
    },
    [toggly]
  );

  const getDebugInfo = useCallback((): TogglyDebugInfo => {
    return toggly.getDebugInfo();
  }, [toggly]);

  const on = useCallback(
    (eventType: TogglyEventType, listener: TogglyEventListener) => {
      return toggly.on(eventType, listener);
    },
    [toggly]
  );

  const onFeatureChange = useCallback(
    (handler: FeatureStateChangeHandler) => {
      return toggly.addStateChangeHandler(handler);
    },
    [toggly]
  );

  return {
    isReady,
    isRefreshing,
    identity,
    features,
    isFeatureOn,
    isFeatureOff,
    refresh,
    setIdentity,
    getDebugInfo,
    on,
    onFeatureChange,
  };
}
