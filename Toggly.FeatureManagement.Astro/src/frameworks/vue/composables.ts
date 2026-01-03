/**
 * Vue Composables for Toggly
 */

import { computed, type ComputedRef } from 'vue';
import { useStore } from '@nanostores/vue';
import { $flags, $isReady } from '../../client/store.js';

/**
 * Hook to check if a feature flag is enabled
 * 
 * @param flagKey - Feature flag key to check
 * @param defaultValue - Default value if flag not found (default: false)
 * @returns Object with enabled state and ready state
 * 
 * @example
 * ```vue
 * <script setup>
 * const { enabled, isReady } = useFeatureFlag('new-dashboard');
 * </script>
 * 
 * <template>
 *   <Loading v-if="!isReady" />
 *   <NewDashboard v-else-if="enabled" />
 *   <OldDashboard v-else />
 * </template>
 * ```
 */
export function useFeatureFlag(
  flagKey: string,
  defaultValue: boolean = false
): {
  enabled: ComputedRef<boolean>;
  isReady: ComputedRef<boolean>;
} {
  const flags = useStore($flags);
  const isReady = useStore($isReady);

  const enabled = computed(() => flags.value[flagKey] ?? defaultValue);

  return { enabled, isReady };
}

/**
 * Hook to check if multiple feature flags are enabled
 * 
 * @param flagKeys - Array of feature flag keys to check
 * @param requirement - 'all' or 'any' (default: 'all')
 * @param negate - If true, negates the result (default: false)
 * @returns Object with enabled state and ready state
 * 
 * @example
 * ```vue
 * <script setup>
 * const { enabled } = useFeatureGate(['feature1', 'feature2'], 'any');
 * </script>
 * 
 * <template>
 *   <NewFeatures v-if="enabled" />
 *   <OldFeatures v-else />
 * </template>
 * ```
 */
export function useFeatureGate(
  flagKeys: string[],
  requirement: 'all' | 'any' = 'all',
  negate: boolean = false
): {
  enabled: ComputedRef<boolean>;
  isReady: ComputedRef<boolean>;
} {
  const flags = useStore($flags);
  const isReady = useStore($isReady);

  const enabled = computed(() => {
    if (flagKeys.length === 0) {
      return !negate;
    }

    let isEnabled: boolean;

    if (requirement === 'any') {
      isEnabled = flagKeys.some((key) => flags.value[key] === true);
    } else {
      isEnabled = flagKeys.every((key) => flags.value[key] === true);
    }

    if (negate) {
      isEnabled = !isEnabled;
    }

    return isEnabled;
  });

  return { enabled, isReady };
}


