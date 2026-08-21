import {
  computed,
  getCurrentInstance,
  inject,
  onMounted,
  onUnmounted,
  ref,
  unref,
  watch,
  type Ref,
} from 'vue'
import type { TogglyEntityContext } from '@ops-ai/toggly-hooks-types'
import defaultToggly, { type Toggly } from '../plugins/toggly.service'

type MaybeRef<T> = T | Ref<T>

export interface UseFeatureGateReturn {
  isEnabled: Ref<boolean>
  isLoading: Ref<boolean>
  refresh: () => Promise<void>
}

export interface UseFeatureGateOptions {
  featureKey?: string
  featureKeys?: string[]
  requirement?: 'all' | 'any'
  negate?: boolean
  context?: TogglyEntityContext | Record<string, unknown> | null
  contextKind?: string
  toggly?: Toggly
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

function buildGate(featureKey?: string, featureKeys?: string[]): string[] {
  const gate: string[] = []
  if (featureKey) {
    gate.push(featureKey)
  }
  if (featureKeys) {
    gate.push(...featureKeys)
  }
  return gate
}

/**
 * Reactive single-feature boolean for conditional UI (styling, taps, etc.).
 */
export function useFeatureFlag(
  featureKey: string,
  options: { negate?: boolean; toggly?: Toggly } = {},
): UseFeatureGateReturn {
  return useFeatureGate({ featureKey, ...options })
}

/**
 * Reactive multi-feature gate boolean for conditional UI.
 *
 * Pass a plain options object, or a `computed()` when options depend on reactive props.
 */
export function useFeatureGate(
  options: MaybeRef<UseFeatureGateOptions> = {},
): UseFeatureGateReturn {
  const resolvedOptions = computed(() => unref(options))
  const toggly = computed(() => resolveToggly(resolvedOptions.value.toggly))
  const isEnabled = ref(false)
  const isLoading = ref(true)

  const refresh = async () => {
    const {
      featureKey,
      featureKeys,
      requirement = 'all',
      negate = false,
      context,
      contextKind,
    } = resolvedOptions.value
    const gate = buildGate(featureKey, featureKeys)
    isLoading.value = true
    try {
      if (gate.length === 0) {
        isEnabled.value = !negate
        return
      }
      isEnabled.value = await toggly.value.evaluateFeatureGate(
        gate,
        requirement,
        negate,
        context,
        contextKind,
      )
    } finally {
      isLoading.value = false
    }
  }

  watch(
    resolvedOptions,
    () => {
      void refresh()
    },
    { deep: true },
  )

  onMounted(() => {
    void refresh()
    const unsubRefresh = toggly.value.subscribeFeaturesRefresh(() => {
      void refresh()
    })
    const unsubLocalGates = toggly.value.subscribeLocalGatesChanged(() => {
      void refresh()
    })
    onUnmounted(() => {
      unsubRefresh()
      unsubLocalGates()
    })
  })

  return { isEnabled, isLoading, refresh }
}
