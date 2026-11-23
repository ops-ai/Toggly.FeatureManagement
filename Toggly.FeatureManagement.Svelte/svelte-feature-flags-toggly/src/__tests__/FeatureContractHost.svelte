<script lang="ts">
  import Feature from '../components/Feature.svelte'
  import FeatureGateBuilder from '../components/FeatureGateBuilder.svelte'

  export let featureOn = 'FlagOn'
  export let featureOff = 'FlagOff'
</script>

<Feature featureKey={featureOn}>
  <span data-testid="feature-on">visible</span>
</Feature>
<Feature featureKey={featureOff}>
  <span data-testid="feature-off">hidden</span>
</Feature>
<FeatureGateBuilder featureKey={featureOn} let:enabled>
  <span data-testid="builder">{enabled ? 'true' : 'false'}</span>
</FeatureGateBuilder>
