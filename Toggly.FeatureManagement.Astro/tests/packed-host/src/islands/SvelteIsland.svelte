<script lang="ts">
import { featureFlag, isReady } from '@ops-ai/astro-feature-flags-toggly/svelte';
import FeatureGateBuilder from '@ops-ai/astro-feature-flags-toggly/svelte/FeatureGateBuilder.svelte';
import Feature from '@ops-ai/astro-feature-flags-toggly/svelte/Feature.svelte';
const enabled = featureFlag('Visible');
</script>
<section><output id="svelte-state">{$isReady ? String($enabled) : 'loading'}</output>
<Feature flag="Visible"><span id="svelte-content">svelte-enabled</span></Feature><FeatureGateBuilder flag="Visible" let:enabled><output id="svelte-builder">{String(enabled)}</output></FeatureGateBuilder></section>
