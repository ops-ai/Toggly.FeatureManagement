/**
 * useFeatureGate hook
 * 
 * Hook to check if multiple feature flags are enabled with gate logic
 */

import { useStore } from '@nanostores/react';
import { $flags, $isReady, $error } from '../client/store.js';
import type { UseFeatureGateResult, GateRequirement } from '../types/index.js';

/**
 * Hook to check if multiple feature flags are enabled
 * 
 * @param flagKeys - Array of feature flag keys to check
 * @param requirement - 'all' or 'any' (default: 'all')
 * @param negate - If true, negates the result (default: false)
 * @returns Object with enabled state, ready state, and error
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isEnabled, isReady } = useFeatureGate(['feature1', 'feature2'], 'any');
 *   
 *   if (!isReady) return <Loading />;
 *   return isEnabled ? <NewFeatures /> : <OldFeatures />;
 * }
 * ```
 * 
 * @example With negation
 * ```tsx
 * // Shows content only if NONE of the flags are enabled
 * const { isEnabled } = useFeatureGate(['premium', 'enterprise'], 'any', true);
 * ```
 */
export function useFeatureGate(
  flagKeys: string[],
  requirement: GateRequirement = 'all',
  negate: boolean = false
): UseFeatureGateResult {
  const flags = useStore($flags);
  const isReady = useStore($isReady);
  const error = useStore($error);

  if (flagKeys.length === 0) {
    return { isEnabled: !negate, isReady, error };
  }

  let isEnabled: boolean;

  if (requirement === 'any') {
    // At least one flag must be true
    isEnabled = flagKeys.some((key) => flags[key] === true);
  } else {
    // All flags must be true
    isEnabled = flagKeys.every((key) => flags[key] === true);
  }

  if (negate) {
    isEnabled = !isEnabled;
  }

  return { isEnabled, isReady, error };
}
