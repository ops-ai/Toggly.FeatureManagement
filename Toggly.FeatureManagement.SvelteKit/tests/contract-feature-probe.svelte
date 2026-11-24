<script lang="ts">
  import Feature from '../src/Feature.svelte';
  import type { TogglyStore, GateOptions } from '../src/index.js';

  export let toggly: TogglyStore;
  export let feature: string | string[];
  export let options: GateOptions = {};
  export let label = 'visible';
</script>

<Feature {toggly} {feature} {options}><span data-testid="probe">{label}</span></Feature>
