import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  TogglyService,
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
export interface UseTogglyResult extends Pick<TogglyService, 'recordUsage' | 'recordView' | 'incrementCounter' | 'setGauge' | 'flushTelemetry'> {
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

  /** Atomically update the owning Core context, including token rotation or clearing. */
  setContext: (context: Parameters<TogglyService['setContext']>[0]) => Promise<void>;

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

  const currentOwner = useRef(toggly);
  currentOwner.current = toggly;
  const refreshIntent = useRef(0);
  const [snapshot, setSnapshot] = useState(() => ({
    owner: toggly, identity: toggly.currentIdentity, features: toggly.currentFeatures,
    isRefreshing: false,
  }));
  const visible = snapshot.owner === toggly ? snapshot : {
    owner: toggly, identity: toggly.currentIdentity, features: toggly.currentFeatures,
    isRefreshing: false,
  };
  const update = useCallback((changes: Partial<typeof snapshot>) => {
    if (currentOwner.current !== toggly) return;
    setSnapshot(previous => ({
      ...(previous.owner === toggly ? previous : {
        owner: toggly, identity: toggly.currentIdentity, features: toggly.currentFeatures,
        isRefreshing: false,
      }), ...changes,
    }));
  }, [toggly]);

  useEffect(() => {
    if (!isReady) return;
    let retired = false;
    const offFeatures = toggly.on('effectiveFlagsChanged', () => {
      if (!retired) update({ features: toggly.currentFeatures, identity: toggly.currentIdentity });
    });
    const offIdentity = toggly.on('identityChanged', event => {
      if (!retired) update({ identity: (event.data as { newIdentity: string | null }).newIdentity });
    });
    // Initialization can publish before an early-mounted consumer subscribes.
    update({ features: toggly.currentFeatures, identity: toggly.currentIdentity });
    return () => { retired = true; offFeatures(); offIdentity(); };
  }, [toggly, isReady, update]);

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
    const intent = ++refreshIntent.current;
    update({ isRefreshing: true });
    try {
      await toggly.refresh();
      update({ features: toggly.currentFeatures });
    } finally {
      if (intent === refreshIntent.current) update({ isRefreshing: false });
    }
  }, [toggly, update]);

  const setIdentity = useCallback(
    async (newIdentity: string | null): Promise<void> => {
      await toggly.setIdentity(newIdentity);
      update({ identity: toggly.currentIdentity });
      update({ features: toggly.currentFeatures });
    },
    [toggly, update]
  );

  const setContext = useCallback(async (context: Parameters<TogglyService['setContext']>[0]): Promise<void> => {
    await toggly.setContext(context);
    update({ identity: toggly.currentIdentity, features: toggly.currentFeatures });
  }, [toggly, update]);

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

  const telemetry = useMemo(() => ({
    recordUsage: (key: string, variant?: string) => toggly.recordUsage(key, variant),
    recordView: (key: string, variant?: string) => toggly.recordView(key, variant),
    incrementCounter: (key: string, value?: number) => toggly.incrementCounter(key, value),
    setGauge: (key: string, value: number) => toggly.setGauge(key, value),
    flushTelemetry: () => toggly.flushTelemetry(),
  }), [toggly]);

  return {
    ...telemetry,
    isReady,
    isRefreshing: visible.isRefreshing,
    identity: visible.identity,
    features: visible.features,
    isFeatureOn,
    isFeatureOff,
    refresh,
    setIdentity,
    setContext,
    getDebugInfo,
    on,
    onFeatureChange,
  };
}
