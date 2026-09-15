<script lang="ts">
/**
 * Svelte FeatureGateBuilder for Astro Islands
 *
 * Always renders its slot and exposes the resolved gate boolean for conditional UI.
 */

import { $gate as createGate, $isReady as ready } from '../../client/store.js';

export let flag: string | undefined = undefined;
export let flags: string[] | undefined = undefined;
export let requirement: 'all' | 'any' = 'all';
export let negate: boolean = false;
export let context: import('@ops-ai/toggly-hooks-types').TogglyEntityContext | Record<string, unknown> | null = null;
export let contextKind: string | undefined = undefined;

$: flagKeys = (() => {
  const keys: string[] = [];
  if (flag) keys.push(flag);
  if (flags && Array.isArray(flags)) keys.push(...flags);
  return keys;
})();

$: gateAtom = createGate(flagKeys, requirement, negate, context, contextKind);

$: enabled = $ready && $gateAtom;
</script>

<slot {enabled} />
