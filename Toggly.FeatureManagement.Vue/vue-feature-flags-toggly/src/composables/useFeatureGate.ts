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
  options: Omit<UseFeatureGateOptions, 'featureKey' | 'featureKeys' | 'requirement'> = {},
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
  const injected = resolveToggly()
  const toggly = computed(() => resolvedOptions.value.toggly ?? injected)
  const isEnabled = ref(false)
  const isLoading = ref(true)
  let active = true
  let request = 0
  let generation = -1
  let unsubscribe = () => {}

  const refresh = async () => {
    if (!active) return
    const current = ++request
    const owner = toggly.value
    generation = owner._ownerGeneration
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
      const enabled = await owner.evaluateFeatureGate(
        gate,
        requirement,
        negate,
        context,
        contextKind,
      )
      if (active && current === request && owner === toggly.value) isEnabled.value = enabled
    } finally {
      if (active && current === request) isLoading.value = false
    }
  }

  const bindOwner = () => {
    unsubscribe()
    const onChange = () => { if (!isLoading.value || generation !== toggly.value._ownerGeneration) void refresh() }
    const unrefresh = toggly.value.subscribeFeaturesRefresh(onChange)
    const unlocal = toggly.value.subscribeLocalGatesChanged(() => { void refresh() })
    unsubscribe = () => { unrefresh(); unlocal() }
  }

  watch(resolvedOptions, () => {
    bindOwner()
    isEnabled.value = false
    void refresh()
  }, { deep: true })

  onMounted(() => {
    bindOwner()
    void refresh()
  })
  onUnmounted(() => { active = false; request++; unsubscribe() })

  return { isEnabled, isLoading, refresh }
}
