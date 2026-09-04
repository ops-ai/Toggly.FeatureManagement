<script lang="ts">
/**
 * Svelte Feature Component for Astro Islands
 * Use `negate` for the off path (no fallback slot).
 */

import { $gate, $isReady, $flags, $localGatesRevision } from '../../client/store.js';
import type { TogglyEntityContext } from '@ops-ai/toggly-hooks-types';

export let flag: string | undefined = undefined;
export let flags: string[] | undefined = undefined;
export let requirement: 'all' | 'any' = 'all';
export let negate: boolean = false;
export let context: TogglyEntityContext | Record<string, unknown> | null = null;
export let contextKind: string | undefined = undefined;

$: flagKeys = (() => {
  const keys: string[] = [];
  if (flag) keys.push(flag);
  if (flags && Array.isArray(flags)) keys.push(...flags);
  return keys;
})();

$: gateAtom = $gate(flagKeys, requirement, negate, context, contextKind);

$: isEnabled = (() => {
  void $flags;
  void $localGatesRevision;
  return gateAtom.get();
})();
</script>

{#if $isReady && isEnabled}
  <slot />
{/if}
