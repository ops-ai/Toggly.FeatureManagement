/**
 * Svelte-specific store utilities for Toggly
 * 
 * Re-exports nanostores for easy use in Svelte components
 */

import { derived } from 'svelte/store';
import { $flags, $isReady, $variants } from '../../client/store.js';
import type { VariantResult } from '../../types/index.js';

/**
 * Create a derived store for a specific feature flag
 * 
 * @param flagKey - Feature flag key to check
 * @param defaultValue - Default value if flag not found (default: false)
 * @returns Svelte-compatible derived store
 * 
 * @example
 * ```svelte
 * <script>
 * import { featureFlag } from '@ops-ai/astro-feature-flags-toggly/svelte';
 * 
 * const newDashboard = featureFlag('new-dashboard');
 * </script>
 * 
 * {#if $newDashboard}
 *   <NewDashboard />
 * {:else}
 *   <OldDashboard />
 * {/if}
 * ```
 */
export function featureFlag(flagKey: string, defaultValue: boolean = false) {
  return derived($flags, ($flags) => $flags[flagKey] ?? defaultValue);
}

/**
 * Create a derived store that evaluates multiple feature flags
 * 
 * @param flagKeys - Array of feature flag keys to check
 * @param requirement - 'all' or 'any' (default: 'all')
 * @param negate - If true, negates the result (default: false)
 * @returns Svelte-compatible derived store
 * 
 * @example
 * ```svelte
 * <script>
 * import { featureGate } from '@ops-ai/astro-feature-flags-toggly/svelte';
 * 
 * const hasAnyFeature = featureGate(['feature1', 'feature2'], 'any');
 * </script>
 * 
 * {#if $hasAnyFeature}
 *   <NewFeatures />
 * {:else}
 *   <OldFeatures />
 * {/if}
 * ```
 */
export function featureGate(
  flagKeys: string[],
  requirement: 'all' | 'any' = 'all',
  negate: boolean = false
) {
  return derived($flags, ($flags) => {
    if (flagKeys.length === 0) {
      return !negate;
    }

    let isEnabled: boolean;

    if (requirement === 'any') {
      isEnabled = flagKeys.some((key) => $flags[key] === true);
    } else {
      isEnabled = flagKeys.every((key) => $flags[key] === true);
    }

    if (negate) {
      isEnabled = !isEnabled;
    }

    return isEnabled;
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

// Re-export base stores for direct use
export { $flags as flags, $isReady as isReady, $variants as variants };


