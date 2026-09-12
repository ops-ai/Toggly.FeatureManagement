<script lang="ts">
  import type { TogglyStore, GateOptions } from '../dist/index.js';
  export let toggly: TogglyStore;
  export let feature: string | string[];
  export let options: GateOptions = {};
  // Subscribe to this layout instance so navigation and verified refreshes invalidate the gate.
  $: allowed = $toggly && toggly.gate(typeof feature === 'string' ? [feature] : feature, options);
</script>

{#if allowed}<slot />{:else}<slot name="fallback" />{/if}
