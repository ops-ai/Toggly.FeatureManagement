<template>
  <slot v-if="isReady && isEnabled" />
</template>

<script setup lang="ts">
/**
 * Vue Feature Component for Astro Islands
 * Use `negate` for the off path (no #fallback slot).
 */

import { computed } from 'vue';
import { useStore } from '@nanostores/vue';
import { $flags, $gate, $isReady, $localGatesRevision } from '../../client/store.js';
import type { TogglyEntityContext } from '@ops-ai/toggly-hooks-types';

export interface FeatureProps {
  /** Single feature flag key to check */
  flag?: string;
  /** Multiple feature flag keys to check */
  flags?: string[];
  /** Requirement for multiple flags: 'all' or 'any' (default: 'all') */
  requirement?: 'all' | 'any';
  /** If true, negates the result (default: false) */
  negate?: boolean;
  /** Entity instance or canonical entity context for entity-gated flags */
  context?: TogglyEntityContext | Record<string, unknown> | null;
  /** Context kind for registerContext mapper lookup when `context` is a domain object */
  contextKind?: string;
}

const props = withDefaults(defineProps<FeatureProps>(), {
  requirement: 'all',
  negate: false,
  context: null,
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

const gateAtom = computed(() =>
  $gate(flagKeys.value, props.requirement, props.negate, props.context, props.contextKind),
);

const isEnabled = computed(() => {
  void flags.value;
  void localGatesRevision.value;
  return gateAtom.value.get();
});
</script>
