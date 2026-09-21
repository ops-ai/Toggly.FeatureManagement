/**
 * useFeatureGate hook
 * 
 * Hook to check if multiple feature flags are enabled with gate logic
 */

import { useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { useConsumerStore } from '../hooks/useConsumerStore.js';
import type { TogglyEntityContext } from '@ops-ai/toggly-hooks-types';
import { createConsumerGate, $isReady, $error } from '../client/store.js';
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
  negate = false,
  entity?: TogglyEntityContext | Record<string, unknown> | null,
  kind?: string,
): UseFeatureGateResult {
  const stableKeys = flagKeys.join('\u0000');
  const gate = useMemo(
    () => createConsumerGate(flagKeys, requirement, negate, entity, kind),
    // The joined keys preserve caller order, including short-circuit order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stableKeys, requirement, negate, entity, kind],
  );
  const isEnabled = useConsumerStore(gate);
  const isReady = useStore($isReady);
  const error = useStore($error);

  return { isEnabled, isReady, error };
}
