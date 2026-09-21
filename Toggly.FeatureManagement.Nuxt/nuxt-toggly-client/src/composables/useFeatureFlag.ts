import { getCurrentScope, onScopeDispose, ref, computed, watch, type Ref } from 'vue'
import { useToggly } from './useToggly'
import type { UseFeatureFlagReturn } from '../types'

/**
 * Composable for checking a single feature flag
 *
 * @example
 * ```vue
 * <script setup>
 * const { isEnabled, isLoading } = useFeatureFlag('new-dashboard')
 * </script>
 *
 * <template>
 *   <div v-if="isLoading">Loading...</div>
 *   <NewDashboard v-else-if="isEnabled" />
 *   <OldDashboard v-else />
 * </template>
 * ```
 */
export function useFeatureFlag(featureKey: string | Ref<string>): UseFeatureFlagReturn {
  const toggly = useToggly()
  const isLoading = ref(true)
  const enabled = ref(false)
  let active = true
  let request = 0
  if (getCurrentScope()) onScopeDispose(() => {active = false; request++})

  const key = computed(() =>
    typeof featureKey === 'string' ? featureKey : featureKey.value
  )

  const checkFeature = async () => {
    if (!active) return
    const current = ++request
    if (!toggly.isReady.value || !toggly.client.state.initialized) {
      // Use local feature state from features ref
      enabled.value = toggly.features.value[key.value] === true
      isLoading.value = false
      return
    }

    isLoading.value = true
    try {
      const result = await toggly.isFeatureOn(key.value)
      if (active && current === request) enabled.value = result
    } catch {
      if (active && current === request) enabled.value = false
    } finally {
      if (active && current === request) isLoading.value = false
    }
  }

  // Vue batches readiness and definitions publication into one effective UI check.
  watch(
    [() => toggly.isReady.value, key, () => toggly.features.value],
    () => { void checkFeature() },
    { immediate: true, deep: true }
  )

  return {
    isEnabled: computed(() => enabled.value),
    isDisabled: computed(() => !enabled.value),
    isLoading,
    refresh: checkFeature,
  }
}

/**
 * Composable for checking if a feature is disabled
 * Convenience wrapper around useFeatureFlag with inverted logic
 *
 * @example
 * ```vue
 * <script setup>
 * const { isEnabled: isMaintenanceMode } = useFeatureOff('maintenance-mode')
 * </script>
 *
 * <template>
 *   <MainApp v-if="isMaintenanceMode" />
 *   <MaintenancePage v-else />
 * </template>
 * ```
 */
export function useFeatureOff(featureKey: string | Ref<string>): UseFeatureFlagReturn {
  const result = useFeatureFlag(featureKey)

  return {
    // Swap enabled/disabled
    isEnabled: result.isDisabled,
    isDisabled: result.isEnabled,
    isLoading: result.isLoading,
    refresh: result.refresh,
  }
}
