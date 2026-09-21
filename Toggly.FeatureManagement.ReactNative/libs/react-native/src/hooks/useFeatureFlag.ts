import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { FeatureRequirement, TogglyEntityContext } from '@ops-ai/react-native-toggly-core';
import { useTogglyContext } from '../contexts/TogglyContext';

/**
 * Options for the useFeatureFlag hook
 */
export interface UseFeatureFlagOptions {
  /**
   * Default value to return before evaluation completes
   * @default false
   */
  defaultValue?: boolean;

  /**
   * Whether to negate the result
   * @default false
   */
  negate?: boolean;

  /**
   * Entity instance or canonical entity context for entity-gated flags
   */
  context?: TogglyEntityContext | Record<string, unknown> | null;

  /**
   * Context kind for registerContext mapper lookup when `context` is a domain object
   */
  contextKind?: string;
}

/**
 * Result of the useFeatureFlag hook
 */
export interface UseFeatureFlagResult {
  /**
   * Whether the feature is enabled
   */
  isEnabled: boolean;

  /**
   * Whether the feature is currently being evaluated
   */
  isLoading: boolean;

  /**
   * Error if evaluation failed
   */
  error: Error | null;

  /**
   * Re-evaluate the feature flag
   */
  refresh: () => Promise<void>;
}

/**
 * Hook to check if a single feature is enabled
 *
 * @param featureKey Feature key to check
 * @param options Hook options
 * @returns Feature flag state
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isEnabled, isLoading } = useFeatureFlag('newFeature');
 *
 *   if (isLoading) return <LoadingSpinner />;
 *
 *   return isEnabled ? <NewFeature /> : <OldFeature />;
 * }
 * ```
 */
export function useFeatureFlag(
  featureKey: string,
  options: UseFeatureFlagOptions = {}
): UseFeatureFlagResult {
  const { defaultValue = false, negate = false, context, contextKind } = options;
  const { toggly, isReady } = useTogglyContext();
  const currentOwner = useRef(toggly);
  currentOwner.current = toggly;
  const request = useRef(0);
  const effectiveChange = useRef({ version: 0, pending: Promise.resolve() });
  const [resultOwner, setResultOwner] = useState(toggly);
  useEffect(() => () => { request.current++; }, [toggly]);

  const [isEnabled, setIsEnabled] = useState(defaultValue);
  const [isLoading, setIsLoading] = useState(!isReady);
  const [error, setError] = useState<Error | null>(null);

  const evaluate = useCallback(async () => {
    if (!isReady || currentOwner.current !== toggly) return;
    const ownRequest = ++request.current;

    setIsLoading(true);
    setError(null);

    try {
      const result = await toggly.evaluateFeatureGate(
        [featureKey],
        'all',
        negate,
        context,
        contextKind,
      );
      if (currentOwner.current !== toggly || ownRequest !== request.current) return;
      setResultOwner(toggly);
      setIsEnabled(result);
    } catch (err) {
      if (currentOwner.current !== toggly || ownRequest !== request.current) return;
      setResultOwner(toggly);
      setError(err instanceof Error ? err : new Error('Evaluation failed'));
      setIsEnabled(defaultValue);
    } finally {
      if (currentOwner.current === toggly && ownRequest === request.current) setIsLoading(false);
    }
  }, [toggly, featureKey, negate, isReady, defaultValue, context, contextKind]);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  // Subscribe to feature changes
  useEffect(() => {
    if (!isReady) return;

    const unsubscribe = toggly.on('effectiveFlagsChanged', () => {
      effectiveChange.current = { version: effectiveChange.current.version + 1, pending: evaluate() };
    });

    return unsubscribe;
  }, [toggly, isReady, evaluate]);

  const refresh = useCallback(async () => {
    const version = effectiveChange.current.version;
    await toggly.refresh();
    if (currentOwner.current !== toggly) return;
    // Core may already have triggered this consumer through its effective event.
    // A no-event refresh (for example offline) still needs an evaluation.
    if (effectiveChange.current.version === version) await evaluate();
    else await effectiveChange.current.pending;
  }, [toggly, evaluate]);

  return {
    isEnabled: resultOwner === toggly ? isEnabled : defaultValue,
    isLoading: resultOwner !== toggly || isLoading,
    error: resultOwner === toggly ? error : null,
    refresh,
  };
}

