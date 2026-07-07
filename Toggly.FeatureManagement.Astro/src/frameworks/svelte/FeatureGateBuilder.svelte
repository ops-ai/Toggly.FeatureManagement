<script lang="ts">
/**
 * Svelte FeatureGateBuilder for Astro Islands
 *
 * Always renders its slot and exposes the resolved gate boolean for conditional UI.
 */

import { $gate, $isReady, $flags, $localGatesRevision } from '../../client/store.js';

export let flag: string | undefined = undefined;
export let flags: string[] | undefined = undefined;
export let requirement: 'all' | 'any' = 'all';
export let negate: boolean = false;

$: flagKeys = (() => {
  const keys: string[] = [];
  if (flag) keys.push(flag);
  if (flags && Array.isArray(flags)) keys.push(...flags);
  return keys;
})();

$: gateAtom = $gate(flagKeys, requirement, negate);

$: enabled = (() => {
  if (!$isReady) {
    return false;
  }
  void $flags;
  void $localGatesRevision;
  return gateAtom.get();
})();
</script>

<slot {enabled} />
