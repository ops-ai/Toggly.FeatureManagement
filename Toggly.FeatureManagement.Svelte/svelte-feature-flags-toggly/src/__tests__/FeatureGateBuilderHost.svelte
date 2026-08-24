<script lang="ts">
  import FeatureGateBuilder from '../components/FeatureGateBuilder.svelte'

  export let featureKey: string | undefined = undefined
  export let featureKeys: string[] | undefined = undefined
  export let requirement: 'all' | 'any' = 'all'
  export let negate = false
</script>

<FeatureGateBuilder {featureKey} {featureKeys} {requirement} {negate} let:enabled>
  <span data-testid="state">{enabled ? 'on' : 'off'}</span>
</FeatureGateBuilder>
