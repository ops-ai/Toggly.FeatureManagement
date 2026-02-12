import { ref, computed, watch, onMounted, type Ref } from 'vue'
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

  const key = computed(() =>
    typeof featureKey === 'string' ? featureKey : featureKey.value
  )

  const checkFeature = async () => {
    if (!toggly.isReady.value) {
      // Use local feature state from features ref
      enabled.value = toggly.features.value[key.value] === true
      isLoading.value = false
      return
    }

    isLoading.value = true
    try {
      enabled.value = await toggly.isFeatureOn(key.value)
    } catch {
      enabled.value = false
    } finally {
      isLoading.value = false
    }
  }

  // Check feature when ready or key changes
  watch(
    [() => toggly.isReady.value, key],
    async () => {
      await checkFeature()
    },
    { immediate: true }
  )

  // Also check when features change
  watch(
    () => toggly.features.value,
    () => {
      enabled.value = toggly.features.value[key.value] === true
    },
    { deep: true }
  )

  onMounted(() => {
    if (toggly.isReady.value) {
      checkFeature()
    }
  })

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
