import { getCurrentInstance, inject, onMounted, onUnmounted, ref, type Ref } from 'vue'
import defaultToggly, { type Toggly } from '../plugins/toggly.service'
import type { VariantResult } from '../variant.types'

export interface UseVariantReturn {
  variant: Ref<VariantResult | null>
  variantValue: Ref<unknown | null>
  isLoading: Ref<boolean>
  refresh: () => Promise<void>
}

function resolveToggly(override?: Toggly): Toggly {
  if (override) {
    return override
  }
  if (getCurrentInstance()) {
    return inject<Toggly>('$toggly', defaultToggly)
  }
  return defaultToggly
}

/**
 * Reactive variant assignment for a feature (requires `enableVariants` in Toggly options).
 *
 * @param featureKey - Feature flag key
 * @param togglyOverride - Optional service instance (e.g. for tests); otherwise uses `$toggly` inject or the default singleton
 */
export function useVariant(featureKey: string, togglyOverride?: Toggly): UseVariantReturn {
  const toggly = resolveToggly(togglyOverride)
  const variant = ref<VariantResult | null>(null) as Ref<VariantResult | null>
  const variantValue = ref<unknown | null>(null) as Ref<unknown | null>
  const isLoading = ref(true)

  const refresh = async () => {
    isLoading.value = true
    try {
      await toggly._featuresLoaded()
      variant.value = toggly.getVariant(featureKey)
      variantValue.value = toggly.getVariantValue(featureKey)
    } finally {
      isLoading.value = false
    }
  }

  onMounted(() => {
    void refresh()
    const unsub = toggly.subscribeFeaturesRefresh(() => {
      void refresh()
    })
    onUnmounted(unsub)
  })

  return { variant, variantValue, isLoading, refresh }
}
