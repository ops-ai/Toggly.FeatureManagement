import { ref, computed, watch, onMounted, type Ref, type MaybeRef, toValue } from 'vue'
import { useToggly } from './useToggly'
import { evaluateGate, normalizeFeatureKeys } from '@ops-ai/nuxt-toggly-core'
import type { UseFeatureGateReturn, FeatureProps } from '../types'
import type { FeatureRequirement } from '@ops-ai/nuxt-toggly-core'
import type { TogglyEntityContext } from '@ops-ai/nuxt-toggly-core'

/**
 * Composable for evaluating multiple feature flags as a gate
 *
 * @example
 * ```vue
 * <script setup>
 * // Check if ALL features are enabled
 * const { isEnabled } = useFeatureGate(['feature-a', 'feature-b'], 'all')
 *
 * // Check if ANY feature is enabled
 * const { isEnabled: hasAny } = useFeatureGate(['feature-a', 'feature-b'], 'any')
 *
 * // Check if feature is NOT enabled
 * const { isEnabled: isHidden } = useFeatureGate(['maintenance-mode'], 'all', true)
 * </script>
 * ```
 */
export function useFeatureGate(
  featureKeys: MaybeRef<string | string[]>,
  requirement: MaybeRef<FeatureRequirement> = 'all',
  negate: MaybeRef<boolean> = false,
  context?: MaybeRef<TogglyEntityContext | Record<string, unknown> | null | undefined>,
  contextKind?: MaybeRef<string | undefined>,
): UseFeatureGateReturn {
  const toggly = useToggly()
  const isLoading = ref(true)
  const enabled = ref(false)

  const keys = computed(() => normalizeFeatureKeys(toValue(featureKeys)))
  const req = computed(() => toValue(requirement))
  const neg = computed(() => toValue(negate))
  const entity = computed(() => toValue(context) ?? null)
  const kind = computed(() => toValue(contextKind))

  const checkGate = async () => {
    if (!toggly.isReady.value) {
      // Use local evaluation (booleans only; entity gates need the client)
      enabled.value = evaluateGate(
        toggly.features.value,
        keys.value,
        req.value,
        neg.value
      )
      isLoading.value = false
      return
    }

    isLoading.value = true
    try {
      enabled.value = await toggly.evaluateFeatureGate(
        keys.value,
        req.value,
        neg.value,
        entity.value,
        kind.value,
      )
    } catch {
      enabled.value = false
    } finally {
      isLoading.value = false
    }
  }

  // Check gate when ready or when inputs change
  watch(
    [() => toggly.isReady.value, keys, req, neg, entity, kind],
    async ([ready]) => {
      if (ready) {
        await checkGate()
      }
    },
    { immediate: true }
  )

  // Also check when features change (sync local map for boolean defs)
  watch(
    () => toggly.features.value,
    () => {
      enabled.value = evaluateGate(
        toggly.features.value,
        keys.value,
        req.value,
        neg.value
      )
    },
    { deep: true }
  )

  onMounted(() => {
    if (toggly.isReady.value) {
      checkGate()
    }
  })

  return {
    isEnabled: computed(() => enabled.value),
    isDisabled: computed(() => !enabled.value),
    isLoading,
    refresh: checkGate,
  }
}

/**
 * Composable that accepts FeatureProps object
 * Useful for creating wrapper components
 *
 * @example
 * ```vue
 * <script setup>
 * const props = defineProps<FeatureProps>()
 * const { isEnabled } = useFeatureProps(props)
 * </script>
 * ```
 */
export function useFeatureProps(props: FeatureProps): UseFeatureGateReturn {
  const keys = computed(() => {
    const keyList: string[] = []
    if (props.featureKey) keyList.push(props.featureKey)
    if (props.featureKeys) keyList.push(...props.featureKeys)
    return keyList
  })

  return useFeatureGate(
    keys,
    computed(() => props.requirement ?? 'all'),
    computed(() => props.negate ?? false),
    computed(() => props.context ?? null),
    computed(() => props.contextKind),
  )
}
