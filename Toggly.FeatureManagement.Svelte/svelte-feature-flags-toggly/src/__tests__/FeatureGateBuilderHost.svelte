<script lang="ts">
  import FeatureGateBuilder from '../components/FeatureGateBuilder.svelte'

  export let featureKey = 'Enabled'
</script>

<FeatureGateBuilder {featureKey} let:enabled>
  <span data-testid="state">{enabled ? 'on' : 'off'}</span>
</FeatureGateBuilder>
