import { defineComponent, type PropType } from 'vue'
import { useFeatureProps } from '../composables/useFeatureGate'
import type { FeatureRequirement } from '@ops-ai/nuxt-toggly-core'
import type { TogglyEntityContext } from '@ops-ai/nuxt-toggly-core'

/**
 * Feature component for conditional rendering based on feature flags
 *
 * @example
 * ```vue
 * <template>
 *   <!-- Single feature -->
 *   <Feature feature-key="new-dashboard">
 *     <NewDashboard />
 *   </Feature>
 *
 *   <!-- Multiple features with requirement -->
 *   <Feature :feature-keys="['feature-a', 'feature-b']" requirement="all">
 *     <FullExperience />
 *   </Feature>
 *
 *   <!-- Negated (show when disabled) -->
 *   <Feature feature-key="maintenance-mode" negate>
 *     <MainContent />
 *   </Feature>
 *
 *   <!-- Entity context -->
 *   <Feature feature-key="OrderBadge" :context="order" context-kind="Order">
 *     <Badge />
 *   </Feature>
 * </template>
 * ```
 */
export const Feature = defineComponent({
  name: 'Feature',

  props: {
    /**
     * Single feature key to check
     */
    featureKey: {
      type: String,
      default: undefined,
    },
    /**
     * Multiple feature keys to check
     */
    featureKeys: {
      type: Array as PropType<string[]>,
      default: undefined,
    },
    /**
     * Requirement type for multiple features
     * - 'all': All features must be enabled (default)
     * - 'any': At least one feature must be enabled
     */
    requirement: {
      type: String as PropType<FeatureRequirement>,
      default: 'all',
    },
    /**
     * Negate the result
     * When true, content is shown when feature(s) are DISABLED
     */
    negate: {
      type: Boolean,
      default: false,
    },
    /**
     * Entity instance or canonical entity context for entity-gated flags
     */
    context: {
      type: Object as PropType<TogglyEntityContext | Record<string, unknown> | null>,
      default: null,
    },
    /**
     * Context kind for registerContext mapper lookup when `context` is a domain object
     */
    contextKind: {
      type: String,
      default: undefined,
    },
  },

  setup(props, { slots }) {
    const { isEnabled, isLoading } = useFeatureProps(props)

    return () => {
      // Show loading slot if available and loading
      if (isLoading.value && slots.loading) {
        return slots.loading()
      }

      if (isEnabled.value) {
        return slots.default?.() ?? null
      }

      // Off path: use a separate Feature with negate (no #fallback slot)
      return null
    }
  },
})

/**
 * FeatureEnabled component - convenience wrapper
 * Only renders when feature is enabled
 * @deprecated Use `<Feature feature-key="…">` instead
 */
export const FeatureEnabled = defineComponent({
  name: 'FeatureEnabled',

  props: {
    featureKey: {
      type: String,
      required: true,
    },
  },

  setup(props, { slots }) {
    const { isEnabled } = useFeatureProps({ featureKey: props.featureKey })

    return () => {
      if (isEnabled.value) {
        return slots.default?.() ?? null
      }
      return null
    }
  },
})

/**
 * FeatureDisabled component - convenience wrapper
 * Only renders when feature is disabled
 * @deprecated Use `<Feature feature-key="…" negate>` instead
 */
export const FeatureDisabled = defineComponent({
  name: 'FeatureDisabled',

  props: {
    featureKey: {
      type: String,
      required: true,
    },
  },

  setup(props, { slots }) {
    const { isDisabled } = useFeatureProps({ featureKey: props.featureKey })

    return () => {
      if (isDisabled.value) {
        return slots.default?.() ?? null
      }
      return null
    }
  },
})
