/**
 * React hooks for Toggly feature flags
 */

import { useMemo } from 'react';
import { useTogglyContext } from './context';
import type { FeatureFlags, FeatureRequirement } from '@ops-ai/remix-toggly-core';

/**
 * Hook to access the Toggly context
 */
export function useToggly() {
  return useTogglyContext();
}

/**
 * Hook to check if a feature is enabled
 */
export function useFeature(
  featureKey: string,
  defaultValue = false
): boolean {
  const { isEnabled } = useTogglyContext();
  return isEnabled(featureKey, defaultValue);
}

/**
 * Hook to check if a feature is disabled
 */
export function useFeatureDisabled(
  featureKey: string,
  defaultValue = true
): boolean {
  const { isDisabled } = useTogglyContext();
  return isDisabled(featureKey, defaultValue);
}

/**
 * Hook to evaluate a feature gate (multiple features)
 */
export function useFeatureGate(
  featureKeys: string[],
  requirement: FeatureRequirement = 'all',
  negate = false
): boolean {
  const { evaluateGate } = useTogglyContext();
  return evaluateGate(featureKeys, requirement, negate);
}

/**
 * Hook to get all feature flags
 */
export function useFeatureFlags(): FeatureFlags {
  const { flags } = useTogglyContext();
  return flags;
}

/**
 * Hook to check multiple features at once
 */
export function useFeatures(
  featureKeys: string[],
  defaultValue = false
): Record<string, boolean> {
  const { isEnabled } = useTogglyContext();

  return useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const key of featureKeys) {
      result[key] = isEnabled(key, defaultValue);
    }
    return result;
  }, [featureKeys, isEnabled, defaultValue]);
}

/**
 * Hook for feature flag with callback
 */
export function useFeatureCallback<T>(
  featureKey: string,
  enabledCallback: () => T,
  disabledCallback: () => T,
  defaultValue = false
): T {
  const enabled = useFeature(featureKey, defaultValue);
  return enabled ? enabledCallback() : disabledCallback();
}

/**
 * Hook to get feature value with typing
 */
export function useFeatureValue<T>(
  featureKey: string,
  enabledValue: T,
  disabledValue: T,
  defaultValue = false
): T {
  const enabled = useFeature(featureKey, defaultValue);
  return enabled ? enabledValue : disabledValue;
}

/**
 * Hook to track feature flag changes
 */
export function useFeatureChange(
  featureKey: string,
  _onChange: (enabled: boolean) => void
): boolean {
  const enabled = useFeature(featureKey);

  // Note: This is synchronous, effect-based tracking should use useEffect
  // in the component directly with enabled as dependency

  return enabled;
}

/**
 * Hook for identity management
 */
export function useIdentity() {
  const { identity, identify, reset } = useTogglyContext();

  return {
    identity,
    identify,
    reset,
  };
}

/**
 * Hook to check if Toggly is ready
 */
export function useTogglyReady(): boolean {
  const { isReady } = useTogglyContext();
  return isReady;
}

/**
 * Hook for refreshing flags
 */
export function useRefreshFlags() {
  const { refresh } = useTogglyContext();
  return refresh;
}

/**
 * Hook for conditional rendering based on feature
 */
export function useFeatureRender<T>(
  featureKey: string,
  enabled: T,
  disabled: T,
  defaultValue = false
): T {
  const isEnabled = useFeature(featureKey, defaultValue);
  return isEnabled ? enabled : disabled;
}

/**
 * Hook for A/B testing with feature flags
 */
export function useABTest(
  featureKey: string,
  variantA: string,
  variantB: string,
  defaultVariant: 'A' | 'B' = 'A'
): string {
  const enabled = useFeature(featureKey, defaultVariant === 'B');
  return enabled ? variantB : variantA;
}

/**
 * Hook to get a feature with loading state
 */
export function useFeatureWithLoading(
  featureKey: string,
  defaultValue = false
): { enabled: boolean; isLoading: boolean } {
  const { isReady, isEnabled } = useTogglyContext();

  return {
    enabled: isEnabled(featureKey, defaultValue),
    isLoading: !isReady,
  };
}
