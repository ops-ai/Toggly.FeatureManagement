/**
 * useFeatureFlag hook
 * 
 * Hook to check if a single feature flag is enabled
 */

import { useStore } from '@nanostores/react';
import { $flags, $isReady, $error } from '../client/store.js';
import type { UseFeatureFlagResult } from '../types/index.js';

/**
 * Hook to check if a feature flag is enabled
 * 
 * @param flagKey - Feature flag key to check
 * @param defaultValue - Default value if flag not found (default: false)
 * @returns Object with enabled state, ready state, and error
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isEnabled, isReady, error } = useFeatureFlag('new-dashboard');
 *   
 *   if (!isReady) return <Loading />;
 *   if (error) return <ErrorMessage />;
 *   if (!isEnabled) return <OldDashboard />;
 *   return <NewDashboard />;
 * }
 * ```
 */
export function useFeatureFlag(
  flagKey: string,
  defaultValue: boolean = false
): UseFeatureFlagResult {
  const flags = useStore($flags);
  const isReady = useStore($isReady);
  const error = useStore($error);

  const isEnabled = flags[flagKey] ?? defaultValue;

  return { isEnabled, isReady, error };
}
