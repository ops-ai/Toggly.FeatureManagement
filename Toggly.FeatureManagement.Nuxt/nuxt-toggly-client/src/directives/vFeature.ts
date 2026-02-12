import type { Directive, DirectiveBinding, VNode } from 'vue'
import { evaluateGate, normalizeFeatureKeys } from '@ops-ai/nuxt-toggly-core'
import { getTogglyClient } from '../composables/useToggly'

/**
 * Directive binding value type
 */
interface FeatureDirectiveValue {
  /** Feature key(s) to check */
  key?: string | string[]
  /** Requirement type for multiple features */
  requirement?: 'all' | 'any'
  /** Negate the result */
  negate?: boolean
}

/**
 * v-feature directive for conditional rendering based on feature flags
 *
 * @example
 * ```vue
 * <template>
 *   <!-- Simple usage with string -->
 *   <div v-feature="'new-feature'">
 *     New feature content
 *   </div>
 *
 *   <!-- Object syntax with options -->
 *   <div v-feature="{ key: 'new-feature' }">
 *     New feature content
 *   </div>
 *
 *   <!-- Multiple features -->
 *   <div v-feature="{ key: ['feature-a', 'feature-b'], requirement: 'all' }">
 *     Both features required
 *   </div>
 *
 *   <!-- Negated -->
 *   <div v-feature="{ key: 'maintenance-mode', negate: true }">
 *     Show when NOT in maintenance mode
 *   </div>
 *
 *   <!-- Using modifiers -->
 *   <div v-feature.any="['feature-a', 'feature-b']">
 *     Any feature enabled
 *   </div>
 *
 *   <div v-feature.not="'beta-feature'">
 *     Show when beta is disabled
 *   </div>
 * </template>
 * ```
 */
export const vFeature: Directive<HTMLElement, string | string[] | FeatureDirectiveValue> = {
  mounted(el, binding) {
    updateVisibility(el, binding)
  },

  updated(el, binding) {
    updateVisibility(el, binding)
  },
}

/**
 * Parse directive binding to get feature options
 */
function parseBinding(
  binding: DirectiveBinding<string | string[] | FeatureDirectiveValue>
): {
  keys: string[]
  requirement: 'all' | 'any'
  negate: boolean
} {
  const { value, modifiers } = binding

  // Handle string or string array
  if (typeof value === 'string' || Array.isArray(value)) {
    return {
      keys: normalizeFeatureKeys(value as string | string[]),
      requirement: modifiers.any ? 'any' : 'all',
      negate: modifiers.not ?? false,
    }
  }

  // Handle object
  const opts = value as FeatureDirectiveValue
  return {
    keys: normalizeFeatureKeys(opts.key),
    requirement: opts.requirement ?? (modifiers.any ? 'any' : 'all'),
    negate: opts.negate ?? modifiers.not ?? false,
  }
}

/**
 * Update element visibility based on feature state
 */
function updateVisibility(
  el: HTMLElement,
  binding: DirectiveBinding<string | string[] | FeatureDirectiveValue>
): void {
  const { keys, requirement, negate } = parseBinding(binding)

  if (keys.length === 0) {
    // No keys specified, show element
    el.style.display = ''
    return
  }

  const client = getTogglyClient()

  if (!client) {
    console.warn('[Toggly] v-feature directive: Client not initialized')
    // Hide element if client not available
    el.style.display = 'none'
    return
  }

  // Get features from client state
  const features = client.state.features
  const isEnabled = evaluateGate(features, keys, requirement, negate)

  // Toggle visibility
  el.style.display = isEnabled ? '' : 'none'
}

/**
 * v-feature-show directive - uses visibility instead of display
 * Element takes up space even when hidden
 */
export const vFeatureShow: Directive<HTMLElement, string | string[] | FeatureDirectiveValue> = {
  mounted(el, binding) {
    updateShowVisibility(el, binding)
  },

  updated(el, binding) {
    updateShowVisibility(el, binding)
  },
}

function updateShowVisibility(
  el: HTMLElement,
  binding: DirectiveBinding<string | string[] | FeatureDirectiveValue>
): void {
  const { keys, requirement, negate } = parseBinding(binding)

  if (keys.length === 0) {
    el.style.visibility = 'visible'
    return
  }

  const client = getTogglyClient()

  if (!client) {
    el.style.visibility = 'hidden'
    return
  }

  const features = client.state.features
  const isEnabled = evaluateGate(features, keys, requirement, negate)

  el.style.visibility = isEnabled ? 'visible' : 'hidden'
}

/**
 * v-feature-class directive - adds/removes class based on feature
 *
 * @example
 * ```vue
 * <div v-feature-class:enabled="'new-feature'">
 *   Has 'enabled' class when feature is on
 * </div>
 *
 * <div v-feature-class:beta="{ key: 'beta-mode' }">
 *   Has 'beta' class when feature is on
 * </div>
 * ```
 */
export const vFeatureClass: Directive<HTMLElement, string | string[] | FeatureDirectiveValue> = {
  mounted(el, binding) {
    updateClass(el, binding)
  },

  updated(el, binding) {
    updateClass(el, binding)
  },
}

function updateClass(
  el: HTMLElement,
  binding: DirectiveBinding<string | string[] | FeatureDirectiveValue>
): void {
  const className = binding.arg
  if (!className) {
    console.warn('[Toggly] v-feature-class requires an argument (class name)')
    return
  }

  const { keys, requirement, negate } = parseBinding(binding)

  if (keys.length === 0) {
    return
  }

  const client = getTogglyClient()

  if (!client) {
    el.classList.remove(className)
    return
  }

  const features = client.state.features
  const isEnabled = evaluateGate(features, keys, requirement, negate)

  if (isEnabled) {
    el.classList.add(className)
  } else {
    el.classList.remove(className)
  }
}
