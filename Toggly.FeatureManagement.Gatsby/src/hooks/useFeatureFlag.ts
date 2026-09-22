/**
 * useFeatureFlag hook
 * 
 * Hook to check if a single feature flag is enabled
 */

import { useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { useConsumerStore } from '../hooks/useConsumerStore.js';
import type { TogglyEntityContext } from '@ops-ai/toggly-hooks-types';
import { createConsumerFlag, $isReady, $error } from '../client/store.js';
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
  defaultValue = false,
  entity?: TogglyEntityContext | Record<string, unknown> | null,
  kind?: string,
): UseFeatureFlagResult {
  const flag = useMemo(
    () => createConsumerFlag(flagKey, defaultValue, entity, kind),
    [flagKey, defaultValue, entity, kind],
  );
  const isEnabled = useConsumerStore(flag);
  const isReady = useStore($isReady);
  const error = useStore($error);

  return { isEnabled, isReady, error };
}
