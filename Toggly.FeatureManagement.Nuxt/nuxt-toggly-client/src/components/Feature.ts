import { defineComponent, h, type PropType, type VNode } from 'vue'
import { useFeatureProps } from '../composables/useFeatureGate'
import type { FeatureRequirement } from '@ops-ai/nuxt-toggly-core'

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
 *   <!-- With fallback slot -->
 *   <Feature feature-key="beta-feature">
 *     <template #default>
 *       <BetaContent />
 *     </template>
 *     <template #fallback>
 *       <StableContent />
 *     </template>
 *   </Feature>
 *
 *   <!-- Negated (show when disabled) -->
 *   <Feature feature-key="maintenance-mode" negate>
 *     <MainContent />
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
  },

  setup(props, { slots }) {
    const { isEnabled, isLoading } = useFeatureProps(props)

    return () => {
      // Show loading slot if available and loading
      if (isLoading.value && slots.loading) {
        return slots.loading()
      }

      // Show content or fallback based on feature state
      if (isEnabled.value) {
        return slots.default?.() ?? null
      }

      // Return fallback slot if available
      return slots.fallback?.() ?? null
    }
  },
})

/**
 * FeatureEnabled component - convenience wrapper
 * Only renders when feature is enabled
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
