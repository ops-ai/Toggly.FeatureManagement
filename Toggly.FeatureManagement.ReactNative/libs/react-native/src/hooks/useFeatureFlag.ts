import { useState, useEffect, useCallback } from 'react';
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

  const [isEnabled, setIsEnabled] = useState(defaultValue);
  const [isLoading, setIsLoading] = useState(!isReady);
  const [error, setError] = useState<Error | null>(null);

  const evaluate = useCallback(async () => {
    if (!isReady) return;

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
      setIsEnabled(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Evaluation failed'));
      setIsEnabled(defaultValue);
    } finally {
      setIsLoading(false);
    }
  }, [toggly, featureKey, negate, isReady, defaultValue, context, contextKind]);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  // Subscribe to feature changes
  useEffect(() => {
    if (!isReady) return;

    const unsubscribe = toggly.on('effectiveFlagsChanged', () => {
      evaluate();
    });

    return unsubscribe;
  }, [toggly, isReady, evaluate]);

  const refresh = useCallback(async () => {
    await toggly.refresh();
    await evaluate();
  }, [toggly, evaluate]);

  return {
    isEnabled,
    isLoading,
    error,
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
  const {
    defaultValue = false,
    negate = false,
    requirement = 'all',
    context,
    contextKind,
  } = options;
  const { toggly, isReady } = useTogglyContext();

  const [isEnabled, setIsEnabled] = useState(defaultValue);
  const [isLoading, setIsLoading] = useState(!isReady);
  const [error, setError] = useState<Error | null>(null);

  const evaluate = useCallback(async () => {
    if (!isReady) return;
    if (featureKeys.length === 0) {
      setIsEnabled(true);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await toggly.evaluateFeatureGate(
        featureKeys,
        requirement,
        negate,
        context,
        contextKind,
      );
      setIsEnabled(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Evaluation failed'));
      setIsEnabled(defaultValue);
    } finally {
      setIsLoading(false);
    }
  }, [toggly, featureKeys, requirement, negate, isReady, defaultValue, context, contextKind]);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  // Subscribe to feature changes
  useEffect(() => {
    if (!isReady) return;

    const unsubscribe = toggly.on('effectiveFlagsChanged', () => {
      evaluate();
    });

    return unsubscribe;
  }, [toggly, isReady, evaluate]);

  const refresh = useCallback(async () => {
    await toggly.refresh();
    await evaluate();
  }, [toggly, evaluate]);

  return {
    isEnabled,
    isLoading,
    error,
    refresh,
  };
}
