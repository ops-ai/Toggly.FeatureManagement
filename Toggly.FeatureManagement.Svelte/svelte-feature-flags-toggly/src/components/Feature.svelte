<script lang="ts">
  import { onMount } from 'svelte'
  import { getTogglyService } from '../stores/toggly.store'
  import type { TogglyService } from '../services/toggly.service'

  export let featureKey: string | undefined = undefined
  export let featureKeys: string[] | undefined = undefined
  export let requirement: 'all' | 'any' = 'all'
  export let negate: boolean = false

  let shouldShow: boolean = false
  let toggly: TogglyService | null = null

  async function evaluateFeature() {
    if (!toggly) {
      try {
        toggly = getTogglyService()
      } catch (error) {
        console.error('Toggly Feature component error:', error)
        shouldShow = false
        return
      }
    }

    // Check if we should show the feature during evaluation
    shouldShow = toggly.shouldShowFeatureDuringEvaluation

    const gate: string[] = []

    if (featureKey) {
      gate.push(featureKey)
    }

    if (featureKeys) {
      gate.push(...featureKeys)
    }

    if (gate.length > 0 && toggly) {
      try {
        shouldShow = await toggly.evaluateFeatureGate(gate, requirement, negate)
      } catch (error) {
        console.error('Toggly Feature evaluation error:', error)
        shouldShow = false
      }
    } else {
      shouldShow = true
    }
  }

  // Reactive statement to re-evaluate when props change
  $: if (toggly || featureKey || featureKeys) {
    evaluateFeature()
  }

  onMount(() => {
    evaluateFeature()
  })
</script>

{#if shouldShow}
  <slot />
{/if}
