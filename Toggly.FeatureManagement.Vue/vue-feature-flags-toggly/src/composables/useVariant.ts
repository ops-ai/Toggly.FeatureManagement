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
  let active = true
  let request = 0
  let generation = -1

  const refresh = async () => {
    if (!active) return
    const current = ++request
    generation = toggly._ownerGeneration
    isLoading.value = true
    try {
      await toggly._featuresLoaded()
      if (!active || current !== request) return
      const next = toggly.getVariant(featureKey)
      if (!active || current !== request) return
      variant.value = next
      variantValue.value = variant.value?.configurationValue ?? null
    } finally {
      if (active && current === request) isLoading.value = false
    }
  }

  onMounted(() => {
    void refresh()
    const unsubRefresh = toggly.subscribeFeaturesRefresh(() => {
      if (!isLoading.value || generation !== toggly._ownerGeneration) void refresh()
    })
    const unsubLocalGates = toggly.subscribeLocalGatesChanged(() => { void refresh() })
    onUnmounted(() => {
      active = false
      request++
      unsubRefresh()
      unsubLocalGates()
    })
  })

  return { variant, variantValue, isLoading, refresh }
}
