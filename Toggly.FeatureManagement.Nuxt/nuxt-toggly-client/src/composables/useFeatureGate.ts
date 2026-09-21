import { getCurrentScope, onScopeDispose, ref, computed, watch, type Ref, type MaybeRef, toValue } from 'vue'
import { useToggly } from './useToggly'
import { evaluateGate, normalizeFeatureKeys } from '@ops-ai/nuxt-toggly-core/browser'
import type { UseFeatureGateReturn, FeatureProps } from '../types'
import type { FeatureRequirement } from '@ops-ai/nuxt-toggly-core/browser'
import type { TogglyEntityContext } from '@ops-ai/nuxt-toggly-core/browser'

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
  let active = true
  let request = 0
  if (getCurrentScope()) onScopeDispose(() => {active = false; request++})

  const keys = computed(() => normalizeFeatureKeys(toValue(featureKeys)))
  const req = computed(() => toValue(requirement))
  const neg = computed(() => toValue(negate))
  const entity = computed(() => toValue(context) ?? null)
  const kind = computed(() => toValue(contextKind))

  const checkGate = async () => {
    if (!active) return
    const current = ++request
    if (!toggly.isReady.value || !toggly.client.state.initialized) {
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
      const result = await toggly.evaluateFeatureGate(
        keys.value,
        req.value,
        neg.value,
        entity.value,
        kind.value,
      )
      if (active && current === request) enabled.value = result
    } catch {
      if (active && current === request) enabled.value = false
    } finally {
      if (active && current === request) isLoading.value = false
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
      request++
      isLoading.value = false
      // Refresh/hydration projection is state synchronization, not a new
      // consumer evaluation, so it remains telemetry-silent.
      enabled.value = evaluateGate(
        toggly.features.value,
        keys.value,
        req.value,
        neg.value
      )
    },
    { deep: true }
  )

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
