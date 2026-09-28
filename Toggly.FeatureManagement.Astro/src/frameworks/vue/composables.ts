/**
 * Vue Composables for Toggly
 */

import { computed, getCurrentInstance, onMounted, ref, type Ref } from 'vue';
import { useStore } from '@nanostores/vue';
import { $flag, $gate, $isReady, $variant, $flags, $localGatesRevision } from '../../client/store.js';
import type { VariantResult } from '../../types/index.js';

/**
 * Evaluate after reading the stores that can change a local gate result.
 * The tuple keeps both reads in Vue's computed dependency graph while the
 * returned value remains the evaluator's boolean (or other result).
 */
export function evaluateWithDefinitionDependencies<T>(
  flags: Readonly<Ref<unknown>>,
  localGatesRevision: Readonly<Ref<unknown>>,
  evaluate: () => T,
): T {
  return [flags.value, localGatesRevision.value, evaluate()][2] as T;
}

/** Evaluate a client-side gate while tracking definition and local-gate updates. */
export function useGateEvaluation(evaluate: () => boolean): Readonly<Ref<boolean>> {
  const flags = useStore($flags);
  const localGatesRevision = useStore($localGatesRevision);
  return computed(() => evaluateWithDefinitionDependencies(flags, localGatesRevision, evaluate));
}

/** @internal Preserve the SSR loading snapshot until the island mounts. */
export function useTogglyReady(): Readonly<Ref<boolean>> {
  const ready = useStore($isReady);
  if (!getCurrentInstance()) return ready;
  const mounted = ref(false);
  onMounted(() => { mounted.value = true; });
  return computed(() => mounted.value && ready.value);
}

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
  const isReady = useTogglyReady();

  const enabled = computed(() => {
    return evaluateWithDefinitionDependencies(
      flags,
      localGatesRevision,
      () => $flag(flagKey, defaultValue).get(),
    );
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
  const isReady = useTogglyReady();

  const enabled = computed(() => {
    return evaluateWithDefinitionDependencies(
      flags,
      localGatesRevision,
      () => $gate(flagKeys, requirement, negate).get(),
    );
  });

  return { enabled, isReady };
}

/**
 * Composable for the current variant assignment of a feature (requires enableVariants in config).
 */
export function useVariant(featureKey: string): Readonly<Ref<VariantResult | null>> {
  return useStore($variant(featureKey));
}
