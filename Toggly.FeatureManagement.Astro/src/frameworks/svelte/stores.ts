/**
 * Svelte-specific store utilities for Toggly
 *
 * Re-exports nanostores for easy use in Svelte components
 */

import { derived, get } from 'svelte/store';
import { $flag, $gate, $isReady, $variants, $flags, $localGatesRevision } from '../../client/store.js';
import type { VariantResult } from '../../types/index.js';

/**
 * Create a derived store for a specific feature flag (includes local post-filter gates).
 */
export function featureFlag(flagKey: string, defaultValue: boolean = false) {
  return derived([$flags, $localGatesRevision], () => {
    return $flag(flagKey, defaultValue).get();
  });
}

/**
 * Create a derived store that evaluates multiple feature flags (includes local post-filter gates).
 */
export function featureGate(
  flagKeys: string[],
  requirement: 'all' | 'any' = 'all',
  negate: boolean = false,
) {
  const keysKey = flagKeys.join('\0');
  const gateAtom = $gate(flagKeys, requirement, negate);
  return derived([$flags, $localGatesRevision], () => {
    void keysKey;
    return gateAtom.get();
  });
}

/**
 * Derived store for the current variant assignment of a feature (requires enableVariants in config).
 */
export function featureVariant(featureKey: string) {
  return derived($variants, ($variants): VariantResult | null => {
    const entry = $variants[featureKey];
    if (!entry?.variant) {
      return null;
    }
    return {
      name: entry.variant,
      configurationValue: entry.configurationValue,
    };
  });
}

/**
 * Read the current effective gate boolean synchronously.
 */
export function readFeatureGate(
  flagKeys: string[],
  requirement: 'all' | 'any' = 'all',
  negate: boolean = false,
): boolean {
  return get($gate(flagKeys, requirement, negate));
}

// Re-export base stores for direct use
export { $flags as flags, $isReady as isReady, $variants as variants };
