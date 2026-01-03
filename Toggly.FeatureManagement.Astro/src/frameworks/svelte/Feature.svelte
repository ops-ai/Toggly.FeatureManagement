<script lang="ts">
/**
 * Svelte Feature Component for Astro Islands
 * 
 * Use this component in Svelte islands within Astro for client-side feature flagging.
 * Integrates with nanostores for reactive state management.
 * 
 * @example
 * ```svelte
 * <Feature flag="new-dashboard">
 *   <Dashboard />
 * </Feature>
 * ```
 * 
 * @example Multiple flags with 'any' requirement
 * ```svelte
 * <Feature flags={['feature1', 'feature2']} requirement="any">
 *   <Content />
 * </Feature>
 * ```
 * 
 * @example With fallback
 * ```svelte
 * <Feature flag="premium-feature">
 *   <PremiumContent />
 *   <svelte:fragment slot="fallback">
 *     <UpgradePrompt />
 *   </svelte:fragment>
 * </Feature>
 * ```
 */

import { $flags, $isReady } from '../../client/store.js';

export let flag: string | undefined = undefined;
export let flags: string[] | undefined = undefined;
export let requirement: 'all' | 'any' = 'all';
export let negate: boolean = false;

// Reactively compute whether the feature is enabled
$: flagKeys = (() => {
  const keys: string[] = [];
  if (flag) keys.push(flag);
  if (flags && Array.isArray(flags)) keys.push(...flags);
  return keys;
})();

$: isEnabled = (() => {
  if (flagKeys.length === 0) {
    return !negate;
  }

  let enabled: boolean;

  if (requirement === 'any') {
    enabled = flagKeys.some((key) => $flags[key] === true);
  } else {
    enabled = flagKeys.every((key) => $flags[key] === true);
  }

  if (negate) {
    enabled = !enabled;
  }

  return enabled;
})();
</script>

{#if $isReady && isEnabled}
  <slot />
{:else}
  <slot name="fallback" />
{/if}


