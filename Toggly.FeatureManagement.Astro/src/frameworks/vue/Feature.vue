<template>
  <slot v-if="isReady && isEnabled" />
  <slot v-else name="fallback" />
</template>

<script setup lang="ts">
/**
 * Vue Feature Component for Astro Islands
 * 
 * Use this component in Vue islands within Astro for client-side feature flagging.
 * Integrates with nanostores for reactive state management.
 * 
 * @example
 * ```vue
 * <Feature flag="new-dashboard">
 *   <Dashboard />
 * </Feature>
 * ```
 * 
 * @example Multiple flags with 'any' requirement
 * ```vue
 * <Feature :flags="['feature1', 'feature2']" requirement="any">
 *   <Content />
 * </Feature>
 * ```
 * 
 * @example With fallback
 * ```vue
 * <Feature flag="premium-feature">
 *   <PremiumContent />
 *   <template #fallback>
 *     <UpgradePrompt />
 *   </template>
 * </Feature>
 * ```
 */

import { computed } from 'vue';
import { useStore } from '@nanostores/vue';
import { $flags, $isReady } from '../../client/store.js';

export interface FeatureProps {
  /** Single feature flag key to check */
  flag?: string;
  /** Multiple feature flag keys to check */
  flags?: string[];
  /** Requirement for multiple flags: 'all' or 'any' (default: 'all') */
  requirement?: 'all' | 'any';
  /** If true, negates the result (default: false) */
  negate?: boolean;
}

const props = withDefaults(defineProps<FeatureProps>(), {
  requirement: 'all',
  negate: false,
});

const allFlags = useStore($flags);
const isReady = useStore($isReady);

const isEnabled = computed(() => {
  // Build flag keys array
  const flagKeys: string[] = [];
  if (props.flag) {
    flagKeys.push(props.flag);
  }
  if (props.flags && Array.isArray(props.flags)) {
    flagKeys.push(...props.flags);
  }

  // No flags specified
  if (flagKeys.length === 0) {
    return !props.negate;
  }

  // Evaluate flags
  let enabled: boolean;

  if (props.requirement === 'any') {
    enabled = flagKeys.some((key) => allFlags.value[key] === true);
  } else {
    enabled = flagKeys.every((key) => allFlags.value[key] === true);
  }

  if (props.negate) {
    enabled = !enabled;
  }

  return enabled;
});
</script>


