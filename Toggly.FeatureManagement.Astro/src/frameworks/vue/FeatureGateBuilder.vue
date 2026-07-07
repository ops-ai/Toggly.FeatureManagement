<template>
  <slot :enabled="enabled" />
</template>

<script setup lang="ts">
/**
 * Vue FeatureGateBuilder for Astro Islands
 *
 * Always renders its slot and exposes the resolved gate boolean for conditional UI.
 */

import { computed } from 'vue';
import { useStore } from '@nanostores/vue';
import { $flags, $gate, $isReady, $localGatesRevision } from '../../client/store.js';

export interface FeatureGateBuilderProps {
  /** Single feature flag key to check */
  flag?: string;
  /** Multiple feature flag keys to check */
  flags?: string[];
  /** Requirement for multiple flags: 'all' or 'any' (default: 'all') */
  requirement?: 'all' | 'any';
  /** If true, negates the result (default: false) */
  negate?: boolean;
}

const props = withDefaults(defineProps<FeatureGateBuilderProps>(), {
  requirement: 'all',
  negate: false,
});

const isReady = useStore($isReady);
const flags = useStore($flags);
const localGatesRevision = useStore($localGatesRevision);

const flagKeys = computed(() => {
  const keys: string[] = [];
  if (props.flag) {
    keys.push(props.flag);
  }
  if (props.flags && Array.isArray(props.flags)) {
    keys.push(...props.flags);
  }
  return keys;
});

const gateAtom = computed(() => $gate(flagKeys.value, props.requirement, props.negate));

const enabled = computed(() => {
  if (!isReady.value) {
    return false;
  }
  void flags.value;
  void localGatesRevision.value;
  return gateAtom.value.get();
});
</script>
