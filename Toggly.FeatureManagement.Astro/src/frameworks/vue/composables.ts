/**
 * Vue Composables for Toggly
 */

import { computed, type Ref } from 'vue';
import { useStore } from '@nanostores/vue';
import { $flag, $gate, $isReady, $variants, $flags, $localGatesRevision } from '../../client/store.js';
import type { VariantResult } from '../../types/index.js';

/**
 * Hook to check if a feature flag is enabled (includes local post-filter gates).
 */
export function useFeatureFlag(
  flagKey: string,
  defaultValue: boolean = false,
): {
  enabled: Readonly<Ref<boolean>>;
  isReady: Readonly<Ref<boolean>>;
} {
  const flags = useStore($flags);
  const localGatesRevision = useStore($localGatesRevision);
  const isReady = useStore($isReady);

  const enabled = computed(() => {
    void flags.value;
    void localGatesRevision.value;
    return $flag(flagKey, defaultValue).get();
  });

  return { enabled, isReady };
}

/**
 * Hook to check if multiple feature flags are enabled (includes local post-filter gates).
 */
export function useFeatureGate(
  flagKeys: string[],
  requirement: 'all' | 'any' = 'all',
  negate: boolean = false,
): {
  enabled: Readonly<Ref<boolean>>;
  isReady: Readonly<Ref<boolean>>;
} {
  const flags = useStore($flags);
  const localGatesRevision = useStore($localGatesRevision);
  const isReady = useStore($isReady);
  const keysKey = flagKeys.join('\0');

  const gateAtom = computed(() => $gate(flagKeys, requirement, negate));

  const enabled = computed(() => {
    void flags.value;
    void localGatesRevision.value;
    void keysKey;
    return gateAtom.value.get();
  });

  return { enabled, isReady };
}

/**
 * Composable for the current variant assignment of a feature (requires enableVariants in config).
 */
export function useVariant(featureKey: string): Readonly<Ref<VariantResult | null>> {
  const variants = useStore($variants);
  return computed(() => {
    const entry = variants.value[featureKey];
    if (!entry?.variant) {
      return null;
    }
    return {
      name: entry.variant,
      configurationValue: entry.configurationValue,
    };
  });
}