/**
 * Options for the useFeatureGate hook
 */
export interface UseFeatureGateOptions extends UseFeatureFlagOptions {
  /**
   * Requirement mode for multiple features
   * @default 'all'
   */
  requirement?: FeatureRequirement;
}

/**
 * Hook to check if multiple features are enabled
 *
 * @param featureKeys Array of feature keys to check
 * @param options Hook options
 * @returns Feature gate state
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   // Check if ALL features are enabled
 *   const allEnabled = useFeatureGate(['feature1', 'feature2'], { requirement: 'all' });
 *
 *   // Check if ANY feature is enabled
 *   const anyEnabled = useFeatureGate(['feature1', 'feature2'], { requirement: 'any' });
 *
 *   return allEnabled.isEnabled ? <FullFeature /> : <BasicFeature />;
 * }
 * ```
 */
export function useFeatureGate(
  featureKeys: string[],
  options: UseFeatureGateOptions = {}
): UseFeatureFlagResult {
  const keysToken = JSON.stringify(featureKeys);
  const stableKeys = useMemo(() => [...featureKeys], [keysToken]);
  const {
    defaultValue = false,
    negate = false,
    requirement = 'all',
    context,
    contextKind,
  } = options;
  const { toggly, isReady } = useTogglyContext();
  const currentOwner = useRef(toggly);
  currentOwner.current = toggly;
  const request = useRef(0);
  const effectiveChange = useRef({ version: 0, pending: Promise.resolve() });
  const [resultOwner, setResultOwner] = useState(toggly);
  useEffect(() => () => { request.current++; }, [toggly]);

  const [isEnabled, setIsEnabled] = useState(defaultValue);
  const [isLoading, setIsLoading] = useState(!isReady);
  const [error, setError] = useState<Error | null>(null);

  const evaluate = useCallback(async () => {
    if (!isReady || currentOwner.current !== toggly) return;
    const ownRequest = ++request.current;
    if (stableKeys.length === 0) {
      setResultOwner(toggly);
      setIsEnabled(true);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await toggly.evaluateFeatureGate(
        stableKeys,
        requirement,
        negate,
        context,
        contextKind,
      );
      if (currentOwner.current !== toggly || ownRequest !== request.current) return;
      setResultOwner(toggly);
      setIsEnabled(result);
    } catch (err) {
      if (currentOwner.current !== toggly || ownRequest !== request.current) return;
      setResultOwner(toggly);
      setError(err instanceof Error ? err : new Error('Evaluation failed'));
      setIsEnabled(defaultValue);
    } finally {
      if (currentOwner.current === toggly && ownRequest === request.current) setIsLoading(false);
    }
  }, [toggly, stableKeys, requirement, negate, isReady, defaultValue, context, contextKind]);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  // Subscribe to feature changes
  useEffect(() => {
    if (!isReady) return;

    const unsubscribe = toggly.on('effectiveFlagsChanged', () => {
      effectiveChange.current = { version: effectiveChange.current.version + 1, pending: evaluate() };
    });

    return unsubscribe;
  }, [toggly, isReady, evaluate]);

  const refresh = useCallback(async () => {
    const version = effectiveChange.current.version;
    await toggly.refresh();
    if (currentOwner.current !== toggly) return;
    // Core may already have triggered this consumer through its effective event.
    // A no-event refresh (for example offline) still needs an evaluation.
    if (effectiveChange.current.version === version) await evaluate();
    else await effectiveChange.current.pending;
  }, [toggly, evaluate]);

  return {
    isEnabled: resultOwner === toggly ? isEnabled : defaultValue,
    isLoading: resultOwner !== toggly || isLoading,
    error: resultOwner === toggly ? error : null,
    refresh,
  };
}
