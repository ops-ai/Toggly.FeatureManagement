import { getCurrentScope, onScopeDispose, ref, computed, watch, type Ref, type MaybeRef, toValue } from 'vue'
import { useToggly } from './useToggly'
import type { VariantResult } from '@ops-ai/nuxt-toggly-core/browser'
import type { UseVariantReturn } from '../types'

/**
 * Reactive variant assignment for a feature (requires `enableVariants` in the
 * Toggly module/client config). Resolves once the shared client is ready;
 * `variant` stays `null` while loading, when disabled, or when unassigned.
 *
 * @example
 * ```vue
 * <script setup>
 * const { variant, variantValue, isLoading } = useVariant('checkout-flow')
 * </script>
 *
 * <template>
 *   <div v-if="isLoading">Loading...</div>
 *   <CheckoutB v-else-if="variant?.name === 'treatment'" />
 *   <CheckoutA v-else />
 * </template>
 * ```
 */
export function useVariant(featureKey: MaybeRef<string>): UseVariantReturn {
  const toggly = useToggly()
  const variant = ref<VariantResult | null>(null) as Ref<VariantResult | null>
  const variantValue = ref<unknown | null>(null) as Ref<unknown | null>
  const isLoading = ref(true)
  let active = true
  let request = 0
  if (getCurrentScope()) onScopeDispose(() => { active = false; request++ })

  const key = computed(() => toValue(featureKey))

  const refresh = async () => {
    if (!active) return
    const current = ++request
    if (!toggly.isReady.value || !toggly.client.state.initialized) {
      // Variant assignment requires loaded remote data; nothing to derive locally.
      isLoading.value = true
      return
    }

    isLoading.value = true
    try {
      const next = toggly.getVariant(key.value)
      if (!active || current !== request) return
      variant.value = next
      variantValue.value = next?.configurationValue ?? null
    } finally {
      if (active && current === request) isLoading.value = false
    }
  }

  // Vue batches readiness and definitions publication into one effective UI check.
  watch(
    [() => toggly.isReady.value, key, () => toggly.features.value],
    () => { void refresh() },
    { immediate: true, deep: true },
  )

  return { variant, variantValue, isLoading, refresh }
}
